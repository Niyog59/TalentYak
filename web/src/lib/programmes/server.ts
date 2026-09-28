import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isKey,
  layOutWeek,
  normalize,
  startOfLocalDay,
  versionInForce,
  type WeekDay,
  type NutritionContent,
  type PlanContent,
  type PlanKind,
  type SessionMove,
  type StartedWorkout,
  type VersionTiming,
  type WorkoutContent,
} from "@/lib/programmes/content";

/*
 * Reads go through the signed-in person's own session, so row-level security
 * decides what they see: a client never receives a draft, a former coach
 * receives nothing, an incoming coach only what the client's sharing choice
 * allows. The single exception is the other person's first name, timezone and
 * public coach name, looked up by id only AFTER that access check has passed.
 */

export interface PlanVersion extends VersionTiming {
  plan_id: string;
  title: string;
  content: PlanContent;
  change_summary: string | null;
  notified: boolean;
  source_template_id: string | null;
  source_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientPlan {
  id: string;
  enrollment_id: string;
  assignment_id: string;
  provider_id: string;
  kind: PlanKind;
  created_at: string;
  coachName: string;
  versions: PlanVersion[];
}

const VERSION_COLUMNS =
  "id, plan_id, version, title, content, change_summary, notified, source_template_id, source_version_id, published_at, effective_from, withdrawn_at, created_at, updated_at";

function readVersion(kind: PlanKind, row: Record<string, unknown>): PlanVersion {
  return { ...(row as unknown as PlanVersion), content: normalize(kind, row.content).content };
}

async function coachNames(providerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const admin = createAdminClient();
  if (!admin || providerIds.length === 0) return out;
  const { data } = await admin
    .from("providers")
    .select("id, display_name, provider_public_profiles(display_name)")
    .in("id", [...new Set(providerIds)]);
  for (const p of data ?? []) {
    const pub = p.provider_public_profiles as unknown as { display_name?: string } | { display_name?: string }[] | null;
    const publicName = Array.isArray(pub) ? pub[0]?.display_name : pub?.display_name;
    out.set(p.id as string, publicName || (p.display_name as string));
  }
  return out;
}

/** Every plan on this relationship the caller may read, newest stint first, with versions. */
export async function plansForEnrollment(enrollmentId: string): Promise<ClientPlan[]> {
  const supabase = await createClient();
  if (!supabase || !isKey(enrollmentId)) return [];
  const { data: plans } = await supabase
    .from("client_plans")
    .select("id, enrollment_id, assignment_id, provider_id, kind, created_at")
    .eq("enrollment_id", enrollmentId)
    .order("created_at", { ascending: false });
  if (!plans?.length) return [];
  const { data: versions } = await supabase
    .from("client_plan_versions")
    .select(VERSION_COLUMNS)
    .in("plan_id", plans.map((p) => p.id))
    .order("version", { ascending: false });
  const names = await coachNames(plans.map((p) => p.provider_id as string));
  return plans.map((p) => ({
    ...(p as Omit<ClientPlan, "coachName" | "versions">),
    coachName: names.get(p.provider_id as string) ?? "Your coach",
    versions: (versions ?? [])
      .filter((v) => v.plan_id === p.id)
      .map((v) => readVersion(p.kind as PlanKind, v as Record<string, unknown>)),
  }));
}

export interface CoachClient {
  enrollment_id: string;
  purchase_id: string;
  client_name: string;
  offer_title: string;
  purchase_state: string;
  assigned_from: string;
  paid_through: string | null;
}

/** A client currently assigned to the calling coach, or null. */
export async function myClient(enrollmentId: string): Promise<CoachClient | null> {
  const supabase = await createClient();
  if (!supabase || !isKey(enrollmentId)) return null;
  const { data } = await supabase.rpc("my_clients");
  return ((data ?? []) as CoachClient[]).find((c) => c.enrollment_id === enrollmentId) ?? null;
}

export async function myClients(): Promise<CoachClient[] | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("my_clients");
  if (error) return null;
  return (data ?? []) as CoachClient[];
}

export async function coachingIsLive(enrollmentId: string): Promise<boolean> {
  const supabase = await createClient();
  if (!supabase) return false;
  const { data } = await supabase.rpc("coaching_is_live", { e_id: enrollmentId });
  return data === true;
}

export interface TrainingProfile {
  experience: "new" | "some" | "experienced" | null;
  experience_note: string | null;
  equipment: string[];
  equipment_note: string | null;
  session_minutes: number | null;
  days_per_week: number | null;
  food_preferences: string | null;
  local_foods: string | null;
  updated_at: string;
}

export interface HealthProfile {
  limitations: string | null;
  allergies: string | null;
  updated_at: string;
}

export interface PlanningContext {
  customerId: string;
  timezone: string | null;
  training: TrainingProfile | null;
  health: HealthProfile | null;
  /** Older booking questionnaire answers, where this relationship came from one. */
  bookingAnswers: Record<string, string> | null;
}

const LEGACY_KEYS: Record<string, string> = {
  goal: "Main goal",
  equipment: "Equipment",
  schedule: "Days per week",
  diet_style: "How they mostly eat",
};

/**
 * What the client has told their coach, for planning. Row-level security
 * returns the profiles only to the client's CURRENT coach; health notes come
 * from their own table under the same rule.
 */
export async function planningContext(enrollmentId: string): Promise<PlanningContext | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: e } = await supabase.from("enrollments").select("customer_id, booking_id").eq("id", enrollmentId).maybeSingle();
  if (!e) return null;
  const [{ data: training }, { data: health }, booking] = await Promise.all([
    supabase.from("client_training_profiles").select("experience, experience_note, equipment, equipment_note, session_minutes, days_per_week, food_preferences, local_foods, updated_at").eq("customer_id", e.customer_id).maybeSingle(),
    supabase.from("client_health_profiles").select("limitations, allergies, updated_at").eq("customer_id", e.customer_id).maybeSingle(),
    e.booking_id
      ? supabase.from("bookings").select("intake_response").eq("id", e.booking_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let bookingAnswers: Record<string, string> | null = null;
  const raw = (booking.data as { intake_response?: Record<string, unknown> } | null)?.intake_response;
  if (raw && typeof raw === "object") {
    bookingAnswers = {};
    for (const [k, label] of Object.entries(LEGACY_KEYS)) {
      const v = raw[k];
      const s = Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "";
      if (s) bookingAnswers[label] = s.slice(0, 200);
    }
    if (!Object.keys(bookingAnswers).length) bookingAnswers = null;
  }

  // The client's timezone decides when "Monday" starts for them. Looked up
  // only after the caller has been shown this relationship.
  const admin = createAdminClient();
  const { data: person } = admin
    ? await admin.from("profiles").select("timezone").eq("id", e.customer_id).maybeSingle()
    : { data: null };

  return {
    customerId: e.customer_id as string,
    timezone: (person?.timezone as string | null) ?? null,
    training: (training as TrainingProfile | null) ?? null,
    health: (health as HealthProfile | null) ?? null,
    bookingAnswers,
  };
}

export interface Template {
  id: string;
  kind: PlanKind;
  title: string;
  content: PlanContent;
  archived_at: string | null;
  updated_at: string;
}

export async function myTemplates(providerId: string, opts: { kind?: PlanKind; includeArchived?: boolean } = {}): Promise<Template[]> {
  const supabase = await createClient();
  if (!supabase) return [];
  let q = supabase.from("plan_templates").select("id, kind, title, content, archived_at, updated_at").eq("provider_id", providerId);
  if (opts.kind) q = q.eq("kind", opts.kind);
  if (!opts.includeArchived) q = q.is("archived_at", null);
  const { data } = await q.order("updated_at", { ascending: false });
  return (data ?? []).map((t) => ({ ...(t as Template), content: normalize(t.kind as PlanKind, t.content).content }));
}

export async function myTemplate(id: string): Promise<Template | null> {
  const supabase = await createClient();
  if (!supabase || !isKey(id)) return null;
  const { data } = await supabase.from("plan_templates").select("id, kind, title, content, archived_at, updated_at").eq("id", id).maybeSingle();
  return data ? { ...(data as Template), content: normalize(data.kind as PlanKind, data.content).content } : null;
}

/** Schedule moves and started workouts for a workout plan, for the client's week view. */
export async function weekRecords(plan: ClientPlan, fromDate: string, toDate: string): Promise<{ moves: SessionMove[]; started: StartedWorkout[] }> {
  const supabase = await createClient();
  if (!supabase) return { moves: [], started: [] };
  const [{ data: moves }, { data: logs }] = await Promise.all([
    supabase.from("plan_session_moves").select("session_key, week_start, to_day, created_at").eq("plan_id", plan.id).gte("week_start", fromDate).lte("week_start", toDate),
    // M12 writes these. Until it exists there are none, and nothing pretends otherwise.
    supabase.from("workout_logs").select("performed_at, session_key, plan_version_id").eq("enrollment_id", plan.enrollment_id)
      .not("plan_version_id", "is", null).gte("performed_at", fromDate).lte("performed_at", toDate),
  ]);
  return {
    moves: (moves ?? []) as SessionMove[],
    started: (logs ?? []).map((l) => ({ performed_on: l.performed_at as string, session_key: l.session_key as string, version_id: l.plan_version_id as string })),
  };
}

/**
 * The current coach's plan of one kind. An earlier coach's plans stay
 * readable in the history but are never shown as what to do now.
 */
export function currentPlanOf(plans: ClientPlan[], kind: PlanKind, openAssignmentId: string | null): ClientPlan | undefined {
  return (
    plans.find((p) => p.kind === kind && p.assignment_id === openAssignmentId && p.versions.length) ??
    (openAssignmentId ? undefined : plans.find((p) => p.kind === kind && p.versions.length))
  );
}

/** One week of a workout plan as the client sees it: moves applied, started records kept. */
export async function weekLayout(plan: ClientPlan, weekStart: string, today: string, tz: string | null, now: Date): Promise<WeekDay[]> {
  const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const records = await weekRecords(plan, weekStart, addDay(weekStart, 6));
  const byId = new Map(plan.versions.map((v) => [v.id, v]));
  const toWorkout = (v: PlanVersion | null | undefined) => (v ? { id: v.id, content: v.content as WorkoutContent } : null);
  return layOutWeek({
    weekStart,
    // Today follows what is in force right now; other days, what is in force when they start.
    versionForDay: (date) => toWorkout(versionInForce(plan.versions, date === today ? now : startOfLocalDay(date, tz))),
    versionById: (id) => toWorkout(byId.get(id)),
    moves: records.moves,
    started: records.started,
  });
}

export type LoggedStatus = "in_progress" | "completed" | "partial" | "skipped";

/** Records already started for planned sessions between two dates, by `date:session`. */
export async function loggedSessions(enrollmentId: string, from: string, to: string): Promise<Map<string, { id: string; status: LoggedStatus }>> {
  const supabase = await createClient();
  const out = new Map<string, { id: string; status: LoggedStatus }>();
  if (!supabase) return out;
  const { data } = await supabase.from("workout_logs").select("id, session_key, performed_at, status")
    .eq("enrollment_id", enrollmentId).not("session_key", "is", null).gte("performed_at", from).lte("performed_at", to);
  for (const r of data ?? []) out.set(`${r.performed_at}:${r.session_key}`, { id: r.id as string, status: r.status as LoggedStatus });
  return out;
}

export function asWorkout(v: PlanVersion): { id: string; content: WorkoutContent } {
  return { id: v.id, content: v.content as WorkoutContent };
}

export function asNutrition(v: PlanVersion): NutritionContent {
  return v.content as NutritionContent;
}


export interface MyEnrollment {
  id: string;
  state: "pending" | "active" | "paused" | "ended";
  provider_id: string;
  coachName: string;
  planTitle: string;
  openAssignmentId: string | null;
}

/** The signed-in client's coaching relationships, newest first. */
export async function myEnrollments(customerId: string): Promise<MyEnrollment[]> {
  const supabase = await createClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("enrollments")
    .select("id, state, provider_id, created_at, purchases(inclusions_snapshot), enrollment_assignments(id, effective_to)")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as {
    id: string;
    state: MyEnrollment["state"];
    provider_id: string;
    purchases: { inclusions_snapshot: { title?: string } | null } | null;
    enrollment_assignments: { id: string; effective_to: string | null }[];
  }[];
  const names = await coachNames(rows.map((r) => r.provider_id));
  return rows.map((r) => ({
    id: r.id,
    state: r.state,
    provider_id: r.provider_id,
    coachName: names.get(r.provider_id) ?? "Your coach",
    planTitle: r.purchases?.inclusions_snapshot?.title ?? "Coaching",
    openAssignmentId: r.enrollment_assignments.find((a) => a.effective_to === null)?.id ?? null,
  }));
}
