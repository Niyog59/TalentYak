import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { isReservedTestAddress, type EmailTransport } from "@/lib/email";
import * as T from "@/lib/email/templates";
import type { RenderedEmail } from "@/lib/email/templates";
import type { NotificationCategory } from "@/lib/notifications";
import {
  appointmentStillCurrent,
  emailStillWanted,
  messagesStillUnread,
  recipientStillValid,
  type Decision,
} from "@/lib/worker/recheck";

/**
 * What each outbox topic does.
 *
 * A handler returns an OUTCOME rather than throwing, so the worker records
 * precisely what happened: done, retry later, give up, or blocked on
 * configuration. An email job's outcome is "accepted by the provider", never
 * "delivered" — the worker cannot know that.
 */

export interface OutboxJob {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export type Outcome =
  | { kind: "done"; result: Record<string, unknown> }
  | { kind: "retry"; error: string }
  | { kind: "fail"; error: string }
  | { kind: "blocked"; error: string };

export interface HandlerContext {
  admin: SupabaseClient;
  transport: EmailTransport;
  enqueue: (topic: string, payload: Record<string, unknown>, dedupeKey: string) => Promise<void>;
}

type Handler = (job: OutboxJob, ctx: HandlerContext) => Promise<Outcome>;

const tctx = (): T.TemplateContext => ({ siteUrl: env.siteUrl, supportEmail: env.supportEmail || null });

interface Person {
  id: string;
  email: string;
  name: string | null;
  timezone: string | null;
}

async function person(ctx: HandlerContext, profileId: unknown): Promise<Person | null> {
  if (typeof profileId !== "string") return null;
  const { data } = await ctx.admin
    .from("profiles")
    .select("id, email, preferred_name, full_name, timezone")
    .eq("id", profileId)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, email: data.email, name: data.preferred_name || data.full_name || null, timezone: data.timezone };
}

async function coachPerson(ctx: HandlerContext, providerId: unknown): Promise<(Person & { displayName: string }) | null> {
  if (typeof providerId !== "string") return null;
  const { data } = await ctx.admin
    .from("providers")
    .select("profile_id, display_name, provider_public_profiles(display_name)")
    .eq("id", providerId)
    .maybeSingle();
  if (!data?.profile_id) return null;
  const p = await person(ctx, data.profile_id);
  if (!p) return null;
  const pub = data.provider_public_profiles as unknown as { display_name?: string } | { display_name?: string }[] | null;
  const publicName = Array.isArray(pub) ? pub[0]?.display_name : pub?.display_name;
  return { ...p, displayName: publicName || data.display_name };
}

async function adminPeople(ctx: HandlerContext): Promise<Person[]> {
  const { data } = await ctx.admin
    .from("profiles")
    .select("id, email, preferred_name, full_name, timezone")
    .eq("role", "admin")
    .is("suspended_at", null);
  return (data ?? []).map((d) => ({ id: d.id, email: d.email, name: d.preferred_name || d.full_name, timezone: d.timezone }));
}

/**
 * Sends one rendered email to one person and records the truth about it.
 *
 * Four things happen in a fixed order, and the order is the point:
 *
 *   1. The job's own preconditions are rechecked (`opts.recheck`) — is this
 *      session still happening, at this time, for this person. A job that fails
 *      this is `done`, not failed: skipping it was the correct outcome.
 *   2. The recipient is rechecked. Suspended, deleted, no address — skip.
 *   3. The notification is written to their inbox, whether or not the email
 *      goes. Switching an email off means you stop being emailed, not that you
 *      stop being told.
 *   4. The preference is rechecked and, if it allows, the provider is called.
 *
 * Steps 2–4 only apply to a recipient who has an account. An invitation to
 * somebody who is not a user yet has no inbox and no preferences.
 */
async function send(
  job: OutboxJob,
  ctx: HandlerContext,
  template: string,
  to: Person | { id: null; email: string },
  email: RenderedEmail,
  opts: {
    category?: NotificationCategory;
    /** Where the person goes to act on it. Same-site path. */
    path?: string;
    /** A shorter summary for the inbox. Defaults to the subject line. */
    inboxTitle?: string;
    /** The job's own preconditions, checked immediately before sending. */
    recheck?: () => Promise<Decision>;
  } = {},
): Promise<Outcome> {
  if (opts.recheck) {
    const decision = await opts.recheck();
    if (!decision.proceed) {
      return { kind: "done", result: { sent: false, reason: "skipped", detail: decision.reason, template } };
    }
  }

  let notificationId: string | null = null;

  if (to.id && opts.category) {
    const valid = await recipientStillValid(ctx.admin, to.id);
    if (!valid.proceed) {
      return { kind: "done", result: { sent: false, reason: "skipped", detail: valid.reason, template } };
    }

    // The inbox record is written before the send is attempted, so it exists
    // even if the provider is unreachable and the job retries for hours.
    const { data } = await ctx.admin.rpc("create_notification", {
      p_profile_id: to.id,
      p_category: opts.category,
      p_title: opts.inboxTitle ?? email.subject,
      p_body: null,
      p_path: opts.path ?? null,
      p_dedupe_key: `outbox:${job.id}`,
      p_outbox_id: job.id,
    });
    notificationId = (data as string) ?? null;

    const wanted = await emailStillWanted(ctx.admin, to.id, opts.category);
    if (!wanted.proceed) {
      return {
        kind: "done",
        result: { sent: false, reason: "preference", detail: wanted.reason, template, notification_id: notificationId },
      };
    }
  }

  if (isReservedTestAddress(to.email)) {
    // Test fixtures use reserved domains. Never send to them: it would bounce and
    // harm the sending domain. Recorded honestly as not sent.
    return { kind: "done", result: { sent: false, reason: "reserved_test_address", template, notification_id: notificationId } };
  }

  const result = await ctx.transport({
    to: to.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey: `outbox:${job.id}`,
    replyTo: env.supportEmail || undefined,
  });

  if (result.status === "unconfigured") {
    return { kind: "blocked", error: result.reason };
  }

  const state = result.status === "accepted" ? "accepted" : "failed";
  await ctx.admin.from("notification_deliveries").upsert(
    {
      outbox_id: job.id,
      template,
      recipient_profile_id: to.id,
      recipient_email: to.email,
      subject: email.subject,
      provider_message_id: result.status === "accepted" ? result.providerMessageId : null,
      state,
      error: result.status === "failed" ? result.reason.slice(0, 1000) : null,
    },
    { onConflict: "outbox_id" },
  );

  if (result.status === "accepted") {
    return {
      kind: "done",
      result: { sent: true, accepted: true, template, provider_message_id: result.providerMessageId, notification_id: notificationId },
    };
  }
  return result.retryable ? { kind: "retry", error: result.reason } : { kind: "fail", error: result.reason };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

interface AppointmentContext {
  id: string;
  starts_at: string;
  state: string;
  customer: Person;
  coach: Person & { displayName: string };
}

async function appointmentContext(ctx: HandlerContext, appointmentId: unknown): Promise<AppointmentContext | null> {
  if (typeof appointmentId !== "string") return null;
  const { data } = await ctx.admin
    .from("appointments")
    .select("id, starts_at, state, customer_id, provider_id")
    .eq("id", appointmentId)
    .maybeSingle();
  if (!data) return null;

  const customer = await person(ctx, data.customer_id);
  const coach = await coachPerson(ctx, data.provider_id);
  if (!customer || !coach) return null;

  return { id: data.id, starts_at: data.starts_at, state: data.state, customer, coach };
}

/**
 * Which side of the appointment this message is for, and what the other side
 * is called. A coach is named to their client by their public display name,
 * never by the name on their account.
 */
function recipientOf(
  ap: AppointmentContext,
  recipient: unknown,
): { person: Person; otherName: string; isCustomer: boolean } | null {
  if (recipient === "customer") {
    return { person: ap.customer, otherName: ap.coach.displayName, isCustomer: true };
  }
  if (recipient === "provider" || recipient === "coach") {
    return { person: ap.coach, otherName: ap.customer.name?.split(" ")[0] ?? "your client", isCustomer: false };
  }
  return null;
}

async function purchaseContext(ctx: HandlerContext, purchaseId: unknown) {
  if (typeof purchaseId !== "string") return null;
  const { data } = await ctx.admin
    .from("purchases")
    .select("id, customer_id, provider_id, charge_amount_minor, charge_currency, service_type, paid_through_at, ends_at, inclusions_snapshot")
    .eq("id", purchaseId)
    .maybeSingle();
  return data;
}

// ---------------------------------------------------------------------------

export const HANDLERS: Record<string, Handler> = {
  "email.coach_invitation": async (job, ctx) => {
    const to = str(job.payload.email);
    if (!to) return { kind: "fail", error: "missing email" };
    return send(job, ctx, "coach_invitation", { id: null, email: to },
      T.coachInvitationEmail(tctx(), { inviteUrl: str(job.payload.invite_url), expiresAt: str(job.payload.expires_at) }));
  },

  "email.purchase_confirmed": async (job, ctx) => {
    const pu = await purchaseContext(ctx, job.payload.purchase_id);
    if (!pu) return { kind: "fail", error: "purchase not found" };
    const customer = await person(ctx, pu.customer_id);
    const coach = await coachPerson(ctx, pu.provider_id);
    if (!customer || !coach) return { kind: "fail", error: "recipient not found" };
    const title = str((pu.inclusions_snapshot as Record<string, unknown>)?.title) || "your plan";

    await ctx.enqueue("email.new_client", { purchase_id: pu.id }, `new_client:${pu.id}`);

    return send(job, ctx, "purchase_confirmed", customer, T.purchaseConfirmedEmail(tctx(), {
      customerName: customer.name, coachName: coach.displayName, planTitle: title,
      amountMinor: pu.charge_amount_minor, currency: pu.charge_currency,
      recurring: pu.service_type === "recurring_coaching", paidThrough: pu.paid_through_at, timezone: customer.timezone,
    }), { category: "billing", path: "/account/billing" });
  },

  "email.new_client": async (job, ctx) => {
    const pu = await purchaseContext(ctx, job.payload.purchase_id);
    if (!pu) return { kind: "fail", error: "purchase not found" };
    const coach = await coachPerson(ctx, pu.provider_id);
    const customer = await person(ctx, pu.customer_id);
    if (!coach) return { kind: "fail", error: "coach not found" };
    return send(job, ctx, "new_client", coach, T.newClientEmail(tctx(), {
      coachName: coach.name,
      planTitle: str((pu.inclusions_snapshot as Record<string, unknown>)?.title) || "a plan",
      // First name only: a coach needs to know who, not the customer's full identity in an inbox.
      customerFirstName: customer?.name?.split(" ")[0] ?? null,
    }), { category: "coaching", path: "/coach/clients" });
  },

  "email.payment_failed": async (job, ctx) => {
    const pu = await purchaseContext(ctx, job.payload.purchase_id);
    if (!pu) return { kind: "fail", error: "purchase not found" };
    const customer = await person(ctx, pu.customer_id);
    if (!customer) return { kind: "fail", error: "customer not found" };
    return send(job, ctx, "payment_failed", customer, T.paymentFailedEmail(tctx(), {
      customerName: customer.name, planTitle: str((pu.inclusions_snapshot as Record<string, unknown>)?.title) || "your plan",
      paidThrough: pu.paid_through_at, timezone: customer.timezone,
    }), { category: "billing", path: "/account/billing" });
  },

  "email.subscription_changed": async (job, ctx) => {
    const pu = await purchaseContext(ctx, job.payload.purchase_id);
    if (!pu) return { kind: "fail", error: "purchase not found" };
    const customer = await person(ctx, pu.customer_id);
    if (!customer) return { kind: "fail", error: "customer not found" };
    const title = str((pu.inclusions_snapshot as Record<string, unknown>)?.title) || "your plan";
    const state = str(job.payload.state);
    if (state === "cancelling") {
      return send(job, ctx, "subscription_cancelling", customer, T.subscriptionCancellingEmail(tctx(), {
        customerName: customer.name, planTitle: title, endsAt: pu.ends_at ?? pu.paid_through_at, timezone: customer.timezone,
      }), { category: "billing", path: "/account/billing" });
    }
    if (state === "ended") {
      return send(job, ctx, "subscription_ended", customer,
        T.subscriptionEndedEmail(tctx(), { customerName: customer.name, planTitle: title }),
        { category: "billing", path: "/account/billing" });
    }
    return { kind: "done", result: { sent: false, reason: `no email for state ${state}` } };
  },

  "email.refund_processed": async (job, ctx) => {
    const pu = await purchaseContext(ctx, job.payload.purchase_id);
    if (!pu) return { kind: "fail", error: "purchase not found" };
    const customer = await person(ctx, pu.customer_id);
    if (!customer) return { kind: "fail", error: "customer not found" };
    return send(job, ctx, "refund_processed", customer, T.refundProcessedEmail(tctx(), {
      customerName: customer.name, amountMinor: num(job.payload.amount_minor), currency: str(job.payload.currency) || pu.charge_currency,
    }), { category: "billing", path: "/account/billing" });
  },

  "email.coach_change_requested": async (job, ctx) => {
    const admins = await adminPeople(ctx);
    for (const a of admins) {
      await ctx.enqueue("email.admin_alert", { admin_id: a.id, title: "Coach change requested", detail: "A customer has asked to change coach.", path: "/admin/coach-changes" }, `admin_alert:${job.id}:${a.id}`);
    }
    return { kind: "done", result: { fanned_out: admins.length } };
  },

  "email.coach_changed": async (job, ctx) => {
    const p = job.payload;
    const base = `coach_changed:${str(p.request_id)}`;
    await ctx.enqueue("email.coach_changed_customer", p, `${base}:customer`);
    await ctx.enqueue("email.coach_changed_previous", p, `${base}:previous`);
    await ctx.enqueue("email.coach_changed_new", p, `${base}:new`);
    return { kind: "done", result: { fanned_out: 3 } };
  },

  "email.coach_changed_customer": async (job, ctx) => {
    const customer = await person(ctx, job.payload.customer_id);
    const coach = await coachPerson(ctx, job.payload.new_provider_id);
    if (!customer || !coach) return { kind: "fail", error: "recipient not found" };
    return send(job, ctx, "coach_changed_customer", customer, T.coachChangedCustomerEmail(tctx(), {
      customerName: customer.name, newCoachName: coach.displayName, effectiveAt: str(job.payload.effective_at), timezone: customer.timezone,
    }), { category: "coaching", path: "/account" });
  },

  "email.coach_changed_previous": async (job, ctx) => {
    const coach = await coachPerson(ctx, job.payload.previous_provider_id);
    if (!coach) return { kind: "fail", error: "coach not found" };
    return send(job, ctx, "coach_changed_previous", coach,
      T.coachChangedPreviousCoachEmail(tctx(), { coachName: coach.name, effectiveAt: str(job.payload.effective_at) }),
      { category: "coaching", path: "/coach/clients" });
  },

  "email.coach_changed_new": async (job, ctx) => {
    const coach = await coachPerson(ctx, job.payload.new_provider_id);
    if (!coach) return { kind: "fail", error: "coach not found" };
    return send(job, ctx, "coach_changed_new", coach,
      T.coachChangedNewCoachEmail(tctx(), { coachName: coach.name, effectiveAt: str(job.payload.effective_at) }),
      { category: "coaching", path: "/coach/clients" });
  },

  "email.payout_paid": async (job, ctx) => {
    const coach = await coachPerson(ctx, job.payload.provider_id);
    if (!coach) return { kind: "fail", error: "coach not found" };
    return send(job, ctx, "payout_paid", coach, T.payoutPaidEmail(tctx(), {
      coachName: coach.name, amountMinor: num(job.payload.amount_minor), currency: str(job.payload.currency), paidAt: str(job.payload.paid_at),
      reference: str(job.payload.external_reference) || null,
    }), { category: "billing", path: "/coach/payouts" });
  },

  "email.profile_approved": async (job, ctx) => {
    const coach = await coachPerson(ctx, job.payload.provider_id);
    if (!coach) return { kind: "fail", error: "coach not found" };
    return send(job, ctx, "profile_approved", coach, T.profileApprovedEmail(tctx(), { coachName: coach.name }),
      { category: "coaching", path: "/coach/profile" });
  },

  "email.admin_alert": async (job, ctx) => {
    const admin = await person(ctx, job.payload.admin_id);
    if (!admin) return { kind: "fail", error: "admin not found" };
    return send(job, ctx, "admin_alert", admin, T.adminAlertEmail(tctx(), {
      title: str(job.payload.title), detail: str(job.payload.detail), path: str(job.payload.path) || "/admin",
    }), { category: "account_security", path: str(job.payload.path) || "/admin" });
  },

  // --- Sessions -------------------------------------------------------------
  //
  // PRODUCERS PENDING (Batch 4). Nothing enqueues these topics yet: booking,
  // rescheduling and reminder scheduling are that batch's work. The handlers,
  // their templates and their rechecks are finished and tested here so that
  // wiring a producer is the only thing left to do.

  "email.appointment_confirmed": async (job, ctx) => {
    const ap = await appointmentContext(ctx, job.payload.appointment_id);
    if (!ap) return { kind: "fail", error: "appointment not found" };
    const to = recipientOf(ap, job.payload.recipient);
    if (!to) return { kind: "fail", error: "recipient not found" };

    return send(job, ctx, "appointment_confirmed", to.person,
      T.appointmentConfirmedEmail(tctx(), {
        name: to.person.name, otherPartyName: to.otherName, startsAt: ap.starts_at, timezone: to.person.timezone,
      }),
      {
        category: "appointments",
        path: to.isCustomer ? "/account" : "/coach",
        recheck: () => appointmentStillCurrent(ctx.admin, ap.id, {
          startsAt: ap.starts_at, recipientProfileId: to.person.id,
        }),
      });
  },

  "email.appointment_changed": async (job, ctx) => {
    const ap = await appointmentContext(ctx, job.payload.appointment_id);
    if (!ap) return { kind: "fail", error: "appointment not found" };
    const to = recipientOf(ap, job.payload.recipient);
    if (!to) return { kind: "fail", error: "recipient not found" };

    return send(job, ctx, "appointment_changed", to.person,
      T.appointmentChangedEmail(tctx(), {
        name: to.person.name, otherPartyName: to.otherName, startsAt: ap.starts_at,
        previousStartsAt: str(job.payload.previous_starts_at) || null, timezone: to.person.timezone,
      }),
      {
        category: "appointments",
        path: to.isCustomer ? "/account" : "/coach",
        // The new time must still be the current one. If it moved twice, only
        // the later message is worth sending.
        recheck: () => appointmentStillCurrent(ctx.admin, ap.id, {
          startsAt: ap.starts_at, recipientProfileId: to.person.id,
        }),
      });
  },

  "email.appointment_cancelled": async (job, ctx) => {
    const ap = await appointmentContext(ctx, job.payload.appointment_id);
    if (!ap) return { kind: "fail", error: "appointment not found" };
    const to = recipientOf(ap, job.payload.recipient);
    if (!to) return { kind: "fail", error: "recipient not found" };

    // Deliberately NOT rechecked against a live state: a cancellation is the
    // one session message whose whole purpose is that the session is gone.
    return send(job, ctx, "appointment_cancelled", to.person,
      T.appointmentCancelledEmail(tctx(), {
        name: to.person.name, otherPartyName: to.otherName, startsAt: ap.starts_at,
        byCoach: job.payload.by_coach === true, timezone: to.person.timezone,
      }),
      { category: "appointments", path: to.isCustomer ? "/account" : "/coach" });
  },

  "email.appointment_reminder": async (job, ctx) => {
    const ap = await appointmentContext(ctx, job.payload.appointment_id);
    if (!ap) return { kind: "fail", error: "appointment not found" };
    const to = recipientOf(ap, job.payload.recipient);
    if (!to) return { kind: "fail", error: "recipient not found" };

    return send(job, ctx, "appointment_reminder", to.person,
      T.appointmentReminderEmail(tctx(), {
        name: to.person.name, otherPartyName: to.otherName, startsAt: ap.starts_at, timezone: to.person.timezone,
      }),
      {
        // Optional: a person may switch session reminders off. Cancellations
        // and reschedules are a different, essential category.
        category: "appointment_reminders",
        path: to.isCustomer ? "/account" : "/coach",
        // The strictest recheck in the system. A reminder for a session that
        // was cancelled, moved, or has already started makes somebody act on
        // something untrue.
        recheck: () => appointmentStillCurrent(ctx.admin, ap.id, {
          startsAt: str(job.payload.starts_at) || ap.starts_at,
          recipientProfileId: to.person.id,
          mustBeInFuture: true,
        }),
      });
  },

  "email.reservation_expired": async (job, ctx) => {
    const customer = await person(ctx, job.payload.customer_id);
    if (!customer) return { kind: "fail", error: "customer not found" };
    return send(job, ctx, "reservation_expired", customer,
      T.reservationExpiredEmail(tctx(), {
        name: customer.name, startsAt: str(job.payload.starts_at), timezone: customer.timezone,
      }),
      { category: "appointments", path: "/account" });
  },

  // --- Messages and expectations --------------------------------------------

  "email.unread_messages": async (job, ctx) => {
    const to = await person(ctx, job.payload.profile_id);
    if (!to) return { kind: "fail", error: "recipient not found" };
    const count = num(job.payload.count);
    if (count < 1) return { kind: "done", result: { sent: false, reason: "nothing unread" } };

    return send(job, ctx, "unread_messages", to,
      T.unreadMessagesEmail(tctx(), { name: to.name, fromName: str(job.payload.from_name) || "Your coach", count }),
      {
        category: "messages",
        path: "/account",
        // The summary line is safe to store; the messages themselves are not.
        inboxTitle: `You have ${count} unread ${count === 1 ? "message" : "messages"}`,
        // PENDING (Batch 2): returns a skip until conversations exist, so this
        // can never email somebody about messages they have already read.
        recheck: () => messagesStillUnread(
          ctx.admin, to.id, str(job.payload.conversation_id), str(job.payload.since),
        ),
      });
  },

  "email.expectations_updated": async (job, ctx) => {
    const customer = await person(ctx, job.payload.customer_id);
    const coach = await coachPerson(ctx, job.payload.provider_id);
    if (!customer || !coach) return { kind: "fail", error: "recipient not found" };
    return send(job, ctx, "expectations_updated", customer,
      T.expectationsUpdatedEmail(tctx(), { name: customer.name, coachName: coach.displayName }),
      { category: "expectations", path: "/account" });
  },

  "email.retention_notice": async (job, ctx) => {
    // Retention policies are PROPOSALS and destructive execution is off. Only
    // synthetic candidates can reach this handler, and nothing is emailed for
    // them: the notice pipeline is exercised, no person is told about a
    // deletion nobody has approved.
    if (job.payload.synthetic !== true) {
      // Recorded against the NOTICE as well as the job. An undelivered notice
      // moves its candidate to `notice_failed`, which stops the clock: nobody
      // may ever be deleted on the strength of a warning they never received.
      await ctx.admin.rpc("record_notice_outcome", {
        p_outbox_id: job.id,
        p_delivered: false,
        p_error: "retention notices for real people are disabled until a retention policy is approved",
      });
      return { kind: "fail", error: "retention notices for real people are disabled until a retention policy is approved" };
    }
    return { kind: "done", result: { sent: false, reason: "synthetic_retention_candidate" } };
  },

  // --- Retained pandit vertical ---------------------------------------------

  "email.shraddha_reminder": async (job, ctx) => {
    const to = str(job.payload.email);
    if (!to) return { kind: "fail", error: "missing email" };
    const { escapeHtml } = await import("@/lib/email/escape");
    // Invariant 1: this job is only ever enqueued after a human confirmed the
    // date, and the admin action re-reads that confirmation server-side.
    const html = `<p>Hello${str(job.payload.customer_name) ? ` ${escapeHtml(str(job.payload.customer_name))}` : ""},</p>
<p>This year the shraddha tithi for <strong>${escapeHtml(str(job.payload.remembered_name))}</strong> (${escapeHtml(str(job.payload.tithi))}) falls on <strong>${escapeHtml(str(job.payload.date_text))}</strong>.</p>
<p>If you would like us to arrange the ceremony on your behalf, reply to this email.</p>`;
    const { htmlToText } = await import("@/lib/email/escape");
    return send(job, ctx, "shraddha_reminder", { id: null, email: to }, {
      // The subject does not name the person being remembered: subjects show on
      // lock screens and in shared inbox previews.
      subject: `An upcoming shraddha date — ${str(job.payload.date_text)}`,
      html,
      text: htmlToText(html),
    });
  },
};
