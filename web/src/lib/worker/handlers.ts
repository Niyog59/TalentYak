import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { isReservedTestAddress, type EmailTransport } from "@/lib/email";
import * as T from "@/lib/email/templates";
import type { RenderedEmail } from "@/lib/email/templates";

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
 */
async function send(
  job: OutboxJob,
  ctx: HandlerContext,
  template: string,
  to: Person | { id: null; email: string },
  email: RenderedEmail,
): Promise<Outcome> {
  if (isReservedTestAddress(to.email)) {
    // Test fixtures use reserved domains. Never send to them: it would bounce and
    // harm the sending domain. Recorded honestly as not sent.
    return { kind: "done", result: { sent: false, reason: "reserved_test_address", template } };
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
    return { kind: "done", result: { sent: true, accepted: true, template, provider_message_id: result.providerMessageId } };
  }
  return result.retryable ? { kind: "retry", error: result.reason } : { kind: "fail", error: result.reason };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);

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
    }));
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
    }));
  },

  "email.payment_failed": async (job, ctx) => {
    const pu = await purchaseContext(ctx, job.payload.purchase_id);
    if (!pu) return { kind: "fail", error: "purchase not found" };
    const customer = await person(ctx, pu.customer_id);
    if (!customer) return { kind: "fail", error: "customer not found" };
    return send(job, ctx, "payment_failed", customer, T.paymentFailedEmail(tctx(), {
      customerName: customer.name, planTitle: str((pu.inclusions_snapshot as Record<string, unknown>)?.title) || "your plan",
      paidThrough: pu.paid_through_at, timezone: customer.timezone,
    }));
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
      }));
    }
    if (state === "ended") {
      return send(job, ctx, "subscription_ended", customer, T.subscriptionEndedEmail(tctx(), { customerName: customer.name, planTitle: title }));
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
    }));
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
    }));
  },

  "email.coach_changed_previous": async (job, ctx) => {
    const coach = await coachPerson(ctx, job.payload.previous_provider_id);
    if (!coach) return { kind: "fail", error: "coach not found" };
    return send(job, ctx, "coach_changed_previous", coach, T.coachChangedPreviousCoachEmail(tctx(), { coachName: coach.name, effectiveAt: str(job.payload.effective_at) }));
  },

  "email.coach_changed_new": async (job, ctx) => {
    const coach = await coachPerson(ctx, job.payload.new_provider_id);
    if (!coach) return { kind: "fail", error: "coach not found" };
    return send(job, ctx, "coach_changed_new", coach, T.coachChangedNewCoachEmail(tctx(), { coachName: coach.name, effectiveAt: str(job.payload.effective_at) }));
  },

  "email.payout_paid": async (job, ctx) => {
    const coach = await coachPerson(ctx, job.payload.provider_id);
    if (!coach) return { kind: "fail", error: "coach not found" };
    return send(job, ctx, "payout_paid", coach, T.payoutPaidEmail(tctx(), {
      coachName: coach.name, amountMinor: num(job.payload.amount_minor), currency: str(job.payload.currency), paidAt: str(job.payload.paid_at),
      reference: str(job.payload.external_reference) || null,
    }));
  },

  "email.profile_approved": async (job, ctx) => {
    const coach = await coachPerson(ctx, job.payload.provider_id);
    if (!coach) return { kind: "fail", error: "coach not found" };
    return send(job, ctx, "profile_approved", coach, T.profileApprovedEmail(tctx(), { coachName: coach.name }));
  },

  "email.admin_alert": async (job, ctx) => {
    const admin = await person(ctx, job.payload.admin_id);
    if (!admin) return { kind: "fail", error: "admin not found" };
    return send(job, ctx, "admin_alert", admin, T.adminAlertEmail(tctx(), {
      title: str(job.payload.title), detail: str(job.payload.detail), path: str(job.payload.path) || "/admin",
    }));
  },

  "email.retention_notice": async (job) => {
    // Retention policies are PROPOSALS and destructive execution is off. Only
    // synthetic candidates can reach this handler, and nothing is emailed for
    // them: the notice pipeline is exercised, no person is told about a
    // deletion nobody has approved.
    if (job.payload.synthetic !== true) {
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
