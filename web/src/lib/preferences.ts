/**
 * Choices offered at onboarding. Shared by the form and the server action so
 * the server validates against exactly what the form offered.
 */

import { isCurrencyCode } from "@/lib/money/currency";

/**
 * Currencies a person may choose to SEE prices in. This is a display
 * preference only. It never changes the currency anyone is charged in — that is
 * whatever the coach priced the plan in.
 */
export const DISPLAY_CURRENCIES = [
  { code: "USD", label: "US dollar (USD)" },
  { code: "GBP", label: "British pound (GBP)" },
  { code: "EUR", label: "Euro (EUR)" },
  { code: "AUD", label: "Australian dollar (AUD)" },
  { code: "CAD", label: "Canadian dollar (CAD)" },
  { code: "NZD", label: "New Zealand dollar (NZD)" },
  { code: "NPR", label: "Nepalese rupee (NPR)" },
  { code: "INR", label: "Indian rupee (INR)" },
] as const;

export function isDisplayCurrency(value: string): boolean {
  return isCurrencyCode(value) && DISPLAY_CURRENCIES.some((c) => c.code === value.toUpperCase());
}

/** True only for a real IANA zone name the runtime recognises. */
export function isValidTimezone(value: string): boolean {
  if (!/^[A-Za-z]+(\/[A-Za-z0-9_+-]+)+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Some runtimes still list retired spellings ("Asia/Katmandu", "Asia/Calcutta").
 * People look for the current names, so the list shows those, and a stored old
 * spelling is read as the current one.
 */
const CURRENT_ZONE_NAME: Record<string, string> = {
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Godthab": "America/Nuuk",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
};

export function canonicalTimezone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  return CURRENT_ZONE_NAME[zone] ?? zone;
}

export function timezoneOptions(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const zones = supported ? supported("timeZone") : ["UTC", "Asia/Kathmandu", "America/Chicago"];
  return [...new Set(zones.filter((z) => z.includes("/")).map((z) => CURRENT_ZONE_NAME[z] ?? z))].sort();
}

export const MIN_PASSWORD_LENGTH = 10;
