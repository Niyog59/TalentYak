/**
 * The one place commercial rules come from.
 *
 * Nothing outside this module may contain a commission rate, a payout
 * schedule, a grace period, a cancellation rule, or a price literal. Import
 * from here instead.
 */

export * from "@/lib/policy/types";
export * from "@/lib/policy/registry";
export * from "@/lib/policy/live-gate";

import type { ServiceType } from "@/lib/policy/types";
import {
  commissionBasisPointsFor,
  currentCommissionPolicy,
  getCommissionPolicy,
} from "@/lib/policy/registry";
import type { Money } from "@/lib/money/money";
import {
  type CommissionSplit,
  type RefundReversal,
  refundReversal,
  splitCommission,
} from "@/lib/money/split";

/**
 * Splits a service amount under a named policy version.
 *
 * `commissionPolicyId` is the version snapshotted on the purchase. Passing it
 * explicitly is what makes an old purchase keep its old economics: the split is
 * never recomputed at today's rate.
 */
export function splitUnderPolicy(args: {
  serviceAmount: Money;
  serviceType: ServiceType;
  commissionPolicyId: string;
  platformFundedDiscount?: Money;
}): CommissionSplit {
  const policy = getCommissionPolicy(args.commissionPolicyId);
  return splitCommission({
    serviceAmount: args.serviceAmount,
    commissionBasisPoints: commissionBasisPointsFor(policy, args.serviceType),
    platformFundedDiscount: args.platformFundedDiscount,
  });
}

/** Reverses part or all of a service amount under the policy it was sold under. */
export function reverseUnderPolicy(args: {
  serviceAmount: Money;
  serviceType: ServiceType;
  commissionPolicyId: string;
  previouslyRefunded: Money;
  refundAmount: Money;
}): RefundReversal {
  const policy = getCommissionPolicy(args.commissionPolicyId);
  return refundReversal({
    serviceAmount: args.serviceAmount,
    commissionBasisPoints: commissionBasisPointsFor(policy, args.serviceType),
    previouslyRefunded: args.previouslyRefunded,
    refundAmount: args.refundAmount,
  });
}

/**
 * The earnings preview shown to a coach in the offer builder.
 *
 * Deliberately says "before separately disclosed adjustments" rather than
 * naming a take-home figure: no corridor for paying coaches in Nepal has been
 * verified, so transfer and FX costs are genuinely unknown, and presenting an
 * unknown as a guarantee is how a coach ends up feeling lied to.
 */
export interface EarningsPreview {
  readonly customerPays: Money;
  readonly platformCommission: Money;
  readonly coachShare: Money;
  readonly commissionBasisPoints: number;
  readonly commissionPolicyId: string;
  /** True when transfer and FX costs cannot yet be stated. */
  readonly transferCostsUnknown: boolean;
}

export function previewEarnings(args: {
  price: Money;
  serviceType: ServiceType;
  commissionPolicyId?: string;
}): EarningsPreview {
  const policy = args.commissionPolicyId
    ? getCommissionPolicy(args.commissionPolicyId)
    : currentCommissionPolicy();
  const basisPoints = commissionBasisPointsFor(policy, args.serviceType);
  const split = splitCommission({
    serviceAmount: args.price,
    commissionBasisPoints: basisPoints,
  });

  return {
    customerPays: split.customerPays,
    platformCommission: split.platformCommission,
    coachShare: split.coachEntitlement,
    commissionBasisPoints: basisPoints,
    commissionPolicyId: policy.id,
    transferCostsUnknown: true,
  };
}
