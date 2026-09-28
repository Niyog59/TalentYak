import { cleanText } from "@/lib/expectations/text";

/*
 * What a coach prescribes, as data.
 *
 * A plan version's content is one JSON document. Every session, exercise,
 * alternative, meal and food carries a `key` (a UUID) that stays the same from
 * version to version while the coach keeps it — that is what lets M12 compare
 * progress on "the same exercise" across updates, and keep an alternative's
 * results apart from the main exercise's.
 *
 * `normalize*` is used both ways. On save it returns problems in words and the
 * action refuses; on read it is the defensive parse — whatever is stored is
 * shown as plain text, and a link is only ever a link if it is http(s).
 */

export type PlanKind = "workout" | "nutrition";

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export const LIMITS = {
  title: 120,
  overview: 2000,
  sessions: 21,
  sessionTitle: 80,
  sessionNotes: 1000,
  exercises: 20,
  exerciseName: 80,
  alternatives: 5,
  shortText: 120,
  progression: 500,
  notes: 1000,
  url: 500,
  restNote: 300,
  guidance: 4000,
  targetNote: 500,
  meals: 12,
  mealName: 60,
  mealTime: 40,
  items: 25,
  food: 80,
  substitutions: 5,
  itemNote: 300,
  foodNotes: 1000,
  summary: 500,
} as const;

export type Target =
  | { type: "reps"; min: number; max: number | null }
  | { type: "duration"; seconds: number }
  | { type: "none" };

export interface Load {
  amount: number;
  unit: "kg" | "lb";
}

export interface ExerciseCore {
  key: string;
  name: string;
  sets: number | null;
  target: Target;
  restSeconds: number | null;
  load: Load | null;
  /** "Bodyweight", "a weight you can lift 10 times with good form". */
  loadNote: string;
  /** Effort guidance: "RPE 7", "2 reps in reserve". */
  effort: string;
  /** How to perform it. For an alternative: when and how to use it instead. */
  notes: string;
  demoUrl: string;
}

export type Alternative = ExerciseCore;

export interface Exercise extends ExerciseCore {
  progression: string;
  alternatives: Alternative[];
}

export interface Session {
  key: string;
  title: string;
  /** 0 = Monday … 6 = Sunday. Null in an in-order plan. */
  day: number | null;
  minutes: number | null;
  notes: string;
  exercises: Exercise[];
}

export interface WorkoutContent {
  schedule: "weekly" | "in_order";
  overview: string;
  sessions: Session[];
  /** Guidance for rest days, by day (weekly plans). */
  restNotes: { day: number; note: string }[];
}

export const FOOD_UNITS = [
  "g", "kg", "ml", "l", "cup", "tbsp", "tsp", "piece", "slice", "bowl", "plate", "handful", "mana", "pau",
] as const;
export type FoodUnit = (typeof FOOD_UNITS)[number];
export const FOOD_UNIT_LABEL: Record<FoodUnit, string> = {
  g: "g", kg: "kg", ml: "ml", l: "litre", cup: "cup", tbsp: "tbsp", tsp: "tsp", piece: "piece", slice: "slice",
  bowl: "bowl", plate: "plate", handful: "handful", mana: "mana", pau: "pau",
};

export interface FoodItem {
  key: string;
  food: string;
  quantity: number | null;
  unit: FoodUnit | "";
  prepared: "cooked" | "raw" | "";
  substitutions: string[];
  notes: string;
  /** Coach-entered estimates. Never measured, never looked up. */
  estKcal: number | null;
  estProteinG: number | null;
}

export interface Meal {
  key: string;
  name: string;
  time: string;
  notes: string;
  items: FoodItem[];
}

export interface Targets {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  note: string;
}

export interface NutritionContent {
  guidance: string;
  targets: Targets | null;
  meals: Meal[];
  /** How the plan fits the client's allergies, preferences and local foods. */
  foodNotes: string;
}

export type PlanContent = WorkoutContent | NutritionContent;

// ---------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isKey(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** An http(s) link, or "" — never javascript:, data:, or anything relative. */
export function safeUrl(input: unknown): string {
  if (typeof input !== "string") return "";
  const raw = input.trim().slice(0, LIMITS.url);
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    if (u.username || u.password) return "";
    return u.toString();
  } catch {
    return "";
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A finite number in range, rounded to `dp` places, or null. */
function num(v: unknown, min: number, max: number, dp = 0): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

class Problems {
  list: string[] = [];
  add(p: string) {
    if (!this.list.includes(p) && this.list.length < 12) this.list.push(p);
  }
}

function checkNum(v: unknown, min: number, max: number, dp: number, label: string, p: Problems): number | null {
  const n = num(v, min, max, dp);
  if (n === null && v !== null && v !== undefined && v !== "") p.add(`${label} must be between ${min} and ${max}.`);
  return n;
}

function text(v: unknown, max: number, label: string, p: Problems): string {
  if (typeof v === "string" && v.trim().length > max) p.add(`${label} is too long (${max} characters at most).`);
  return cleanText(v, max);
}

function key(v: unknown, label: string, seen: Set<string>, p: Problems): string {
  if (!isKey(v)) {
    p.add(`${label} is missing its identifier. Reload the page and try again.`);
    return typeof v === "string" ? v.slice(0, 36) : "";
  }
  const k = v.toLowerCase();
  if (seen.has(k)) p.add(`${label} appears twice. Reload the page and try again.`);
  seen.add(k);
  return k;
}

function capped<T>(items: unknown[], max: number, label: string, p: Problems): unknown[] {
  if (items.length > max) p.add(`${label}: ${max} at most.`);
  return items.slice(0, max);
}

function target(v: unknown, label: string, p: Problems): Target {
  const t = obj(v);
  if (t.type === "duration") {
    const seconds = checkNum(t.seconds, 5, 3600, 0, `${label}: time`, p);
    return seconds === null ? { type: "none" } : { type: "duration", seconds };
  }
  if (t.type === "reps") {
    const min = checkNum(t.min, 1, 100, 0, `${label}: reps`, p);
    let max = checkNum(t.max, 1, 100, 0, `${label}: reps`, p);
    if (min === null) return { type: "none" };
    if (max !== null && max < min) {
      p.add(`${label}: the top of the rep range is below the bottom.`);
      max = null;
    }
    return { type: "reps", min, max: max === min ? null : max };
  }
  return { type: "none" };
}

function core(v: unknown, label: string, seen: Set<string>, p: Problems): ExerciseCore {
  const e = obj(v);
  const name = text(e.name, LIMITS.exerciseName, `${label} name`, p);
  if (!name) p.add(`${label} needs a name.`);
  const loadIn = obj(e.load);
  const amount = checkNum(loadIn.amount, 0.25, 1000, 2, `${label}: weight`, p);
  const unit = loadIn.unit === "lb" ? "lb" : "kg";
  const rawUrl = typeof e.demoUrl === "string" ? e.demoUrl.trim() : "";
  const demoUrl = safeUrl(rawUrl);
  if (rawUrl && !demoUrl) p.add(`${label}: the demonstration link must start with https://`);
  return {
    key: key(e.key, label, seen, p),
    name,
    sets: checkNum(e.sets, 1, 20, 0, `${label}: sets`, p),
    target: target(e.target, label, p),
    restSeconds: checkNum(e.restSeconds, 0, 900, 0, `${label}: rest`, p),
    load: amount === null ? null : { amount, unit },
    loadNote: text(e.loadNote, LIMITS.shortText, `${label} weight guidance`, p),
    effort: text(e.effort, LIMITS.shortText, `${label} effort guidance`, p),
    notes: text(e.notes, LIMITS.notes, `${label} notes`, p),
    demoUrl,
  };
}

export interface Normalized<T> {
  content: T;
  problems: string[];
}

export function normalizeWorkout(input: unknown): Normalized<WorkoutContent> {
  const p = new Problems();
  const c = obj(input);
  const schedule = c.schedule === "in_order" ? "in_order" : "weekly";
  const seen = new Set<string>();

  const sessions = capped(arr(c.sessions), LIMITS.sessions, "Sessions", p).map((sv, si) => {
    const s = obj(sv);
    const label = `Session ${si + 1}`;
    const title = text(s.title, LIMITS.sessionTitle, `${label} title`, p);
    if (!title) p.add(`${label} needs a title.`);
    const day = schedule === "weekly" ? num(s.day, 0, 6) : null;
    if (schedule === "weekly" && day === null) p.add(`${label} needs a day of the week.`);
    const exercises = capped(arr(s.exercises), LIMITS.exercises, `${label} exercises`, p).map((ev, ei) => {
      const e = obj(ev);
      const elabel = `${label}, exercise ${ei + 1}`;
      return {
        ...core(e, elabel, seen, p),
        progression: text(e.progression, LIMITS.progression, `${elabel} progression`, p),
        alternatives: capped(arr(e.alternatives), LIMITS.alternatives, `${elabel} alternatives`, p).map((av, ai) =>
          core(av, `${elabel}, alternative ${ai + 1}`, seen, p),
        ),
      } satisfies Exercise;
    });
    return {
      key: key(s.key, label, seen, p),
      title,
      day,
      minutes: checkNum(s.minutes, 5, 240, 0, `${label}: length`, p),
      notes: text(s.notes, LIMITS.sessionNotes, `${label} notes`, p),
      exercises,
    } satisfies Session;
  });

  const restNotes: { day: number; note: string }[] = [];
  if (schedule === "weekly") {
    for (const rv of arr(c.restNotes).slice(0, 7)) {
      const r = obj(rv);
      const day = num(r.day, 0, 6);
      const note = text(r.note, LIMITS.restNote, "Rest-day note", p);
      if (day !== null && note && !restNotes.some((x) => x.day === day)) restNotes.push({ day, note });
    }
  }

  return {
    content: { schedule, overview: text(c.overview, LIMITS.overview, "Overview", p), sessions, restNotes },
    problems: p.list,
  };
}

export function normalizeNutrition(input: unknown): Normalized<NutritionContent> {
  const p = new Problems();
  const c = obj(input);
  const seen = new Set<string>();

  const t = obj(c.targets);
  const targets: Targets = {
    calories: checkNum(t.calories, 500, 10000, 0, "Calorie target", p),
    proteinG: checkNum(t.proteinG, 0, 1000, 0, "Protein target", p),
    carbsG: checkNum(t.carbsG, 0, 2000, 0, "Carbohydrate target", p),
    fatG: checkNum(t.fatG, 0, 1000, 0, "Fat target", p),
    note: text(t.note, LIMITS.targetNote, "Target note", p),
  };
  const hasTargets = targets.calories !== null || targets.proteinG !== null || targets.carbsG !== null || targets.fatG !== null;

  const meals = capped(arr(c.meals), LIMITS.meals, "Meals", p).map((mv, mi) => {
    const m = obj(mv);
    const label = `Meal ${mi + 1}`;
    const name = text(m.name, LIMITS.mealName, `${label} name`, p);
    if (!name) p.add(`${label} needs a name.`);
    const items = capped(arr(m.items), LIMITS.items, `${label} foods`, p).map((iv, ii) => {
      const i = obj(iv);
      const ilabel = `${label}, food ${ii + 1}`;
      const food = text(i.food, LIMITS.food, `${ilabel} name`, p);
      if (!food) p.add(`${ilabel} needs a name.`);
      const unit = (FOOD_UNITS as readonly string[]).includes(String(i.unit)) ? (i.unit as FoodUnit) : "";
      return {
        key: key(i.key, ilabel, seen, p),
        food,
        quantity: checkNum(i.quantity, 0.01, 10000, 2, `${ilabel}: amount`, p),
        unit,
        prepared: i.prepared === "cooked" || i.prepared === "raw" ? i.prepared : "",
        substitutions: capped(arr(i.substitutions), LIMITS.substitutions, `${ilabel} swaps`, p)
          .map((s) => text(s, LIMITS.shortText, `${ilabel} swap`, p))
          .filter(Boolean),
        notes: text(i.notes, LIMITS.itemNote, `${ilabel} notes`, p),
        estKcal: checkNum(i.estKcal, 0, 5000, 0, `${ilabel}: calories`, p),
        estProteinG: checkNum(i.estProteinG, 0, 500, 1, `${ilabel}: protein`, p),
      } satisfies FoodItem;
    });
    return {
      key: key(m.key, label, seen, p),
      name,
      time: text(m.time, LIMITS.mealTime, `${label} time`, p),
      notes: text(m.notes, LIMITS.notes, `${label} notes`, p),
      items,
    } satisfies Meal;
  });

  return {
    content: {
      guidance: text(c.guidance, LIMITS.guidance, "Guidance", p),
      targets: hasTargets || targets.note ? targets : null,
      meals,
      foodNotes: text(c.foodNotes, LIMITS.foodNotes, "Food notes", p),
    },
    problems: p.list,
  };
}

export function normalize(kind: PlanKind, input: unknown): Normalized<PlanContent> {
  return kind === "workout" ? normalizeWorkout(input) : normalizeNutrition(input);
}

/** What still stops a version being handed to a client. Mirrors plan_content_publishable(). */
export function missingForPublish(kind: PlanKind, content: PlanContent): string[] {
  if (kind === "workout") {
    const w = content as WorkoutContent;
    return w.sessions.length ? [] : ["at least one session"];
  }
  const n = content as NutritionContent;
  const used = n.guidance || (n.targets && (n.targets.calories !== null || n.targets.proteinG !== null)) || n.meals.length;
  return used ? [] : ["written guidance, a calorie or protein target, or a meal plan — any one is enough"];
}

export function emptyContent(kind: PlanKind): PlanContent {
  return kind === "workout"
    ? { schedule: "weekly", overview: "", sessions: [], restNotes: [] }
    : { guidance: "", targets: null, meals: [], foodNotes: "" };
}

// ---------------------------------------------------------------------------
// Describing a prescription in words
// ---------------------------------------------------------------------------

export function seconds(n: number): string {
  if (n < 60) return `${n} s`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/** "3 × 8–12", "4 × 30 s", "3 sets". */
export function prescription(e: ExerciseCore): string {
  const t = e.target;
  const what =
    t.type === "reps" ? `${t.min}${t.max ? `–${t.max}` : ""} reps` : t.type === "duration" ? seconds(t.seconds) : "";
  if (e.sets && what) return `${e.sets} × ${what}`;
  if (e.sets) return `${e.sets} ${e.sets === 1 ? "set" : "sets"}`;
  return what;
}

export function loadText(e: ExerciseCore): string {
  const parts = [e.load ? `${e.load.amount} ${e.load.unit}` : "", e.loadNote].filter(Boolean);
  return parts.join(" · ");
}

export function quantityText(i: FoodItem): string {
  const q = i.quantity !== null ? `${i.quantity}${i.unit ? ` ${FOOD_UNIT_LABEL[i.unit]}` : ""}` : "";
  return [q, i.prepared ? i.prepared : ""].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// Versions over time
// ---------------------------------------------------------------------------

export interface VersionTiming {
  id: string;
  version: number;
  published_at: string | null;
  effective_from: string | null;
  withdrawn_at: string | null;
}

const live = (v: VersionTiming) => v.published_at !== null && v.effective_from !== null && v.withdrawn_at === null;

/**
 * The version a client follows at `at`: the latest published, non-withdrawn
 * version that has taken effect. Mirrors the rule publish_plan_draft() keeps
 * true (a newer version withdraws any older one scheduled at or after it).
 */
export function versionInForce<T extends VersionTiming>(versions: T[], at: Date): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (!live(v) || Date.parse(v.effective_from!) > at.getTime()) continue;
    if (!best || Date.parse(v.effective_from!) > Date.parse(best.effective_from!) ||
        (v.effective_from === best.effective_from && v.version > best.version)) best = v;
  }
  return best;
}

/** Published updates that have not started yet, soonest first. */
export function scheduledVersions<T extends VersionTiming>(versions: T[], now: Date): T[] {
  return versions
    .filter((v) => live(v) && Date.parse(v.effective_from!) > now.getTime())
    .sort((a, b) => Date.parse(a.effective_from!) - Date.parse(b.effective_from!));
}

// ---------------------------------------------------------------------------
// Calendar days in a person's own timezone
// ---------------------------------------------------------------------------

/** "2026-09-28" for this instant, in this timezone. */
export function localDate(at: Date, timeZone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export function addDays(dateOnly: string, n: number): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(dateOnly: string): number {
  return (new Date(`${dateOnly}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function mondayOf(dateOnly: string): string {
  return addDays(dateOnly, -weekday(dateOnly));
}

export function isDateOnly(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

/** The instant a calendar day starts in a timezone (midnight, or the first valid moment after it). */
export function startOfLocalDay(dateOnly: string, timeZone: string | null | undefined): Date {
  const tz = timeZone || "UTC";
  const guess = Date.parse(`${dateOnly}T00:00:00Z`);
  let t = guess;
  // Two passes settle any offset, including a DST change on that day.
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    t = guess - (asUtc - t);
  }
  return new Date(t);
}

// ---------------------------------------------------------------------------
// A client's week
// ---------------------------------------------------------------------------

export interface SessionMove {
  session_key: string;
  week_start: string;
  to_day: number | null;
  created_at: string;
}

/** A workout record M12 has already started against a version. */
export interface StartedWorkout {
  performed_on: string;
  session_key: string;
  version_id: string;
}

export interface PlacedSession {
  session: Session;
  versionId: string;
  /** Planned day, when it has been moved this week. */
  movedFrom: number | null;
  /** True when the instructions come from a record already started, not today's version. */
  fromStartedRecord: boolean;
}

export interface WeekDay {
  date: string;
  day: number;
  versionId: string | null;
  sessions: PlacedSession[];
  restNote: string;
}

/**
 * Lay a week out Monday to Sunday. Each day follows the version in force when
 * that day starts; a move shifts a session for this week only; and a workout
 * already started keeps the instructions of the version it was started under.
 */
export function layOutWeek(args: {
  weekStart: string;
  versionForDay: (date: string) => { id: string; content: WorkoutContent } | null;
  versionById: (id: string) => { id: string; content: WorkoutContent } | null;
  moves: SessionMove[];
  started: StartedWorkout[];
}): WeekDay[] {
  const latestMove = new Map<string, SessionMove>();
  for (const m of args.moves) {
    if (m.week_start !== args.weekStart) continue;
    const prev = latestMove.get(m.session_key);
    if (!prev || Date.parse(m.created_at) >= Date.parse(prev.created_at)) latestMove.set(m.session_key, m);
  }
  const dayOf = (s: Session) => {
    const m = latestMove.get(s.key);
    return m && m.to_day !== null ? m.to_day : s.day;
  };

  return Array.from({ length: 7 }, (_, day) => {
    const date = addDays(args.weekStart, day);
    const v = args.versionForDay(date);
    const sessions: PlacedSession[] = [];
    if (v && v.content.schedule === "weekly") {
      for (const s of v.content.sessions) {
        if (dayOf(s) !== day) continue;
        sessions.push({ session: s, versionId: v.id, movedFrom: s.day !== day ? s.day : null, fromStartedRecord: false });
      }
    }
    for (const w of args.started) {
      if (w.performed_on !== date) continue;
      const sv = args.versionById(w.version_id);
      const s = sv?.content.sessions.find((x) => x.key === w.session_key);
      if (!sv || !s) continue;
      const i = sessions.findIndex((x) => x.session.key === s.key);
      const placed = { session: s, versionId: sv.id, movedFrom: s.day !== day ? s.day : null, fromStartedRecord: sv.id !== v?.id };
      if (i >= 0) sessions[i] = placed;
      else sessions.push(placed);
    }
    const restNote = v && v.content.schedule === "weekly" && !sessions.length
      ? v.content.restNotes.find((r) => r.day === day)?.note ?? ""
      : "";
    return { date, day, versionId: v?.id ?? null, sessions, restNote };
  });
}

export type VersionStatus = "draft" | "current" | "scheduled" | "earlier" | "cancelled";

/** Where a version stands at `now`. */
export function versionStatus<T extends VersionTiming>(v: T, all: T[], now: Date): VersionStatus {
  if (!v.published_at) return "draft";
  if (v.withdrawn_at) return "cancelled";
  if (v.effective_from && Date.parse(v.effective_from) > now.getTime()) return "scheduled";
  return versionInForce(all, now)?.id === v.id ? "current" : "earlier";
}

export const VERSION_STATUS_LABEL: Record<VersionStatus, string> = {
  draft: "Draft — only you can see it",
  current: "Current",
  scheduled: "Scheduled update",
  earlier: "Earlier version",
  cancelled: "Cancelled before it started",
};
