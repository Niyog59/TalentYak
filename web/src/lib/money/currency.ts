/**
 * Currency metadata.
 *
 * Money in this system is an integer count of MINOR UNITS plus an explicit
 * currency code. How many minor units make one major unit is a property of the
 * currency, not a constant: USD and NPR have 100, JPY and KRW have 1, and KWD
 * has 1000. Dividing by 100 to "get dollars" is a bug in every currency that is
 * not two-decimal, so nothing in this codebase may do it.
 *
 * Exponents are ISO 4217. Adding a currency is a deliberate act: an unknown
 * code throws rather than silently defaulting to 2, because a wrong exponent
 * misstates an amount by a factor of ten or a hundred.
 */

/** Currencies this system knows how to represent. */
export const MINOR_UNIT_EXPONENTS = {
  // Two-decimal currencies
  AUD: 2,
  CAD: 2,
  CHF: 2,
  CNY: 2,
  EUR: 2,
  GBP: 2,
  HKD: 2,
  INR: 2,
  NPR: 2,
  NZD: 2,
  SGD: 2,
  USD: 2,
  ZAR: 2,
  // Zero-decimal currencies
  JPY: 0,
  KRW: 0,
  VND: 0,
  // Three-decimal currencies
  BHD: 3,
  JOD: 3,
  KWD: 3,
  OMR: 3,
  TND: 3,
} as const;

export type CurrencyCode = keyof typeof MINOR_UNIT_EXPONENTS;

export class UnknownCurrencyError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(
      `Unknown currency ${JSON.stringify(code)}. Add it to MINOR_UNIT_EXPONENTS with its ISO 4217 exponent before using it.`,
    );
    this.name = "UnknownCurrencyError";
    this.code = code;
  }
}

/**
 * Narrows an arbitrary string to a known currency code.
 * Accepts any case; returns the canonical uppercase form.
 */
export function toCurrencyCode(value: string): CurrencyCode {
  const upper = value.trim().toUpperCase();
  if (!(upper in MINOR_UNIT_EXPONENTS)) throw new UnknownCurrencyError(value);
  return upper as CurrencyCode;
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return value.trim().toUpperCase() in MINOR_UNIT_EXPONENTS;
}

/** Number of decimal places this currency is expressed in. */
export function minorUnitExponent(currency: CurrencyCode): number {
  return MINOR_UNIT_EXPONENTS[currency];
}

/** How many minor units make one major unit. 100 for USD, 1 for JPY. */
export function minorUnitsPerMajor(currency: CurrencyCode): number {
  return 10 ** minorUnitExponent(currency);
}
