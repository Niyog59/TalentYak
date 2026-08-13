import type { PayoutRule, PayoutSplit } from "@/lib/payouts/types";

/**
 * Fitness payout model (handover §6.3): 60% coach / 40% platform on
 * all tiers; founding coaches get 65% (invisible to customers).
 */
export const fitnessPayoutRule: PayoutRule = ({
  grossCents,
  providerFounding,
}): PayoutSplit => {
  const coachRate = providerFounding ? 0.65 : 0.6;
  const providerShareCents = Math.round(grossCents * coachRate);
  return {
    grossCents,
    directCostsCents: 0,
    providerShareCents,
    platformShareCents: grossCents - providerShareCents,
    rule: providerFounding ? "fitness_65_35_founding" : "fitness_60_40",
  };
};
