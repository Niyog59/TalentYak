import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_MINOR_UNITS,
  MoneyError,
  CurrencyMismatchError,
  addMoney,
  allocate,
  allocateEvenly,
  applyBasisPoints,
  compareMoney,
  formatMinorAsDecimal,
  formatMoney,
  money,
  parseDecimalToMinor,
  subtractMoney,
  sumMoney,
} from "@/lib/money/money";
import {
  UnknownCurrencyError,
  minorUnitExponent,
  minorUnitsPerMajor,
  toCurrencyCode,
} from "@/lib/money/currency";

describe("currency precision", () => {
  test("knows the exponent of each supported currency", () => {
    assert.equal(minorUnitExponent("USD"), 2);
    assert.equal(minorUnitExponent("NPR"), 2);
    assert.equal(minorUnitExponent("JPY"), 0);
    assert.equal(minorUnitExponent("KWD"), 3);
  });

  test("minor units per major is never assumed to be 100", () => {
    assert.equal(minorUnitsPerMajor("USD"), 100);
    assert.equal(minorUnitsPerMajor("JPY"), 1);
    assert.equal(minorUnitsPerMajor("KWD"), 1000);
  });

  test("an unknown currency throws rather than defaulting to two decimals", () => {
    assert.throws(() => toCurrencyCode("XYZ"), UnknownCurrencyError);
  });

  test("currency codes are accepted in any case and canonicalised", () => {
    assert.equal(toCurrencyCode("usd"), "USD");
    assert.equal(toCurrencyCode("  Npr "), "NPR");
  });
});

describe("constructing money", () => {
  test("rejects a fractional minor unit, which means a float crept in", () => {
    assert.throws(() => money(10.5, "USD"), MoneyError);
  });

  test("rejects an amount beyond the sanity bound", () => {
    assert.throws(() => money(MAX_MINOR_UNITS + 1, "USD"), MoneyError);
  });

  test("accepts zero and negative amounts", () => {
    assert.equal(money(0, "USD").minor, 0);
    assert.equal(money(-1500, "USD").minor, -1500);
  });
});

describe("arithmetic", () => {
  test("adds and subtracts within one currency", () => {
    assert.equal(addMoney(money(1000, "USD"), money(25, "USD")).minor, 1025);
    assert.equal(subtractMoney(money(1000, "USD"), money(25, "USD")).minor, 975);
  });

  test("refuses to combine different currencies", () => {
    assert.throws(
      () => addMoney(money(1000, "USD"), money(1000, "NPR")),
      CurrencyMismatchError,
    );
  });

  test("sums a list and refuses a mixed-currency list", () => {
    const total = sumMoney(
      [money(100, "USD"), money(250, "USD"), money(3, "USD")],
      "USD",
    );
    assert.equal(total.minor, 353);
    assert.throws(
      () => sumMoney([money(100, "USD"), money(100, "JPY")], "USD"),
      CurrencyMismatchError,
    );
  });

  test("compares within one currency", () => {
    assert.equal(compareMoney(money(1, "USD"), money(2, "USD")), -1);
    assert.equal(compareMoney(money(2, "USD"), money(2, "USD")), 0);
    assert.equal(compareMoney(money(3, "USD"), money(2, "USD")), 1);
  });
});

describe("applying a rate", () => {
  test("rounds to the nearest minor unit, half away from zero", () => {
    // 1001 × 20% = 200.2 → 200
    assert.equal(applyBasisPoints(1001, 2000), 200);
    // 1005 × 50% = 502.5 → 503
    assert.equal(applyBasisPoints(1005, 5000), 503);
    // −1005 × 50% = −502.5 → −503
    assert.equal(applyBasisPoints(-1005, 5000), -503);
  });

  test("is exact on clean multiples", () => {
    assert.equal(applyBasisPoints(10_000, 2000), 2000);
    assert.equal(applyBasisPoints(54_000, 2000), 10_800);
  });

  test("rejects a rate outside 0–10000 basis points", () => {
    assert.throws(() => applyBasisPoints(1000, -1), MoneyError);
    assert.throws(() => applyBasisPoints(1000, 10_001), MoneyError);
    assert.throws(() => applyBasisPoints(1000, 20.5), MoneyError);
  });

  test("stays exact at the top of the permitted range", () => {
    // 99_999_999_999 × 3333 = 333_299_999_996_667, ÷ 10000 = 33_329_999_999.6667
    assert.equal(applyBasisPoints(99_999_999_999, 3333), 33_330_000_000);
  });

  test("matches an independent exact computation across a sweep", () => {
    // The reference is computed in BigInt with the rounding rule applied by
    // hand, so this checks the implementation rather than restating it.
    const reference = (minor: number, bp: number) => {
      const product = BigInt(minor) * BigInt(bp);
      const quotient = product / 10_000n;
      const remainder = product % 10_000n;
      return Number(remainder * 2n >= 10_000n ? quotient + 1n : quotient);
    };

    for (const bp of [1, 2000, 3000, 3333, 5000, 6667, 10_000]) {
      for (const minor of [1, 7, 99, 1001, 1005, 54_321, 999_999, 12_345_678]) {
        assert.equal(
          applyBasisPoints(minor, bp),
          reference(minor, bp),
          `${minor} minor units at ${bp} bp`,
        );
      }
    }
  });

  test("differs from Math.round on a negative half, which is the point", () => {
    // Math.round(-502.5) is -502 — it rounds toward positive infinity, so a
    // reversal would not mirror the charge it reverses.
    assert.equal(applyBasisPoints(-1005, 5000), -503);
    assert.notEqual(applyBasisPoints(-1005, 5000), Math.round((-1005 * 5000) / 10_000));
  });
});

describe("allocation", () => {
  test("parts always sum exactly to the total", () => {
    for (const total of [100, 101, 999, 1001, 5, 0, 7]) {
      for (const parts of [2, 3, 6, 7, 12]) {
        const split = allocateEvenly(total, parts);
        assert.equal(
          split.reduce((a, b) => a + b, 0),
          total,
          `${total} over ${parts} parts must sum exactly`,
        );
      }
    }
  });

  test("gives leftover minor units to the earliest parts, deterministically", () => {
    assert.deepEqual(allocateEvenly(100, 3), [34, 33, 33]);
    assert.deepEqual(allocateEvenly(101, 3), [34, 34, 33]);
    assert.deepEqual(allocateEvenly(1, 3), [1, 0, 0]);
  });

  test("is stable across repeated calls", () => {
    const first = allocateEvenly(1001, 7);
    const second = allocateEvenly(1001, 7);
    assert.deepEqual(first, second);
  });

  test("allocates by weight", () => {
    assert.deepEqual(allocate(1000, [1, 1, 2]), [250, 250, 500]);
    const weighted = allocate(100, [1, 2, 3, 4]);
    assert.deepEqual(weighted, [10, 20, 30, 40]);
  });

  test("mirrors a negative total, so a reversal is the exact inverse", () => {
    const charge = allocateEvenly(101, 3);
    const reversal = allocateEvenly(-101, 3);
    assert.deepEqual(
      reversal,
      charge.map((n) => -n),
    );
    assert.equal(
      reversal.reduce((a, b) => a + b, 0),
      -101,
    );
  });

  test("rejects degenerate inputs rather than guessing", () => {
    assert.throws(() => allocate(100, []), MoneyError);
    assert.throws(() => allocate(100, [0, 0]), MoneyError);
    assert.throws(() => allocate(100, [1, -1]), MoneyError);
    assert.throws(() => allocate(100, [1.5, 1]), MoneyError);
    assert.throws(() => allocateEvenly(100, 0), MoneyError);
  });
});

describe("parsing decimal input", () => {
  test("parses to minor units without a float", () => {
    assert.equal(parseDecimalToMinor("10.01", "USD"), 1001);
    assert.equal(parseDecimalToMinor("10.1", "USD"), 1010);
    assert.equal(parseDecimalToMinor("10", "USD"), 1000);
    assert.equal(parseDecimalToMinor("0.07", "USD"), 7);
    assert.equal(parseDecimalToMinor("-2.50", "USD"), -250);
  });

  test("uses the currency's own precision", () => {
    assert.equal(parseDecimalToMinor("1000", "JPY"), 1000);
    assert.equal(parseDecimalToMinor("1.234", "KWD"), 1234);
  });

  test("refuses to silently round an amount someone submitted", () => {
    assert.throws(() => parseDecimalToMinor("10.005", "USD"), MoneyError);
    assert.throws(() => parseDecimalToMinor("1000.5", "JPY"), MoneyError);
  });

  test("rejects symbols, separators and junk rather than interpreting them", () => {
    for (const bad of ["$10.00", "1,000.00", "10.00 USD", "", "abc", "1.2.3", "1e3"]) {
      assert.throws(
        () => parseDecimalToMinor(bad, "USD"),
        MoneyError,
        `${JSON.stringify(bad)} must be rejected`,
      );
    }
  });

  test("the classic float failure does not occur", () => {
    // 0.1 + 0.2 as minor units is exact.
    const a = parseDecimalToMinor("0.1", "USD");
    const b = parseDecimalToMinor("0.2", "USD");
    assert.equal(a + b, parseDecimalToMinor("0.30", "USD"));
  });
});

describe("formatting", () => {
  test("renders minor units back to a plain decimal", () => {
    assert.equal(formatMinorAsDecimal(1001, "USD"), "10.01");
    assert.equal(formatMinorAsDecimal(7, "USD"), "0.07");
    assert.equal(formatMinorAsDecimal(-250, "USD"), "-2.50");
    assert.equal(formatMinorAsDecimal(1000, "JPY"), "1000");
    assert.equal(formatMinorAsDecimal(1234, "KWD"), "1.234");
  });

  test("round-trips through parsing", () => {
    for (const value of ["10.01", "0.07", "123456.78", "-2.50"]) {
      assert.equal(
        formatMinorAsDecimal(parseDecimalToMinor(value, "USD"), "USD"),
        value,
      );
    }
  });

  test("always shows the currency code, because a dollar sign is ambiguous", () => {
    const usd = formatMoney(money(8000, "USD"));
    const nprAmount = formatMoney(money(8000, "NPR"));
    assert.ok(usd.includes("USD"), `expected a USD marker in ${usd}`);
    assert.ok(nprAmount.includes("NPR"), `expected an NPR marker in ${nprAmount}`);
    assert.notEqual(usd, nprAmount);
  });

  test("honours the currency's decimal places", () => {
    assert.ok(formatMoney(money(1000, "JPY")).includes("1,000"));
    assert.ok(!formatMoney(money(1000, "JPY")).includes(".00"));
  });
});
