import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { formatMinorAsDecimal, money } from "@/lib/money/money";
import {
  batchToCsv,
  describeHold,
  maskReference,
  prepareBatch,
  type EligibleEntry,
  type ProviderInfo,
} from "@/lib/payouts/batching";

const policy = { minimumPayoutMinorUnits: 0 };
const fmt = (m: { minor: number; currency: string }) =>
  formatMinorAsDecimal(m.minor, m.currency);

const payableCoach = (id: string, name: string): ProviderInfo => ({
  providerId: id,
  displayName: name,
  payoutDestinationId: `dest-${id}`,
  payoutDestinationApproved: true,
  payoutReferenceMasked: "••••1234",
});

const entry = (
  providerId: string,
  amountMinor: number,
  currency = "USD",
  ledgerEntryId = `e-${Math.random()}`,
): EligibleEntry => ({ ledgerEntryId, providerId, currency, amountMinor });

describe("grouping", () => {
  test("nets several entries into one line per coach", () => {
    const batch = prepareBatch(
      [entry("c1", 8000), entry("c1", 6800), entry("c1", 6800)],
      [payableCoach("c1", "Sita")],
      policy,
    );

    assert.equal(batch.lines.length, 1);
    assert.equal(batch.lines[0].amount.minor, 21_600);
    assert.equal(batch.lines[0].entryCount, 3);
  });

  test("a coach paid in two currencies gets two lines, never one total", () => {
    const batch = prepareBatch(
      [entry("c1", 8000, "USD"), entry("c1", 500_000, "NPR")],
      [payableCoach("c1", "Sita")],
      policy,
    );

    assert.equal(batch.lines.length, 2);
    assert.equal(batch.totalsByCurrency.get("USD")?.minor, 8000);
    assert.equal(batch.totalsByCurrency.get("NPR")?.minor, 500_000);
    assert.equal(batch.totalsByCurrency.size, 2, "there is no grand total across currencies");
  });

  test("reversals are netted, not ignored", () => {
    // Earned 80.00, then 25.00 of it was refunded (coach side −20.00).
    const batch = prepareBatch(
      [entry("c1", 8000), entry("c1", -2000)],
      [payableCoach("c1", "Sita")],
      policy,
    );
    assert.equal(
      batch.lines[0].amount.minor,
      6000,
      "summing only the positives would pay for a refunded service",
    );
  });

  test("is deterministic, so two operators see the same batch", () => {
    const entries = [entry("c2", 100), entry("c1", 200), entry("c3", 300)];
    const providers = [payableCoach("c1", "A"), payableCoach("c2", "B"), payableCoach("c3", "C")];

    const first = prepareBatch(entries, providers, policy);
    const second = prepareBatch([...entries].reverse(), providers, policy);

    assert.deepEqual(
      first.lines.map((l) => l.providerId),
      second.lines.map((l) => l.providerId),
    );
  });
});

describe("what is held back", () => {
  test("a negative balance is never paid", () => {
    const batch = prepareBatch(
      [entry("c1", 8000), entry("c1", -10_000)],
      [payableCoach("c1", "Sita")],
      policy,
    );

    assert.equal(batch.lines.length, 0, "nothing is transferred");
    assert.equal(batch.held[0].reason, "negative_balance");
    assert.equal(batch.held[0].amount.minor, -2000);
  });

  test("a negative balance is reported as such, not as 'below minimum'", () => {
    // They need different actions, so they must not be collapsed.
    const batch = prepareBatch(
      [entry("c1", -500)],
      [payableCoach("c1", "Sita")],
      { minimumPayoutMinorUnits: 1000 },
    );
    assert.equal(batch.held[0].reason, "negative_balance");
  });

  test("a balance that nets to zero produces no line and no exception", () => {
    const batch = prepareBatch(
      [entry("c1", 8000), entry("c1", -8000)],
      [payableCoach("c1", "Sita")],
      policy,
    );
    assert.equal(batch.lines.length, 0);
    assert.equal(batch.held.length, 0, "fully reversed is not an exception");
  });

  test("a coach with no payout destination is held, not skipped silently", () => {
    const batch = prepareBatch(
      [entry("c1", 8000)],
      [
        {
          providerId: "c1",
          displayName: "Sita",
          payoutDestinationId: null,
          payoutDestinationApproved: false,
          payoutReferenceMasked: null,
        },
      ],
      policy,
    );
    assert.equal(batch.lines.length, 0);
    assert.equal(batch.held[0].reason, "no_payout_destination");
  });

  test("an unreviewed destination change cannot walk into a payment", () => {
    const batch = prepareBatch(
      [entry("c1", 8000)],
      [{ ...payableCoach("c1", "Sita"), payoutDestinationApproved: false }],
      policy,
    );
    assert.equal(batch.lines.length, 0);
    assert.equal(batch.held[0].reason, "destination_not_approved");
  });

  test("below the minimum rolls forward rather than being sent", () => {
    const batch = prepareBatch(
      [entry("c1", 500)],
      [payableCoach("c1", "Sita")],
      { minimumPayoutMinorUnits: 1000 },
    );
    assert.equal(batch.held[0].reason, "below_minimum");
  });

  test("every hold reason has an explanation an operator can act on", () => {
    for (const reason of [
      "negative_balance",
      "below_minimum",
      "no_payout_destination",
      "destination_not_approved",
    ] as const) {
      assert.ok(describeHold(reason).length > 40, `${reason} needs a real explanation`);
    }
  });

  test("a held line never appears in the payable lines", () => {
    const batch = prepareBatch(
      [entry("c1", 8000), entry("c2", -500), entry("c3", 100)],
      [
        payableCoach("c1", "A"),
        payableCoach("c2", "B"),
        { ...payableCoach("c3", "C"), payoutDestinationId: null },
      ],
      policy,
    );

    const paid = new Set(batch.lines.map((l) => l.providerId));
    for (const h of batch.held) {
      assert.ok(!paid.has(h.providerId), `${h.providerId} is both paid and held`);
    }
    assert.equal(batch.lines.length, 1);
    assert.equal(batch.held.length, 2);
  });
});

describe("the exported statement", () => {
  test("contains only payable lines", () => {
    const batch = prepareBatch(
      [entry("c1", 8000), entry("c2", -500)],
      [payableCoach("c1", "Sita"), payableCoach("c2", "Ram")],
      policy,
    );
    const csv = batchToCsv(batch, fmt);
    assert.ok(csv.includes("Sita"));
    assert.ok(!csv.includes("Ram"), "a held coach must not appear in a payment file");
  });

  test("neutralises a name that would run as a formula", () => {
    const batch = prepareBatch(
      [entry("c1", 8000)],
      [payableCoach("c1", '=HYPERLINK("http://evil","click")')],
      policy,
    );
    const csv = batchToCsv(batch, fmt);
    const dataRow = csv.split("\r\n")[1];
    assert.ok(
      dataRow.startsWith("\"'="),
      "a leading = must be prefixed so a spreadsheet treats it as text",
    );
  });

  test("writes the amount as an exact decimal string", () => {
    const batch = prepareBatch([entry("c1", 810)], [payableCoach("c1", "Sita")], policy);
    const csv = batchToCsv(batch, fmt);
    assert.ok(csv.includes('"8.10"'), "8.10 must not become 8.1");
  });

  test("states the currency on every row", () => {
    const batch = prepareBatch(
      [entry("c1", 8000, "USD"), entry("c2", 500_000, "NPR")],
      [payableCoach("c1", "A"), payableCoach("c2", "B")],
      policy,
    );
    const csv = batchToCsv(batch, fmt);
    assert.ok(csv.includes('"USD"'));
    assert.ok(csv.includes('"NPR"'));
  });

  test("carries the masked reference, never a full one", () => {
    const batch = prepareBatch([entry("c1", 8000)], [payableCoach("c1", "Sita")], policy);
    const csv = batchToCsv(batch, fmt);
    assert.ok(csv.includes("••••1234"));
  });

  test("an empty batch still produces a valid header row", () => {
    const batch = prepareBatch([], [], policy);
    const csv = batchToCsv(batch, fmt);
    assert.ok(csv.startsWith('"provider"'));
    assert.equal(csv.split("\r\n").length, 1);
  });
});

describe("masking a reference", () => {
  test("keeps the last four so two destinations can be told apart", () => {
    assert.equal(maskReference("1234567890123456"), "••••••••••••3456");
  });

  test("hides a short reference entirely rather than revealing most of it", () => {
    assert.equal(maskReference("1234"), "••••");
    assert.equal(maskReference("12"), "••");
  });

  test("never returns the original string", () => {
    for (const ref of ["1234567890", "NP-ACCOUNT-99881", "abcd"]) {
      assert.notEqual(maskReference(ref), ref);
    }
  });
});

describe("totals", () => {
  test("only count what is actually being paid", () => {
    const batch = prepareBatch(
      [entry("c1", 8000), entry("c2", -500), entry("c3", 100)],
      [
        payableCoach("c1", "A"),
        payableCoach("c2", "B"),
        { ...payableCoach("c3", "C"), payoutDestinationId: null },
      ],
      policy,
    );
    assert.equal(
      batch.totalsByCurrency.get("USD")?.minor,
      8000,
      "held lines must not inflate the total being sent",
    );
  });
});
