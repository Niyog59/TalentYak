import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computePayout, csvField, payoutsToCsv } from "@/lib/payouts";
import { CURRENT_COMMISSION_POLICY_ID } from "@/lib/policy";

describe("payout split", () => {
  test("fitness uses the current 20% policy and records its id", () => {
    const split = computePayout({
      verticalSlug: "fitness",
      serviceId: "anything",
      grossCents: 10_000,
    });

    assert.equal(split.platformShareCents, 2000);
    assert.equal(split.providerShareCents, 8000);
    assert.equal(split.rule, CURRENT_COMMISSION_POLICY_ID);
  });

  test("the founding-coach flag no longer changes anyone's rate", () => {
    const founding = computePayout({
      verticalSlug: "fitness",
      serviceId: "anything",
      grossCents: 10_000,
      providerFounding: true,
    });
    const ordinary = computePayout({
      verticalSlug: "fitness",
      serviceId: "anything",
      grossCents: 10_000,
      providerFounding: false,
    });
    assert.deepEqual(founding, ordinary);
  });

  test("the shares always sum to the gross", () => {
    for (const gross of [1, 7, 1001, 9999, 123_456]) {
      const split = computePayout({
        verticalSlug: "fitness",
        serviceId: "anything",
        grossCents: gross,
      });
      assert.equal(split.providerShareCents + split.platformShareCents, gross);
    }
  });

  test("an unregistered vertical refuses rather than guessing a split", () => {
    assert.throws(
      () =>
        computePayout({
          verticalSlug: "not-a-vertical",
          serviceId: "anything",
          grossCents: 10_000,
        }),
      /No payout rule is registered/,
    );
  });
});

/**
 * Minimal RFC 4180 row parser, written here rather than imported so the test
 * checks the output independently instead of reusing the code that produced it.
 */
function parseCsvRow(row: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (inQuotes) {
      if (char === '"') {
        if (row[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

describe("CSV export safety", () => {
  test("neutralises a leading formula character", () => {
    for (const dangerous of [
      "=1+1",
      "+1",
      "-1",
      "@SUM(A1)",
      '=cmd|" /C calc"!A0',
    ]) {
      const field = csvField(dangerous);
      assert.ok(
        field.startsWith("\"'"),
        `${dangerous} should be prefixed so a spreadsheet treats it as text, got ${field}`,
      );
    }
  });

  test("leaves an ordinary value alone apart from quoting", () => {
    assert.equal(csvField("Sita Sharma"), '"Sita Sharma"');
    assert.equal(csvField(12), '"12"');
    assert.equal(csvField(null), '""');
  });

  test("escapes quotes, commas and newlines so columns cannot shift", () => {
    assert.equal(csvField('He said "hi"'), '"He said ""hi"""');
    assert.equal(csvField("Sharma, Sita"), '"Sharma, Sita"');
    assert.equal(csvField("line one\nline two"), '"line one\nline two"');
  });

  test("a hostile provider name cannot break out of its cell", () => {
    const hostile = '=HYPERLINK("http://evil","click"),extra';
    const csv = payoutsToCsv([
      {
        provider_name: hostile,
        payout_reference: "ref-1",
        total_cents: 8000,
        entry_count: 2,
      },
    ]);

    const [, row] = csv.split("\r\n");
    const fields = parseCsvRow(row);

    // The embedded quotes and comma stay inside one cell rather than shifting
    // the payout amount into the wrong column.
    assert.equal(fields.length, 5);
    assert.equal(fields[0], `'${hostile}`);
    assert.equal(fields[2], "80.00");
    assert.equal(fields[4], "2");
  });

  test("names the reference column for the concept, not an unverified vendor", () => {
    const csv = payoutsToCsv([]);
    assert.ok(csv.includes("payout_reference"));
    assert.ok(!csv.toLowerCase().includes("payoneer"));
  });

  test("states the currency rather than assuming dollars", () => {
    const csv = payoutsToCsv([
      {
        provider_name: "Sita Sharma",
        payout_reference: null,
        total_cents: 8000,
        entry_count: 1,
        currency: "usd",
      },
    ]);
    assert.ok(csv.includes('"USD"'));
    assert.ok(csv.includes("currency"));
  });
});
