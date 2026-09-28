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
  SchedulingPolicy,
  CallsPolicy,
  CheckinAccessPolicy,
  CheckinRemindersPolicy,
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
  supersededBy: "cancellation.v2",
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
  supersededBy: "payment_failure.v2",
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
  supersededBy: "messaging.v2",
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

/**
 * The customer-facing words for a coaching relationship paused by a failed
 * renewal. Founder-approved wording: it is shown, not paraphrased, wherever a
 * customer meets the pause.
 */
export const PAUSED_FOR_PAYMENT_NOTICE = "Your payment didn’t go through. Renew to continue coaching. Your progress is saved.";

const CANCELLATION_V2: CancellationPolicy = {
  kind: "cancellation",
  id: "cancellation.v2",
  version: 2,
  status: "confirmed",
  effectiveFrom: "2026-09-22",
  source: "Founder instruction, 2026-09-22 — approved, replacing the sandbox defaults it conflicts with",
  note: "Cancelling a renewal keeps access active until the already-paid period ends. Unchanged in substance from cancellation.v1; this version is the approved one.",
  recurringCancelsAtPeriodEnd: true,
  retainsAccessUntilPaidThrough: true,
  retainsReadOnlyHistoryAfterEnd: true,
  cancellationImpliesRefund: false,
  refundRequiresAdminAdjudication: true,
};

const PAYMENT_FAILURE_V2: PaymentFailurePolicy = {
  kind: "payment_failure",
  id: "payment_failure.v2",
  version: 2,
  status: "confirmed",
  effectiveFrom: "2026-09-22",
  source: "Founder instruction, 2026-09-22 — approved, replacing the sandbox defaults it conflicts with",
  note: "No grace period beyond the time already paid for. When it runs out, new service pauses — new messages, new bookings, new coaching activity — and everything already recorded stays readable under the permissions that already apply. A failed payment never deletes anything. Paying restores exactly what was paused, and never lifts a suspension or undoes a coach change.",
  graceDays: 0,
  failedRenewalErasesHistory: false,
  distinguishesPaidThroughFromNewService: true,
  pausesNewServiceWhenUnpaid: true,
  retainsReadableRecords: true,
  paymentRestoresPausedAccess: true,
  customerNotice: PAUSED_FOR_PAYMENT_NOTICE,
};

const MESSAGING_V2: MessagingPolicy = {
  kind: "messaging",
  id: "messaging.v2",
  version: 2,
  status: "confirmed",
  effectiveFrom: "2026-09-22",
  source: "Founder instruction, 2026-09-22 — approved, replacing the sandbox defaults it conflicts with",
  note: "Approved: no new messages once the paid period has run out, the whole history stays readable, support stays reachable, and paying restores sending. Values are unchanged from messaging.v1 apart from the approved customer wording.",
  sendWhilePaused: false,
  clientReadsAfterEnd: true,
  prePurchaseInquiries: false,
  maxBodyChars: 4000,
  sendsPerMinute: 20,
  sendsPerDay: 500,
  unreadEmailDelayMinutes: 15,
  supportAccessHours: 72,
  supportCasesPerDay: 5,
  pausedNotice: PAUSED_FOR_PAYMENT_NOTICE,
};

const SCHEDULING_V1: SchedulingPolicy = {
  kind: "scheduling",
  id: "scheduling.v1",
  version: 1,
  status: "sandbox_default",
  effectiveFrom: "2026-09-27",
  source: "M09 founder prompt (Batch 4), 21 September 2026 — illustrative timings, explicitly not approved rules",
  note: "Proposals lapse after 48 hours and hold no time; reminders 24 hours and 1 hour before; 12 hours' notice, a 28-day horizon and 10-minute buffers are only the starting values each coach can change. Meetings after the paid period stay tentative until the renewal is paid (founder decision, 2026-09-27). No cancellation, lateness or no-show rule has any financial consequence.",
  proposalTtlHours: 48,
  reminderOffsetsMinutes: [1440, 60],
  defaultMinNoticeMinutes: 720,
  defaultHorizonDays: 28,
  defaultBufferMinutes: 10,
  slotHoldMinutes: 35,
  confirmBeyondPaidThrough: false,
  clientRequestsNeedCoachConfirmation: true,
  outcomesHaveConsequences: false,
};

const CALLS_V1: CallsPolicy = {
  kind: "calls",
  id: "calls.v1",
  version: 1,
  status: "sandbox_default",
  effectiveFrom: "2026-09-27",
  source: "M10 founder prompt (Batch 5), 21 September 2026 — configurable development defaults, explicitly not approved rules",
  note: "Each session's private room opens 10 minutes before and stays open 30 minutes past the booked end, with warnings at 10 and 2 minutes before it closes; then it is deleted. Join passes last 2 minutes. Joining, attendance and outcomes carry no financial consequence, and a dropped connection is never a no-show.",
  joinOpensMinutesBefore: 10,
  graceAfterEndMinutes: 30,
  closingWarningMinutes: [10, 2],
  joinPassSeconds: 120,
  joinRequestsPer10Minutes: 20,
  attendanceCheckDelayMinutes: 3,
  maxParticipants: 2,
  attendanceHasConsequences: false,
  automaticNoShow: false,
};

const CHECKIN_ACCESS_V1: CheckinAccessPolicy = {
  kind: "checkin_access",
  id: "checkin_access.v1",
  version: 1,
  status: "confirmed",
  effectiveFrom: "2026-09-27",
  source: "Founder M13 prompt, 2026-09-27 — approved policy and approved exception (DECISION_REGISTER §U)",
  note: "Applies the approved paid-access rules to check-ins: cancellation keeps them running through the paid period; after access ends, new check-ins pause and past submissions and feedback stay readable. Approved exception: the responsible coach may finish a review submitted during paid time after it runs out, and the client reads it and is told. The exception reopens nothing else and never overrides a suspension, a reassignment or a refund.",
  continuesThroughPaidPeriod: true,
  newCheckinsWhenAccessEnds: false,
  historyReadableAfterAccessEnds: true,
  reviewSubmittedInPaidTimeMayBeFinished: true,
  exceptionReopensOtherActivity: false,
  exceptionOverridesSuspensionOrReassignment: false,
  draftsKeptWhilePaused: true,
  paymentFailureDeletes: false,
  missedCheckinBlocksCoaching: false,
};

const CHECKIN_REMINDERS_V1: CheckinRemindersPolicy = {
  kind: "checkin_reminders",
  id: "checkin_reminders.v1",
  version: 1,
  status: "sandbox_default",
  effectiveFrom: "2026-09-27",
  source: "M13 engineering default — timings chosen by the codebase, not approved",
  note: "A due-soon notice 24 hours before the due time; one 'still open, late is fine' notice between 24 and 72 hours after it; a coach with no stated review time is nudged after 72 hours. Each notice once only, re-checked before it is sent, and switchable off in email settings.",
  dueSoonHours: 24,
  lateAfterHours: 24,
  lateWindowHours: 72,
  reviewWithoutStatedTimeHours: 72,
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
  CANCELLATION_V2,
  PAYMENT_FAILURE_V2,
  MESSAGING_V2,
  SCHEDULING_V1,
  CALLS_V1,
  CHECKIN_ACCESS_V1,
  CHECKIN_REMINDERS_V1,
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

export const CURRENT_MESSAGING_POLICY_ID = MESSAGING_V2.id;

export function currentMessagingPolicy(): MessagingPolicy {
  const policy = getPolicy(CURRENT_MESSAGING_POLICY_ID);
  if (policy.kind !== "messaging") throw new UnknownPolicyError(CURRENT_MESSAGING_POLICY_ID);
  return policy;
}

export const CURRENT_SCHEDULING_POLICY_ID = SCHEDULING_V1.id;

export function currentSchedulingPolicy(): SchedulingPolicy {
  const policy = getPolicy(CURRENT_SCHEDULING_POLICY_ID);
  if (policy.kind !== "scheduling") throw new UnknownPolicyError(CURRENT_SCHEDULING_POLICY_ID);
  return policy;
}

export const CURRENT_CALLS_POLICY_ID = CALLS_V1.id;

export function currentCallsPolicy(): CallsPolicy {
  const policy = getPolicy(CURRENT_CALLS_POLICY_ID);
  if (policy.kind !== "calls") throw new UnknownPolicyError(CURRENT_CALLS_POLICY_ID);
  return policy;
}

export const CURRENT_CHECKIN_ACCESS_POLICY_ID = CHECKIN_ACCESS_V1.id;

export function currentCheckinAccessPolicy(): CheckinAccessPolicy {
  const policy = getPolicy(CURRENT_CHECKIN_ACCESS_POLICY_ID);
  if (policy.kind !== "checkin_access") throw new UnknownPolicyError(CURRENT_CHECKIN_ACCESS_POLICY_ID);
  return policy;
}

export const CURRENT_CHECKIN_REMINDERS_POLICY_ID = CHECKIN_REMINDERS_V1.id;

export function currentCheckinReminderPolicy(): CheckinRemindersPolicy {
  const policy = getPolicy(CURRENT_CHECKIN_REMINDERS_POLICY_ID);
  if (policy.kind !== "checkin_reminders") throw new UnknownPolicyError(CURRENT_CHECKIN_REMINDERS_POLICY_ID);
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
    cancellationPolicyId: CANCELLATION_V2.id,
    paymentFailurePolicyId: PAYMENT_FAILURE_V2.id,
    recognitionPolicyId: RECOGNITION_V1.id,
    payoutPolicyId: PAYOUT_V1.id,
    eligibilityPolicyId: ELIGIBILITY_V1.id,
  };
}

export {
  CANCELLATION_V2,
  PAYMENT_FAILURE_V2,
  MESSAGING_V2,
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
