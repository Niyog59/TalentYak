import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isKey } from "@/lib/programmes/content";
import type { ClientPlan } from "@/lib/programmes/server";
import { buildOverview } from "@/lib/tracking/overview";
import { foodDays } from "@/lib/tracking/server";
import type { LengthUnit, WeightUnit } from "@/lib/tracking/units";
import type { Answers, Question } from "@/lib/checkins/questions";
import { daysBetween, isSnapshot, type ProgressSnapshot } from "@/lib/checkins/snapshot";
import type { CheckinRow, CheckinStatus } from "@/lib/checkins/status";

/*
 * Reads, through the signed-in person's own session: row-level security
 * decides what each person gets. A client reads their own check-ins and
 * drafts and only PUBLISHED feedback; a coach reads what the client's
 * sharing choice allows (attachments by the stricter media rule), never a
 * client's draft, and only their own feedback drafts. A former coach and an
 * administrator read nothing here.
 */

const CHECKIN_COLUMNS =
  "id, enrollment_id, period_start, period_end, due_at, timezone, status, status_reason, first_submitted_at, last_submitted_at, current_revision, review_revision, needs_resolution, completed_at, responsible_provider_id, template_version_id, created_at";

export interface Submission {
  id: string;
  revision: number;
  answers: Answers;
  media_ids: string[];
  substantive: boolean;
  change_note: string | null;
  progress_snapshot: ProgressSnapshot | null;
  submitted_at: string;
}

export interface NextStep {
  key: string;
  text: string;
  kind: "action" | "plan_change";
}

export interface Feedback {
  id: string;
  version: number;
  provider_id: string;
  body: string;
  next_steps: NextStep[];
  plan_id: string | null;
  conversation_id: string | null;
  refers_to_revision: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  links: { step_key: string; plan_version_id: string; linked_at: string }[];
}

export interface CheckinEvent {
  kind: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface CheckinDetail {
  checkin: CheckinRow;
  questions: Question[];
  templateTitle: string;
  submissions: Submission[];
  draft: { answers: Answers; revision: number; base_submission_revision: number; updated_at: string } | null;
  feedback: Feedback[];
  events: CheckinEvent[];
  coachName: string;
}

export async function providerNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const admin = createAdminClient();
  if (!admin || ids.length === 0) return out;
  const { data } = await admin.from("providers").select("id, display_name, provider_public_profiles(display_name)").in("id", [...new Set(ids)]);
  for (const p of data ?? []) {
    const pub = p.provider_public_profiles as unknown as { display_name?: string } | { display_name?: string }[] | null;
    const publicName = Array.isArray(pub) ? pub[0]?.display_name : pub?.display_name;
    out.set(p.id as string, publicName || (p.display_name as string));
  }
  return out;
}

/** Makes the request for the period running now, if one is due. Idempotent. */
export async function refreshCheckins(enrollmentId: string): Promise<void> {
  const supabase = await createClient();
  if (!supabase || !isKey(enrollmentId)) return;
  await supabase.rpc("refresh_checkins", { p_enrollment: enrollmentId });
}

export interface CheckinListItem extends CheckinRow {
  hasDraft: boolean;
  feedbackCoversLatest: boolean;
  anyFeedback: boolean;
}

/** A client's check-ins on one relationship, newest period first. */
export async function checkinsFor(enrollmentId: string): Promise<CheckinListItem[]> {
  const supabase = await createClient();
  if (!supabase || !isKey(enrollmentId)) return [];
  const { data } = await supabase.from("checkins").select(CHECKIN_COLUMNS).eq("enrollment_id", enrollmentId).order("period_start", { ascending: false }).limit(100);
  const rows = (data ?? []) as CheckinRow[];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [{ data: drafts }, { data: feedback }] = await Promise.all([
    supabase.from("checkin_drafts").select("checkin_id").in("checkin_id", ids),
    supabase.from("checkin_feedback").select("checkin_id, refers_to_revision").in("checkin_id", ids).not("published_at", "is", null),
  ]);
  const drafted = new Set((drafts ?? []).map((d) => d.checkin_id as string));
  return rows.map((r) => {
    const mine = (feedback ?? []).filter((f) => f.checkin_id === r.id);
    return {
      ...r,
      hasDraft: drafted.has(r.id),
      anyFeedback: mine.length > 0,
      feedbackCoversLatest: mine.some((f) => (f.refers_to_revision as number) >= (r.review_revision ?? 1)),
    };
  });
}

export async function checkinDetail(checkinId: string): Promise<CheckinDetail | null> {
  const supabase = await createClient();
  if (!supabase || !isKey(checkinId)) return null;
  const { data: row } = await supabase.from("checkins").select(CHECKIN_COLUMNS).eq("id", checkinId).maybeSingle();
  if (!row) return null;
  const checkin = row as CheckinRow;
  const [{ data: tv }, { data: subs }, { data: draft }, { data: fb }, { data: events }] = await Promise.all([
    supabase.from("checkin_template_versions").select("title, questions").eq("id", checkin.template_version_id).maybeSingle(),
    supabase.from("checkin_submissions").select("id, revision, answers, media_ids, substantive, change_note, progress_snapshot, submitted_at").eq("checkin_id", checkinId).order("revision", { ascending: true }),
    supabase.from("checkin_drafts").select("answers, revision, base_submission_revision, updated_at").eq("checkin_id", checkinId).maybeSingle(),
    supabase.from("checkin_feedback").select("id, version, provider_id, body, next_steps, plan_id, conversation_id, refers_to_revision, published_at, created_at, updated_at").eq("checkin_id", checkinId).order("created_at", { ascending: true }),
    supabase.from("checkin_events").select("kind, detail, created_at").eq("checkin_id", checkinId).order("created_at", { ascending: true }),
  ]);
  const feedbackRows = (fb ?? []) as Omit<Feedback, "links">[];
  const { data: links } = feedbackRows.length
    ? await supabase.from("checkin_step_links").select("feedback_id, step_key, plan_version_id, linked_at").in("feedback_id", feedbackRows.map((f) => f.id))
    : { data: [] };
  const names = await providerNames([checkin.responsible_provider_id]);
  return {
    checkin,
    questions: ((tv?.questions ?? []) as Question[]),
    templateTitle: (tv?.title as string) ?? "Check-in",
    submissions: ((subs ?? []) as Submission[]).map((s) => ({ ...s, progress_snapshot: isSnapshot(s.progress_snapshot) ? s.progress_snapshot : null })),
    draft: (draft as CheckinDetail["draft"]) ?? null,
    feedback: feedbackRows.map((f) => ({
      ...f,
      next_steps: Array.isArray(f.next_steps) ? f.next_steps : [],
      links: (links ?? []).filter((l) => l.feedback_id === f.id) as Feedback["links"],
    })),
    events: (events ?? []) as CheckinEvent[],
    coachName: names.get(checkin.responsible_provider_id) ?? "Your coach",
  };
}

export interface ReviewExpectation {
  coach_name: string;
  coach_timezone: string | null;
  working_hours: { day: number; start: string; end: string }[];
  response_expectation: string | null;
  response_days: number | null;
  review_due: string | null;
  away_until: string | null;
  away_note: string | null;
  may_finish_after_paid_time: boolean;
}

export async function reviewExpectation(checkinId: string): Promise<ReviewExpectation | null> {
  const supabase = await createClient();
  if (!supabase || !isKey(checkinId)) return null;
  const { data } = await supabase.rpc("checkin_review_expectation", { p_checkin: checkinId });
  return (data as ReviewExpectation | null) ?? null;
}

// ---------------------------------------------------------------------------
// The period's progress, from the client's own records
// ---------------------------------------------------------------------------

/**
 * Read with the CLIENT's session when sending (their records, all of them),
 * or with the coach's for the "since it was sent" comparison (what their
 * sharing choice allows — the comparison then only covers that).
 */
export async function buildSnapshot(args: {
  enrollmentId: string;
  plans: ClientPlan[];
  from: string;
  to: string;
  today: string;
  timeZone: string | null;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
}): Promise<ProgressSnapshot> {
  const to = args.to > args.today ? args.today : args.to;
  const [overview, food] = await Promise.all([
    buildOverview({
      enrollmentId: args.enrollmentId,
      plans: args.plans,
      range: { id: "custom", from: args.from, to, label: "Check-in period" },
      today: args.today,
      timeZone: args.timeZone,
      weightUnit: args.weightUnit,
      lengthUnit: args.lengthUnit,
    }),
    foodDays(args.enrollmentId, args.from, to),
  ]);
  const c = overview.consistency;
  const upcoming = c.planned.filter((p) => p.outcome === "upcoming").length;
  const weights = overview.weights;
  const entries = food.flatMap((d) => d.entries);
  return {
    v: 1,
    capturedAt: new Date().toISOString(),
    period: { from: args.from, to: args.to },
    workouts: {
      hasPlan: overview.hasPlan,
      inOrder: overview.inOrder,
      due: overview.hasPlan && !overview.inOrder ? c.due : null,
      completed: c.counts.completed,
      partial: c.counts.partial,
      skipped: c.counts.skipped,
      notLogged: c.counts.unlogged,
      upcoming,
      unplanned: c.unplannedWorkouts,
      logged: overview.workouts
        .map((w) => ({ date: w.doc.performedOn, label: w.label, status: w.doc.status, planned: Boolean(w.doc.sessionKey) }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    },
    weight: {
      unit: args.weightUnit,
      readings: weights.length,
      first: weights[0] ?? null,
      latest: weights.at(-1) ?? null,
    },
    measurements: overview.measurements.map((m) => ({
      unit: args.lengthUnit,
      label: m.label,
      readings: m.readings,
      first: m.first?.value ?? null,
      latest: m.latest?.value ?? null,
    })),
    food: {
      days: daysBetween(args.from, to),
      daysWithEntries: food.filter((d) => d.entries.length > 0).length,
      daysMarkedComplete: food.filter((d) => d.entries.length > 0 && d.complete).length,
      entries: entries.length,
      entriesWithCalories: entries.filter((e) => e.kcal !== null).length,
      entriesWithProtein: entries.filter((e) => e.protein_g !== null).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Coach
// ---------------------------------------------------------------------------

export interface QueueRow {
  checkin_id: string;
  enrollment_id: string;
  client_name: string;
  period_start: string;
  period_end: string;
  due_at: string;
  status: CheckinStatus;
  first_submitted_at: string | null;
  last_submitted_at: string | null;
  current_revision: number;
  review_revision: number | null;
  feedback_published: boolean;
  review_due: string | null;
  responsible_name: string;
  mine: boolean;
  may_review: boolean;
}

export async function coachQueue(): Promise<QueueRow[] | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("coach_checkin_queue");
  if (error) return null;
  return (data ?? []) as QueueRow[];
}

export interface TemplateSummary {
  id: string;
  title: string;
  latest_version: number;
  archived_at: string | null;
  updated_at: string;
}

export async function myCheckinTemplates(): Promise<TemplateSummary[]> {
  const supabase = await createClient();
  if (!supabase) return [];
  const { data } = await supabase.from("checkin_templates").select("id, title, latest_version, archived_at, updated_at").order("updated_at", { ascending: false });
  return (data ?? []) as TemplateSummary[];
}

export async function templateWithQuestions(id: string): Promise<{ template: TemplateSummary; questions: Question[] } | null> {
  const supabase = await createClient();
  if (!supabase || !isKey(id)) return null;
  const { data: t } = await supabase.from("checkin_templates").select("id, title, latest_version, archived_at, updated_at").eq("id", id).maybeSingle();
  if (!t) return null;
  const { data: v } = await supabase.from("checkin_template_versions").select("questions").eq("template_id", id).eq("version", t.latest_version).maybeSingle();
  return { template: t as TemplateSummary, questions: ((v?.questions ?? []) as Question[]) };
}

export interface ScheduleView {
  id: string;
  provider_id: string;
  paused_at: string | null;
  pause_note: string | null;
  ended_at: string | null;
  current: {
    version: number;
    template_id: string;
    interval_weeks: number;
    due_weekday: number;
    due_time: string;
    timezone: string;
    response_days: number | null;
    effective_from: string;
  } | null;
  versions: number;
  breaks: { id: string; starts_on: string; ends_on: string; note: string | null; cancelled_at: string | null }[];
}

/** The open schedule on this relationship (the current coach's), if any. */
export async function scheduleFor(enrollmentId: string): Promise<ScheduleView | null> {
  const supabase = await createClient();
  if (!supabase || !isKey(enrollmentId)) return null;
  const { data: s } = await supabase
    .from("checkin_schedules")
    .select("id, provider_id, paused_at, pause_note, ended_at, created_at")
    .eq("enrollment_id", enrollmentId)
    .is("ended_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!s) return null;
  const [{ data: versions }, { data: breaks }] = await Promise.all([
    supabase.from("checkin_schedule_versions").select("version, template_id, interval_weeks, due_weekday, due_time, timezone, response_days, effective_from").eq("schedule_id", s.id).order("version", { ascending: false }),
    supabase.from("checkin_breaks").select("id, starts_on, ends_on, note, cancelled_at").eq("schedule_id", s.id).order("starts_on", { ascending: false }).limit(20),
  ]);
  return {
    ...(s as Omit<ScheduleView, "current" | "versions" | "breaks">),
    current: ((versions ?? [])[0] as ScheduleView["current"]) ?? null,
    versions: (versions ?? []).length,
    breaks: (breaks ?? []) as ScheduleView["breaks"],
  };
}
