import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getStripe, stripeMode } from "@/lib/payments/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { checkEventContext, minimisePayload, ruleFor, type EventAction } from "@/lib/payments/events";
import {
  entriesForCycleEarning,
  entriesForDisputeLost,
  entriesForDisputeOpened,
  entriesForDisputeWon,
  entriesForRefund,
} from "@/lib/ledger/effects";
import { money } from "@/lib/money/money";
import { kickWorker } from "@/lib/worker/outbox";

/**
 * The Stripe webhook — the only writer of payment truth (invariant 5).
 *
 * SHAPE
 *   1. Verify the signature against the raw body, and the event's mode/account.
 *   2. Record a receipt. A receipt is not proof of processing.
 *   3. Take a lease, so one worker processes an event at a time.
 *   4. Fetch the CURRENT object from Stripe and apply it through a database
 *      function that commits every effect of that payment in one transaction.
 *   5. Mark processed. Anything that throws marks the receipt failed and returns
 *      500 so Stripe retries; the scheduled sweep also retries stuck receipts
 *      from Stripe's own copy of the event.
 *
 * WHY FETCH THE CURRENT OBJECT. Webhooks arrive late, twice, and out of order.
 * Applying what an event SAID means an old "active" can overwrite a newer
 * "canceled". Applying what Stripe says NOW makes every event for an object
 * converge on the same, current state — which is also why two different events
 * describing one payment cannot double-count: they apply the same effects, and
 * the effects are keyed by what they describe (the invoice, the payment
 * intent, the refund), not by which event carried them.
 */

type Admin = SupabaseClient;
const LEASE_SECONDS = 120;

export async function handleStripeWebhook(req: Request): Promise<Response> {
  const stripe = getStripe();
  if (!stripe || !env.stripeWebhookSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 501 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, env.stripeWebhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Database not configured" }, { status: 501 });

  // A valid signature proves the event came from Stripe. It does not prove it
  // came from this deployment's account, in this deployment's mode.
  const context = checkEventContext(
    { livemode: event.livemode, accountId: event.account ?? null },
    { expectLivemode: stripeMode() === "live", expectedAccountId: process.env.STRIPE_ACCOUNT_ID || null },
  );
  if (!context.ok) {
    await recordReceipt(admin, event, "ignored", context.reason);
    return NextResponse.json({ received: true, ignored: true });
  }

  const receipt = await recordReceipt(admin, event, ruleFor(event.type).action === "ignore" ? "ignored" : "received");
  if (!receipt) return NextResponse.json({ error: "Could not record event" }, { status: 500 });
  if (receipt.processing_state === "processed" || receipt.processing_state === "ignored") {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const outcome = await processWithLease(admin, stripe, event, receipt.id);
  if (outcome === "in_progress") return NextResponse.json({ received: true, in_progress: true });
  if (outcome === "failed") return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  return NextResponse.json({ received: true });
}

// ---------------------------------------------------------------------------
// Receipts and leases
// ---------------------------------------------------------------------------

async function recordReceipt(
  admin: Admin,
  event: Stripe.Event,
  state: "received" | "ignored",
  note?: string,
): Promise<{ id: string; processing_state: string; attempts: number } | null> {
  // Insert-if-absent. A redelivery must NOT reset an existing receipt: an event
  // already processed stays processed.
  await admin.from("provider_events").upsert(
    {
      source: "stripe",
      external_id: event.id,
      event_type: event.type,
      account_id: event.account ?? null,
      livemode: event.livemode,
      api_version: event.api_version ?? null,
      payload: minimisePayload(event as never),
      occurred_at: new Date(event.created * 1000).toISOString(),
      processing_state: state,
      last_error: note ?? null,
    },
    { onConflict: "source,external_id", ignoreDuplicates: true },
  );

  const { data, error } = await admin
    .from("provider_events")
    .select("id, processing_state, attempts")
    .eq("source", "stripe")
    .eq("external_id", event.id)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function processWithLease(
  admin: Admin,
  stripe: Stripe,
  event: Stripe.Event,
  receiptId: string,
): Promise<"processed" | "in_progress" | "failed"> {
  const owner = `${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  const { data: current } = await admin.from("provider_events").select("attempts").eq("id", receiptId).single();
  const { data: claimed } = await admin
    .from("provider_events")
    .update({
      processing_state: "processing",
      lease_owner: owner,
      lease_expires_at: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString(),
      attempts: (current?.attempts ?? 0) + 1,
    })
    .eq("id", receiptId)
    .neq("processing_state", "processed")
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${now}`)
    .select("id")
    .maybeSingle();

  if (!claimed) return "in_progress";

  try {
    await applyEvent(admin, stripe, event, receiptId);
    await admin
      .from("provider_events")
      .update({ processing_state: "processed", processed_at: new Date().toISOString(), lease_owner: null, lease_expires_at: null, last_error: null })
      .eq("id", receiptId)
      .eq("lease_owner", owner);
    kickWorker();
    return "processed";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("provider_events")
      .update({ processing_state: "failed", last_error: message.slice(0, 2000), lease_owner: null, lease_expires_at: null })
      .eq("id", receiptId);
    console.error(`[stripe] ${event.type} ${event.id} failed: ${message}`);
    return "failed";
  }
}

/**
 * Reprocesses receipts that never finished — a crash, a timeout, a database
 * error — from Stripe's own copy of the event. Called by the scheduled sweep.
 */
export async function recoverStuckEvents(limit = 20): Promise<number> {
  const admin = createAdminClient();
  const stripe = getStripe();
  if (!admin || !stripe) return 0;

  const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
  const now = new Date().toISOString();
  const { data: stuck } = await admin
    .from("provider_events")
    .select("id, external_id, attempts, processing_state, lease_expires_at")
    .eq("source", "stripe")
    .lt("received_at", cutoff)
    .lt("attempts", 12)
    .or(`processing_state.eq.received,processing_state.eq.failed,and(processing_state.eq.processing,lease_expires_at.lt.${now})`)
    .order("received_at", { ascending: true })
    .limit(limit);

  let recovered = 0;
  for (const row of stuck ?? []) {
    try {
      const event = await stripe.events.retrieve(row.external_id);
      if ((await processWithLease(admin, stripe, event, row.id)) === "processed") recovered++;
    } catch (err) {
      await admin
        .from("provider_events")
        .update({ last_error: `recovery: ${err instanceof Error ? err.message : String(err)}`.slice(0, 2000) })
        .eq("id", row.id);
    }
  }
  return recovered;
}

// ---------------------------------------------------------------------------
// Applying events
// ---------------------------------------------------------------------------

async function applyEvent(admin: Admin, stripe: Stripe, event: Stripe.Event, receiptId: string): Promise<void> {
  const action: EventAction = ruleFor(event.type).action;
  const object = event.data.object as unknown as { id: string; object: string };

  switch (action) {
    case "ignore":
      return;

    case "link_checkout_session":
    case "release_checkout": {
      const session = await stripe.checkout.sessions.retrieve(object.id);
      return applyCheckoutSession(admin, stripe, session, receiptId, event.type);
    }

    case "record_cycle_paid": {
      if (object.object === "invoice") {
        const invoice = await stripe.invoices.retrieve(object.id, { expand: ["payments"] });
        return applyInvoicePaid(admin, stripe, invoice, receiptId);
      }
      const session = await stripe.checkout.sessions.retrieve(object.id);
      return applyCheckoutSession(admin, stripe, session, receiptId, event.type);
    }

    case "record_payment_failed": {
      if (object.object === "invoice") {
        const invoice = await stripe.invoices.retrieve(object.id);
        return applyInvoiceFailed(admin, stripe, invoice);
      }
      if (object.object === "checkout.session") {
        const session = await stripe.checkout.sessions.retrieve(object.id);
        return applyCheckoutSession(admin, stripe, session, receiptId, event.type);
      }
      return; // payment_intent.payment_failed: the invoice or session event carries the business outcome
    }

    case "sync_subscription":
    case "end_subscription": {
      const subscription = await stripe.subscriptions.retrieve(object.id);
      return applySubscription(admin, subscription);
    }

    case "record_refund": {
      const paymentIntentId = paymentIntentOf(event.data.object);
      if (!paymentIntentId) return;
      return applyRefundsForPaymentIntent(admin, stripe, paymentIntentId, receiptId);
    }

    case "record_dispute_opened":
    case "record_dispute_closed": {
      const dispute = await stripe.disputes.retrieve(object.id);
      return applyDispute(admin, stripe, dispute, receiptId);
    }
  }
}

function paymentIntentOf(obj: unknown): string | null {
  const o = obj as { payment_intent?: string | { id: string } | null; object?: string; id?: string };
  if (o.object === "payment_intent" && o.id) return o.id;
  if (typeof o.payment_intent === "string") return o.payment_intent;
  if (o.payment_intent && typeof o.payment_intent === "object") return o.payment_intent.id;
  return null;
}

function metadataPurchaseId(meta: Stripe.Metadata | null | undefined): string | null {
  const id = meta?.purchase_id;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

async function applyCheckoutSession(
  admin: Admin,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  receiptId: string,
  eventType: string,
): Promise<void> {
  const attemptId = session.metadata?.checkout_attempt_id ?? session.client_reference_id;
  const purchaseId = metadataPurchaseId(session.metadata);
  if (!attemptId || !purchaseId) return;

  // Expired or abandoned: release this attempt's own hold, unless it completed.
  if (session.status === "expired") {
    await admin.rpc("close_checkout_attempt", { p_attempt_id: attemptId, p_state: "expired", p_reason: "stripe_session_expired" });
    return;
  }

  if (session.id) {
    await admin.rpc("attach_checkout_session", { p_attempt_id: attemptId, p_session_id: session.id });
  }

  if (session.mode === "subscription") {
    // The subscription's first invoice is what earns — handled by invoice.paid.
    // Here we only link the subscription so later events can find the purchase.
    if (session.subscription) {
      const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
      await applySubscription(admin, subscription);
    }
    return;
  }

  // One-off payment. A completed session is NOT a paid session: a delayed
  // payment method finishes the form now and pays later (or never).
  if (session.payment_status !== "paid") {
    if (eventType === "checkout.session.async_payment_failed") {
      await admin.rpc("close_checkout_attempt", { p_attempt_id: attemptId, p_state: "failed", p_reason: "async_payment_failed" });
    }
    return;
  }

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!paymentIntentId) throw new Error(`paid session ${session.id} has no payment intent`);

  const { data: pu } = await admin
    .from("purchases")
    .select("id, customer_id, provider_id, service_type, commission_policy_id")
    .eq("id", purchaseId)
    .single();
  if (!pu) throw new Error(`purchase ${purchaseId} not found for session ${session.id}`);

  const taxMinor = session.total_details?.amount_tax ?? 0;
  const amountPaid = session.amount_total ?? 0;
  const currency = (session.currency ?? "usd").toUpperCase();
  const now = new Date();

  const entries = entriesForCycleEarning({
    billingCycleId: paymentIntentId,
    purchaseId: pu.id,
    providerId: pu.provider_id,
    customerId: pu.customer_id,
    // Commission is charged on the service amount, never on tax.
    serviceAmount: money(amountPaid - taxMinor, currency),
    serviceType: pu.service_type,
    commissionPolicyId: pu.commission_policy_id,
    // A one-off consultation is earned by a completion event, not a payment.
    delivered: false,
  });

  await rpcOrThrow(admin, "record_cycle_payment", {
    p: {
      purchase_id: pu.id,
      source_event_id: receiptId,
      cycle: {
        source_key: paymentIntentId,
        period_start: now.toISOString(),
        period_end: new Date(now.getTime() + 60_000).toISOString(),
        currency,
        amount_minor: amountPaid - taxMinor,
        stripe_payment_intent_id: paymentIntentId,
      },
      entries,
      notification: { topic: "email.purchase_confirmed", payload: { purchase_id: pu.id }, dedupe_key: `purchase_confirmed:${pu.id}` },
    },
  });
}

async function purchaseForInvoice(stripe: Stripe, invoice: Stripe.Invoice): Promise<string | null> {
  const details = invoice.parent?.subscription_details;
  const fromSnapshot = metadataPurchaseId(details?.metadata ?? null);
  if (fromSnapshot) return fromSnapshot;
  const subId = typeof details?.subscription === "string" ? details.subscription : details?.subscription?.id;
  if (!subId) return null;
  const subscription = await stripe.subscriptions.retrieve(subId);
  return metadataPurchaseId(subscription.metadata);
}

async function applyInvoicePaid(admin: Admin, stripe: Stripe, invoice: Stripe.Invoice, receiptId: string): Promise<void> {
  // The current invoice, not the event's copy. A stale "paid" for an invoice
  // since voided must not accrue.
  if (invoice.status !== "paid") return;

  const purchaseId = await purchaseForInvoice(stripe, invoice);
  if (!purchaseId) return; // not one of ours (e.g. created outside TalentYak)

  const { data: pu } = await admin
    .from("purchases")
    .select("id, customer_id, provider_id, service_type, commission_policy_id")
    .eq("id", purchaseId)
    .single();
  if (!pu) throw new Error(`purchase ${purchaseId} not found for invoice ${invoice.id}`);

  const payment = invoice.payments?.data?.find((p) => p.status === "paid") ?? invoice.payments?.data?.[0];
  const paymentIntentId =
    payment?.payment?.type === "payment_intent"
      ? (typeof payment.payment.payment_intent === "string" ? payment.payment.payment_intent : payment.payment.payment_intent?.id) ?? null
      : null;

  const line = invoice.lines?.data?.[0];
  const periodStart = line?.period?.start ?? invoice.period_start;
  const periodEnd = line?.period?.end ?? invoice.period_end;
  const taxMinor = (invoice.total_taxes ?? []).reduce((sum, t) => sum + (t.amount ?? 0), 0);
  const serviceMinor = (invoice.amount_paid ?? 0) - taxMinor;
  const currency = invoice.currency.toUpperCase();

  // A zero-amount invoice (e.g. a 100% discount) buys a period but earns nothing.
  const entries = serviceMinor > 0
    ? entriesForCycleEarning({
        billingCycleId: invoice.id!,
        purchaseId: pu.id,
        providerId: pu.provider_id,
        customerId: pu.customer_id,
        serviceAmount: money(serviceMinor, currency),
        serviceType: pu.service_type,
        commissionPolicyId: pu.commission_policy_id,
        delivered: false,
      })
    : [];

  await rpcOrThrow(admin, "record_cycle_payment", {
    p: {
      purchase_id: pu.id,
      source_event_id: receiptId,
      cycle: {
        source_key: invoice.id,
        period_start: new Date(periodStart * 1000).toISOString(),
        period_end: new Date(periodEnd * 1000).toISOString(),
        currency,
        amount_minor: Math.max(0, serviceMinor),
        stripe_invoice_id: invoice.id,
        stripe_payment_intent_id: paymentIntentId,
      },
      entries,
      notification: invoice.billing_reason === "subscription_create"
        ? { topic: "email.purchase_confirmed", payload: { purchase_id: pu.id }, dedupe_key: `purchase_confirmed:${pu.id}` }
        : null,
    },
  });
}

async function applyInvoiceFailed(admin: Admin, stripe: Stripe, invoice: Stripe.Invoice): Promise<void> {
  if (invoice.status === "paid") return; // recovered since; the paid event owns it
  const purchaseId = await purchaseForInvoice(stripe, invoice);
  if (!purchaseId) return;

  const line = invoice.lines?.data?.[0];
  await rpcOrThrow(admin, "record_payment_failure", {
    p: {
      purchase_id: purchaseId,
      source_key: invoice.id,
      stripe_invoice_id: invoice.id,
      period_start: line?.period?.start ? new Date(line.period.start * 1000).toISOString() : null,
      period_end: line?.period?.end ? new Date(line.period.end * 1000).toISOString() : null,
      currency: invoice.currency.toUpperCase(),
      amount_minor: invoice.amount_due,
      notification: { topic: "email.payment_failed", payload: { purchase_id: purchaseId }, dedupe_key: `payment_failed:${invoice.id}` },
    },
  });
}

async function applySubscription(admin: Admin, subscription: Stripe.Subscription): Promise<void> {
  const purchaseId = metadataPurchaseId(subscription.metadata);
  if (!purchaseId) return;

  const item = subscription.items?.data?.[0];
  const iso = (s?: number | null) => (s ? new Date(s * 1000).toISOString() : null);
  const stateForEmail = subscription.status === "canceled" ? "ended" : subscription.cancel_at_period_end ? "cancelling" : subscription.status;

  await rpcOrThrow(admin, "sync_subscription_state", {
    p: {
      purchase_id: purchaseId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
      status: subscription.status,
      cancel_at_period_end: subscription.cancel_at_period_end,
      current_period_start: iso(item?.current_period_start),
      current_period_end: iso(item?.current_period_end),
      canceled_at: iso(subscription.canceled_at),
      ended_at: iso(subscription.ended_at),
      // When WE observed this state. Fetched just now, so it is newer than any
      // observation already applied — unless a concurrent, later fetch landed first.
      observed_at: new Date().toISOString(),
      notification: ["cancelling", "ended"].includes(stateForEmail)
        ? { topic: "email.subscription_changed", payload: { purchase_id: purchaseId, state: stateForEmail }, dedupe_key: `subscription_changed:${subscription.id}:${stateForEmail}` }
        : null,
    },
  });
}

/**
 * A payment we have no record of yet.
 *
 * This is not a curiosity: a dispute or a refund can reach us BEFORE the
 * payment it refers to, and dropping it would lose money truth silently. So it
 * is written down for a person, and the event is failed on purpose — the
 * recovery sweep re-fetches it from Stripe and applies it once the payment has
 * been recorded. After a dozen attempts it stops retrying and the exception
 * stays open, because by then it needs a human, not another retry.
 */
async function unknownPayment(
  admin: Admin,
  receiptId: string | null,
  paymentIntentId: string,
  what: string,
): Promise<never> {
  if (receiptId) {
    const { data: existing } = await admin
      .from("reconciliation_exceptions")
      .select("id")
      .eq("provider_event_id", receiptId)
      .eq("kind", "missing_payment")
      .maybeSingle();
    if (!existing) {
      await admin.from("reconciliation_exceptions").insert({
        kind: "missing_payment",
        severity: "critical",
        provider_event_id: receiptId,
        detail: `${what} arrived for Stripe payment ${paymentIntentId}, which has no billing period recorded here yet. It will be retried; if it stays open, the payment and the ${what.toLowerCase()} need matching up by hand.`,
      });
    }
  }
  throw new Error(`No billing period recorded for payment ${paymentIntentId} (${what}); will retry.`);
}

async function cycleForPaymentIntent(admin: Admin, paymentIntentId: string) {
  const { data } = await admin
    .from("billing_cycles")
    .select("id, source_key, purchase_id, currency, amount_minor, purchases(customer_id, provider_id, service_type, commission_policy_id)")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (!data) return null;
  const pu = (Array.isArray(data.purchases) ? data.purchases[0] : data.purchases) as {
    customer_id: string; provider_id: string; service_type: "recurring_coaching" | "one_off_consultation"; commission_policy_id: string;
  };
  return { ...data, purchase: pu };
}

async function applyRefundsForPaymentIntent(admin: Admin, stripe: Stripe, paymentIntentId: string, receiptId: string | null): Promise<void> {
  const cycle = (await cycleForPaymentIntent(admin, paymentIntentId))
    ?? (await unknownPayment(admin, receiptId, paymentIntentId, "A refund"));

  // The full, current list of refunds on this payment — processed oldest first
  // so each one's cumulative basis is correct.
  const refunds = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
  const ordered = [...refunds.data].sort((a, b) => a.created - b.created);

  for (const refund of ordered) {
    const state = refund.status === "succeeded" ? "succeeded" : refund.status === "failed" || refund.status === "canceled" ? "failed" : "pending";

    const { data: prior } = await admin
      .from("refunds")
      .select("amount_minor, stripe_refund_id")
      .eq("billing_cycle_id", cycle.id)
      .eq("state", "succeeded");
    const previously = (prior ?? [])
      .filter((r) => r.stripe_refund_id !== refund.id)
      .reduce((sum, r) => sum + Number(r.amount_minor), 0);

    const entries = state === "succeeded"
      ? entriesForRefund({
          refundId: refund.id,
          billingCycleId: cycle.source_key,
          purchaseId: cycle.purchase_id,
          providerId: cycle.purchase.provider_id,
          customerId: cycle.purchase.customer_id,
          serviceAmount: money(Number(cycle.amount_minor), cycle.currency),
          serviceType: cycle.purchase.service_type,
          commissionPolicyId: cycle.purchase.commission_policy_id,
          previouslyRefunded: money(previously, cycle.currency),
          refundAmount: money(refund.amount, cycle.currency),
        })
      : [];

    await rpcOrThrow(admin, "record_refund_effects", {
      p: {
        purchase_id: cycle.purchase_id,
        billing_cycle_id: cycle.id,
        source_event_id: receiptId,
        previously_refunded_minor: previously,
        refund: {
          stripe_refund_id: refund.id,
          request_id: refund.metadata?.refund_request_id ?? null,
          stripe_payment_intent_id: paymentIntentId,
          currency: refund.currency.toUpperCase(),
          amount_minor: refund.amount,
          state,
          reason: refund.reason ?? null,
        },
        entries,
        notification: state === "succeeded"
          ? { topic: "email.refund_processed", payload: { purchase_id: cycle.purchase_id, amount_minor: refund.amount, currency: refund.currency.toUpperCase() }, dedupe_key: `refund_processed:${refund.id}` }
          : null,
      },
    });
  }
}

function disputeState(status: Stripe.Dispute.Status): string {
  switch (status) {
    case "won":
    case "prevented":
      return "won";
    case "lost":
      return "lost";
    case "warning_closed":
      return "warning_closed";
    case "under_review":
    case "warning_under_review":
      return "under_review";
    default:
      return "open";
  }
}

async function applyDispute(admin: Admin, stripe: Stripe, dispute: Stripe.Dispute, receiptId: string): Promise<void> {
  let paymentIntentId = paymentIntentOf(dispute);
  if (!paymentIntentId) {
    const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
    const charge = await stripe.charges.retrieve(chargeId);
    paymentIntentId = paymentIntentOf(charge);
  }
  if (!paymentIntentId) return;

  const cycle = (await cycleForPaymentIntent(admin, paymentIntentId))
    ?? (await unknownPayment(admin, receiptId, paymentIntentId, "A card dispute"));

  const state = disputeState(dispute.status);
  const input = {
    disputeId: dispute.id,
    purchaseId: cycle.purchase_id,
    providerId: cycle.purchase.provider_id,
    customerId: cycle.purchase.customer_id,
    // A dispute can be for less than the payment; never more than the service amount.
    disputedAmount: money(Math.min(dispute.amount, Number(cycle.amount_minor)), cycle.currency),
    commissionPolicyId: cycle.purchase.commission_policy_id,
    serviceType: cycle.purchase.service_type,
  };

  // Entries for the FINAL state. Effect keys make re-applying any of them harmless,
  // which is what lets a "lost" that arrives before its "created" converge.
  const entries = [
    ...entriesForDisputeOpened(input),
    ...(state === "won" || state === "warning_closed" ? entriesForDisputeWon(input) : []),
    ...(state === "lost" ? entriesForDisputeLost(input) : []),
  ];

  await rpcOrThrow(admin, "record_dispute_effects", {
    p: {
      purchase_id: cycle.purchase_id,
      source_event_id: receiptId,
      dispute: {
        stripe_dispute_id: dispute.id,
        currency: dispute.currency.toUpperCase(),
        amount_minor: input.disputedAmount.minor,
        state,
        reason: dispute.reason,
      },
      entries,
    },
  });
}

async function rpcOrThrow(admin: Admin, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) {
    // stale_refund_basis and friends are retryable by design: throwing makes the
    // webhook return 500, Stripe retries, and the retry computes a fresh basis.
    throw new Error(`${fn}: ${error.message}${error.details ? ` (${error.details})` : ""}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Direct syncs, for actions that just changed something at Stripe
// ---------------------------------------------------------------------------
//
// After a customer cancels, or an admin issues a refund, the result is fetched
// back from Stripe and applied through the same path the webhook uses. The
// source of truth is still Stripe's own object — never the button that was
// pressed — and the webhook arriving later changes nothing further.

export async function syncSubscriptionFromStripe(subscriptionId: string): Promise<void> {
  const admin = createAdminClient();
  const stripe = getStripe();
  if (!admin || !stripe) return;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await applySubscription(admin, subscription);
  kickWorker();
}

export async function syncRefundsFromStripe(paymentIntentId: string): Promise<void> {
  const admin = createAdminClient();
  const stripe = getStripe();
  if (!admin || !stripe) return;
  await applyRefundsForPaymentIntent(admin, stripe, paymentIntentId, null);
  kickWorker();
}
