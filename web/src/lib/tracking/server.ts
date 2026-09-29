import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isKey, type Session, type WorkoutContent } from "@/lib/programmes/content";
import type { ClientPlan } from "@/lib/programmes/server";
import { fromRows, identityOf, type ExerciseEntry, type ExerciseRow, type SetRow, type WorkoutDoc, type WorkoutRow } from "@/lib/tracking/workout";
import type { LengthUnit, WeightUnit } from "@/lib/tracking/units";
import { epochMicros, type MeasurementRow, type WeightRow } from "@/lib/tracking/progress";

/*
 * Reads, through the signed-in person's own session. Row-level security
 * decides what comes back: the client gets their own records; the current
 * coach gets what the client's sharing choice allows, photos by the stricter
 * media rule; a former coach and an admin get nothing.
 */

/** "logging_paused": the relationship is live but TalentYak has paused logging; entries wait on the device. */
export type WriteState = "live" | "logging_paused" | "paused" | "ended" | "suspended" | "unavailable" | "not_permitted";

/** The relationship itself is live (logging may still be paused by TalentYak). */
export const relationshipLive = (s: WriteState) => s === "live" || s === "logging_paused";

/** May the signed-in client add entries on this relationship now? */
export async function trackingWriteState(enrollmentId: string): Promise<WriteState> {
  const supabase = await createClient();
  if (!supabase || !isKey(enrollmentId)) return "not_permitted";
  const { data, error } = await supabase.rpc("tracking_write_state", { p_enrollment: enrollmentId });
  if (error) return "unavailable";
  return (data as WriteState) ?? "not_permitted";
}

/**
 * For a coach: whose relationship this is, and their timezone — looked up by
 * id only after row-level security has shown the caller the relationship.
 */
export async function clientBasics(enrollmentId: string): Promise<{ customerId: string; timezone: string | null } | null> {
  const supabase = await createClient();
  if (!supabase || !isKey(enrollmentId)) return null;
  const { data: e } = await supabase.from("enrollments").select("customer_id").eq("id", enrollmentId).maybeSingle();
  if (!e) return null;
  const admin = createAdminClient();
  const { data: person } = admin ? await admin.from("profiles").select("timezone").eq("id", e.customer_id).maybeSingle() : { data: null };
  return { customerId: e.customer_id as string, timezone: (person?.timezone as string | null) ?? null };
}

export interface TrackingPreferences {
  weight_unit: WeightUnit;
  length_unit: LengthUnit;
  log_reminders: boolean;
  saved: boolean;
}

export async function trackingPreferences(customerId: string): Promise<TrackingPreferences> {
  const supabase = await createClient();
  const fallback: TrackingPreferences = { weight_unit: "kg", length_unit: "cm", log_reminders: true, saved: false };
  if (!supabase) return fallback;
  const { data } = await supabase.from("tracking_preferences").select("weight_unit, length_unit, log_reminders").eq("customer_id", customerId).maybeSingle();
  return data ? { ...(data as Omit<TrackingPreferences, "saved">), saved: true } : fallback;
}

export interface TrackingFocus {
  fields: string[];
  note: string | null;
  updated_at: string;
}

/** What the coach on the open assignment finds useful to track, if they said. */
export async function trackingFocus(enrollmentId: string, assignmentId: string | null): Promise<TrackingFocus | null> {
  const supabase = await createClient();
  if (!supabase || !assignmentId) return null;
  const { data } = await supabase.from("tracking_focus").select("fields, note, updated_at").eq("enrollment_id", enrollmentId).eq("assignment_id", assignmentId).maybeSingle();
  return (data as TrackingFocus | null) ?? null;
}

export interface StoredWorkout {
  doc: WorkoutDoc;
  revision: number;
  updatedAt: string;
  finishedAt: string | null;
  startedAt: string | null;
}

const WORKOUT_COLUMNS = "id, enrollment_id, plan_version_id, session_key, performed_at, title, status, notes, revision, updated_at, finished_at, started_at";
const EXERCISE_COLUMNS = "id, workout_log_id, position, exercise_key, alternative_key, performed_name, status, load_kind, load_basis, notes";
const SET_COLUMNS = "id, workout_log_id, exercise_log_id, set_index, load_value, load_unit, reps, duration_seconds, rpe, extra";

async function assemble(rows: WorkoutRow[]): Promise<StoredWorkout[]> {
  const supabase = await createClient();
  if (!supabase || !rows.length) return [];
  const ids = rows.map((r) => r.id);
  const exercises: ExerciseRow[] = [];
  const sets: SetRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const [e, s] = await Promise.all([
      supabase.from("workout_exercise_logs").select(EXERCISE_COLUMNS).in("workout_log_id", chunk),
      supabase.from("set_logs").select(SET_COLUMNS).in("workout_log_id", chunk),
    ]);
    exercises.push(...((e.data ?? []) as ExerciseRow[]));
    sets.push(...((s.data ?? []) as SetRow[]));
  }
  return rows.map((w) => ({
    doc: fromRows(w, exercises, sets),
    revision: w.revision,
    updatedAt: w.updated_at,
    finishedAt: w.finished_at,
    startedAt: w.started_at,
  }));
}

export async function workoutById(id: string): Promise<StoredWorkout | null> {
  const supabase = await createClient();
  if (!supabase || !isKey(id)) return null;
  const { data } = await supabase.from("workout_logs").select(WORKOUT_COLUMNS).eq("id", id).not("enrollment_id", "is", null).maybeSingle();
  if (!data) return null;
  return (await assemble([data as WorkoutRow]))[0] ?? null;
}

/** A planned session's record for a day, if one exists. */
export async function workoutForSessionDay(enrollmentId: string, sessionKey: string, date: string): Promise<{ id: string } | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase.from("workout_logs").select("id").eq("enrollment_id", enrollmentId).eq("session_key", sessionKey).eq("performed_at", date).maybeSingle();
  return (data as { id: string } | null) ?? null;
}

export async function workoutsBetween(enrollmentId: string, from: string, to: string, limit = 400): Promise<StoredWorkout[]> {
  const supabase = await createClient();
  if (!supabase || !isKey(enrollmentId)) return [];
  const { data } = await supabase
    .from("workout_logs")
    .select(WORKOUT_COLUMNS)
    .eq("enrollment_id", enrollmentId)
    .gte("performed_at", from)
    .lte("performed_at", to)
    .order("performed_at", { ascending: false })
    .order("started_at", { ascending: false })
    .limit(limit);
  return assemble((data ?? []) as WorkoutRow[]);
}

export interface PreviousResult {
  workoutId: string;
  date: string;
  entry: ExerciseEntry;
}

/**
 * The most recent earlier result for every exercise identity, from the last
 * workouts before `date` (and never the workout being logged).
 */
export async function previousResults(enrollmentId: string, date: string, excludeId: string | null): Promise<Record<string, PreviousResult>> {
  const supabase = await createClient();
  if (!supabase) return {};
  let q = supabase.from("workout_logs").select(WORKOUT_COLUMNS).eq("enrollment_id", enrollmentId).lte("performed_at", date);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q.order("performed_at", { ascending: false }).order("started_at", { ascending: false }).limit(60);
  const workouts = await assemble((data ?? []) as WorkoutRow[]);
  const out: Record<string, PreviousResult> = {};
  for (const w of workouts) {
    for (const e of w.doc.exercises) {
      if (e.status === "skipped" || !e.sets.length) continue;
      const k = identityOf(e);
      if (!out[k]) out[k] = { workoutId: w.doc.id, date: w.doc.performedOn, entry: e };
    }
  }
  return out;
}

/** Every exercise and alternative name a plan has used, by identity; newest version wins. */
export function exerciseNames(plans: ClientPlan[]): Map<string, string> {
  const names = new Map<string, string>();
  const versions = plans.filter((p) => p.kind === "workout").flatMap((p) => p.versions).filter((v) => v.published_at);
  versions.sort((a, b) => a.version - b.version);
  for (const v of versions) {
    for (const s of (v.content as WorkoutContent).sessions) {
      for (const e of s.exercises) {
        names.set(`key:${e.key}`, e.name);
        for (const a of e.alternatives) names.set(`alt:${a.key}`, a.name);
      }
    }
  }
  return names;
}

export function sessionFrom(plans: ClientPlan[], versionId: string | null, sessionKey: string | null): { session: Session; version: ClientPlan["versions"][number]; plan: ClientPlan } | null {
  if (!versionId || !sessionKey) return null;
  for (const plan of plans) {
    const version = plan.versions.find((v) => v.id === versionId && v.published_at);
    if (!version || plan.kind !== "workout") continue;
    const session = (version.content as WorkoutContent).sessions.find((s) => s.key === sessionKey);
    if (session) return { session, version, plan };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

export interface BodyDay {
  date: string;
  weight: WeightRow | null;
  measurements: MeasurementRow | null;
  /** What save_body_entry() compares against to catch edits from another device. */
  token: string;
}

export async function bodyEntries(enrollmentId: string, from: string, to: string): Promise<BodyDay[]> {
  const supabase = await createClient();
  if (!supabase || !isKey(enrollmentId)) return [];
  const [{ data: weights }, { data: measures }] = await Promise.all([
    supabase.from("bodyweight_logs").select("logged_on, weight_kg, entered_value, entered_unit, updated_at").eq("enrollment_id", enrollmentId).gte("logged_on", from).lte("logged_on", to),
    supabase.from("measurements").select("logged_on, waist_cm, hip_cm, chest_cm, arm_cm, entered_unit, updated_at").eq("enrollment_id", enrollmentId).gte("logged_on", from).lte("logged_on", to),
  ]);
  const days = new Map<string, BodyDay>();
  const day = (d: string) => days.get(d) ?? { date: d, weight: null, measurements: null, token: "" };
  const stamp = new Map<string, [string, string]>();
  for (const w of (weights ?? []) as (WeightRow & { updated_at: string })[]) {
    days.set(w.logged_on, { ...day(w.logged_on), weight: w });
    stamp.set(w.logged_on, [w.updated_at, stamp.get(w.logged_on)?.[1] ?? "-"]);
  }
  for (const m of (measures ?? []) as (MeasurementRow & { updated_at: string })[]) {
    days.set(m.logged_on, { ...day(m.logged_on), measurements: m });
    stamp.set(m.logged_on, [stamp.get(m.logged_on)?.[0] ?? "-", m.updated_at]);
  }
  return [...days.values()]
    .map((d) => ({ ...d, token: "" }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d) => ({ ...d, token: tokenOf(stamp.get(d.date)) }));
}

function tokenOf(s: [string, string] | undefined): string {
  return s ? `${epochMicros(s[0])}|${epochMicros(s[1])}` : "";
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

export interface ProgressPhoto {
  id: string;
  mediaId: string;
  takenOn: string;
  pose: "front" | "side" | "back" | "other" | null;
  state: string;
}

export async function progressPhotos(enrollmentId: string): Promise<ProgressPhoto[]> {
  const supabase = await createClient();
  if (!supabase || !isKey(enrollmentId)) return [];
  const { data } = await supabase
    .from("progress_photos")
    .select("id, media_id, taken_on, pose")
    .eq("enrollment_id", enrollmentId)
    .not("media_id", "is", null)
    .order("taken_on", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as { id: string; media_id: string; taken_on: string; pose: ProgressPhoto["pose"] }[];
  if (!rows.length) return [];
  // The media row decides whether it can be shown: the file's own policy.
  const { data: media } = await supabase.from("media_assets").select("id, state, deleted_at").in("id", rows.map((r) => r.media_id));
  const state = new Map((media ?? []).map((m) => [m.id as string, m.deleted_at ? "deleted" : (m.state as string)]));
  return rows
    .filter((r) => state.has(r.media_id) && state.get(r.media_id) !== "deleted")
    .map((r) => ({ id: r.id, mediaId: r.media_id, takenOn: r.taken_on, pose: r.pose, state: state.get(r.media_id)! }));
}

// ---------------------------------------------------------------------------
// Food diary
// ---------------------------------------------------------------------------

export interface FoodEntry {
  id: string;
  eaten_on: string;
  meal: "breakfast" | "lunch" | "dinner" | "snack" | "other";
  description: string | null;
  media_id: string | null;
  mediaState: string | null;
  kcal: number | null;
  protein_g: number | null;
  revision: number;
  created_at: string;
}

export interface FoodDay {
  date: string;
  complete: boolean;
  entries: FoodEntry[];
}

export async function foodDays(enrollmentId: string, from: string, to: string): Promise<FoodDay[]> {
  const supabase = await createClient();
  if (!supabase || !isKey(enrollmentId)) return [];
  const [{ data: entries }, { data: days }] = await Promise.all([
    supabase.from("food_entries").select("id, eaten_on, meal, description, media_id, kcal, protein_g, revision, created_at")
      .eq("enrollment_id", enrollmentId).gte("eaten_on", from).lte("eaten_on", to).order("created_at", { ascending: true }),
    supabase.from("food_diary_days").select("day, complete").eq("enrollment_id", enrollmentId).gte("day", from).lte("day", to),
  ]);
  const list = (entries ?? []) as Omit<FoodEntry, "mediaState">[];
  const mediaIds = list.map((e) => e.media_id).filter((x): x is string => Boolean(x));
  const { data: media } = mediaIds.length
    ? await supabase.from("media_assets").select("id, state, deleted_at").in("id", mediaIds)
    : { data: [] };
  const state = new Map((media ?? []).map((m) => [m.id as string, m.deleted_at ? "deleted" : (m.state as string)]));

  const byDay = new Map<string, FoodDay>();
  for (const d of (days ?? []) as { day: string; complete: boolean }[]) byDay.set(d.day, { date: d.day, complete: d.complete, entries: [] });
  for (const e of list) {
    const d = byDay.get(e.eaten_on) ?? { date: e.eaten_on, complete: false, entries: [] };
    d.entries.push({
      ...e,
      kcal: e.kcal === null ? null : Number(e.kcal),
      protein_g: e.protein_g === null ? null : Number(e.protein_g),
      // Unreadable (the coach's view of a photo their scope excludes) reads as absent.
      mediaState: e.media_id ? (state.get(e.media_id) ?? "hidden") : null,
    });
    byDay.set(e.eaten_on, d);
  }
  return [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
}
