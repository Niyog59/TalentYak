import { formatMoney as formatMoneyValue, money } from "@/lib/money/money";
import { isCurrencyCode } from "@/lib/money/currency";

/*
 * Display formatting shared by every service.
 *
 * Money is stored in integer minor units with an explicit currency code, and
 * is always displayed with that code — "$85 USD", "£60 GBP" — because a bare
 * "$" is ambiguous for a customer in Australia or Canada.
 *
 * Times are always rendered in a named IANA timezone and carry a visible zone
 * label. Nothing here reads the server's own timezone.
 */

export function formatMoney(
  minorUnits: number,
  currency: string,
  locale = "en-US",
): string {
  const code = currency.toUpperCase();
  const digits =
    new Intl.NumberFormat(locale, { style: "currency", currency: code })
      .resolvedOptions().maximumFractionDigits ?? 2;
  const value = minorUnits / 10 ** digits;
  const whole = Number.isInteger(value);
  const amount = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${amount} ${code}`;
}

export interface ZonedTime {
  /** e.g. "Tue, Sep 16" */
  date: string;
  /** e.g. "7:30 PM" */
  time: string;
  /** Short zone name, e.g. "CDT" or "GMT+5:45" */
  zone: string;
  /** IANA identifier, e.g. "America/Chicago" */
  timeZone: string;
}

export function formatInZone(
  isoInstant: string,
  timeZone: string,
  locale = "en-US",
): ZonedTime {
  const at = new Date(isoInstant);
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(at);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(at);
  const zone =
    new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? timeZone;
  return { date, time, zone, timeZone };
}

/** Date-only value ("2026-09-10") → "Sep 10". Independent of any timezone. */
export function formatDay(
  dateOnly: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
  locale = "en-US",
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(
    new Date(`${dateOnly}T00:00:00Z`),
  );
}

/** Milliseconds for a date-only value, for positioning points on a chart. */
export function dayValue(dateOnly: string): number {
  return Date.parse(`${dateOnly}T00:00:00Z`);
}

export type WeightUnit = "kg" | "lb";

/** Weights are stored in kilograms and shown in the person's chosen unit. */
export function toUnit(kg: number, unit: WeightUnit): number {
  return unit === "kg" ? kg : kg * 2.20462;
}

export function formatWeight(kg: number, unit: WeightUnit): string {
  return `${toUnit(kg, unit).toFixed(1)} ${unit}`;
}

/**
 * A neutral change: a true minus sign or plus sign and a number. No words
 * like "down" or "gained", and no colour — the direction is not a verdict.
 */
export function formatChange(deltaKg: number, unit: WeightUnit): string {
  const value = toUnit(deltaKg, unit);
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  return `${sign}${Math.abs(rounded).toFixed(1)} ${unit}`;
}

/** Readable place name for an IANA zone: "America/Chicago" → "Chicago". */
export function zoneCity(timeZone: string): string {
  const last = timeZone.split("/").pop() ?? timeZone;
  return last.replaceAll("_", " ");
}

// ---------------------------------------------------------------------------
// Account, billing and earnings screens
// ---------------------------------------------------------------------------

/** Minor units → "USD 80.00"-style text, always showing which currency. */
export function formatMinor(minor: number | string | bigint | null | undefined, currency: string | null | undefined): string {
  if (minor === null || minor === undefined || !currency) return "—";
  const value = Number(minor);
  if (!isCurrencyCode(currency)) return `${value} ${currency} (minor units)`;
  return formatMoneyValue(money(value, currency));
}

/** A date for people, in their own timezone when we know it. */
export function formatDate(iso: string | null | undefined, timezone?: string | null, withTime = false): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
      timeZone: timezone ?? "UTC",
      ...(timezone ? {} : { timeZoneName: withTime ? "short" : undefined }),
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, withTime ? 16 : 10);
  }
}

/** Words for the machine states a person may see. */
export const PURCHASE_STATE_LABEL: Record<string, string> = {
  pending_payment: "Waiting for payment",
  active: "Active",
  cancelling: "Ends at the end of the paid period",
  past_due: "Payment failed — retrying",
  paused: "Paused",
  ended: "Ended",
  refunded: "Refunded",
  failed: "Payment did not complete",
  expired: "Checkout expired",
};

export const PROVIDER_STATUS_LABEL: Record<string, string> = {
  invited: "Invited",
  onboarding: "Setting up",
  submitted: "Submitted for review",
  in_review: "In review",
  approved: "Approved",
  suspended: "Suspended",
  retired: "Retired",
};

export const OFFER_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  published: "On sale",
  paused: "Paused — not taking sign-ups",
  archived: "Archived",
};

export const EARNING_STATE_LABEL: Record<string, string> = {
  pending: "Pending — service not yet delivered",
  held: "Held",
  eligible: "Ready to be paid",
  batched: "In a payout being prepared",
  paid: "Paid",
  reversed: "Reversed",
};
