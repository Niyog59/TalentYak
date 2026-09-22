/**
 * Pure helpers for showing a conversation: day grouping in the reader's own
 * timezone, the read watermark, and merging pages without duplicates.
 * Client-safe and unit-tested.
 */

import type { Message, WorkingHours } from "@/lib/messaging/types";

/** The calendar day a moment falls on, in a timezone, as YYYY-MM-DD. */
export function dayKey(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "Today", "Yesterday", or a readable date, relative to `now`, in the timezone. */
export function dayLabel(iso: string, timeZone: string, now: Date = new Date()): string {
  const key = dayKey(iso, timeZone);
  if (key === dayKey(now.toISOString(), timeZone)) return "Today";
  if (key === dayKey(new Date(now.getTime() - 86_400_000).toISOString(), timeZone)) return "Yesterday";
  const sameYear = key.slice(0, 4) === dayKey(now.toISOString(), timeZone).slice(0, 4);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }),
  }).format(new Date(iso));
}

export function timeLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export interface DayGroup {
  key: string;
  label: string;
  messages: Message[];
}

/** Messages in sequence order, grouped by the reader's calendar day. */
export function groupByDay(messages: readonly Message[], timeZone: string, now: Date = new Date()): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const m of [...messages].sort((a, b) => a.seq - b.seq)) {
    const key = dayKey(m.created_at, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.messages.push(m);
    else groups.push({ key, label: dayLabel(m.created_at, timeZone, now), messages: [m] });
  }
  return groups;
}

/** Adds fetched messages to what is shown: one entry per sequence number, in order. */
export function mergeMessages(current: readonly Message[], incoming: readonly Message[]): Message[] {
  const bySeq = new Map<number, Message>();
  for (const m of current) bySeq.set(m.seq, m);
  for (const m of incoming) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * How far the reader has genuinely read. Starting from the stored watermark,
 * it advances one message at a time, and only across messages that were
 * actually on screen (or that the reader sent). A message scrolled past
 * without being shown, or one further up that was never loaded, stops it —
 * so opening a conversation at the bottom never marks unseen older messages
 * as read.
 */
export function advanceWatermark(
  watermark: number,
  lastSeq: number,
  seen: ReadonlySet<number>,
  mine: ReadonlySet<number>,
): number {
  let next = watermark;
  while (next < lastSeq && (seen.has(next + 1) || mine.has(next + 1))) next++;
  return next;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon–Fri 09:00–17:00, Sat 10:00–12:00" from the coach's own hours. */
export function describeWorkingHours(hours: readonly WorkingHours[]): string | null {
  const valid = hours.filter((h) => h.day >= 0 && h.day <= 6 && /^\d\d:\d\d$/.test(h.start) && /^\d\d:\d\d$/.test(h.end));
  if (!valid.length) return null;
  const byRange = new Map<string, number[]>();
  for (const h of [...valid].sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7))) {
    const range = `${h.start}–${h.end}`;
    byRange.set(range, [...(byRange.get(range) ?? []), h.day]);
  }
  const parts: string[] = [];
  for (const [range, days] of byRange) {
    const order = days.map((d) => (d + 6) % 7);
    const consecutive = order.every((d, i) => i === 0 || d === order[i - 1] + 1);
    const label = days.length > 2 && consecutive
      ? `${DAYS[days[0]]}–${DAYS[days[days.length - 1]]}`
      : days.map((d) => DAYS[d]).join(", ");
    parts.push(`${label} ${range}`);
  }
  return parts.join("; ");
}
