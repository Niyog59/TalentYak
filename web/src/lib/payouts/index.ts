import "server-only";
import type { PayoutSplit } from "@/lib/payouts/types";
import { getModule } from "@/verticals/registry";

/**
 * Computes the payout split for a payment using the vertical's
 * registered rule. Falls back to 60/40 if a vertical hasn't
 * defined one — conservative and visible in the ledger rule name.
 */
export function computePayout(args: {
  verticalSlug: string;
  serviceId: string;
  grossCents: number;
  providerFounding?: boolean;
}): PayoutSplit {
  const rule = getModule(args.verticalSlug)?.payoutRule;
  if (rule) {
    return rule({
      serviceId: args.serviceId,
      grossCents: args.grossCents,
      providerFounding: args.providerFounding,
    });
  }
  const providerShareCents = Math.round(args.grossCents * 0.6);
  return {
    grossCents: args.grossCents,
    directCostsCents: 0,
    providerShareCents,
    platformShareCents: args.grossCents - providerShareCents,
    rule: "default_60_40",
  };
}

/** Payoneer CSV: one row per provider with pending earnings. */
export function payoutsToCsv(
  rows: {
    provider_name: string;
    payout_reference: string | null;
    total_cents: number;
    entry_count: number;
  }[],
): string {
  const header = "provider,payoneer_reference,amount_usd,entries";
  const lines = rows.map(
    (r) =>
      `"${r.provider_name.replaceAll('"', '""')}",` +
      `"${(r.payout_reference ?? "").replaceAll('"', '""')}",` +
      `${(r.total_cents / 100).toFixed(2)},${r.entry_count}`,
  );
  return [header, ...lines].join("\n");
}
