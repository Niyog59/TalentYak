import "server-only";
import type { PayoutSplit } from "@/lib/payouts/types";
import { getModule } from "@/verticals/registry";

/**
 * Computes the payout split for a payment using the vertical's registered rule.
 *
 * A vertical with no registered rule is a programming error, not a case to
 * guess at. The previous fallback silently applied a 60/40 split to any
 * unrecognised vertical, which would have written a wrong, plausible-looking
 * number into an immutable ledger — the worst failure mode available here.
 * Refusing is recoverable; a quietly wrong ledger row is not.
 */
export function computePayout(args: {
  verticalSlug: string;
  serviceId: string;
  grossCents: number;
  providerFounding?: boolean;
}): PayoutSplit {
  const rule = getModule(args.verticalSlug)?.payoutRule;
  if (!rule) {
    throw new Error(
      `No payout rule is registered for vertical ${JSON.stringify(args.verticalSlug)}. Refusing to guess a split: this value is written to an immutable ledger.`,
    );
  }
  return rule({
    serviceId: args.serviceId,
    grossCents: args.grossCents,
    providerFounding: args.providerFounding,
  });
}

/**
 * Escapes one CSV field.
 *
 * Two separate problems, both handled here.
 *
 * **Quoting** — a field containing a comma, a quote, or a newline has to be
 * wrapped and its quotes doubled, or the row silently splits into the wrong
 * columns.
 *
 * **Formula injection** — a spreadsheet treats a field starting with `=`, `+`,
 * `-`, `@`, or a control character as a formula and will offer to execute it.
 * A coach whose display name begins with `=` is enough to turn a payout
 * statement into something that runs on the opener's machine. Prefixing with a
 * single quote makes the spreadsheet treat it as text, and the visible value is
 * unchanged.
 */
export function csvField(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  const neutralised = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${neutralised.replaceAll('"', '""')}"`;
}

/**
 * Payout statement rows, one per provider with a pending balance.
 *
 * The reference column is named for the concept, not a vendor: no payout
 * corridor has been verified, and naming the column after a provider we have
 * not confirmed we can use would be a claim the system cannot support.
 */
export function payoutsToCsv(
  rows: {
    provider_name: string;
    payout_reference: string | null;
    total_cents: number;
    entry_count: number;
    currency?: string;
  }[],
): string {
  const header = ["provider", "payout_reference", "amount", "currency", "entries"]
    .map(csvField)
    .join(",");

  const lines = rows.map((row) =>
    [
      csvField(row.provider_name),
      csvField(row.payout_reference),
      csvField((row.total_cents / 100).toFixed(2)),
      csvField((row.currency ?? "USD").toUpperCase()),
      csvField(row.entry_count),
    ].join(","),
  );

  return [header, ...lines].join("\r\n");
}
