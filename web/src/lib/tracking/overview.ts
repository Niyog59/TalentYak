import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  addDays,
  layOutWeek,
  startOfLocalDay,
  versionInForce,
  type SessionMove,
  type WorkoutContent,
} from "@/lib/programmes/content";
import type { ClientPlan, PlanVersion } from "@/lib/programmes/server";
import {
  consistency,
  measurementChanges,
  performanceSeries,
  weekStarts,
  weightPoints,
  type ConsistencySummary,
  type DateRange,
  type MeasurementChange,
  type MeasurementRow,
  type PerfSeries,
  type WeightRow,
} from "@/lib/tracking/progress";
import { bodyEntries, exerciseNames, workoutsBetween, type StoredWorkout } from "@/lib/tracking/server";
import type { LengthUnit, WeightUnit } from "@/lib/tracking/units";

/*
 * Everything the progress pages show, for one relationship and date range,
 * read through the viewer's own session. The client and their coach call the
 * same function; row-level security gives each what they may see, so a coach
 * with a limited view of earlier history simply gets fewer records.
 */

export type LabelledWorkout = StoredWorkout & { label: string };

export interface Overview {
  workouts: LabelledWorkout[];
  consistency: ConsistencySummary;
  /** The plan in force today is done in order rather than on set days. */
  inOrder: boolean;
  hasPlan: boolean;
  weights: { date: string; value: number }[];
  measurements: MeasurementChange[];
  measurementRows: MeasurementRow[];
  series: PerfSeries[];
}

export function allWorkoutVersions(plans: ClientPlan[]): PlanVersion[] {
  return plans.filter((p) => p.kind === "workout").flatMap((p) => p.versions).filter((v) => v.published_at);
}

export async function buildOverview(args: {
  enrollmentId: string;
  plans: ClientPlan[];
  range: DateRange;
  today: string;
  timeZone: string | null;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
}): Promise<Overview> {
  const { range, today, timeZone: tz } = args;
  const versions = allWorkoutVersions(args.plans);
  const byId = new Map(versions.map((v) => [v.id, v]));
  const now = new Date();
  const asWorkout = (v: PlanVersion | null | undefined) => (v ? { id: v.id, content: v.content as WorkoutContent } : null);

  const weeks = weekStarts(range.from, range.to);
  const supabase = await createClient();
  const planIds = args.plans.filter((p) => p.kind === "workout").map((p) => p.id);
  const [workouts, body, moves] = await Promise.all([
    workoutsBetween(args.enrollmentId, addDays(weeks[0] ?? range.from, 0), addDays(weeks.at(-1) ?? range.to, 6)),
    bodyEntries(args.enrollmentId, range.from, range.to),
    planIds.length && supabase
      ? supabase.from("plan_session_moves").select("session_key, week_start, to_day, created_at").in("plan_id", planIds)
          .gte("week_start", weeks[0] ?? range.from).lte("week_start", weeks.at(-1) ?? range.to)
      : Promise.resolve({ data: [] }),
  ]);

  const started = workouts
    .filter((w) => w.doc.planVersionId && w.doc.sessionKey)
    .map((w) => ({ performed_on: w.doc.performedOn, session_key: w.doc.sessionKey!, version_id: w.doc.planVersionId! }));

  const layouts = weeks.map((weekStart) =>
    layOutWeek({
      weekStart,
      versionForDay: (date) => asWorkout(versionInForce(versions, date === today ? now : startOfLocalDay(date, tz))),
      versionById: (id) => asWorkout(byId.get(id)),
      moves: (moves.data ?? []) as SessionMove[],
      started,
    }),
  );

  const titleOf = (key: string) => {
    for (const v of versions) {
      const s = (v.content as WorkoutContent).sessions.find((x) => x.key === key);
      if (s) return s.title;
    }
    return "Session";
  };

  const inRange = workouts.filter((w) => w.doc.performedOn >= range.from && w.doc.performedOn <= range.to);
  const summary = consistency({
    from: range.from,
    to: range.to,
    today,
    weeks: layouts,
    logs: workouts.map((w) => ({ id: w.doc.id, sessionKey: w.doc.sessionKey, performedOn: w.doc.performedOn, status: w.doc.status })),
    titleOf,
  });

  const current = versionInForce(versions, now);
  const names = exerciseNames(args.plans);
  const series = performanceSeries(
    [...inRange].reverse().map((w) => w.doc),
    (identity, fallback) => names.get(identity) ?? fallback ?? "Exercise",
    args.weightUnit,
  );

  const weightRows = body.filter((d) => d.weight).map((d) => d.weight as WeightRow);
  const measurementRows = body.filter((d) => d.measurements).map((d) => d.measurements as MeasurementRow);

  return {
    workouts: inRange.map((w) => ({ ...w, label: w.doc.title ?? (w.doc.sessionKey ? titleOf(w.doc.sessionKey) : "Workout") })),
    consistency: summary,
    inOrder: (current?.content as WorkoutContent | undefined)?.schedule === "in_order",
    hasPlan: versions.length > 0,
    weights: weightPoints(weightRows, args.weightUnit),
    measurements: measurementChanges(measurementRows, args.lengthUnit),
    measurementRows,
    series,
  };
}
