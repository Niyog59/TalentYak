/**
 * Money arithmetic.
 *
 * Every amount is an integer count of minor units with an explicit currency.
 * No float ever holds a monetary value. Intermediate products are computed in
 * BigInt so a large amount multiplied by a rate cannot silently lose precision
 * on the way to a result, and every value returned to the caller is asserted to
 * be a safe integer.
 *
 * Rounding is stated once and never varied: **half away from zero**, to the
 * nearest whole minor unit. Where a total must be divided, the division is an
 * allocation that sums exactly to the original — never a set of independent
 * roundings that drift apart.
 */

import {
  type CurrencyCode,
  minorUnitExponent,
  minorUnitsPerMajor,
  toCurrencyCode,
} from "@/lib/money/currency";

/** An amount of money. `minor` is always an integer. */
export interface Money {
  readonly currency: CurrencyCode;
  readonly minor: number;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export class CurrencyMismatchError extends MoneyError {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(
      `Cannot combine ${a} and ${b}. Amounts in different currencies are never added; convert explicitly and record the rate and time.`,
    );
    this.name = "CurrencyMismatchError";
  }
}

/**
 * Upper bound on any single stored amount, in minor units.
 *
 * Deliberately far below Number.MAX_SAFE_INTEGER. Its purpose is to catch a
 * corrupted or hostile value — a price posted as 1e15, a missing decimal point
 * — before it reaches the database, not to describe a real transaction limit.
 * One hundred billion minor units is one billion dollars.
 */
export const MAX_MINOR_UNITS = 100_000_000_000;

function assertSafeMinor(value: bigint, what: string): number {
  if (value > BigInt(MAX_MINOR_UNITS) || value < BigInt(-MAX_MINOR_UNITS)) {
    throw new MoneyError(
      `${what} is out of range: ${value.toString()} minor units exceeds the ±${MAX_MINOR_UNITS} bound.`,
    );
  }
  return Number(value);
}

/** Constructs a Money value, validating the amount and the currency. */
export function money(minor: number, currency: string): Money {
  if (!Number.isInteger(minor)) {
    throw new MoneyError(
      `Amount must be an integer number of minor units, received ${minor}. A fractional minor unit means a float crept in.`,
    );
  }
  const code = toCurrencyCode(currency);
  assertSafeMinor(BigInt(minor), "Amount");
  return { currency: code, minor };
}

export function zero(currency: string): Money {
  return money(0, currency);
}

function sameCurrency(a: Money, b: Money): CurrencyCode {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
  return a.currency;
}

export function addMoney(a: Money, b: Money): Money {
  const currency = sameCurrency(a, b);
  return {
    currency,
    minor: assertSafeMinor(BigInt(a.minor) + BigInt(b.minor), "Sum"),
  };
}

export function subtractMoney(a: Money, b: Money): Money {
  const currency = sameCurrency(a, b);
  return {
    currency,
    minor: assertSafeMinor(BigInt(a.minor) - BigInt(b.minor), "Difference"),
  };
}

export function negateMoney(a: Money): Money {
  return { currency: a.currency, minor: -a.minor };
}

export function sumMoney(amounts: readonly Money[], currency: string): Money {
  const code = toCurrencyCode(currency);
  let total = 0n;
  for (const amount of amounts) {
    if (amount.currency !== code) {
      throw new CurrencyMismatchError(code, amount.currency);
    }
    total += BigInt(amount.minor);
  }
  return { currency: code, minor: assertSafeMinor(total, "Sum") };
}

export function isZero(a: Money): boolean {
  return a.minor === 0;
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  sameCurrency(a, b);
  if (a.minor < b.minor) return -1;
  if (a.minor > b.minor) return 1;
  return 0;
}

// --- Rounding -----------------------------------------------------------------

/**
 * Integer division rounding half away from zero.
 * 200.5 → 201, −200.5 → −201. The denominator must be positive.
 */
function divRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new MoneyError("Denominator must be positive.");
  }
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * Applies a rate expressed in basis points (1 bp = 0.01%), rounding to the
 * nearest whole minor unit, half away from zero.
 *
 * 1001 minor units at 2000 bp (20%) is 200.2 → 200.
 */
export function applyBasisPoints(minor: number, basisPoints: number): number {
  if (!Number.isInteger(minor)) {
    throw new MoneyError(`Amount must be an integer, received ${minor}.`);
  }
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new MoneyError(
      `Rate must be an integer 0–10000 basis points, received ${basisPoints}.`,
    );
  }
  const product = BigInt(minor) * BigInt(basisPoints);
  return assertSafeMinor(divRoundHalfAwayFromZero(product, 10_000n), "Rate result");
}

// --- Allocation ---------------------------------------------------------------

/**
 * Splits a total into parts by weight so the parts sum EXACTLY to the total.
 *
 * Uses the largest-remainder method: every part takes its floor, and the
 * leftover minor units go one each to the parts with the largest fractional
 * remainders, ties broken by position. The result is deterministic — the same
 * inputs always produce the same split, which matters because these numbers are
 * written to an immutable ledger and must be reproducible during
 * reconciliation.
 *
 * Negative totals (reversals) allocate on the magnitude and are negated, so a
 * refund splits the mirror image of the charge it reverses.
 */
export function allocate(
  totalMinor: number,
  weights: readonly number[],
): number[] {
  if (!Number.isInteger(totalMinor)) {
    throw new MoneyError(`Total must be an integer, received ${totalMinor}.`);
  }
  if (weights.length === 0) {
    throw new MoneyError("Cannot allocate across zero parts.");
  }
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new MoneyError(
        `Weights must be finite and non-negative, received ${weight}.`,
      );
    }
    if (!Number.isInteger(weight)) {
      throw new MoneyError(
        `Weights must be integers so the split is exactly reproducible, received ${weight}.`,
      );
    }
  }

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight === 0) {
    throw new MoneyError("Cannot allocate across parts whose weights are all zero.");
  }

  const negative = totalMinor < 0;
  const magnitude = BigInt(negative ? -totalMinor : totalMinor);
  const weightSum = BigInt(totalWeight);

  const floors: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let distributed = 0n;

  weights.forEach((weight, index) => {
    const product = magnitude * BigInt(weight);
    const floor = product / weightSum;
    floors.push(floor);
    remainders.push({ index, remainder: product % weightSum });
    distributed += floor;
  });

  let leftover = magnitude - distributed;

  // Largest remainder first; earlier index wins a tie.
  remainders.sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  );

  for (const entry of remainders) {
    if (leftover <= 0n) break;
    floors[entry.index] += 1n;
    leftover -= 1n;
  }

  return floors.map((value, index) =>
    assertSafeMinor(negative ? -value : value, `Allocation part ${index}`),
  );
}

/** Splits a total into `parts` equal shares, remainder to the earliest parts. */
export function allocateEvenly(totalMinor: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError(`Part count must be a positive integer, received ${parts}.`);
  }
  return allocate(totalMinor, new Array<number>(parts).fill(1));
}

// --- Parsing and formatting ---------------------------------------------------

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Parses a decimal string into minor units for a currency, without ever
 * constructing a float. "10.01" in USD is 1001; "10.1" is 1010; "10" is 1000.
 *
 * More fraction digits than the currency allows is an error, not a rounding
 * opportunity — silently rounding a submitted price is how a customer gets
 * charged something they did not agree to.
 */
export function parseDecimalToMinor(value: string, currency: string): number {
  const code = toCurrencyCode(currency);
  const exponent = minorUnitExponent(code);
  const text = value.trim();

  const match = DECIMAL_PATTERN.exec(text);
  if (!match) {
    throw new MoneyError(
      `${JSON.stringify(value)} is not a plain decimal amount. Expected digits with at most one decimal point, no grouping separators and no currency symbol.`,
    );
  }

  const [, sign, whole, fraction = ""] = match;
  if (fraction.length > exponent) {
    throw new MoneyError(
      `${JSON.stringify(value)} has ${fraction.length} decimal places but ${code} has ${exponent}. Refusing to round a submitted amount.`,
    );
  }

  const padded = fraction.padEnd(exponent, "0");
  const minor = BigInt(whole + padded) * (sign === "-" ? -1n : 1n);
  return assertSafeMinor(minor, "Parsed amount");
}

/** Renders minor units as a plain decimal string: 1001 USD → "10.01". */
export function formatMinorAsDecimal(
  minor: number,
  currency: string,
): string {
  const code = toCurrencyCode(currency);
  const exponent = minorUnitExponent(code);
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = exponent === 0 ? "" : `.${digits.slice(digits.length - exponent)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/**
 * Formats for display, always with the currency code visible.
 *
 * The code is never dropped in favour of a bare symbol: "$" is at least five
 * different currencies, and a Nepali coach reading "$80" must be able to tell
 * which one it is.
 */
export function formatMoney(
  amount: Money,
  options: { locale?: string; showCode?: boolean } = {},
): string {
  const { locale = "en-US", showCode = true } = options;
  const exponent = minorUnitExponent(amount.currency);
  const value = amount.minor / minorUnitsPerMajor(amount.currency);

  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: amount.currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(value);

  if (!showCode) return formatted;
  return formatted.includes(amount.currency)
    ? formatted
    : `${formatted} ${amount.currency}`;
}
