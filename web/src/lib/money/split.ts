/**
 * Commission arithmetic.
 *
 * One rule, stated once: **commission is computed first, and the coach takes
 * the remainder.**
 *
 *     commission = round(base × rate)     half away from zero
 *     coach      = base − commission
 *
 * Computing the coach's share first and leaving the platform the remainder
 * gives a different answer on odd amounts, so the order is part of the
 * specification, not an implementation detail. On a USD 10.01 service at 20%
 * the commission is 2.00 and the coach receives 8.01.
 *
 * What goes into `base` is a policy question answered in `@/lib/policy`:
 * the service amount, excluding separately identified tax, after any
 * coach-funded discount. Tax is never commissioned, and a display-only
 * converted estimate is never commissioned.
 */

import {
  type Money,
  MoneyError,
  addMoney,
  allocate,
  applyBasisPoints,
  compareMoney,
  money,
  subtractMoney,
  zero,
} from "@/lib/money/money";

export interface CommissionSplit {
  /** The commission base: service amount excluding tax, after coach-funded discounts. */
  readonly serviceAmount: Money;
  /** What the platform takes from the service amount. */
  readonly platformCommission: Money;
  /** What the coach is entitled to. Never reduced by a platform-funded promotion. */
  readonly coachEntitlement: Money;
  /** A promotion the platform paid for. Reduces the customer's payment and the platform's net. */
  readonly platformFundedDiscount: Money;
  /** What the customer pays for the service, before separately identified tax. */
  readonly customerPays: Money;
  /** Platform economics before processing costs, which the platform also bears. */
  readonly platformNetBeforeProcessing: Money;
}

/**
 * Splits a service amount between coach and platform.
 *
 * A platform-funded discount is modelled explicitly rather than appearing as an
 * unexplained imbalance: it lowers what the customer pays and what the platform
 * nets, and leaves the coach's entitlement untouched. A coach-funded discount
 * is not represented here at all — it has already reduced `serviceAmount`,
 * which is what both parties agreed the service now costs.
 */
export function splitCommission(args: {
  serviceAmount: Money;
  commissionBasisPoints: number;
  platformFundedDiscount?: Money;
}): CommissionSplit {
  const { serviceAmount, commissionBasisPoints } = args;

  if (serviceAmount.minor < 0) {
    throw new MoneyError(
      "Service amount cannot be negative. Reversals are produced by refundReversal, not by a negative split.",
    );
  }

  const subsidy = args.platformFundedDiscount ?? zero(serviceAmount.currency);
  if (subsidy.minor < 0) {
    throw new MoneyError("A platform-funded discount cannot be negative.");
  }
  if (compareMoney(subsidy, serviceAmount) > 0) {
    throw new MoneyError(
      "A platform-funded discount cannot exceed the service amount. A free service is a zero-amount purchase, not a negative one.",
    );
  }

  const platformCommission = money(
    applyBasisPoints(serviceAmount.minor, commissionBasisPoints),
    serviceAmount.currency,
  );
  const coachEntitlement = subtractMoney(serviceAmount, platformCommission);

  return {
    serviceAmount,
    platformCommission,
    coachEntitlement,
    platformFundedDiscount: subsidy,
    customerPays: subtractMoney(serviceAmount, subsidy),
    platformNetBeforeProcessing: subtractMoney(platformCommission, subsidy),
  };
}

export interface RefundReversal {
  /** Commission reversed by THIS refund. */
  readonly platformCommissionReversal: Money;
  /** Coach entitlement reversed by THIS refund. */
  readonly coachEntitlementReversal: Money;
  /** Total refunded against this service after this refund. */
  readonly cumulativeRefunded: Money;
  /** Total commission reversed after this refund. */
  readonly cumulativeCommissionReversed: Money;
  /** Total coach entitlement reversed after this refund. */
  readonly cumulativeCoachReversed: Money;
}

/**
 * Computes the reversal for one refund against a service amount.
 *
 * The reversal is derived from the CUMULATIVE refunded total rather than from
 * this refund alone. Rounding each partial refund independently lets the
 * reversals drift away from the original allocation — refund a 10.01 service in
 * three pieces and the pieces stop adding up to 2.00 and 8.01. Computing the
 * cumulative position and subtracting what has already been reversed makes a
 * full refund in any number of steps reconcile exactly to the original split.
 *
 * This function is pure arithmetic and has no memory. Protection against a
 * replayed refund event is the ledger's job, through its unique effect key —
 * calling this twice with the same `previouslyRefunded` deliberately returns
 * the same answer twice.
 */
export function refundReversal(args: {
  serviceAmount: Money;
  commissionBasisPoints: number;
  /** Cumulative amount already refunded against this service, before this refund. */
  previouslyRefunded: Money;
  /** The amount being refunded now. */
  refundAmount: Money;
}): RefundReversal {
  const { serviceAmount, commissionBasisPoints, previouslyRefunded, refundAmount } =
    args;

  if (refundAmount.minor < 0) {
    throw new MoneyError("A refund amount cannot be negative.");
  }
  if (previouslyRefunded.minor < 0) {
    throw new MoneyError("Cumulative refunds cannot be negative.");
  }

  const cumulativeRefunded = addMoney(previouslyRefunded, refundAmount);
  if (compareMoney(cumulativeRefunded, serviceAmount) > 0) {
    throw new MoneyError(
      "Cumulative refunds would exceed the original service amount. Refunding more than was charged is a data error, not an adjustment.",
    );
  }

  const cumulativeCommissionReversed = money(
    applyBasisPoints(cumulativeRefunded.minor, commissionBasisPoints),
    serviceAmount.currency,
  );
  const previousCommissionReversed = money(
    applyBasisPoints(previouslyRefunded.minor, commissionBasisPoints),
    serviceAmount.currency,
  );

  const cumulativeCoachReversed = subtractMoney(
    cumulativeRefunded,
    cumulativeCommissionReversed,
  );
  const previousCoachReversed = subtractMoney(
    previouslyRefunded,
    previousCommissionReversed,
  );

  return {
    platformCommissionReversal: subtractMoney(
      cumulativeCommissionReversed,
      previousCommissionReversed,
    ),
    coachEntitlementReversal: subtractMoney(
      cumulativeCoachReversed,
      previousCoachReversed,
    ),
    cumulativeRefunded,
    cumulativeCommissionReversed,
    cumulativeCoachReversed,
  };
}

export interface ServicePeriodAllocation {
  readonly periodIndex: number;
  readonly serviceAmount: Money;
  readonly platformCommission: Money;
  readonly coachEntitlement: Money;
}

/**
 * Allocates a prepaid term across its service periods.
 *
 * A six-month package paid once is not six monthly charges, and it is not
 * earned on the day it is paid. The payment is allocated across the periods it
 * buys; each period's earnings become the coach's only when that period has
 * actually been delivered. The undelivered remainder is a liability, tracked
 * separately — never presented to a coach as money they have earned.
 *
 * The per-period amounts sum exactly to the total. Where the total does not
 * divide evenly, the extra minor units land on the earliest periods, which is
 * deterministic and reproducible during reconciliation.
 */
export function allocateAcrossServicePeriods(args: {
  total: Money;
  periods: number;
  commissionBasisPoints: number;
}): ServicePeriodAllocation[] {
  const { total, periods, commissionBasisPoints } = args;

  if (!Number.isInteger(periods) || periods <= 0) {
    throw new MoneyError(
      `A term must cover a positive whole number of service periods, received ${periods}.`,
    );
  }
  if (total.minor < 0) {
    throw new MoneyError("A prepaid term total cannot be negative.");
  }

  return allocate(total.minor, new Array<number>(periods).fill(1)).map(
    (periodMinor, periodIndex) => {
      const serviceAmount = money(periodMinor, total.currency);
      const platformCommission = money(
        applyBasisPoints(periodMinor, commissionBasisPoints),
        total.currency,
      );
      return {
        periodIndex,
        serviceAmount,
        platformCommission,
        coachEntitlement: subtractMoney(serviceAmount, platformCommission),
      };
    },
  );
}
