import { localDate, startOfLocalDay } from "@/lib/programmes/content";

/**
 * The reporting period for the founder's overview: Today, the last 7 or 30
 * days, or a custom range of whole days — always counted in one stated
 * timezone, from the start of the first day to the end of the last (or now,
 * when the last day is today). Pure; tested.
 */

export type RangeKey = "today" | "7d" | "30d" | "custom";

export interface ReportRange {
  key: RangeKey;
  from: Date;
  to: Date;
  fromDay: string;
  toDay: string;
  timeZone: string;
  label: string;
  /** Set when the requested custom range was unusable and a default was used. */
  corrected?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function validTimeZone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export function resolveRange(
  input: { range?: string; from?: string; to?: string },
  timeZone: string | null | undefined,
  now: Date = new Date(),
): ReportRange {
  const tz = validTimeZone(timeZone);
  const today = localDate(now, tz);
  const make = (key: RangeKey, fromDay: string, toDay: string, label: string, corrected?: string): ReportRange => {
    const end = toDay >= today ? now : startOfLocalDay(addDays(toDay, 1), tz);
    return { key, from: startOfLocalDay(fromDay, tz), to: end, fromDay, toDay: toDay >= today ? today : toDay, timeZone: tz, label, corrected };
  };

  switch (input.range) {
    case "today":
      return make("today", today, today, "Today");
    case "30d":
      return make("30d", addDays(today, -29), today, "Last 30 days");
    case "custom": {
      const from = input.from ?? "";
      const to = input.to ?? "";
      if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
        return make("7d", addDays(today, -6), today, "Last 7 days", "Choose both dates to use a custom range.");
      }
      if (from > to) return make("7d", addDays(today, -6), today, "Last 7 days", "The start date must be on or before the end date.");
      if (from > today) return make("7d", addDays(today, -6), today, "Last 7 days", "The range can't start in the future.");
      const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
      if (days > MAX_DAYS) return make("7d", addDays(today, -6), today, "Last 7 days", "Choose a range of a year or less.");
      return make("custom", from, to > today ? today : to, `${from} to ${to > today ? today : to}`);
    }
    default:
      return make("7d", addDays(today, -6), today, "Last 7 days");
  }
}

/** An instant some days before now, as an ISO string (for "last N days" reads). */
export function daysAgoIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}
