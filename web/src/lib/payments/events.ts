/**
 * The event-to-effect matrix.
 *
 * Kept as data and pure functions so the decisions are checkable without
 * standing up Stripe. The previous webhook handled three event types in a
 * `switch`, and the gaps were not visible: nothing covered a failed renewal, a
 * cancellation, a dispute, or an async payment, so those events arrived and
 * were silently dropped with a 200.
 *
 * Three rules encoded here, each from a real failure mode:
 *
 * 1. **A completed checkout is not a paid checkout.** `checkout.session.completed`
 *    fires when the customer finishes the form. For a subscription, or for a
 *    delayed payment method, the money may not have moved. Granting access on
 *    this event alone gives away service for an invoice that never paid.
 *
 * 2. **The first subscription invoice must not accrue twice.** Both
 *    `checkout.session.completed` and `invoice.paid` describe the first month.
 *    Only the invoice carries the earning; the session sets up the linkage.
 *
 * 3. **Arrival order is not chronology.** Webhooks retry and overtake each
 *    other. Every state change compares the event's own timestamp against what
 *    was last applied, so a stale event cannot resurrect revoked access or
 *    overwrite a newer paid period.
 */

export type EventAction =
  /** Link the Stripe objects to our purchase. Grants nothing. */
  | "link_checkout_session"
  /** Money confirmed for a billing cycle. This is the only thing that earns. */
  | "record_cycle_paid"
  /** A renewal failed. Paid-through access is unaffected; no new period opens. */
  | "record_payment_failed"
  /** Subscription lifecycle: state, period boundaries, cancel-at-period-end. */
  | "sync_subscription"
  /** The subscription is over. */
  | "end_subscription"
  /** A checkout was abandoned or timed out; release its capacity hold. */
  | "release_checkout"
  | "record_refund"
  | "record_dispute_opened"
  | "record_dispute_closed"
  /** Known, deliberately not acted on. Recorded so the gap is visible. */
  | "ignore";

export interface EventRule {
  readonly action: EventAction;
  /** Why, in one line, so a future reader does not have to reconstruct it. */
  readonly reason: string;
  /** True when this action can grant or move money. Used for extra checks. */
  readonly financial: boolean;
}

/**
 * Every event type we accept. An unlisted type is recorded and marked
 * `ignored` rather than dropped — a gap should be visible in the table, not
 * discovered when someone asks where a payment went.
 */
export const EVENT_RULES: Readonly<Record<string, EventRule>> = {
  "checkout.session.completed": {
    action: "link_checkout_session",
    reason:
      "The customer finished the form. For a subscription or a delayed payment method the money may not have moved, so this links objects and grants nothing.",
    financial: false,
  },
  "checkout.session.async_payment_succeeded": {
    action: "record_cycle_paid",
    reason: "A delayed payment method finally cleared.",
    financial: true,
  },
  "checkout.session.async_payment_failed": {
    action: "record_payment_failed",
    reason: "A delayed payment method failed. No access is granted.",
    financial: false,
  },
  "checkout.session.expired": {
    action: "release_checkout",
    reason: "Abandoned checkout. Its capacity hold is released — only its own.",
    financial: false,
  },

  "invoice.paid": {
    action: "record_cycle_paid",
    reason: "The authoritative signal that a billing period has been paid for.",
    financial: true,
  },
  "invoice.payment_succeeded": {
    action: "record_cycle_paid",
    reason:
      "Describes the same money as invoice.paid. Deduplicated by the cycle's effect key, not by event type.",
    financial: true,
  },
  "invoice.payment_failed": {
    action: "record_payment_failed",
    reason:
      "A renewal failed. Access already paid for runs to its paid-through date; no new period opens.",
    financial: false,
  },
  "invoice.marked_uncollectible": {
    action: "record_payment_failed",
    reason: "Stripe gave up collecting. Treated as a failed period.",
    financial: false,
  },

  "customer.subscription.created": {
    action: "sync_subscription",
    reason: "Records the subscription and its first period boundaries.",
    financial: false,
  },
  "customer.subscription.updated": {
    action: "sync_subscription",
    reason:
      "Plan, status, period, or cancel-at-period-end changed. Applied only if newer than what we hold.",
    financial: false,
  },
  "customer.subscription.deleted": {
    action: "end_subscription",
    reason: "The subscription has ended. Historical records are untouched.",
    financial: false,
  },
  "customer.subscription.paused": {
    action: "sync_subscription",
    reason: "Paused subscriptions bill nothing and open no new service period.",
    financial: false,
  },
  "customer.subscription.resumed": {
    action: "sync_subscription",
    reason:
      "Billing resumes and new period boundaries arrive. The earning still waits for the invoice that actually pays.",
    financial: false,
  },

  "charge.refunded": {
    action: "record_refund",
    reason:
      "Reverses the service amount AND its commission. The old code updated a status column and left the coach's earning payable.",
    financial: true,
  },
  "refund.created": {
    action: "record_refund",
    reason: "A refund object exists. Requested is not succeeded.",
    financial: true,
  },
  "refund.updated": {
    action: "record_refund",
    reason: "A refund changed state, possibly to failed.",
    financial: true,
  },
  "refund.failed": {
    action: "record_refund",
    reason: "A refund did not go through. The reversal must not stand.",
    financial: true,
  },

  "charge.dispute.created": {
    action: "record_dispute_opened",
    reason: "Holds the affected balance and raises an operational exception. Does not reverse.",
    financial: true,
  },
  "charge.dispute.closed": {
    action: "record_dispute_closed",
    reason: "Won releases the hold; lost releases it and reverses once.",
    financial: true,
  },
  "charge.dispute.funds_withdrawn": {
    action: "ignore",
    reason: "Cash-flow detail. The dispute lifecycle is driven by created/closed.",
    financial: false,
  },
  "charge.dispute.funds_reinstated": {
    action: "ignore",
    reason: "Cash-flow detail; the outcome arrives on charge.dispute.closed.",
    financial: false,
  },

  "payment_intent.succeeded": {
    action: "ignore",
    reason:
      "Describes the same money as the invoice or session that carries our business identifiers. Acting here would be a second accrual path.",
    financial: false,
  },
  "payment_intent.payment_failed": {
    action: "record_payment_failed",
    reason: "A payment attempt failed.",
    financial: false,
  },
} as const;

export function ruleFor(eventType: string): EventRule {
  return (
    EVENT_RULES[eventType] ?? {
      action: "ignore",
      reason: "Not in the event matrix. Recorded so the gap is visible rather than silent.",
      financial: false,
    }
  );
}

export function isHandled(eventType: string): boolean {
  return eventType in EVENT_RULES;
}

// --- Context checks -----------------------------------------------------------

export interface EventContext {
  readonly livemode: boolean;
  readonly accountId?: string | null;
}

export interface ExpectedContext {
  /** True when this deployment is configured for live billing. */
  readonly expectLivemode: boolean;
  /** Our own Stripe account id, when known. */
  readonly expectedAccountId?: string | null;
}

export type ContextVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Refuses an event from the wrong mode or the wrong account.
 *
 * A signature check proves the payload came from Stripe. It does not prove it
 * came from OUR Stripe, in the mode we are running in. A test-mode event
 * processed as live grants free service; a live event processed by a sandbox
 * deployment writes real money into a test ledger.
 */
export function checkEventContext(
  event: EventContext,
  expected: ExpectedContext,
): ContextVerdict {
  if (event.livemode !== expected.expectLivemode) {
    return {
      ok: false,
      reason: `Event livemode=${event.livemode} does not match this deployment (expects livemode=${expected.expectLivemode}). Refusing to process.`,
    };
  }

  if (
    expected.expectedAccountId &&
    event.accountId &&
    event.accountId !== expected.expectedAccountId
  ) {
    return {
      ok: false,
      reason: `Event account ${event.accountId} is not this deployment's account ${expected.expectedAccountId}.`,
    };
  }

  return { ok: true };
}

// --- Ordering -----------------------------------------------------------------

/**
 * Should this event be applied over what we already hold?
 *
 * Webhooks retry and overtake each other, so arrival order means nothing. A
 * cancellation delivered late must not un-cancel a resubscription, and a stale
 * `active` must not overwrite a newer `canceled`.
 *
 * An event with no timestamp is applied — refusing it would drop real
 * information — but an equal timestamp is NOT applied, so a duplicate delivery
 * is a no-op.
 */
export function shouldApply(
  eventOccurredAt: Date | null,
  lastAppliedAt: Date | null,
): boolean {
  if (!eventOccurredAt) return true;
  if (!lastAppliedAt) return true;
  return eventOccurredAt.getTime() > lastAppliedAt.getTime();
}

/**
 * The minimal set of fields worth keeping from an event.
 *
 * A full Stripe payload carries the customer's name, email, address, and card
 * details. This table is read by ordinary operators during reconciliation, and
 * The project rules forbid logging a full payload containing customer PII. Enough is
 * kept to replay and reconcile; nothing more.
 */
export function minimisePayload(
  event: { id: string; type: string; created?: number; data?: { object?: Record<string, unknown> } },
): Record<string, unknown> {
  const object = event.data?.object ?? {};
  const keep = [
    "id",
    "object",
    "status",
    "mode",
    "currency",
    "amount",
    "amount_total",
    "amount_paid",
    "amount_due",
    "amount_refunded",
    "subscription",
    "invoice",
    "payment_intent",
    "charge",
    "client_reference_id",
    "cancel_at_period_end",
    "current_period_start",
    "current_period_end",
    "period_start",
    "period_end",
    "reason",
    "failure_reason",
    "billing_reason",
    "payment_status",
  ];

  const minimal: Record<string, unknown> = {};
  for (const key of keep) {
    if (object[key] !== undefined && object[key] !== null) minimal[key] = object[key];
  }

  // Our own identifiers travel in metadata. Everything else in metadata is
  // dropped: it is a free-text field and there is no guarantee it is safe.
  const metadata = object.metadata as Record<string, unknown> | undefined;
  if (metadata) {
    minimal.metadata = {
      purchase_id: metadata.purchase_id,
      checkout_attempt_id: metadata.checkout_attempt_id,
      offer_version_id: metadata.offer_version_id,
      provider_id: metadata.provider_id,
    };
  }

  return minimal;
}
