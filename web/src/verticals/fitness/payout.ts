import type { PayoutRule, PayoutSplit } from "@/lib/payouts/types";
import { applyBasisPoints } from "@/lib/money/money";
import { commissionBasisPointsFor, currentCommissionPolicy } from "@/lib/policy";

/**
 * Coaching payout: the rate comes from the policy register, never from a number
 * written here.
 *
 * The previous 60/40 split and the 65% founding-coach override are gone from
 * this code path, but they are not gone from the system — they are preserved as
 * `commission.coaching.v1` in the register so any ledger row written under them
 * can still be explained. `providers.founding` is likewise retained as
 * historical data and no longer changes anyone's rate.
 *
 * The `rule` string recorded on each ledger row is now the policy id, so a row
 * points at the exact version that produced it rather than at a rate baked into
 * a string.
 */
export const fitnessPayoutRule: PayoutRule = ({ grossCents }): PayoutSplit => {
  const policy = currentCommissionPolicy();
  const basisPoints = commissionBasisPointsFor(policy, "recurring_coaching");

  // Commission first, coach takes the exact remainder.
  const platformShareCents = applyBasisPoints(grossCents, basisPoints);

  return {
    grossCents,
    directCostsCents: 0,
    providerShareCents: grossCents - platformShareCents,
    platformShareCents,
    rule: policy.id,
  };
};
