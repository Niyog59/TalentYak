/**
 * Currencies a coach may CHARGE in, and the smallest amount Stripe will accept
 * in each.
 *
 * Charge currency and display currency are different things. A customer may
 * choose to see approximate prices in rupees; they are charged in whatever
 * currency the coach priced the plan in, and checkout always says which.
 *
 * The list is the diaspora markets the business plans to serve. Whether the
 * Stripe account can actually settle each one is an account setting the founder
 * confirms in the Stripe dashboard; Stripe refuses a currency it cannot take,
 * and the checkout fails closed with nothing charged.
 *
 * Minimums are Stripe's published minimum charge amounts, in minor units. A
 * price below them could never be paid, so the plan builder refuses it rather
 * than letting a coach publish a plan nobody can buy.
 */
export const CHARGE_CURRENCIES = [
  { code: "USD", label: "US dollar (USD)", minimumMinor: 50 },
  { code: "GBP", label: "British pound (GBP)", minimumMinor: 30 },
  { code: "EUR", label: "Euro (EUR)", minimumMinor: 50 },
  { code: "AUD", label: "Australian dollar (AUD)", minimumMinor: 50 },
  { code: "CAD", label: "Canadian dollar (CAD)", minimumMinor: 50 },
  { code: "NZD", label: "New Zealand dollar (NZD)", minimumMinor: 50 },
] as const;

export type ChargeCurrency = (typeof CHARGE_CURRENCIES)[number]["code"];

export function chargeCurrency(code: string) {
  return CHARGE_CURRENCIES.find((c) => c.code === code.toUpperCase()) ?? null;
}
