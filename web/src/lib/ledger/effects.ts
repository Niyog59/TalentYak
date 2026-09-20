/**
 * What each financial event does to the ledger.
 *
 * Pure functions: in, a description of something that happened; out, the exact
 * rows to append. No database, no network, no clock beyond what is passed in.
 * That is deliberate — this is the arithmetic that decides what a coach is
 * owed, and it should be checkable without standing a system up.
 *
 * **The effect key is the heart of this file.** Deduplicating on the Stripe
 * event id is not enough. Several different events can describe one payment —
 * `checkout.session.completed` and `invoice.paid` both arrive for the first
 * month of a subscription — and a system that keys on the event id records the
 * earnings twice, once per event type. So every entry carries a key naming the
 * BUSINESS EFFECT it represents: "the coach's earnings for billing cycle X".
 * Whichever event carries that effect, and however many times it is delivered,
 * the unique index on `effect_key` admits it exactly once.
 */

import {
  type Money,
  addMoney,
  money,
  subtractMoney,
  zero,
} from "@/lib/money/money";
import { splitCommission, refundReversal } from "@/lib/money/split";
import { commissionBasisPointsFor, getCommissionPolicy } from "@/lib/policy/registry";
import type { ServiceType } from "@/lib/policy/types";

export type LedgerAccount =
  | "coach_payable"
  | "platform_revenue"
  | "platform_subsidy"
  | "processing_expense"
  | "customer_refund"
  | "dispute_holdback";

export type LedgerEffect =
  | "service_earned"
  | "commission_earned"
  | "refund_reversal"
  | "dispute_hold"
  | "dispute_release"
  | "dispute_loss"
  | "subsidy"
  | "processing_fee"
  | "payout"
  | "payout_reversal"
  | "manual_adjustment";

export interface LedgerEntryDraft {
  readonly account: LedgerAccount;
  readonly effect: LedgerEffect;
  readonly currency: string;
  readonly amountMinor: number;
  readonly effectKey: string;
  readonly providerId?: string;
  readonly customerId?: string;
  readonly purchaseId?: string;
  readonly billingCycleId?: string;
  readonly commissionPolicyId?: string;
  readonly reversesEffectKey?: string;
  /**
   * Where this entry starts in the payout workflow.
   *
   * `pending` for money not yet earned by delivery. A payment arriving is not a
   * month of coaching being delivered, and presenting it as earned is how a
   * coach ends up owing money back.
   */
  readonly initialState: "pending" | "held" | "eligible";
}

// --- Effect keys --------------------------------------------------------------

/**
 * Keys are built from business identity, never from an event id or a timestamp.
 * Two deliveries of the same event, or two different events describing the same
 * thing, must produce byte-identical keys.
 */
export const effectKeys = {
  coachEarnedForCycle: (cycleId: string) => `cycle:${cycleId}:coach_earned`,
  commissionForCycle: (cycleId: string) => `cycle:${cycleId}:commission`,
  subsidyForCycle: (cycleId: string) => `cycle:${cycleId}:subsidy`,
  processingFeeForCycle: (cycleId: string) => `cycle:${cycleId}:processing_fee`,
  coachReversalForRefund: (refundId: string) => `refund:${refundId}:coach_reversal`,
  commissionReversalForRefund: (refundId: string) =>
    `refund:${refundId}:commission_reversal`,
  customerRefund: (refundId: string) => `refund:${refundId}:customer`,
  disputeHold: (disputeId: string) => `dispute:${disputeId}:hold`,
  disputeRelease: (disputeId: string) => `dispute:${disputeId}:release`,
  disputeLoss: (disputeId: string) => `dispute:${disputeId}:loss`,
  payout: (batchItemId: string) => `payout:${batchItemId}:paid`,
  payoutReversal: (batchItemId: string) => `payout:${batchItemId}:returned`,
} as const;

// --- Earning a billing cycle --------------------------------------------------

export interface CycleEarningInput {
  readonly billingCycleId: string;
  readonly purchaseId: string;
  readonly providerId: string;
  readonly customerId: string;
  /** The service amount for this cycle, excluding separately identified tax. */
  readonly serviceAmount: Money;
  readonly serviceType: ServiceType;
  readonly commissionPolicyId: string;
  /** A promotion the platform funded. Never reduces the coach's entitlement. */
  readonly platformFundedDiscount?: Money;
  /**
   * True when this cycle has actually been delivered. Earnings become eligible
   * for payout only then — not when the payment arrived.
   */
  readonly delivered: boolean;
}

/**
 * The entries for one paid billing cycle.
 *
 * Note what does NOT happen here: a one-off consultation does not become
 * eligible because a checkout succeeded. Its `delivered` flag comes from an
 * approved completion event in the appointment lifecycle, which does not exist
 * yet — so today a one-off can only sit `pending`, and no code fabricates the
 * completion that would release it.
 */
export function entriesForCycleEarning(
  input: CycleEarningInput,
): LedgerEntryDraft[] {
  const policy = getCommissionPolicy(input.commissionPolicyId);
  const basisPoints = commissionBasisPointsFor(policy, input.serviceType);

  const split = splitCommission({
    serviceAmount: input.serviceAmount,
    commissionBasisPoints: basisPoints,
    platformFundedDiscount: input.platformFundedDiscount,
  });

  const shared = {
    currency: input.serviceAmount.currency,
    providerId: input.providerId,
    customerId: input.customerId,
    purchaseId: input.purchaseId,
    billingCycleId: input.billingCycleId,
    commissionPolicyId: policy.id,
  } as const;

  const entries: LedgerEntryDraft[] = [
    {
      ...shared,
      account: "coach_payable",
      effect: "service_earned",
      amountMinor: split.coachEntitlement.minor,
      effectKey: effectKeys.coachEarnedForCycle(input.billingCycleId),
      initialState: input.delivered ? "eligible" : "pending",
    },
    {
      ...shared,
      account: "platform_revenue",
      effect: "commission_earned",
      amountMinor: split.platformCommission.minor,
      effectKey: effectKeys.commissionForCycle(input.billingCycleId),
      initialState: input.delivered ? "eligible" : "pending",
    },
  ];

  // A platform-funded promotion is recorded as its own negative entry against
  // platform economics, so the books show a subsidy that was decided rather
  // than an imbalance that has to be explained later.
  if (split.platformFundedDiscount.minor > 0) {
    entries.push({
      ...shared,
      account: "platform_subsidy",
      effect: "subsidy",
      amountMinor: -split.platformFundedDiscount.minor,
      effectKey: effectKeys.subsidyForCycle(input.billingCycleId),
      initialState: "eligible",
    });
  }

  return entries;
}

// --- Refunds ------------------------------------------------------------------

export interface RefundInput {
  readonly refundId: string;
  readonly billingCycleId: string;
  readonly purchaseId: string;
  readonly providerId: string;
  readonly customerId: string;
  readonly serviceAmount: Money;
  readonly serviceType: ServiceType;
  readonly commissionPolicyId: string;
  /** Cumulative amount already refunded against this service, before this one. */
  readonly previouslyRefunded: Money;
  readonly refundAmount: Money;
}

/**
 * Reversal entries for one refund.
 *
 * Both sides reverse. The old code updated `payments.status` to 'refunded' and
 * stopped, leaving the coach's entry `pending` — so it would be exported in the
 * next batch and paid out, for a service the customer had already been refunded
 * for.
 */
export function entriesForRefund(input: RefundInput): LedgerEntryDraft[] {
  const policy = getCommissionPolicy(input.commissionPolicyId);
  const basisPoints = commissionBasisPointsFor(policy, input.serviceType);

  const reversal = refundReversal({
    serviceAmount: input.serviceAmount,
    commissionBasisPoints: basisPoints,
    previouslyRefunded: input.previouslyRefunded,
    refundAmount: input.refundAmount,
  });

  const shared = {
    currency: input.serviceAmount.currency,
    providerId: input.providerId,
    customerId: input.customerId,
    purchaseId: input.purchaseId,
    billingCycleId: input.billingCycleId,
    commissionPolicyId: policy.id,
  } as const;

  const entries: LedgerEntryDraft[] = [];

  if (reversal.coachEntitlementReversal.minor !== 0) {
    entries.push({
      ...shared,
      account: "coach_payable",
      effect: "refund_reversal",
      amountMinor: -reversal.coachEntitlementReversal.minor,
      effectKey: effectKeys.coachReversalForRefund(input.refundId),
      reversesEffectKey: effectKeys.coachEarnedForCycle(input.billingCycleId),
      initialState: "eligible",
    });
  }

  if (reversal.platformCommissionReversal.minor !== 0) {
    entries.push({
      ...shared,
      account: "platform_revenue",
      effect: "refund_reversal",
      amountMinor: -reversal.platformCommissionReversal.minor,
      effectKey: effectKeys.commissionReversalForRefund(input.refundId),
      reversesEffectKey: effectKeys.commissionForCycle(input.billingCycleId),
      initialState: "eligible",
    });
  }

  return entries;
}

// --- Disputes -----------------------------------------------------------------

export interface DisputeInput {
  readonly disputeId: string;
  readonly purchaseId: string;
  readonly providerId: string;
  readonly customerId: string;
  readonly disputedAmount: Money;
  readonly commissionPolicyId: string;
  readonly serviceType: ServiceType;
}

/**
 * A dispute freezes the affected balance; it does not reverse it.
 *
 * Opening a chargeback is a claim, not an outcome. Treating it as a refund
 * would take money off a coach who may well be about to win.
 */
export function entriesForDisputeOpened(input: DisputeInput): LedgerEntryDraft[] {
  return [
    {
      account: "dispute_holdback",
      effect: "dispute_hold",
      currency: input.disputedAmount.currency,
      amountMinor: input.disputedAmount.minor,
      effectKey: effectKeys.disputeHold(input.disputeId),
      providerId: input.providerId,
      customerId: input.customerId,
      purchaseId: input.purchaseId,
      commissionPolicyId: input.commissionPolicyId,
      initialState: "held",
    },
  ];
}

/** Won: the hold is released and nothing else changes. */
export function entriesForDisputeWon(input: DisputeInput): LedgerEntryDraft[] {
  return [
    {
      account: "dispute_holdback",
      effect: "dispute_release",
      currency: input.disputedAmount.currency,
      amountMinor: -input.disputedAmount.minor,
      effectKey: effectKeys.disputeRelease(input.disputeId),
      providerId: input.providerId,
      customerId: input.customerId,
      purchaseId: input.purchaseId,
      commissionPolicyId: input.commissionPolicyId,
      initialState: "eligible",
    },
  ];
}

/**
 * Lost: the hold is released AND the amounts reverse.
 *
 * A lost dispute is not processed as a second identical refund — it releases
 * the hold first, so the same money is not subtracted twice.
 */
export function entriesForDisputeLost(input: DisputeInput): LedgerEntryDraft[] {
  const policy = getCommissionPolicy(input.commissionPolicyId);
  const basisPoints = commissionBasisPointsFor(policy, input.serviceType);
  const split = splitCommission({
    serviceAmount: input.disputedAmount,
    commissionBasisPoints: basisPoints,
  });

  const shared = {
    currency: input.disputedAmount.currency,
    providerId: input.providerId,
    customerId: input.customerId,
    purchaseId: input.purchaseId,
    commissionPolicyId: policy.id,
  } as const;

  return [
    {
      ...shared,
      account: "dispute_holdback",
      effect: "dispute_release",
      amountMinor: -input.disputedAmount.minor,
      effectKey: effectKeys.disputeRelease(input.disputeId),
      initialState: "eligible",
    },
    {
      ...shared,
      account: "coach_payable",
      effect: "dispute_loss",
      amountMinor: -split.coachEntitlement.minor,
      effectKey: `${effectKeys.disputeLoss(input.disputeId)}:coach`,
      initialState: "eligible",
    },
    {
      ...shared,
      account: "platform_revenue",
      effect: "dispute_loss",
      amountMinor: -split.platformCommission.minor,
      effectKey: `${effectKeys.disputeLoss(input.disputeId)}:platform`,
      initialState: "eligible",
    },
  ];
}

// --- Payouts ------------------------------------------------------------------

export function entriesForPayout(input: {
  batchItemId: string;
  providerId: string;
  amount: Money;
}): LedgerEntryDraft[] {
  return [
    {
      account: "coach_payable",
      effect: "payout",
      currency: input.amount.currency,
      amountMinor: -input.amount.minor,
      effectKey: effectKeys.payout(input.batchItemId),
      providerId: input.providerId,
      initialState: "eligible",
    },
  ];
}

/** A returned or failed transfer puts the money back where it was owed. */
export function entriesForReturnedPayout(input: {
  batchItemId: string;
  providerId: string;
  amount: Money;
}): LedgerEntryDraft[] {
  return [
    {
      account: "coach_payable",
      effect: "payout_reversal",
      currency: input.amount.currency,
      amountMinor: input.amount.minor,
      effectKey: effectKeys.payoutReversal(input.batchItemId),
      providerId: input.providerId,
      reversesEffectKey: effectKeys.payout(input.batchItemId),
      initialState: "eligible",
    },
  ];
}

// --- Reconciliation -----------------------------------------------------------

/**
 * Sums a set of drafts per account and currency.
 *
 * Currencies are never combined. A coach paid in two currencies has two
 * balances, and adding them would be inventing an exchange rate we have not
 * looked up and could not defend.
 */
export function summarise(
  entries: readonly LedgerEntryDraft[],
): Map<string, Money> {
  const totals = new Map<string, Money>();
  for (const entry of entries) {
    const key = `${entry.account}:${entry.currency}`;
    const current = totals.get(key) ?? zero(entry.currency);
    totals.set(key, addMoney(current, money(entry.amountMinor, entry.currency)));
  }
  return totals;
}

/**
 * What the coach is owed across a set of entries, in one currency.
 * Every entry outside that currency is ignored rather than converted.
 */
export function coachBalance(
  entries: readonly LedgerEntryDraft[],
  currency: string,
): Money {
  let total = zero(currency);
  for (const entry of entries) {
    if (entry.account !== "coach_payable") continue;
    if (entry.currency !== total.currency) continue;
    total = addMoney(total, money(entry.amountMinor, currency));
  }
  return total;
}

/** Drops any draft whose effect key is already present. */
export function dedupeByEffectKey(
  existingKeys: ReadonlySet<string>,
  drafts: readonly LedgerEntryDraft[],
): LedgerEntryDraft[] {
  const seen = new Set(existingKeys);
  const out: LedgerEntryDraft[] = [];
  for (const draft of drafts) {
    if (seen.has(draft.effectKey)) continue;
    seen.add(draft.effectKey);
    out.push(draft);
  }
  return out;
}

export { subtractMoney };
