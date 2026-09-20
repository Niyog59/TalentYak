/**
 * Preparing a monthly payout batch.
 *
 * Pure functions over plain data: given the eligible earnings, decide what goes
 * into a batch and what each coach is owed. No database, no network. The
 * persistence around this is thin on purpose, because the part that can quietly
 * pay someone the wrong amount is the arithmetic, and arithmetic is worth being
 * able to test exhaustively.
 *
 * Three rules this file exists to enforce:
 *
 * 1. **A coach paid in two currencies has two balances, never one.** There is
 *    no conversion here and no total across currencies. Adding USD to NPR would
 *    mean inventing an exchange rate.
 *
 * 2. **A negative balance is never paid.** A coach who was paid and then had a
 *    customer refunded can owe money back. That carries forward against future
 *    earnings; it does not become a transfer, and it certainly does not become
 *    a bank debit.
 *
 * 3. **Exported is not paid.** Nothing here marks anything paid. Producing a
 *    batch produces a list and a file; a human records the actual transfer
 *    afterwards, with evidence.
 */

import { type Money, addMoney, money, zero } from "@/lib/money/money";
import { csvField } from "@/lib/payouts/index";

/** One eligible earning, as it comes out of the ledger. */
export interface EligibleEntry {
  readonly ledgerEntryId: string;
  readonly providerId: string;
  readonly currency: string;
  /** Signed. Negative entries are reversals and must be netted, not skipped. */
  readonly amountMinor: number;
}

export interface ProviderInfo {
  readonly providerId: string;
  readonly displayName: string;
  /** Null when the coach has not supplied one, or it has not passed review. */
  readonly payoutDestinationId: string | null;
  readonly payoutDestinationApproved: boolean;
  readonly payoutReferenceMasked: string | null;
}

export interface BatchLine {
  readonly providerId: string;
  readonly displayName: string;
  readonly currency: string;
  readonly amount: Money;
  readonly entryCount: number;
  readonly ledgerEntryIds: readonly string[];
  readonly payoutDestinationId: string | null;
  readonly payoutReferenceMasked: string | null;
}

export interface HeldLine {
  readonly providerId: string;
  readonly displayName: string;
  readonly currency: string;
  readonly amount: Money;
  readonly entryCount: number;
  readonly reason: HoldReason;
}

export type HoldReason =
  | "negative_balance"
  | "below_minimum"
  | "no_payout_destination"
  | "destination_not_approved";

export interface PreparedBatch {
  /** Lines that would actually be transferred. */
  readonly lines: readonly BatchLine[];
  /** Lines deliberately excluded, each with a reason a human can act on. */
  readonly held: readonly HeldLine[];
  /** One total per currency. Never a single grand total. */
  readonly totalsByCurrency: ReadonlyMap<string, Money>;
}

export interface BatchPolicy {
  /** Below this, an eligible balance rolls into next month rather than being sent. */
  readonly minimumPayoutMinorUnits: number;
}

/**
 * Groups eligible entries into per-coach, per-currency lines.
 *
 * Every entry is netted, including negative ones. Filtering out reversals and
 * summing only the positives would pay a coach for a service that was refunded
 * — which is the exact bug the old ledger had, arriving by a different route.
 */
export function prepareBatch(
  entries: readonly EligibleEntry[],
  providers: readonly ProviderInfo[],
  policy: BatchPolicy,
): PreparedBatch {
  const providerById = new Map(providers.map((p) => [p.providerId, p]));

  // Key by provider AND currency. Two currencies for one coach are two lines.
  const grouped = new Map<
    string,
    { providerId: string; currency: string; minor: number; ids: string[] }
  >();

  for (const entry of entries) {
    const key = `${entry.providerId}::${entry.currency}`;
    const bucket = grouped.get(key) ?? {
      providerId: entry.providerId,
      currency: entry.currency,
      minor: 0,
      ids: [],
    };
    bucket.minor += entry.amountMinor;
    bucket.ids.push(entry.ledgerEntryId);
    grouped.set(key, bucket);
  }

  const lines: BatchLine[] = [];
  const held: HeldLine[] = [];
  const totals = new Map<string, Money>();

  // Sorted so the same input always produces the same batch, which matters when
  // two operators compare what they are about to send.
  const keys = [...grouped.keys()].sort();

  for (const key of keys) {
    const bucket = grouped.get(key)!;
    const provider = providerById.get(bucket.providerId);
    const amount = money(bucket.minor, bucket.currency);

    const common = {
      providerId: bucket.providerId,
      displayName: provider?.displayName ?? "(unknown provider)",
      currency: bucket.currency,
      amount,
      entryCount: bucket.ids.length,
    };

    const hold = (reason: HoldReason) => held.push({ ...common, reason });

    // Order matters: a negative balance is reported as a negative balance, not
    // as "below minimum", because they need completely different actions.
    if (bucket.minor < 0) {
      hold("negative_balance");
      continue;
    }
    if (bucket.minor === 0) {
      // Nets to nothing — earned and fully reversed. Not an exception, and not
      // worth a line in a payment file.
      continue;
    }
    if (!provider?.payoutDestinationId) {
      hold("no_payout_destination");
      continue;
    }
    if (!provider.payoutDestinationApproved) {
      // A destination changed recently and has not cleared review. A changed
      // bank reference must not walk straight into a payment.
      hold("destination_not_approved");
      continue;
    }
    if (bucket.minor < policy.minimumPayoutMinorUnits) {
      hold("below_minimum");
      continue;
    }

    lines.push({
      ...common,
      ledgerEntryIds: bucket.ids,
      payoutDestinationId: provider.payoutDestinationId,
      payoutReferenceMasked: provider.payoutReferenceMasked,
    });

    totals.set(
      bucket.currency,
      addMoney(totals.get(bucket.currency) ?? zero(bucket.currency), amount),
    );
  }

  return { lines, held, totalsByCurrency: totals };
}

/**
 * The downloadable statement for a batch.
 *
 * Every field goes through `csvField`, which both quotes correctly and
 * neutralises a leading `=`, `+`, `-` or `@` so a coach whose name starts with
 * one of those cannot turn a payout statement into something that executes when
 * it is opened.
 *
 * The amount column is a decimal string rather than a number so a spreadsheet
 * cannot helpfully reformat `8.10` into `8.1` and make two files stop matching.
 */
export function batchToCsv(
  batch: PreparedBatch,
  formatAmount: (amount: Money) => string,
): string {
  const header = [
    "provider",
    "provider_id",
    "payout_reference",
    "amount",
    "currency",
    "entries",
  ]
    .map(csvField)
    .join(",");

  const rows = batch.lines.map((line) =>
    [
      csvField(line.displayName),
      csvField(line.providerId),
      csvField(line.payoutReferenceMasked),
      csvField(formatAmount(line.amount)),
      csvField(line.currency),
      csvField(line.entryCount),
    ].join(","),
  );

  return [header, ...rows].join("\r\n");
}

/** A short, human-readable explanation of why a line was held back. */
export function describeHold(reason: HoldReason): string {
  switch (reason) {
    case "negative_balance":
      return "Balance is negative — a refund or dispute reversed more than was earned this period. It carries forward against future earnings; nothing is collected back.";
    case "below_minimum":
      return "Below the minimum payout amount. It stays eligible and rolls into the next batch.";
    case "no_payout_destination":
      return "No payout destination on file. The coach needs to supply one before they can be paid.";
    case "destination_not_approved":
      return "The payout destination has not cleared review. A changed destination cannot go straight into a payment.";
  }
}

/**
 * Masks an account reference for display.
 *
 * Shown in the admin interface and in exports, so an operator can tell two
 * destinations apart without the full reference sitting in a spreadsheet, an
 * email, or a screenshot.
 */
export function maskReference(reference: string): string {
  const trimmed = reference.trim();
  if (trimmed.length <= 4) return "•".repeat(trimmed.length);
  return `${"•".repeat(Math.max(4, trimmed.length - 4))}${trimmed.slice(-4)}`;
}
