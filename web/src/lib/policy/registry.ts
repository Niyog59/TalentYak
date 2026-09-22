/**
 * The policy register — the single source of truth for every commercial rule.
 *
 * Superseded versions are kept, never deleted. A ledger row written in 2026
 * under a 70/30 split must still be interpretable in 2030, and the only way to
 * guarantee that is for the policy that produced it to still be here.
 *
 * Adding a version: append it, mark the one it replaces with `supersededBy`,
 * and point the CURRENT_* constant at it. Never edit a version that has been
 * snapshotted onto a purchase.
 */

import type {
  BillingTermsPolicy,
  CancellationPolicy,
  CommissionPolicy,
  DiscountPolicy,
  EligibilityPolicy,
  MessagingPolicy,
  PaymentFailurePolicy,
  PayoutPolicy,
  Policy,
  PriceChangePolicy,
  RecognitionPolicy,
  ServiceType,
} from "@/lib/policy/types";

// --- Commission ---------------------------------------------------------------

/**
 * Ghartira-era fitness split: 60% coach, 40% platform, with a 65% rate for
 * founding coaches. Superseded twice over. Retained so that any historical
 * ledger row citing it can still be explained.
 */
const COMMISSION_FITNESS_V1: CommissionPolicy = {
  kind: "commission",
  id: "commission.coaching.v1",
  version: 1,
  status: "confirmed",
  effectiveFrom: "2026-08-13",
  supersededBy: "commission.coaching.v2",
  source: "docs/HANDOVER.md §6.3 (Ghartira era)",
  note: "60/40, with a 65/35 rate for founding coaches. Historical only — no new contract may be written under it.",
  recurringBasisPoints: 4000,
  oneOffBasisPoints: 4000,
  baseRule: "service_amount_excluding_tax_after_coach_funded_discount",
  processingCostsBorneBy: "platform",
  rounding: "commission_first_half_away_from_zero",
  deductsDirectCostsFirst: false,
};

/**
 * Aafnai-era split: 30% on recurring coaching, 40% on one-off consultations.
 * Confirmed on 2026-09-09 as AAF-COMM-01 and AAF-COMM-02, superseded on
 * 2026-09-15 by the founder's TalentYak brief. Historical only.
 */
const COMMISSION_COACHING_V2: CommissionPolicy = {
  kind: "commission",
  id: "commission.coaching.v2",
  version: 2,
  status: "confirmed",
  effectiveFrom: "2026-09-09",
  supersededBy: "commission.coaching.v3",
  source: "docs/aafnai/DECISION_REGISTER.md AAF-COMM-01, AAF-COMM-02",
  note: "70/30 recurring and 60/40 one-off. Historical only — no new contract may be written under it.",
  recurringBasisPoints: 3000,
  oneOffBasisPoints: 4000,
  baseRule: "service_amount_excluding_tax_after_coach_funded_discount",
  processingCostsBorneBy: "platform",
  rounding: "commission_first_half_away_from_zero",
  deductsDirectCostsFirst: false,
};

/**
 * Current TalentYak split: 20% on both recurring coaching and one-off
 * consultations. The coach receives the exact remainder.
 */
const COMMISSION_COACHING_V3: CommissionPolicy = {
  kind: "commission",
  id: "commission.coaching.v3",
  version: 3,
  status: "confirmed",
  effectiveFrom: "2026-09-15",
  source: "Founder brief, TalentYak M03–M07, §1 and §5 — supersedes AAF-COMM-01, AAF-COMM-02, AAF-COMM-05",
  note: "20% on both service types. Ordinary processing costs are borne by the platform out of its share, never deducted from the advertised 80%.",
  recurringBasisPoints: 2000,
  oneOffBasisPoints: 2000,
  baseRule: "service_amount_excluding_tax_after_coach_funded_discount",
  processingCostsBorneBy: "platform",
  rounding: "commission_first_half_away_from_zero",
  deductsDirectCostsFirst: false,
};

/**
 * Pandit vertical: direct ritual costs — samagri, temple fees, assistant,
 * fixer — come out of the ticket first, and what remains splits 50/50. Not
 * superseded: it is a different vertical with a different economic shape. The
 * pandit vertical is not publicly sellable, so this governs historical records
 * only, but it governs them correctly.
 */
const COMMISSION_PANDIT_V1: CommissionPolicy = {
  kind: "commission",
  id: "commission.pandit.v1",
  version: 1,
  status: "confirmed",
  effectiveFrom: "2026-08-13",
  source: "docs/HANDOVER.md §5.2",
  note: "Post-direct-cost 50/50. Applies to pandit records only; the vertical is not publicly sellable.",
  recurringBasisPoints: 5000,
  oneOffBasisPoints: 5000,
  baseRule: "service_amount_excluding_tax_after_coach_funded_discount",
  processingCostsBorneBy: "platform",
  rounding: "commission_first_half_away_from_zero",
  deductsDirectCostsFirst: true,
};

export const CURRENT_COMMISSION_POLICY_ID = COMMISSION_COACHING_V3.id;

// --- Everything else ----------------------------------------------------------

const DISCOUNT_V1: DiscountPolicy = {
  kind: "discount",
  id: "discount.v1",
  version: 1,
  status: "sandbox_default",
  effectiveFrom: "2026-09-15",
  source: "Founder brief §5, 'Discount ownership' — sandbox default pending approval",
  note: "Platform-funded campaigns stay disabled until the founder approves who funds them and how the subsidy is recorded.",
  coachFundedReducesBothShares: true,
  platformFundedProtectsCoachShare: true,
  platformFundedCampaignsEnabled: false,
  coachFundedRequiresCoachAcceptance: true,
};

const BILLING_TERMS_V1: BillingTermsPolicy = {
  kind: "billing_terms",
  id: "billing_terms.v1",
  version: 1,
  status: "sandbox_default",
  effectiveFrom: "2026-09-15",
  source: "Founder brief §5, 'Billing terms'; docs/aafnai/DECISION_REGISTER.md AAF-TERM-05 (OPEN, blocking)",
  note: "Prepaid terms are modelled and tested but disabled: their cancellation and refund rules are undecided, and selling one first means improvising a refund policy in front of a customer.",
  monthlyRecurringEnabled: true,
  monthlyUnderCommitmentEnabled: true,
  prepaidTermEnabled: false,
  autoRenewRequiresExplicitConsent: true,
  earlyTerminationChargeEnabled: false,
};

const PRICE_CHANGE_V1: PriceChangePolicy = {
  kind: "price_change",
  id: "price_change.v1",
  version: 1,
  status: "confirmed",
  effectiveFrom: "2026-09-15",
  source: "Founder brief §5, 'Price changes'; docs/HANDOVER.md §6.4 'price locked at signup'",
  newVersionAppliesToNewPurchasesOnly: true,
  existingSubscribersKeepContractedPrice: true,
  migrationOfExistingSubscribersEnabled: false,
};

const CANCELLATION_V1: CancellationPolicy = {
  kind: "cancellation",
  id: "cancellation.v1",
  version: 1,
  status: "sandbox_default",
  effectiveFrom: "2026-09-15",
  source: "Founder brief §5, 'Cancellation' — sandbox default pending approval",
  note: "Cancel at period end, keep access already paid for, keep permitted read-only history. Refund adjudication stays a reviewed admin action; no no-refunds policy has been invented here.",
  recurringCancelsAtPeriodEnd: true,
  retainsAccessUntilPaidThrough: true,
  retainsReadOnlyHistoryAfterEnd: true,
  cancellationImpliesRefund: false,
  refundRequiresAdminAdjudication: true,
};

const PAYMENT_FAILURE_V1: PaymentFailurePolicy = {
  kind: "payment_failure",
  id: "payment_failure.v1",
  version: 1,
  status: "sandbox_default",
  effectiveFrom: "2026-09-15",
  source: "Founder brief §5, 'Payment failure' — sandbox default pending approval",
  note: "No grace period by default: a new service period is not granted on unpaid billing, because the alternative is giving away a coach's time on a promise.",
  graceDays: 0,
  failedRenewalErasesHistory: false,
  distinguishesPaidThroughFromNewService: true,
};

const RECOGNITION_V1: RecognitionPolicy = {
  kind: "recognition",
  id: "recognition.v1",
  version: 1,
  status: "sandbox_default",
  effectiveFrom: "2026-09-15",
  source: "Founder brief §5 and §10.2 — sandbox default pending approval",
  note: "Earnings are recognised as service is delivered. One-off earnings need an approved completion event from the appointment lifecycle, which does not exist yet, so they can only sit pending in this release.",
  recurringRecognisedOverServicePeriod: true,
  prepaidAllocatedAcrossServicePeriods: true,
  oneOffRequiresCompletionEvent: true,
  holdDaysAfterServicePeriod: 0,
};

const PAYOUT_V1: PayoutPolicy = {
  kind: "payout",
  id: "payout.v1",
  version: 1,
  status: "sandbox_default",
  effectiveFrom: "2026-09-15",
  source: "Founder brief §5 'Payout timing' and §10.4 — sandbox default pending approval",
  note: "Monthly batching of eligible earned balances. No corridor for paying Nepal coaches has been verified, so automated transfers are disabled and every settlement is recorded as manual with evidence.",
  schedule: "monthly_in_arrears",
  batchPreparedByDayOfMonth: 7,
  minimumPayoutMinorUnits: 0,
  settlementCurrency: "USD",
  negativeBalanceTreatment: "carry_forward_against_future_earnings",
  automatedTransfersEnabled: false,
  settlementEvidenceRequired: true,
};

const ELIGIBILITY_V1: EligibilityPolicy = {
  kind: "eligibility",
  id: "eligibility.v1",
  version: 1,
  status: "sandbox_default",
  effectiveFrom: "2026-09-15",
  source: "Founder brief §5, 'Geography' and 'Adult-only onboarding' — sandbox defaults pending approval",
  note: "A US Stripe business account does not by itself activate any market. Both lists are empty until the founder names the countries we may sell in and the approved route for paying coaches in Nepal.",
  minimumCustomerAge: 18,
  enabledCustomerCountries: [],
  approvedPayoutCorridors: [],
};

const MESSAGING_V1: MessagingPolicy = {
  kind: "messaging",
  id: "messaging.v1",
  version: 1,
  status: "sandbox_default",
  effectiveFrom: "2026-09-21",
  source: "M14 founder prompt, 21 September 2026 — proposed default, explicitly not yet approved",
  note: "Clients keep reading their own history after coaching ends or the coach changes; no new messages once paid time has run out; support stays reachable. Pre-purchase messaging is off.",
  sendWhilePaused: false,
  clientReadsAfterEnd: true,
  prePurchaseInquiries: false,
  maxBodyChars: 4000,
  sendsPerMinute: 20,
  sendsPerDay: 500,
  unreadEmailDelayMinutes: 15,
  supportAccessHours: 72,
  supportCasesPerDay: 5,
};

// --- Register -----------------------------------------------------------------

const ALL_POLICIES: readonly Policy[] = [
  COMMISSION_FITNESS_V1,
  COMMISSION_COACHING_V2,
  COMMISSION_COACHING_V3,
  COMMISSION_PANDIT_V1,
  DISCOUNT_V1,
  BILLING_TERMS_V1,
  PRICE_CHANGE_V1,
  CANCELLATION_V1,
  PAYMENT_FAILURE_V1,
  RECOGNITION_V1,
  PAYOUT_V1,
  ELIGIBILITY_V1,
  MESSAGING_V1,
];

const BY_ID = new Map(ALL_POLICIES.map((policy) => [policy.id, policy]));

export class UnknownPolicyError extends Error {
  constructor(id: string) {
    super(
      `No policy registered with id ${JSON.stringify(id)}. A snapshotted policy id must always resolve — a missing one means a version was deleted or renamed, which is never allowed.`,
    );
    this.name = "UnknownPolicyError";
  }
}

/** Resolves a snapshotted policy id. Throws rather than returning undefined. */
export function getPolicy(id: string): Policy {
  const policy = BY_ID.get(id);
  if (!policy) throw new UnknownPolicyError(id);
  return policy;
}

export function listPolicies(): readonly Policy[] {
  return ALL_POLICIES;
}

export function getCommissionPolicy(id: string): CommissionPolicy {
  const policy = getPolicy(id);
  if (policy.kind !== "commission") {
    throw new UnknownPolicyError(
      `${id} (resolved to a ${policy.kind} policy, not a commission policy)`,
    );
  }
  return policy;
}

export const CURRENT_MESSAGING_POLICY_ID = MESSAGING_V1.id;

export function currentMessagingPolicy(): MessagingPolicy {
  const policy = getPolicy(CURRENT_MESSAGING_POLICY_ID);
  if (policy.kind !== "messaging") throw new UnknownPolicyError(CURRENT_MESSAGING_POLICY_ID);
  return policy;
}

/** The commission policy new purchases are written under. */
export function currentCommissionPolicy(): CommissionPolicy {
  return getCommissionPolicy(CURRENT_COMMISSION_POLICY_ID);
}

/** The rate a given service type attracts under a given policy version. */
export function commissionBasisPointsFor(
  policy: CommissionPolicy,
  serviceType: ServiceType,
): number {
  return serviceType === "recurring_coaching"
    ? policy.recurringBasisPoints
    : policy.oneOffBasisPoints;
}

/** The full set of policies a new purchase is written under. */
export interface PolicySnapshot {
  readonly commissionPolicyId: string;
  readonly discountPolicyId: string;
  readonly billingTermsPolicyId: string;
  readonly priceChangePolicyId: string;
  readonly cancellationPolicyId: string;
  readonly paymentFailurePolicyId: string;
  readonly recognitionPolicyId: string;
  readonly payoutPolicyId: string;
  readonly eligibilityPolicyId: string;
}

export function currentPolicySnapshot(): PolicySnapshot {
  return {
    commissionPolicyId: COMMISSION_COACHING_V3.id,
    discountPolicyId: DISCOUNT_V1.id,
    billingTermsPolicyId: BILLING_TERMS_V1.id,
    priceChangePolicyId: PRICE_CHANGE_V1.id,
    cancellationPolicyId: CANCELLATION_V1.id,
    paymentFailurePolicyId: PAYMENT_FAILURE_V1.id,
    recognitionPolicyId: RECOGNITION_V1.id,
    payoutPolicyId: PAYOUT_V1.id,
    eligibilityPolicyId: ELIGIBILITY_V1.id,
  };
}

export {
  COMMISSION_FITNESS_V1,
  COMMISSION_COACHING_V2,
  COMMISSION_COACHING_V3,
  COMMISSION_PANDIT_V1,
  BILLING_TERMS_V1,
  CANCELLATION_V1,
  DISCOUNT_V1,
  ELIGIBILITY_V1,
  PAYMENT_FAILURE_V1,
  PAYOUT_V1,
  PRICE_CHANGE_V1,
  RECOGNITION_V1,
};
