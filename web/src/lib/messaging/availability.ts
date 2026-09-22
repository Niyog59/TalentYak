/**
 * Parsing a coach's working hours and away date from the settings form.
 * Pure and unit-tested; the database re-checks the shape and lengths.
 */

import type { WorkingHours } from "@/lib/messaging/types";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Reads day-N / start-N / end-N fields. An end before its start is refused. */
export function parseWorkingHours(get: (name: string) => string): { hours: WorkingHours[]; error: string | null } {
  const hours: WorkingHours[] = [];
  for (let day = 0; day < 7; day++) {
    if (get(`day-${day}`) !== "on") continue;
    const start = get(`start-${day}`);
    const end = get(`end-${day}`);
    if (!TIME.test(start) || !TIME.test(end)) return { hours: [], error: "Enter a start and end time for each working day." };
    if (end <= start) return { hours: [], error: "Each day's end time must be after its start time." };
    hours.push({ day, start, end });
  }
  return { hours, error: null };
}

/**
 * The instant a calendar date ENDS in a timezone — "away until 3 October"
 * means back at the start of the 4th, the coach's own time.
 */
export function endOfDayInZone(date: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  // Midnight starting the next day, first guessed as UTC, then corrected by
  // the zone's offset at that moment (twice, to settle across a DST change).
  let guess = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(guess));
    const v = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const shown = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
    guess += Date.UTC(y, m - 1, d + 1, 0, 0, 0) - shown;
  }
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result;
}
