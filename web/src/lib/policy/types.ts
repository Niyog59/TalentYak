/**
 * Business policy types.
 *
 * Every commercial rule in the product — commission, what commission is charged
 * on, who pays processing costs, who funds a discount, what cancellation does,
 * what happens when a renewal fails, when a coach's earnings become payable —
 * lives here as a typed, versioned record. Nothing is a literal in a component,
 * a migration, or a Stripe call.
 *
 * Two things make this more than a constants file.
 *
 * **Versioning.** A purchase snapshots the identifier of the exact policy
 * version it was made under. Publishing a new version never reaches backwards:
 * an existing subscriber keeps the terms they bought, and an old ledger row
 * stays interpretable years later because the policy that produced it is still
 * here, marked superseded rather than deleted.
 *
 * **Status.** A rule the founder has decided and a rule this codebase invented
 * as a working default are not the same claim, and collapsing them is how a
 * guess becomes a promise to a customer. `confirmed` rules may run live;
 * `sandbox_default` rules are implemented and tested but refuse to operate
 * against live billing until they are approved.
 */

export type PolicyStatus =
  /** The founder decided this. It may run live. */
  | "confirmed"
  /** A working default with a stated trade-off. Implemented, tested, and blocked from live use. */
  | "sandbox_default";

export interface PolicyMeta {
  /** Stable identifier snapshotted onto purchases and ledger entries. Never reused. */
  readonly id: string;
  readonly version: number;
  readonly status: PolicyStatus;
  /** ISO date this version began applying to new purchases. */
  readonly effectiveFrom: string;
  /** Set when a later version replaced this one. The record itself is never removed. */
  readonly supersededBy?: string;
  /** Where the rule came from, so a future reader can check it rather than trust it. */
  readonly source: string;
  readonly note?: string;
}

// --- Commission ---------------------------------------------------------------

export interface CommissionPolicy extends PolicyMeta {
  readonly kind: "commission";
  /** Ongoing coaching, whether billed monthly or prepaid as a term. */
  readonly recurringBasisPoints: number;
  /** One-off consultations. */
  readonly oneOffBasisPoints: number;
  /**
   * What the rate is applied to. Tax is never included, and a display-only
   * converted estimate is never included.
   */
  readonly baseRule: "service_amount_excluding_tax_after_coach_funded_discount";
  /** Who bears ordinary payment-processing and payout costs. */
  readonly processingCostsBorneBy: "platform";
  /** Commission is rounded first; the coach takes the exact remainder. */
  readonly rounding: "commission_first_half_away_from_zero";
  /** True when the split has service-specific direct costs deducted before it. */
  readonly deductsDirectCostsFirst: boolean;
}

/**
 * How a service is classified for commission. This is a property of the
 * SERVICE, not of how many times it is billed: a six-month coaching package
 * paid in one payment is ongoing coaching, not a consultation.
 */
export type ServiceType = "recurring_coaching" | "one_off_consultation";

// --- Discount funding ---------------------------------------------------------

export interface DiscountPolicy extends PolicyMeta {
  readonly kind: "discount";
  /**
   * A coach-funded discount lowers the service amount, so both parties' amounts
   * move together at the same split.
   */
  readonly coachFundedReducesBothShares: true;
  /**
   * A platform-funded promotion must reduce platform economics only. It never
   * silently reduces what the coach is owed.
   */
  readonly platformFundedProtectsCoachShare: true;
  /** Platform-funded campaigns stay switched off until approved. */
  readonly platformFundedCampaignsEnabled: boolean;
  /** A coach-funded discount requires the coach's recorded acceptance. */
  readonly coachFundedRequiresCoachAcceptance: true;
}

// --- Billing terms ------------------------------------------------------------

export interface BillingTermsPolicy extends PolicyMeta {
  readonly kind: "billing_terms";
  /** Monthly recurring offers. */
  readonly monthlyRecurringEnabled: boolean;
  /**
   * A term billed monthly under a stated commitment. Distinct from prepayment:
   * the customer pays each month and the exposure is one month at a time.
   */
  readonly monthlyUnderCommitmentEnabled: boolean;
  /**
   * A term paid in full upfront. Modelled and tested, but gated: cancellation
   * and refund rules for prepaid terms are undecided, and selling one before
   * they exist means improvising a refund policy in front of a customer.
   */
  readonly prepaidTermEnabled: boolean;
  /** A term never renews itself unless its renewal terms were shown and accepted. */
  readonly autoRenewRequiresExplicitConsent: true;
  /** No early-termination charge exists until an approved policy defines one. */
  readonly earlyTerminationChargeEnabled: boolean;
}

// --- Price changes ------------------------------------------------------------

export interface PriceChangePolicy extends PolicyMeta {
  readonly kind: "price_change";
  /** A new price version applies to new purchases only. */
  readonly newVersionAppliesToNewPurchasesOnly: true;
  /** Existing subscribers keep their contracted price. */
  readonly existingSubscribersKeepContractedPrice: true;
  /** No migration of an existing subscriber without an approved, disclosed policy. */
  readonly migrationOfExistingSubscribersEnabled: boolean;
}

// --- Cancellation -------------------------------------------------------------

export interface CancellationPolicy extends PolicyMeta {
  readonly kind: "cancellation";
  /** Cancelling stops future billing; it does not end the period already paid for. */
  readonly recurringCancelsAtPeriodEnd: true;
  /** Access already paid for runs to its paid-through date. */
  readonly retainsAccessUntilPaidThrough: true;
  /** Permitted history stays readable after the relationship ends. */
  readonly retainsReadOnlyHistoryAfterEnd: true;
  /** Cancelling is not a refund and not an account deletion. */
  readonly cancellationImpliesRefund: false;
  /** Refunds are adjudicated by a reviewed admin action, never granted automatically. */
  readonly refundRequiresAdminAdjudication: true;
}

// --- Payment failure ----------------------------------------------------------

export interface PaymentFailurePolicy extends PolicyMeta {
  readonly kind: "payment_failure";
  /**
   * Days of access granted beyond the paid-through date while a renewal is
   * being retried. Zero means no new service period is granted on unpaid
   * billing — the default, because the alternative is giving away a coach's
   * time on a promise.
   */
  readonly graceDays: number;
  /** A failed renewal never erases historical records. */
  readonly failedRenewalErasesHistory: false;
  /** Paid-through access and new unpaid service are tracked as different things. */
  readonly distinguishesPaidThroughFromNewService: true;
}

// --- Earnings recognition -----------------------------------------------------

export interface RecognitionPolicy extends PolicyMeta {
  readonly kind: "recognition";
  /** Recurring service is recognised across the period it covers, not on payment. */
  readonly recurringRecognisedOverServicePeriod: true;
  /** A prepaid term is allocated across its service periods. */
  readonly prepaidAllocatedAcrossServicePeriods: true;
  /**
   * A one-off consultation is not earned by a successful checkout. It becomes
   * eligible on an approved completion event from the appointment lifecycle,
   * which does not exist yet — so in this release one-off earnings can only sit
   * pending, and no code may fabricate a completion.
   */
  readonly oneOffRequiresCompletionEvent: true;
  /** Days an earned balance is held before becoming eligible for payout. */
  readonly holdDaysAfterServicePeriod: number;
}

// --- Payout timing ------------------------------------------------------------

export interface PayoutPolicy extends PolicyMeta {
  readonly kind: "payout";
  /** Monthly batching of eligible earned balances, not a transfer per customer payment. */
  readonly schedule: "monthly_in_arrears";
  /** Day of the following month by which a batch is prepared. */
  readonly batchPreparedByDayOfMonth: number;
  /** Minimum eligible balance before a coach is included in a batch, in minor units. */
  readonly minimumPayoutMinorUnits: number;
  /** Settlement currency for coach payouts, when a corridor is approved. */
  readonly settlementCurrency: string;
  /** How a negative balance is handled. */
  readonly negativeBalanceTreatment: "carry_forward_against_future_earnings";
  /** No verified corridor exists, so no automated transfer may be attempted. */
  readonly automatedTransfersEnabled: boolean;
  /** A recorded transfer is labelled manual and never described as provider-verified. */
  readonly settlementEvidenceRequired: true;
}

// --- Eligibility --------------------------------------------------------------

export interface EligibilityPolicy extends PolicyMeta {
  readonly kind: "eligibility";
  /** Minimum customer age at signup. */
  readonly minimumCustomerAge: number;
  /** Countries customers may purchase from. Empty means none are activated. */
  readonly enabledCustomerCountries: readonly string[];
  /** Countries coaches may be paid into. Empty means no corridor is approved. */
  readonly approvedPayoutCorridors: readonly string[];
}

// --- Messaging ----------------------------------------------------------------

/**
 * How the relationship lifecycle affects private messaging. Mirrored into the
 * `messaging_settings` table (0037), which is what the database enforces; a
 * database test asserts the two agree. Operational, not commercial: it is not
 * part of the purchase snapshot.
 */
export interface MessagingPolicy extends PolicyMeta {
  readonly kind: "messaging";
  /** Paid time has run out after a failed renewal (enrollment paused). */
  readonly sendWhilePaused: boolean;
  /** After the relationship ends or the coach changes, the client may read their history. */
  readonly clientReadsAfterEnd: boolean;
  /** Messaging a coach before buying. */
  readonly prePurchaseInquiries: boolean;
  readonly maxBodyChars: number;
  readonly sendsPerMinute: number;
  readonly sendsPerDay: number;
  /** How long after an unread message the grouped email is sent. */
  readonly unreadEmailDelayMinutes: number;
  /** How long a case-scoped support grant to read a conversation lasts. */
  readonly supportAccessHours: number;
  readonly supportCasesPerDay: number;
}

export type Policy =
  | MessagingPolicy
  | CommissionPolicy
  | DiscountPolicy
  | BillingTermsPolicy
  | PriceChangePolicy
  | CancellationPolicy
  | PaymentFailurePolicy
  | RecognitionPolicy
  | PayoutPolicy
  | EligibilityPolicy;
