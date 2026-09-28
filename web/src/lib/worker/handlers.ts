import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env, isDailyConfigured } from "@/lib/env";
import { attendanceRows, dailyClient, type DailyClient } from "@/lib/calls/daily";
import { OUTCOME_LABEL } from "@/lib/scheduling/types";
import { isReservedTestAddress, type EmailTransport } from "@/lib/email";
import * as T from "@/lib/email/templates";
import type { RenderedEmail } from "@/lib/email/templates";
import type { NotificationCategory } from "@/lib/notifications";
import {
  appointmentStillCurrent,
  emailStillWanted,
  unreadMessageCount,
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
  /** The call provider. Tests pass a stand-in; otherwise built from DAILY_API_KEY. */
  daily?: DailyClient;
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

/**
 * The person this message was for no longer exists — their account was
 * deleted between queueing and sending. That is not a failure anyone can act
 * on, so the job finishes as skipped, like a reminder for a cancelled session.
 * (A missing PURCHASE is different: purchases are never deleted, so a missing
 * one means a bug, and those still fail visibly.)
 */
/**
 * Worth telling the client about only while it is still theirs and still
 * unread: already acknowledged (on any device), or no longer their
 * relationship, and nothing is sent.
 */
async function expectationsStillUnread(ctx: HandlerContext, presentationId: string, customerId: string): Promise<Decision> {
  if (!presentationId) return { proceed: true };
  const { data, error } = await ctx.admin
    .from("enrollment_expectations")
    .select("id, enrollments(customer_id), expectation_acknowledgements(id)")
    .eq("id", presentationId)
    .maybeSingle();
  if (error) return { proceed: false, reason: "expectations could not be checked" };
  if (!data) return { proceed: false, reason: "that version is no longer on record" };
  const row = data as { enrollments: { customer_id: string } | { customer_id: string }[] | null; expectation_acknowledgements: unknown[] | { id: string } | null };
  const enrollment = Array.isArray(row.enrollments) ? row.enrollments[0] : row.enrollments;
  if (enrollment?.customer_id !== customerId) return { proceed: false, reason: "no longer this client's relationship" };
  const acks = Array.isArray(row.expectation_acknowledgements) ? row.expectation_acknowledgements : row.expectation_acknowledgements ? [row.expectation_acknowledgements] : [];
  if (acks.length) return { proceed: false, reason: "already read and acknowledged" };
  return { proceed: true };
}

/**
 * Still worth telling: the version is still this client's, and a "published"
 * notice is not sent for an update that was cancelled before the worker ran.
 */
async function planNoticeStillTrue(ctx: HandlerContext, versionId: string, customerId: string, event: string): Promise<Decision> {
  if (!versionId) return { proceed: false, reason: "no version named" };
  const { data, error } = await ctx.admin
    .from("client_plan_versions")
    .select("id, withdrawn_at, client_plans(enrollments(customer_id))")
    .eq("id", versionId)
    .maybeSingle();
  if (error) return { proceed: false, reason: "plan version could not be checked" };
  if (!data) return { proceed: false, reason: "that version is no longer on record" };
  const plan = data.client_plans as unknown as { enrollments: { customer_id: string } | null } | null;
  if (plan?.enrollments?.customer_id !== customerId) return { proceed: false, reason: "no longer this client's plan" };
  if (event === "published" && data.withdrawn_at) return { proceed: false, reason: "the update was cancelled before the notice went out" };
  return { proceed: true };
}

async function checkinNoticeStillTrue(ctx: HandlerContext, payload: Record<string, unknown>): Promise<Decision> {
  const { data, error } = await ctx.admin.rpc("checkin_notice_still_true", { p_job: payload });
  if (error) return { proceed: false, reason: "check-in notice could not be checked" };
  return data ? { proceed: false, reason: String(data) } : { proceed: true };
}

function gone(who: string): Outcome {
  return { kind: "done", result: { sent: false, reason: "skipped", detail: `${who} no longer exists` } };
}

async function stillAdmin(ctx: HandlerContext, profileId: string): Promise<Decision> {
  const { data } = await ctx.admin.from("profiles").select("role, suspended_at").eq("id", profileId).maybeSingle();
  if (!data || data.role !== "admin") return { proceed: false, reason: "recipient is no longer an administrator" };
  if (data.suspended_at) return { proceed: false, reason: "recipient account is suspended" };
  return { proceed: true };
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

/** Where each side manages a session. */
function appointmentPath(id: string, isCustomer: boolean): string {
  return isCustomer ? `/account/appointments/${id}` : `/coach/calendar/appointments/${id}`;
}
function schedulePath(isCustomer: boolean): string {
  return isCustomer ? "/account/appointments" : "/coach/calendar";
}

async function appointmentState(ctx: HandlerContext, id: string): Promise<string | null> {
  const { data } = await ctx.admin.from("appointments").select("state").eq("id", id).maybeSingle();
  return (data?.state as string) ?? null;
}

async function proposalState(ctx: HandlerContext, id: string): Promise<string | null> {
  const { data } = await ctx.admin.from("appointment_proposals").select("state, expires_at").eq("id", id).maybeSingle();
  if (!data) return null;
  if (data.state === "pending" && Date.parse(data.expires_at) <= Date.now()) return "expired";
  return data.state as string;
}

async function proposalContext(ctx: HandlerContext, proposalId: unknown): Promise<(AppointmentContext & { reschedule: boolean; weekly: boolean }) | null> {
  if (typeof proposalId !== "string") return null;
  const { data } = await ctx.admin
    .from("appointment_proposals")
    .select("id, starts_at, state, customer_id, provider_id, replaces_appointment_id, recurrence")
    .eq("id", proposalId)
    .maybeSingle();
  if (!data) return null;
  const customer = await person(ctx, data.customer_id);
  const coach = await coachPerson(ctx, data.provider_id);
  if (!customer || !coach) return null;
  return {
    id: data.id, starts_at: data.starts_at, state: data.state, customer, coach,
    reschedule: Boolean(data.replaces_appointment_id), weekly: data.recurrence === "weekly",
  };
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

// --- Calls ------------------------------------------------------------------

function dailyFor(ctx: HandlerContext): DailyClient | null {
  if (ctx.daily) return ctx.daily;
  return isDailyConfigured() ? dailyClient({ apiKey: env.dailyApiKey }) : null;
}

interface CallRoomRow {
  id: string;
  room_name: string;
  state: string;
  opens_at: string;
  provider_created_at: string | null;
  close_reason: string | null;
  appointment_id: string;
}

async function callRoom(ctx: HandlerContext, roomId: unknown): Promise<CallRoomRow | null> {
  if (typeof roomId !== "string") return null;
  const { data } = await ctx.admin
    .from("call_rooms")
    .select("id, room_name, state, opens_at, provider_created_at, close_reason, appointment_id")
    .eq("id", roomId)
    .maybeSingle();
  return (data as CallRoomRow | null) ?? null;
}

const providerFailure = (r: { error: string; retryable: boolean }, what: string): Outcome =>
  r.retryable ? { kind: "retry", error: `${what}: ${r.error}` } : { kind: "fail", error: `${what}: ${r.error}` };

const sinceOpening = (room: CallRoomRow) => Math.floor(Date.parse(room.opens_at) / 1000) - 300;

// ---------------------------------------------------------------------------

export const HANDLERS: Record<string, Handler> = {
  "email.coach_invitation": async (job, ctx) => {
    const to = str(job.payload.email);
    if (!to) return { kind: "fail", error: "missing email" };
    return send(job, ctx, "coach_invitation", { id: null, email: to },
      T.coachInvitationEmail(tctx(), { inviteUrl: str(job.payload.invite_url), expiresAt: str(job.payload.expires_at) }));
  },

  // Waitlist (M16). The address and state come from the table at send time,
  // so a withdrawn person is never emailed and no address lingers in a job
  // that outlives the entry.
  "email.waitlist_confirm": async (job, ctx) => {
    const { data: w } = await ctx.admin.from("waitlist_entries").select("email, first_name, state").eq("id", str(job.payload.entry_id)).maybeSingle();
    if (!w) return { kind: "done", result: { sent: false, reason: "skipped", detail: "withdrawn", template: "waitlist_confirm" } };
    return send(job, ctx, "waitlist_confirm", { id: null, email: w.email as string },
      T.waitlistConfirmEmail(tctx(), { firstName: w.first_name as string | null, confirmUrl: str(job.payload.confirm_url), withdrawUrl: str(job.payload.withdraw_url), coachName: str(job.payload.coach_name) || null }),
      { recheck: async () => (w.state === "pending" ? { proceed: true } : { proceed: false, reason: "already_confirmed" }) });
  },

  "email.waitlist_notice": async (job, ctx) => {
    const { data: w } = await ctx.admin.from("waitlist_entries").select("email, first_name, state").eq("id", str(job.payload.entry_id)).maybeSingle();
    if (!w) return { kind: "done", result: { sent: false, reason: "skipped", detail: "withdrawn", template: "waitlist_notice" } };
    return send(job, ctx, "waitlist_notice", { id: null, email: w.email as string },
      T.waitlistNoticeEmail(tctx(), { firstName: w.first_name as string | null, coachName: str(job.payload.coach_name) || null, url: str(job.payload.url), withdrawUrl: str(job.payload.withdraw_url) }),
      { recheck: async () => (w.state === "confirmed" ? { proceed: true } : { proceed: false, reason: "not_confirmed" }) });
  },

  "email.purchase_confirmed": async (job, ctx) => {
    const pu = await purchaseContext(ctx, job.payload.purchase_id);
    if (!pu) return { kind: "fail", error: "purchase not found" };
    const customer = await person(ctx, pu.customer_id);
    const coach = await coachPerson(ctx, pu.provider_id);
    if (!customer || !coach) return gone("recipient");
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
    if (!coach) return gone("coach");
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
    if (!customer) return gone("customer");
    return send(job, ctx, "payment_failed", customer, T.paymentFailedEmail(tctx(), {
      customerName: customer.name, planTitle: str((pu.inclusions_snapshot as Record<string, unknown>)?.title) || "your plan",
      paidThrough: pu.paid_through_at, timezone: customer.timezone,
    }), { category: "billing", path: "/account/billing" });
  },

  "email.subscription_changed": async (job, ctx) => {
    const pu = await purchaseContext(ctx, job.payload.purchase_id);
    if (!pu) return { kind: "fail", error: "purchase not found" };
    const customer = await person(ctx, pu.customer_id);
    if (!customer) return gone("customer");
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
    if (!customer) return gone("customer");
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
    if (!customer || !coach) return gone("recipient");
    return send(job, ctx, "coach_changed_customer", customer, T.coachChangedCustomerEmail(tctx(), {
      customerName: customer.name, newCoachName: coach.displayName, effectiveAt: str(job.payload.effective_at), timezone: customer.timezone,
    }), { category: "coaching", path: "/account" });
  },

  "email.coach_changed_previous": async (job, ctx) => {
    const coach = await coachPerson(ctx, job.payload.previous_provider_id);
    if (!coach) return gone("coach");
    return send(job, ctx, "coach_changed_previous", coach,
      T.coachChangedPreviousCoachEmail(tctx(), { coachName: coach.name, effectiveAt: str(job.payload.effective_at) }),
      { category: "coaching", path: "/coach/clients" });
  },

  "email.coach_changed_new": async (job, ctx) => {
    const coach = await coachPerson(ctx, job.payload.new_provider_id);
    if (!coach) return gone("coach");
    return send(job, ctx, "coach_changed_new", coach,
      T.coachChangedNewCoachEmail(tctx(), { coachName: coach.name, effectiveAt: str(job.payload.effective_at) }),
      { category: "coaching", path: "/coach/clients" });
  },

  "email.payout_paid": async (job, ctx) => {
    const coach = await coachPerson(ctx, job.payload.provider_id);
    if (!coach) return gone("coach");
    return send(job, ctx, "payout_paid", coach, T.payoutPaidEmail(tctx(), {
      coachName: coach.name, amountMinor: num(job.payload.amount_minor), currency: str(job.payload.currency), paidAt: str(job.payload.paid_at),
      reference: str(job.payload.external_reference) || null,
    }), { category: "billing", path: "/coach/payouts" });
  },

  "email.profile_approved": async (job, ctx) => {
    const coach = await coachPerson(ctx, job.payload.provider_id);
    if (!coach) return gone("coach");
    return send(job, ctx, "profile_approved", coach, T.profileApprovedEmail(tctx(), { coachName: coach.name }),
      { category: "coaching", path: "/coach/profile" });
  },

  "email.admin_alert": async (job, ctx) => {
    const admin = await person(ctx, job.payload.admin_id);
    if (!admin) return gone("admin");
    return send(job, ctx, "admin_alert", admin, T.adminAlertEmail(tctx(), {
      title: str(job.payload.title), detail: str(job.payload.detail), path: str(job.payload.path) || "/admin",
    }), {
      category: "account_security",
      path: str(job.payload.path) || "/admin",
      // The recipient was an administrator when this was queued. They must
      // still be one when it is sent: founder alerts describe other people's
      // accounts, and somebody whose admin role was removed in between is no
      // longer entitled to read them.
      recheck: () => stillAdmin(ctx, admin.id),
    });
  },

  // --- Sessions -------------------------------------------------------------
  //
  // Producers: the scheduling functions in 0042 (accept, reschedule, cancel,
  // reconciliation, consultation payment and checkout expiry).

  "email.appointment_confirmed": async (job, ctx) => {
    const ap = await appointmentContext(ctx, job.payload.appointment_id);
    if (!ap) return { kind: "fail", error: "appointment not found" };
    const to = recipientOf(ap, job.payload.recipient);
    if (!to) return gone("recipient");

    return send(job, ctx, "appointment_confirmed", to.person,
      T.appointmentConfirmedEmail(tctx(), {
        name: to.person.name, otherPartyName: to.otherName, startsAt: ap.starts_at, timezone: to.person.timezone, path: appointmentPath(ap.id, to.isCustomer),
      }),
      {
        category: "appointments",
        path: appointmentPath(ap.id, to.isCustomer),
        recheck: () => appointmentStillCurrent(ctx.admin, ap.id, {
          startsAt: ap.starts_at, recipientProfileId: to.person.id,
        }),
      });
  },

  "email.appointment_changed": async (job, ctx) => {
    const ap = await appointmentContext(ctx, job.payload.appointment_id);
    if (!ap) return { kind: "fail", error: "appointment not found" };
    const to = recipientOf(ap, job.payload.recipient);
    if (!to) return gone("recipient");

    return send(job, ctx, "appointment_changed", to.person,
      T.appointmentChangedEmail(tctx(), {
        name: to.person.name, otherPartyName: to.otherName, startsAt: ap.starts_at,
        previousStartsAt: str(job.payload.previous_starts_at) || null, timezone: to.person.timezone, path: appointmentPath(ap.id, to.isCustomer),
      }),
      {
        category: "appointments",
        path: appointmentPath(ap.id, to.isCustomer),
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
    if (!to) return gone("recipient");

    // Deliberately NOT rechecked against a live state: a cancellation is the
    // one session message whose whole purpose is that the session is gone.
    return send(job, ctx, "appointment_cancelled", to.person,
      T.appointmentCancelledEmail(tctx(), {
        name: to.person.name, otherPartyName: to.otherName, startsAt: ap.starts_at,
        byCoach: job.payload.by_coach === true, timezone: to.person.timezone, path: appointmentPath(ap.id, to.isCustomer),
      }),
      { category: "appointments", path: appointmentPath(ap.id, to.isCustomer) });
  },

  "email.appointment_reminder": async (job, ctx) => {
    const ap = await appointmentContext(ctx, job.payload.appointment_id);
    if (!ap) return { kind: "fail", error: "appointment not found" };
    const to = recipientOf(ap, job.payload.recipient);
    if (!to) return gone("recipient");

    return send(job, ctx, "appointment_reminder", to.person,
      T.appointmentReminderEmail(tctx(), {
        name: to.person.name, otherPartyName: to.otherName, startsAt: ap.starts_at, timezone: to.person.timezone, path: appointmentPath(ap.id, to.isCustomer),
      }),
      {
        // Optional: a person may switch session reminders off. Cancellations
        // and reschedules are a different, essential category.
        category: "appointment_reminders",
        path: appointmentPath(ap.id, to.isCustomer),
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

  "email.appointment_proposed": async (job, ctx) => {
    const pr = await proposalContext(ctx, job.payload.proposal_id);
    if (!pr) return { kind: "fail", error: "proposal not found" };
    const to = recipientOf(pr, job.payload.recipient);
    if (!to) return gone("recipient");
    return send(job, ctx, "appointment_proposed", to.person,
      T.appointmentProposedEmail(tctx(), {
        name: to.person.name, otherPartyName: to.otherName, startsAt: pr.starts_at, timezone: to.person.timezone,
        reschedule: pr.reschedule, weekly: pr.weekly, path: schedulePath(to.isCustomer),
      }),
      {
        category: "appointments",
        path: schedulePath(to.isCustomer),
        inboxTitle: `${to.otherName} suggested a session time`,
        // Answered, withdrawn or lapsed since: nothing to answer any more.
        recheck: async () => (await proposalState(ctx, pr.id)) === "pending"
          ? { proceed: true } : { proceed: false, reason: "the suggestion is no longer waiting for an answer" },
      });
  },

  "email.appointment_proposal_update": async (job, ctx) => {
    const pr = await proposalContext(ctx, job.payload.proposal_id);
    if (!pr) return { kind: "fail", error: "proposal not found" };
    const to = recipientOf(pr, job.payload.recipient);
    if (!to) return gone("recipient");
    const state = str(job.payload.state);
    return send(job, ctx, "appointment_proposal_update", to.person,
      T.appointmentProposalUpdateEmail(tctx(), {
        name: to.person.name, otherPartyName: to.otherName, startsAt: pr.starts_at, timezone: to.person.timezone,
        state, path: schedulePath(to.isCustomer),
      }),
      {
        category: "appointments",
        path: schedulePath(to.isCustomer),
        recheck: async () => (await proposalState(ctx, pr.id)) === state
          ? { proceed: true } : { proceed: false, reason: "the suggestion has changed since" },
      });
  },

  "email.appointment_on_hold": async (job, ctx) => {
    const ap = await appointmentContext(ctx, job.payload.appointment_id);
    if (!ap) return { kind: "fail", error: "appointment not found" };
    const to = recipientOf(ap, job.payload.recipient);
    if (!to) return gone("recipient");
    return send(job, ctx, "appointment_on_hold", to.person,
      T.appointmentOnHoldEmail(tctx(), {
        name: to.person.name, otherPartyName: to.otherName, startsAt: ap.starts_at, timezone: to.person.timezone,
        reason: str(job.payload.reason), path: appointmentPath(ap.id, to.isCustomer),
      }),
      {
        category: "appointments",
        path: appointmentPath(ap.id, to.isCustomer),
        // Restored (payment recovered, time freed) before this went out: say nothing.
        recheck: async () => ap.state === "on_hold" && (await appointmentState(ctx, ap.id)) === "on_hold"
          ? { proceed: true } : { proceed: false, reason: "the session is no longer on hold" },
      });
  },

  "email.consultation_needs_rebooking": async (job, ctx) => {
    const pu = await purchaseContext(ctx, job.payload.purchase_id);
    if (!pu) return { kind: "fail", error: "purchase not found" };
    const customer = await person(ctx, pu.customer_id);
    if (!customer) return gone("customer");
    return send(job, ctx, "consultation_needs_rebooking", customer, T.consultationNeedsRebookingEmail(tctx(), { name: customer.name }),
      { category: "appointments", path: "/account/appointments" });
  },

  "email.consultation_rebook": async (job, ctx) => {
    const pu = await purchaseContext(ctx, job.payload.purchase_id);
    if (!pu) return { kind: "fail", error: "purchase not found" };
    const customer = await person(ctx, pu.customer_id);
    if (!customer) return gone("customer");
    return send(job, ctx, "consultation_rebook", customer, T.consultationRebookEmail(tctx(), { name: customer.name }),
      { category: "appointments", path: "/account/appointments" });
  },

  "email.reservation_expired": async (job, ctx) => {
    const customer = await person(ctx, job.payload.customer_id);
    if (!customer) return gone("customer");
    return send(job, ctx, "reservation_expired", customer,
      T.reservationExpiredEmail(tctx(), {
        name: customer.name, startsAt: str(job.payload.starts_at), timezone: customer.timezone,
      }),
      { category: "appointments", path: "/account" });
  },

  // --- Calls ----------------------------------------------------------------
  //
  // Producers: 0044. A room is closed when its window ends and whenever
  // access is lost (cancelled, moved, on hold, suspension, coach change,
  // relationship ended, refund). Closing ejects both people and deletes the
  // room at the provider — the only way to invalidate a pass it has signed.

  "call.close_room": async (job, ctx) => {
    const room = await callRoom(ctx, job.payload.room_id);
    if (!room) return { kind: "fail", error: "room not found" };
    if (room.state === "closed") return { kind: "done", result: { skipped: "already closed" } };
    const daily = dailyFor(ctx);
    if (!daily) return { kind: "blocked", error: "DAILY_API_KEY is not set" };

    const { data: ap } = await ctx.admin
      .from("appointments").select("customer_id, providers(profile_id)").eq("id", room.appointment_id).maybeSingle();
    const prov = ap?.providers as unknown as { profile_id: string } | { profile_id: string }[] | null;
    const coachProfile = Array.isArray(prov) ? prov[0]?.profile_id : prov?.profile_id;
    const userIds = [ap?.customer_id as string | undefined, coachProfile].filter((v): v is string => Boolean(v));

    const ejected = await daily.eject(room.room_name, userIds);
    if (!ejected.ok) return providerFailure(ejected, "eject");

    // Whatever has already finished is recorded before the room goes, in case
    // the provider keeps less about a deleted room. Meetings still settling are
    // picked up by the fetch queued below.
    const before = await daily.listMeetings(room.room_name, sinceOpening(room));
    if (before.ok) {
      const { rows } = attendanceRows(before.value);
      if (rows.length) {
        await ctx.admin.rpc("record_call_attendance", { p_room: room.id, p_rows: rows, p_source: "provider_api", p_complete: false });
      }
    }

    const deleted = await daily.deleteRoom(room.room_name);
    if (!deleted.ok) return providerFailure(deleted, "delete");

    const { error } = await ctx.admin.rpc("mark_call_room_closed", { p_room: room.id, p_reason: str(job.payload.reason) || "closed" });
    if (error) return { kind: "retry", error: `mark closed: ${error.message}` };

    if (room.provider_created_at) {
      const { data: g } = await ctx.admin.from("call_settings").select("attendance_check_delay_minutes").eq("id", true).maybeSingle();
      const delay = Number(g?.attendance_check_delay_minutes) || 3;
      await ctx.admin.rpc("enqueue_outbox", {
        p_topic: "call.fetch_attendance",
        p_payload: { room_id: room.id },
        p_dedupe_key: `call_attendance:${room.id}:closed`,
        p_scheduled_for: new Date(Date.now() + delay * 60_000).toISOString(),
        p_expires_at: null,
      });
    }
    return { kind: "done", result: { ejected: ejected.value.ejected, deleted: deleted.value.deleted, reason: str(job.payload.reason) } };
  },

  "call.fetch_attendance": async (job, ctx) => {
    const room = await callRoom(ctx, job.payload.room_id);
    if (!room) return { kind: "fail", error: "room not found" };
    if (!room.provider_created_at) return { kind: "done", result: { skipped: "room was never created at the provider" } };
    const daily = dailyFor(ctx);
    if (!daily) return { kind: "blocked", error: "DAILY_API_KEY is not set" };

    const list = await daily.listMeetings(room.room_name, sinceOpening(room));
    if (!list.ok) return providerFailure(list, "meetings");
    const { rows, ongoing } = attendanceRows(list.value);
    const { data: recorded, error } = await ctx.admin.rpc("record_call_attendance", {
      p_room: room.id, p_rows: rows, p_source: "provider_api", p_complete: room.state === "closed" && !ongoing,
    });
    if (error) return { kind: "retry", error: `record: ${error.message}` };
    // A closed room whose last meeting the provider still shows as running:
    // ask again shortly rather than record a half-finished attendance.
    if (ongoing && room.state === "closed") return { kind: "retry", error: "meeting still settling at the provider" };
    return { kind: "done", result: { meetings: list.value.length, recorded: Number(recorded) || 0 } };
  },

  "email.session_outcome_recorded": async (job, ctx) => {
    const ap = await appointmentContext(ctx, job.payload.appointment_id);
    if (!ap) return { kind: "fail", error: "appointment not found" };
    const to = recipientOf(ap, job.payload.recipient);
    if (!to) return gone("recipient");
    const outcomeId = str(job.payload.outcome_id);
    const { data: o } = await ctx.admin
      .from("appointment_outcomes").select("id, outcome, recorded_role, corrects").eq("id", outcomeId).maybeSingle();
    if (!o) return { kind: "fail", error: "outcome not found" };
    const label = OUTCOME_LABEL[o.outcome as string] ?? "Recorded";
    const path = appointmentPath(ap.id, to.isCustomer);
    return send(job, ctx, "session_outcome_recorded", to.person,
      T.sessionOutcomeEmail(tctx(), {
        name: to.person.name, otherPartyName: to.otherName, startsAt: ap.starts_at, timezone: to.person.timezone,
        outcomeLabel: label, technical: o.outcome === "technical_failure", correction: Boolean(o.corrects),
        byTalentYak: o.recorded_role === "admin", forCoach: !to.isCustomer, path,
      }),
      {
        category: "appointments",
        path,
        inboxTitle: `Session recorded: ${label}`,
        // Corrected again before this went out: only the latest is worth telling.
        recheck: async () => {
          const { data: latest } = await ctx.admin.from("appointment_outcomes").select("id")
            .eq("appointment_id", ap.id).order("recorded_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
          return latest?.id === outcomeId ? { proceed: true } : { proceed: false, reason: "a later correction replaced this record" };
        },
      });
  },

  // --- Messages and expectations --------------------------------------------

  "email.unread_messages": async (job, ctx) => {
    const to = await person(ctx, job.payload.profile_id);
    if (!to) return gone("recipient");
    const conversationId = str(job.payload.conversation_id);

    // The final recheck: counted now, against the live read markers and the
    // live access rules. Read on any device since, or no longer theirs to
    // read, and nothing is sent.
    const count = await unreadMessageCount(ctx.admin, to.id, conversationId, num(job.payload.since_seq));
    if (count === null) return { kind: "retry", error: "unread count unavailable" };
    if (count < 1) {
      return { kind: "done", result: { sent: false, reason: "skipped", detail: "no unread messages, or no longer a participant" } };
    }

    const path = job.payload.recipient_role === "coach"
      ? `/coach/messages/${conversationId}`
      : `/account/messages/${conversationId}`;
    return send(job, ctx, "unread_messages", to,
      T.unreadMessagesEmail(tctx(), { name: to.name, fromName: str(job.payload.from_name) || "Your coach", count, path }),
      {
        category: "messages",
        path,
        // A count and a name are safe to store; what was said is not.
        inboxTitle: `You have ${count} unread ${count === 1 ? "message" : "messages"}`,
      });
  },

  "email.support_case_opened": async (job, ctx) => {
    const admins = await adminPeople(ctx);
    for (const a of admins) {
      await ctx.enqueue("email.admin_alert", {
        admin_id: a.id,
        title: "Support case opened",
        // Category and role only. What the person wrote stays in the console.
        detail: `A ${str(job.payload.reporter_role) || "person"} opened a ${str(job.payload.category) || "support"} case.`,
        path: `/admin/support/${str(job.payload.case_id)}`,
      }, `admin_alert:${job.id}:${a.id}`);
    }
    return { kind: "done", result: { fanned_out: admins.length } };
  },

  "email.expectations_updated": async (job, ctx) => {
    const customer = await person(ctx, job.payload.customer_id);
    const coach = await coachPerson(ctx, job.payload.provider_id);
    if (!customer || !coach) return gone("recipient");
    const enrollmentId = str(job.payload.enrollment_id);
    const presentationId = str(job.payload.presentation_id);
    const path = enrollmentId
      ? `/account/expectations/${enrollmentId}${presentationId ? `?v=${presentationId}` : ""}`
      : "/account";
    return send(job, ctx, "expectations_updated", customer,
      T.expectationsUpdatedEmail(tctx(), { name: customer.name, coachName: coach.displayName, path }),
      {
        category: "expectations",
        path,
        // The coach's name and a link. What the document says stays in the app.
        inboxTitle: `${coach.displayName} shared an updated welcome & expectations`,
        recheck: () => expectationsStillUnread(ctx, presentationId, customer.id),
      });
  },

  "email.plan_updated": async (job, ctx) => {
    const customer = await person(ctx, job.payload.customer_id);
    const coach = await coachPerson(ctx, job.payload.provider_id);
    if (!customer || !coach) return gone("recipient");
    const enrollmentId = str(job.payload.enrollment_id);
    const versionId = str(job.payload.version_id);
    const event = job.payload.event === "withdrawn" ? "withdrawn" : "published";
    const kind = job.payload.kind === "nutrition" ? "nutrition" : "workout";
    const effective = str(job.payload.effective_from);
    const later = effective && Date.parse(effective) > Date.now() + 60_000;
    const startsLabel = later
      ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: customer.timezone || "UTC" }).format(new Date(effective))
      : null;
    const path = enrollmentId ? `/account/plan/${enrollmentId}${versionId && event === "published" && later ? `/history?v=${versionId}` : ""}` : "/account/plan";
    const email = T.planUpdatedEmail(tctx(), { name: customer.name, coachName: coach.displayName, kind, event, first: num(job.payload.version) === 1, startsLabel, path });
    return send(job, ctx, "plan_updated", customer, email, {
      category: "coaching",
      path,
      // The coach's name and a date. What the plan says stays in the app.
      inboxTitle: email.subject,
      recheck: () => planNoticeStillTrue(ctx, versionId, customer.id, event),
    });
  },

  "email.checkin_notice": async (job, ctx) => {
    const recipient = await person(ctx, job.payload.recipient_id);
    if (!recipient) return gone("recipient");
    const { data: c } = await ctx.admin
      .from("checkins")
      .select("id, enrollment_id, customer_id, responsible_provider_id, due_at, timezone")
      .eq("id", str(job.payload.checkin_id))
      .maybeSingle();
    if (!c) return gone("check-in");
    const event = str(job.payload.event) as T.CheckinNoticeEvent;
    const toCoach = ["submitted", "corrected", "review_overdue", "transferred"].includes(event);
    const [client, coach] = await Promise.all([person(ctx, c.customer_id), coachPerson(ctx, c.responsible_provider_id)]);
    const path = toCoach ? `/coach/check-ins/${c.id}` : `/account/progress/${c.enrollment_id}/check-ins/${c.id}`;
    const email = T.checkinNoticeEmail(tctx(), {
      event,
      name: recipient.name,
      clientName: client?.name?.split(" ")[0] ?? null,
      coachName: coach?.displayName ?? null,
      dueAt: c.due_at,
      timeZone: toCoach ? recipient.timezone : c.timezone,
      path,
    });
    return send(job, ctx, "checkin_notice", recipient, email, {
      category: "checkins",
      path,
      inboxTitle: email.subject,
      // Status and permission as they are now, not as they were when queued.
      recheck: () => checkinNoticeStillTrue(ctx, job.payload),
    });
  },

  // Sent only by scripts/send-test-notification.mjs, to an address the founder
  // named. Goes through the same send path as every real notification.
  "email.delivery_check": async (job, ctx) => {
    const to = await person(ctx, job.payload.profile_id);
    if (!to) return gone("recipient");
    return send(job, ctx, "delivery_check", to, T.deliveryCheckEmail(tctx(), { name: to.name }), {
      category: "account_security",
      path: "/account/notifications",
    });
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
