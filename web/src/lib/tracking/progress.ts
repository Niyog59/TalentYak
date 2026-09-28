import { addDays, isDateOnly, mondayOf, type WeekDay } from "@/lib/programmes/content";
import { convertLength, convertWeight, roundTo, type LengthUnit, type WeightUnit } from "@/lib/tracking/units";
import { identityOf, seriesKey, type LoadBasis, type LoadKind, type WorkoutDoc, type WorkoutStatus } from "@/lib/tracking/workout";

/*
 * Progress, computed only from what was recorded.
 *
 * A missing reading is missing — never zero, never interpolated into a value
 * that was not entered. Only records that mean the same thing share a line.
 * Nothing here estimates body fat, calories or anything else not typed in.
 */

// ---------------------------------------------------------------------------
// Date ranges
// ---------------------------------------------------------------------------

export const RANGES = [
  { id: "4w", label: "4 weeks", days: 28 },
  { id: "12w", label: "12 weeks", days: 84 },
  { id: "6m", label: "6 months", days: 182 },
  { id: "1y", label: "1 year", days: 365 },
  { id: "all", label: "All time", days: 730 },
] as const;

export interface DateRange {
  id: string;
  from: string;
  to: string;
  label: string;
}

export function resolveRange(params: { range?: string; from?: string; to?: string }, today: string): DateRange {
  if (isDateOnly(params.from) && isDateOnly(params.to) && params.from <= params.to) {
    const to = params.to > today ? today : params.to;
    return { id: "custom", from: params.from, to, label: "Chosen dates" };
  }
  const r = RANGES.find((x) => x.id === params.range) ?? RANGES[1];
  return { id: r.id, from: addDays(today, -(r.days - 1)), to: today, label: r.label };
}

// ---------------------------------------------------------------------------
// Consistency
// ---------------------------------------------------------------------------

export interface ConsistencyLog {
  id: string;
  sessionKey: string | null;
  performedOn: string;
  status: WorkoutStatus;
}

export type PlannedOutcome = "completed" | "partial" | "skipped" | "unlogged" | "upcoming";

export interface PlannedSessionResult {
  weekStart: string;
  sessionKey: string;
  /** The plan version that placed it, to start a record against. */
  versionId: string;
  title: string;
  /** The day it sat on in the client's week, after any move. */
  plannedOn: string;
  outcome: PlannedOutcome;
  workoutId: string | null;
}

export interface ConsistencySummary {
  planned: PlannedSessionResult[];
  counts: Record<Exclude<PlannedOutcome, "upcoming">, number>;
  /** Planned sessions whose day has come (or that were logged early). */
  due: number;
  /** completed / due, or null when nothing was due. */
  rate: number | null;
  unplannedWorkouts: number;
  /** Weeks in the range with no weekly plan in force. */
  weeksWithoutPlan: number;
}

const RANK: Record<WorkoutStatus, number> = { completed: 4, partial: 3, in_progress: 2, skipped: 1 };

/**
 * How many planned sessions were done, from the client's own schedule.
 *
 *   · A planned session is one the week layout places on a day — after the
 *     client's moves, and following the version in force that day. Rest days
 *     are simply days with nothing placed.
 *   · Its outcome is the best record of that session anywhere in the same
 *     week, so a session done a day late still counts as done.
 *   · A session whose day has not ended yet is "upcoming" and not counted,
 *     unless it has already been recorded.
 *   · An unfinished record counts as partly done. Unplanned workouts are
 *     listed but never raise the rate.
 */
export function consistency(args: {
  from: string;
  to: string;
  today: string;
  weeks: WeekDay[][];
  logs: ConsistencyLog[];
  titleOf: (sessionKey: string) => string;
}): ConsistencySummary {
  const inRange = (d: string) => d >= args.from && d <= args.to;
  const planned: PlannedSessionResult[] = [];
  let weeksWithoutPlan = 0;

  for (const week of args.weeks) {
    if (!week.length) continue;
    const weekStart = week[0].date;
    const weekEnd = addDays(weekStart, 6);
    if (week.every((d) => d.versionId === null)) {
      weeksWithoutPlan++;
      continue;
    }
    const seen = new Set<string>();
    for (const day of week) {
      if (!inRange(day.date)) continue;
      for (const placed of day.sessions) {
        const key = placed.session.key;
        if (seen.has(key)) continue;
        seen.add(key);
        const logs = args.logs.filter((l) => l.sessionKey === key && l.performedOn >= weekStart && l.performedOn <= weekEnd);
        const best = logs.sort((a, b) => RANK[b.status] - RANK[a.status])[0] ?? null;
        let outcome: PlannedOutcome;
        if (best) outcome = best.status === "in_progress" ? "partial" : best.status;
        else outcome = day.date < args.today ? "unlogged" : "upcoming";
        planned.push({ weekStart, sessionKey: key, versionId: placed.versionId, title: placed.session.title || args.titleOf(key), plannedOn: day.date, outcome, workoutId: best?.id ?? null });
      }
    }
  }

  const counts = { completed: 0, partial: 0, skipped: 0, unlogged: 0 };
  for (const p of planned) if (p.outcome !== "upcoming") counts[p.outcome]++;
  const due = counts.completed + counts.partial + counts.skipped + counts.unlogged;
  return {
    planned,
    counts,
    due,
    rate: due ? counts.completed / due : null,
    unplannedWorkouts: args.logs.filter((l) => l.sessionKey === null && inRange(l.performedOn)).length,
    weeksWithoutPlan,
  };
}

/** Mondays from the week containing `from` to the week containing `to`. */
export function weekStarts(from: string, to: string): string[] {
  const out: string[] = [];
  for (let w = mondayOf(from); w <= to; w = addDays(w, 7)) out.push(w);
  return out;
}

// ---------------------------------------------------------------------------
// Exercise performance
// ---------------------------------------------------------------------------

export type Metric = "load" | "assistance" | "reps" | "seconds";

export const METRIC_LABEL: Record<Metric, string> = {
  load: "Heaviest set",
  assistance: "Least assistance (lower means more of your own weight)",
  reps: "Most reps in one set",
  seconds: "Longest set",
};

export interface PerfPoint {
  date: string;
  workoutId: string;
  value: number;
  detail: string;
}

export interface PerfSeries {
  key: string;
  identity: string;
  name: string;
  loadKind: LoadKind;
  loadBasis: LoadBasis | null;
  metric: Metric;
  unit: string;
  points: PerfPoint[];
}

/**
 * One line per exercise AND load meaning. A goblet squat never joins a back
 * squat; a dumbbell press recorded per hand never joins one recorded as a
 * combined total; kg and lb are converted to the client's unit, never mixed.
 */
export function performanceSeries(workouts: WorkoutDoc[], nameOf: (identity: string, fallback: string | null) => string, unit: WeightUnit): PerfSeries[] {
  const groups = new Map<string, { entries: { date: string; workoutId: string; e: WorkoutDoc["exercises"][number] }[] }>();
  for (const w of workouts) {
    for (const e of w.exercises) {
      if (e.status === "skipped" || !e.sets.length) continue;
      const k = seriesKey(e);
      const g = groups.get(k) ?? { entries: [] };
      g.entries.push({ date: w.performedOn, workoutId: w.id, e });
      groups.set(k, g);
    }
  }

  const out: PerfSeries[] = [];
  for (const [key, g] of groups) {
    const first = g.entries[0].e;
    const allSets = g.entries.flatMap((x) => x.e.sets);
    const hasLoad = allSets.some((s) => s.loadValue !== null && s.loadUnit !== null);
    const hasReps = allSets.some((s) => s.reps !== null);
    const metric: Metric =
      (first.loadKind === "weight" && hasLoad) ? "load"
      : (first.loadKind === "assisted" && hasLoad) ? "assistance"
      : hasReps ? "reps" : "seconds";

    const points: PerfPoint[] = [];
    for (const { date, workoutId, e } of g.entries.sort((a, b) => a.date.localeCompare(b.date))) {
      let best: { value: number; detail: string } | null = null;
      for (const s of e.sets) {
        let value: number | null = null;
        let detail = "";
        if (metric === "load" || metric === "assistance") {
          if (s.loadValue === null || !s.loadUnit) continue;
          value = roundTo(convertWeight(s.loadValue, s.loadUnit, unit), 1);
          detail = s.reps !== null ? `× ${s.reps}` : s.seconds !== null ? `× ${s.seconds} s` : "";
          if (best && (metric === "load" ? value <= best.value : value >= best.value)) continue;
        } else if (metric === "reps") {
          if (s.reps === null) continue;
          value = s.reps;
          detail = s.loadValue !== null && s.loadUnit ? `+ ${roundTo(convertWeight(s.loadValue, s.loadUnit, unit), 1)} ${unit}` : "";
          if (best && value <= best.value) continue;
        } else {
          if (s.seconds === null) continue;
          value = s.seconds;
          if (best && value <= best.value) continue;
        }
        best = { value, detail };
      }
      if (best) points.push({ date, workoutId, ...best });
    }
    if (!points.length) continue;
    const identity = identityOf(first);
    out.push({
      key,
      identity,
      name: nameOf(identity, first.performedName),
      loadKind: first.loadKind,
      loadBasis: first.loadBasis,
      metric,
      unit: metric === "load" || metric === "assistance" ? unit : metric === "reps" ? "reps" : "s",
      points,
    });
  }
  return out.sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Body weight and measurements
// ---------------------------------------------------------------------------

export interface WeightRow {
  logged_on: string;
  weight_kg: number | string;
  entered_value: number | string | null;
  entered_unit: WeightUnit | null;
}

/** Readings in the client's unit — exactly as typed when the unit matches. */
export function weightPoints(rows: WeightRow[], unit: WeightUnit): { date: string; value: number }[] {
  return rows
    .map((r) => {
      const value =
        r.entered_unit === unit && r.entered_value !== null
          ? Number(r.entered_value)
          : roundTo(convertWeight(Number(r.weight_kg), "kg", unit), 1);
      return { date: r.logged_on, value };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export const MEASUREMENT_FIELDS = [
  { id: "waist_cm", label: "Waist" },
  { id: "hip_cm", label: "Hips" },
  { id: "chest_cm", label: "Chest" },
  { id: "arm_cm", label: "Arm" },
] as const;
export type MeasurementField = (typeof MEASUREMENT_FIELDS)[number]["id"];

export type MeasurementRow = { logged_on: string } & Partial<Record<MeasurementField, number | string | null>>;

export interface MeasurementChange {
  field: MeasurementField;
  label: string;
  readings: number;
  first: { date: string; value: number } | null;
  latest: { date: string; value: number } | null;
  change: number | null;
}

/** First and latest reading of each measurement, each on the dates it was actually taken. */
export function measurementChanges(rows: MeasurementRow[], unit: LengthUnit): MeasurementChange[] {
  const sorted = [...rows].sort((a, b) => a.logged_on.localeCompare(b.logged_on));
  return MEASUREMENT_FIELDS.map(({ id, label }) => {
    const readings = sorted
      .filter((r) => r[id] !== null && r[id] !== undefined)
      .map((r) => ({ date: r.logged_on, value: roundTo(convertLength(Number(r[id]), "cm", unit), 1) }));
    const first = readings[0] ?? null;
    const latest = readings[readings.length - 1] ?? null;
    return {
      field: id,
      label,
      readings: readings.length,
      first,
      latest,
      change: first && latest && readings.length > 1 ? roundTo(latest.value - first.value, 1) : null,
    };
  });
}

/**
 * A timestamp as whole microseconds since 1970 — the form body_entry_token()
 * builds in the database — from the ISO text the API returns. "-" for none.
 * Exact: the fraction is read as digits, never through a float.
 */
export function epochMicros(iso: string | null | undefined): string {
  if (!iso || iso === "-") return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(iso.trim());
  if (!m) return "-";
  const [, y, mo, d, h, mi, sec, frac = "", zone = "Z"] = m;
  let offsetMinutes = 0;
  if (zone !== "Z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || "0"));
  }
  const seconds = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec)) / 1000 - offsetMinutes * 60;
  return (BigInt(seconds) * BigInt(1_000_000) + BigInt(frac.padEnd(6, "0") || "0")).toString();
}
