import type { PayoutRule, PayoutSplit } from "@/lib/payouts/types";

/**
 * Pandit payout model (handover §5.2): direct ritual costs come out
 * first — samagri, temple fees, assistant, Stripe, fixer — then the
 * remaining pool splits 50/50 between pandit and platform.
 *
 * Direct-cost estimates per SKU, in cents. Adjustable as real costs
 * come in from the pilot; the ledger stores what was actually used.
 */
const directCostEstimates: Record<string, number> = {
  "shraddha-basic": 2600, // samagri + Stripe + fixer (NPR 1,500)
  "gokarna-shraddha-full": 4700, // + assistant NPR 2,500
  "gokarna-shraddha-complete": 17500, // + sida daan, brahmin bhojan
  "sohra-shraddha-bundle": 10000, // 16 days of samagri + fixer
  "tripindi-pitru-dosh": 8000, // two pandits' materials
  "rudrabhishek-pashupatinath": 5500, // temple fee NPR 7,500 dominates
  "kundali-pdf": 1200, // jyotish materials + Stripe
  "muhurat-selection": 500, // Stripe only
};

export const panditPayoutRule: PayoutRule = ({
  serviceId,
  grossCents,
}): PayoutSplit => {
  const directCostsCents = directCostEstimates[serviceId] ?? 0;
  const pool = Math.max(grossCents - directCostsCents, 0);
  const providerShareCents = Math.round(pool / 2);
  return {
    grossCents,
    directCostsCents,
    providerShareCents,
    platformShareCents: pool - providerShareCents,
    rule: "pandit_post_cost_50_50",
  };
};
