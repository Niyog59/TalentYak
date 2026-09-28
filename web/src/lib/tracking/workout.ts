import { cleanText } from "@/lib/expectations/text";
import { isDateOnly, isKey, prescription, seconds as secondsText, type ExerciseCore, type Session } from "@/lib/programmes/content";
import { convertWeight, trimNumber, type WeightUnit } from "@/lib/tracking/units";

/*
 * What a client did in one workout, as the device holds it and the server
 * stores it.
 *
 * PRESCRIBED AND ACTUAL NEVER MIX. The coach's targets come from the plan
 * version and are only ever displayed. A set exists in this document only once
 * the client has confirmed it ("Complete set"); typed-but-unconfirmed values
 * live in the device's draft and are never sent.
 *
 * WHAT A LOAD MEANS travels with every exercise entry: a plain weight, the
 * client's bodyweight (with any added weight), an assisted movement (the
 * number is the assistance), or no load; and for dumbbells, whether the number
 * is per hand or both together. Comparisons only ever put like beside like.
 *
 * Ids are chosen on the device, so saving the same document twice updates the
 * same rows rather than adding new ones.
 */

export type LoadKind = "weight" | "bodyweight" | "assisted" | "none";
export type LoadBasis = "total" | "per_hand";
export type WorkoutStatus = "in_progress" | "completed" | "partial" | "skipped";

export const LOAD_KIND_LABEL: Record<LoadKind, string> = {
  weight: "Weight",
  bodyweight: "Bodyweight",
  assisted: "Assisted",
  none: "No load",
};

export const STATUS_LABEL: Record<WorkoutStatus | "unlogged", string> = {
  in_progress: "Not finished",
  completed: "Completed",
  partial: "Partly done",
  skipped: "Skipped",
  unlogged: "Not logged",
};

export const LIMITS = {
  exercises: 40,
  sets: 400,
  setsPerExercise: 30,
  name: 80,
  title: 80,
  notes: 1000,
  sessionNotes: 2000,
} as const;

export interface SetEntry {
  id: string;
  /** 1-based, in the order done. */
  setIndex: number;
  loadValue: number | null;
  loadUnit: WeightUnit | null;
  reps: number | null;
  seconds: number | null;
  rpe: number | null;
  /** Beyond the number of sets the coach prescribed. */
  extra: boolean;
}

export interface ExerciseEntry {
  id: string;
  position: number;
  /** The planned exercise this entry fills. Null for an added exercise. */
  exerciseKey: string | null;
  /** The coach's alternative done instead. */
  alternativeKey: string | null;
  /** The client's own substitute, or an added exercise's name. */
  performedName: string | null;
  status: "active" | "skipped";
  loadKind: LoadKind;
  loadBasis: LoadBasis | null;
  notes: string;
  sets: SetEntry[];
}

export interface WorkoutDoc {
  id: string;
  enrollmentId: string;
  planVersionId: string | null;
  sessionKey: string | null;
  /** The client's own calendar day, YYYY-MM-DD. */
  performedOn: string;
  /** Unplanned workouts only. */
  title: string | null;
  status: WorkoutStatus;
  notes: string;
  exercises: ExerciseEntry[];
}

// ---------------------------------------------------------------------------
// Wire format — what save_workout_log() takes
// ---------------------------------------------------------------------------

export function toWire(doc: WorkoutDoc) {
  return {
    id: doc.id,
    enrollment_id: doc.enrollmentId,
    plan_version_id: doc.planVersionId,
    session_key: doc.sessionKey,
    performed_on: doc.performedOn,
    title: doc.title,
    status: doc.status,
    notes: doc.notes,
    exercises: doc.exercises.map((e) => ({
      id: e.id,
      position: e.position,
      exercise_key: e.exerciseKey,
      alternative_key: e.alternativeKey,
      performed_name: e.performedName,
      status: e.status,
      load_kind: e.loadKind,
      load_basis: e.loadBasis,
      notes: e.notes,
    })),
    sets: doc.exercises.flatMap((e) =>
      e.sets.map((s) => ({
        id: s.id,
        exercise_log_id: e.id,
        set_index: s.setIndex,
        load_value: s.loadValue,
        load_unit: s.loadValue === null ? null : s.loadUnit,
        reps: s.reps,
        duration_seconds: s.seconds,
        rpe: s.rpe,
        extra: s.extra,
      })),
    ),
  };
}

export interface WorkoutRow {
  id: string;
  enrollment_id: string;
  plan_version_id: string | null;
  session_key: string | null;
  performed_at: string;
  title: string | null;
  status: WorkoutStatus;
  notes: string | null;
  revision: number;
  updated_at: string;
  finished_at: string | null;
  started_at: string | null;
}

export interface ExerciseRow {
  id: string;
  workout_log_id: string;
  position: number;
  exercise_key: string | null;
  alternative_key: string | null;
  performed_name: string | null;
  status: "active" | "skipped";
  load_kind: LoadKind;
  load_basis: LoadBasis | null;
  notes: string | null;
}

export interface SetRow {
  id: string;
  workout_log_id: string;
  exercise_log_id: string | null;
  set_index: number;
  load_value: number | string | null;
  load_unit: WeightUnit | null;
  reps: number | null;
  duration_seconds: number | null;
  rpe: number | string | null;
  extra: boolean;
}

const n = (v: number | string | null): number | null => (v === null || v === undefined ? null : Number(v));

export function fromRows(w: WorkoutRow, exercises: ExerciseRow[], sets: SetRow[]): WorkoutDoc {
  return {
    id: w.id,
    enrollmentId: w.enrollment_id,
    planVersionId: w.plan_version_id,
    sessionKey: w.session_key,
    performedOn: w.performed_at,
    title: w.title,
    status: w.status,
    notes: w.notes ?? "",
    exercises: exercises
      .filter((e) => e.workout_log_id === w.id)
      .sort((a, b) => a.position - b.position)
      .map((e) => ({
        id: e.id,
        position: e.position,
        exerciseKey: e.exercise_key,
        alternativeKey: e.alternative_key,
        performedName: e.performed_name,
        status: e.status,
        loadKind: e.load_kind,
        loadBasis: e.load_basis,
        notes: e.notes ?? "",
        sets: sets
          .filter((s) => s.exercise_log_id === e.id)
          .sort((a, b) => a.set_index - b.set_index)
          .map((s) => ({
            id: s.id,
            setIndex: s.set_index,
            loadValue: n(s.load_value),
            loadUnit: s.load_unit,
            reps: s.reps,
            seconds: s.duration_seconds,
            rpe: n(s.rpe),
            extra: s.extra,
          })),
      })),
  };
}

// ---------------------------------------------------------------------------
// Cleaning — the server's check before anything reaches the database
// ---------------------------------------------------------------------------

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function inRange(v: unknown, min: number, max: number, dp: number): number | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(x) || x < min || x > max) return undefined;
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

export function normalizeWorkoutDoc(input: unknown): { doc: WorkoutDoc | null; problems: string[] } {
  const problems: string[] = [];
  const add = (p: string) => {
    if (!problems.includes(p) && problems.length < 8) problems.push(p);
  };
  const c = obj(input);
  const ids = new Set<string>();
  const id = (v: unknown, label: string): string => {
    if (!isKey(v)) {
      add(`${label} is missing its identifier.`);
      return "";
    }
    const k = v.toLowerCase();
    if (ids.has(k)) add(`${label} appears twice.`);
    ids.add(k);
    return k;
  };

  const status = c.status;
  if (status !== "in_progress" && status !== "completed" && status !== "partial" && status !== "skipped") add("The workout's status is missing.");
  if (!isDateOnly(c.performedOn)) add("Choose the date you trained.");
  const planVersionId = isKey(c.planVersionId) ? c.planVersionId.toLowerCase() : null;
  const sessionKey = isKey(c.sessionKey) ? c.sessionKey.toLowerCase() : null;
  if ((planVersionId === null) !== (sessionKey === null)) add("This workout's plan reference is incomplete. Reload the page.");
  const title = cleanText(c.title, LIMITS.title) || null;
  if (!planVersionId && !title) add("Give this workout a name.");
  if (!isKey(c.enrollmentId)) add("This workout isn't linked to your coaching. Reload the page.");

  const exercisesIn = arr(c.exercises);
  if (exercisesIn.length > LIMITS.exercises) add(`${LIMITS.exercises} exercises at most.`);
  let setCount = 0;
  const exercises: ExerciseEntry[] = exercisesIn.slice(0, LIMITS.exercises).map((ev, i) => {
    const e = obj(ev);
    const label = `Exercise ${i + 1}`;
    const exerciseKey = isKey(e.exerciseKey) ? e.exerciseKey.toLowerCase() : null;
    const alternativeKey = exerciseKey && isKey(e.alternativeKey) ? e.alternativeKey.toLowerCase() : null;
    const performedName = alternativeKey ? null : cleanText(e.performedName, LIMITS.name) || null;
    if (!exerciseKey && !performedName) add(`${label} needs a name.`);
    if (exerciseKey && !planVersionId) add(`${label} refers to a plan this workout doesn't follow.`);
    const loadKind: LoadKind = e.loadKind === "bodyweight" || e.loadKind === "assisted" || e.loadKind === "none" ? e.loadKind : "weight";
    const loadBasis: LoadBasis | null = e.loadBasis === "per_hand" || e.loadBasis === "total" ? e.loadBasis : null;
    const setsIn = arr(e.sets);
    if (setsIn.length > LIMITS.setsPerExercise) add(`${label}: ${LIMITS.setsPerExercise} sets at most.`);
    setCount += setsIn.length;
    const sets: SetEntry[] = setsIn.slice(0, LIMITS.setsPerExercise).map((sv, si) => {
      const s = obj(sv);
      const slabel = `${label}, set ${si + 1}`;
      const loadValue = inRange(s.loadValue, 0, 1000, 2);
      const reps = inRange(s.reps, 0, 1000, 0);
      const secs = inRange(s.seconds, 1, 36000, 0);
      const rpe = inRange(s.rpe, 1, 10, 1);
      if (loadValue === undefined) add(`${slabel}: the weight must be between 0 and 1000.`);
      if (reps === undefined) add(`${slabel}: reps must be a whole number.`);
      if (secs === undefined) add(`${slabel}: time must be between 1 second and 10 hours.`);
      if (rpe === undefined) add(`${slabel}: effort must be between 1 and 10.`);
      if ((reps ?? null) === null && (secs ?? null) === null && loadKind !== "none" && (loadValue ?? null) === null) {
        add(`${slabel} has nothing recorded.`);
      }
      return {
        id: id(s.id, slabel),
        setIndex: si + 1,
        loadValue: loadValue ?? null,
        loadUnit: (loadValue ?? null) === null ? null : s.loadUnit === "lb" ? "lb" : "kg",
        reps: reps ?? null,
        seconds: secs ?? null,
        rpe: rpe ?? null,
        extra: s.extra === true,
      };
    });
    return {
      id: id(e.id, label),
      position: i,
      exerciseKey,
      alternativeKey,
      performedName,
      status: e.status === "skipped" ? "skipped" : "active",
      loadKind,
      loadBasis,
      notes: cleanText(e.notes, LIMITS.notes),
      sets,
    };
  });
  if (setCount > LIMITS.sets) add(`${LIMITS.sets} sets at most.`);

  const doc: WorkoutDoc = {
    id: id(c.id, "The workout"),
    enrollmentId: isKey(c.enrollmentId) ? c.enrollmentId.toLowerCase() : "",
    planVersionId,
    sessionKey,
    performedOn: isDateOnly(c.performedOn) ? c.performedOn : "",
    title: planVersionId ? null : title,
    status: (status as WorkoutStatus) ?? "in_progress",
    notes: cleanText(c.notes, LIMITS.sessionNotes),
    exercises,
  };
  return { doc: problems.length ? null : doc, problems };
}

// ---------------------------------------------------------------------------
// Starting a workout from the plan
// ---------------------------------------------------------------------------

/** A reasonable first guess at what a planned exercise's load means. The client can change it. */
export function defaultLoadKind(e: ExerciseCore): LoadKind {
  if (e.load) return "weight";
  const note = e.loadNote.toLowerCase();
  if (/assist/.test(note)) return "assisted";
  if (/body ?weight/.test(note)) return "bodyweight";
  if (e.target.type === "duration" && !note) return "none";
  return "weight";
}

export function defaultLoadBasis(e: ExerciseCore): LoadBasis | null {
  return /dumbbell|db\b|kettlebell/i.test(`${e.name} ${e.loadNote}`) ? "per_hand" : null;
}

export function newPlannedDoc(args: {
  id: string;
  enrollmentId: string;
  planVersionId: string;
  session: Session;
  performedOn: string;
  newId: () => string;
}): WorkoutDoc {
  return {
    id: args.id,
    enrollmentId: args.enrollmentId,
    planVersionId: args.planVersionId,
    sessionKey: args.session.key,
    performedOn: args.performedOn,
    title: null,
    status: "in_progress",
    notes: "",
    exercises: args.session.exercises.map((e, i) => ({
      id: args.newId(),
      position: i,
      exerciseKey: e.key,
      alternativeKey: null,
      performedName: null,
      status: "active",
      loadKind: defaultLoadKind(e),
      loadBasis: defaultLoadBasis(e),
      notes: "",
      sets: [],
    })),
  };
}

export function newUnplannedDoc(args: { id: string; enrollmentId: string; performedOn: string; title: string }): WorkoutDoc {
  return {
    id: args.id,
    enrollmentId: args.enrollmentId,
    planVersionId: null,
    sessionKey: null,
    performedOn: args.performedOn,
    title: args.title,
    status: "in_progress",
    notes: "",
    exercises: [],
  };
}

/** The prescription an entry is measured against: the planned exercise, or the alternative chosen. */
export function prescribedFor(entry: ExerciseEntry, session: Session | null): ExerciseCore | null {
  if (!session || !entry.exerciseKey) return null;
  const planned = session.exercises.find((e) => e.key === entry.exerciseKey);
  if (!planned) return null;
  if (entry.performedName) return null; // the client's own substitute has no prescription
  if (entry.alternativeKey) return planned.alternatives.find((a) => a.key === entry.alternativeKey) ?? null;
  return planned;
}

/**
 * What the finished workout should probably be called. Only a suggestion —
 * the client chooses.
 */
export function suggestedStatus(doc: WorkoutDoc, session: Session | null): Exclude<WorkoutStatus, "in_progress"> {
  // Every planned slot, however it was filled: as written, by an alternative,
  // or by the client's own substitute.
  const planned = doc.exercises.filter((e) => Boolean(e.exerciseKey));
  const anySets = doc.exercises.some((e) => e.sets.length > 0);
  if (!anySets) return "skipped";
  if (!session) return "completed";
  const allDone = planned.length > 0 && planned.every((e) => {
    if (e.status === "skipped") return false;
    const p = prescribedFor(e, session);
    const target = p?.sets ?? 1;
    return e.sets.filter((s) => !s.extra).length >= target;
  });
  return allDone ? "completed" : "partial";
}

// ---------------------------------------------------------------------------
// Identity — which records may be compared with which
// ---------------------------------------------------------------------------

/**
 * Two entries are the same exercise when they share this identity: the same
 * planned key, the same alternative key, or — for anything the plan never
 * named — the same name typed by the client.
 */
export function identityOf(e: Pick<ExerciseEntry, "exerciseKey" | "alternativeKey" | "performedName">): string {
  if (e.alternativeKey) return `alt:${e.alternativeKey}`;
  if (e.performedName) return `name:${e.performedName.trim().toLowerCase().replace(/\s+/g, " ")}`;
  return `key:${e.exerciseKey}`;
}

/** Identity plus what the load means: only records sharing this are ever put on one line. */
export function seriesKey(e: Pick<ExerciseEntry, "exerciseKey" | "alternativeKey" | "performedName" | "loadKind" | "loadBasis">): string {
  return `${identityOf(e)}|${e.loadKind}|${e.loadBasis ?? "-"}`;
}

// ---------------------------------------------------------------------------
// Describing what was done
// ---------------------------------------------------------------------------

export function loadText(kind: LoadKind, basis: LoadBasis | null, value: number | null, unit: WeightUnit | null, show?: WeightUnit): string {
  const amount = value !== null && unit ? `${trimNumber(show ? convertWeight(value, unit, show) : value, show && show !== unit ? 1 : 2)} ${show ?? unit}` : "";
  const hand = basis === "per_hand" ? " per hand" : basis === "total" ? " total" : "";
  switch (kind) {
    case "bodyweight":
      return amount && value ? `bodyweight + ${amount}${hand}` : "bodyweight";
    case "assisted":
      return amount ? `assisted, ${amount} assistance` : "assisted";
    case "none":
      return "";
    default:
      return amount ? `${amount}${hand}` : "";
  }
}

/** "20 kg per hand × 10", "bodyweight × 12", "45 s". */
export function setText(entry: Pick<ExerciseEntry, "loadKind" | "loadBasis">, s: SetEntry, show?: WeightUnit): string {
  const load = loadText(entry.loadKind, entry.loadBasis, s.loadValue, s.loadUnit, show);
  const amount = s.reps !== null ? `${s.reps} rep${s.reps === 1 ? "" : "s"}` : s.seconds !== null ? secondsText(s.seconds) : "";
  const effort = s.rpe !== null ? ` · effort ${s.rpe}/10` : "";
  return [load, amount].filter(Boolean).join(" × ") + effort;
}

export function targetText(p: ExerciseCore): string {
  const bits = [prescription(p)];
  if (p.load) bits.push(`${p.load.amount} ${p.load.unit}`);
  if (p.loadNote) bits.push(p.loadNote);
  if (p.effort) bits.push(p.effort);
  if (p.restSeconds) bits.push(`rest ${secondsText(p.restSeconds)}`);
  return bits.filter(Boolean).join(" · ");
}

export function entryName(e: ExerciseEntry, session: Session | null): { name: string; insteadOf: string | null } {
  const planned = session?.exercises.find((x) => x.key === e.exerciseKey) ?? null;
  if (e.performedName) return { name: e.performedName, insteadOf: planned?.name ?? null };
  if (e.alternativeKey) {
    const alt = planned?.alternatives.find((a) => a.key === e.alternativeKey);
    return { name: alt?.name ?? "Alternative", insteadOf: planned?.name ?? null };
  }
  return { name: planned?.name ?? "Exercise", insteadOf: null };
}

export function confirmedSets(doc: WorkoutDoc): number {
  return doc.exercises.reduce((sum, e) => sum + e.sets.length, 0);
}
