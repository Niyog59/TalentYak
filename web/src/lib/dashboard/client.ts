import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SessionContext } from "@/lib/auth";
import { attempt, rows, type Loaded } from "@/lib/dashboard/load";
import type { ClientNotice } from "@/lib/dashboard/tasks";
import { callClock, type CallTimes } from "@/lib/calls/window";
import { checkinsFor, refreshCheckins } from "@/lib/checkins/server";
import { clientStage, periodLabel, type ClientStage } from "@/lib/checkins/status";
import { getEnrollmentDocument } from "@/lib/expectations/server";
import {
  addDays,
  localDate,
  mondayOf,
  versionInForce,
  weekday,
  type NutritionContent,
  type WorkoutContent,
} from "@/lib/programmes/content";
import {
  currentPlanOf,
  loggedSessions,
  myEnrollments,
  plansForEnrollment,
  weekLayout,
  type ClientPlan,
  type LoggedStatus,
  type MyEnrollment,
} from "@/lib/programmes/server";
import { loadSchedule, type ScheduleAppointment, type ScheduleProposal } from "@/lib/scheduling/server";
import { buildOverview } from "@/lib/tracking/overview";
import { foodDays, trackingFocus, trackingPreferences, trackingWriteState, type WriteState } from "@/lib/tracking/server";
import { METRIC_LABEL } from "@/lib/tracking/progress";

/*
 * The client's "what do I need to do today?", read through their own
 * session. Every figure comes from the same functions as the screen it links
 * to (the plan, progress, check-in, session and billing pages), so the two
 * never disagree. Each relationship is loaded and labelled separately: one
 * coach's plan, sessions or messages are never mixed into another's.
 */

export interface WeekCell {
  date: string;
  day: number;
  sessions: number;
  logged: number;
  rest: boolean;
  noPlan: boolean;
}

export interface TodaySession {
  title: string;
  minutes: number | null;
  exercises: number;
  href: string;
  logged: LoggedStatus | null;
}

export type TodayWorkout =
  | { kind: "waiting"; firstPlanScheduled: boolean }
  | { kind: "in_order"; title: string }
  | { kind: "sessions"; sessions: TodaySession[] }
  | { kind: "rest"; note: string | null };

export interface CheckinSummary {
  /** Open for the client to answer: due, or a draft to finish. */
  open: { id: string; stage: ClientStage; dueAt: string; timezone: string; period: string } | null;
  /** Sent and waiting, or corrected and waiting again. */
  waiting: { id: string; stage: ClientStage; period: string }[];
  /** Feedback on a recent period. */
  feedback: { id: string; period: string }[];
}

export interface ProgressSummary {
  focus: string[];
  consistency: { completed: number; partial: number; due: number } | "in_order" | "no_plan";
  strength: { name: string; metric: string; unit: string; first: number; latest: number; points: number }[];
  weight: { readings: number; first: number | null; latest: number | null; unit: string } | null;
  measurements: { label: string; first: number | null; latest: number | null; readings: number; unit: string }[];
}

export interface NutritionSummary {
  plan: { title: string; version: number; calories: number | null; proteinG: number | null; meals: number } | null;
  today: { entries: number; complete: boolean };
}

export interface PackageSummary {
  purchaseId: string;
  title: string;
  state: string;
  serviceType: string;
  paidThrough: string | null;
  cancelling: boolean;
  callsIncluded: boolean;
  allowance: { allowed: number; used: number | null; periodEnd: string | null } | null;
}

export interface OnboardingStep {
  key: string;
  label: string;
  href: string;
  done: boolean;
  note?: string;
}

export interface Relationship {
  e: MyEnrollment;
  writeState: WriteState;
  pkg: Loaded<PackageSummary | null>;
  today: Loaded<{ workout: TodayWorkout; week: WeekCell[] | null; weekStart: string }>;
  checkins: Loaded<CheckinSummary>;
  nutrition: Loaded<NutritionSummary>;
  progress: Loaded<ProgressSummary>;
  onboarding: Loaded<OnboardingStep[]>;
  notices: Loaded<ClientNotice[]>;
}

export interface ConversationLink {
  id: string;
  enrollmentId: string | null;
  coachName: string;
  unread: number;
  canSend: boolean;
  state: string;
}

export interface ClientDashboard {
  /** When this was read. */
  now: string;
  today: string;
  current: Relationship[];
  pending: MyEnrollment[];
  ended: MyEnrollment[];
  schedule: Loaded<{
    upcoming: (ScheduleAppointment & { joinable: boolean })[];
    toAnswer: ScheduleProposal[];
    mine: ScheduleProposal[];
    recentlyClosed: ScheduleProposal[];
    cancelled: ScheduleAppointment[];
  }>;
  messages: Loaded<ConversationLink[]>;
  marks: Loaded<{ item_key: string; action: "snoozed" | "handled" | "dismissed"; snoozed_until: string | null; through_seq: number | null }[]>;
  unreadNotifications: number | null;
}

const RECENT_DAYS = 30;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function todayFor(e: MyEnrollment, plans: ClientPlan[], today: string, tz: string | null, now: Date) {
  const workout = currentPlanOf(plans, "workout", e.openAssignmentId);
  const weekStart = mondayOf(today);
  const inForce = workout ? versionInForce(workout.versions, now) : null;
  if (!workout || !inForce) {
    return { workout: { kind: "waiting", firstPlanScheduled: Boolean(workout) } as TodayWorkout, week: null, weekStart };
  }
  const content = inForce.content as WorkoutContent;
  if (content.schedule === "in_order") return { workout: { kind: "in_order", title: inForce.title } as TodayWorkout, week: null, weekStart };

  const [days, logged] = await Promise.all([weekLayout(workout, weekStart, today, tz, now), loggedSessions(e.id, weekStart, addDays(weekStart, 6))]);
  const base = `/account/progress/${e.id}/workouts`;
  const todayPlan = days[weekday(today)];
  const week: WeekCell[] = days.map((d) => ({
    date: d.date,
    day: d.day,
    sessions: d.sessions.length,
    // Finished (completed, partly done or skipped); a workout still in progress isn't ticked yet.
    logged: d.sessions.filter((p) => {
      const l = logged.get(`${d.date}:${p.session.key}`);
      return l && l.status !== "in_progress";
    }).length,
    rest: d.versionId !== null && d.sessions.length === 0,
    noPlan: d.versionId === null,
  }));
  if (!todayPlan?.sessions.length) return { workout: { kind: "rest", note: todayPlan?.restNote ?? null } as TodayWorkout, week, weekStart };
  return {
    workout: {
      kind: "sessions",
      sessions: todayPlan.sessions.map((p) => {
        const l = logged.get(`${today}:${p.session.key}`);
        return {
          title: p.session.title,
          minutes: p.session.minutes,
          exercises: p.session.exercises.length,
          logged: l?.status ?? null,
          href: l ? `${base}/${l.id}` : `${base}/new?${new URLSearchParams({ version: p.versionId, session: p.session.key, date: today }).toString()}`,
        };
      }),
    } as TodayWorkout,
    week,
    weekStart,
  };
}

async function checkinSummary(e: MyEnrollment, live: boolean, today: string): Promise<CheckinSummary> {
  // The same idempotent step the check-ins page takes, so both show the same request.
  if (live) await refreshCheckins(e.id);
  const list = await checkinsFor(e.id);
  const stage = (c: (typeof list)[number]) => clientStage(c, c.hasDraft, c.feedbackCoversLatest, c.anyFeedback);
  const open = list.find((c) => c.status === "open") ?? null;
  const recent = addDays(today, -21);
  return {
    open: open ? { id: open.id, stage: stage(open), dueAt: open.due_at, timezone: open.timezone, period: periodLabel(open.period_start, open.period_end) } : null,
    waiting: list
      .filter((c) => ["awaiting_feedback", "reopened"].includes(stage(c)) && !c.needs_resolution)
      .map((c) => ({ id: c.id, stage: stage(c), period: periodLabel(c.period_start, c.period_end) })),
    feedback: list
      .filter((c) => stage(c) === "feedback_received" && c.period_end >= recent)
      .slice(0, 2)
      .map((c) => ({ id: c.id, period: periodLabel(c.period_start, c.period_end) })),
  };
}

async function progressSummary(e: MyEnrollment, plans: ClientPlan[], today: string, tz: string | null, userId: string): Promise<ProgressSummary> {
  const [prefs, focus] = await Promise.all([trackingPreferences(userId), trackingFocus(e.id, e.openAssignmentId)]);
  const o = await buildOverview({
    enrollmentId: e.id,
    plans,
    range: { id: "custom", from: addDays(today, -27), to: today, label: "Last 4 weeks" },
    today,
    timeZone: tz,
    weightUnit: prefs.weight_unit,
    lengthUnit: prefs.length_unit,
  });
  const fields = focus?.fields ?? [];
  const measured = o.measurements.filter((m) => m.readings > 0 || fields.includes(m.field));
  return {
    focus: fields,
    consistency: !o.hasPlan ? "no_plan" : o.inOrder ? "in_order" : { completed: o.consistency.counts.completed, partial: o.consistency.counts.partial, due: o.consistency.due },
    strength: o.series
      .filter((s) => s.points.length >= 2)
      .sort((a, b) => b.points.length - a.points.length)
      .slice(0, 2)
      .map((s) => ({ name: s.name, metric: METRIC_LABEL[s.metric], unit: s.unit, first: s.points[0].value, latest: s.points.at(-1)!.value, points: s.points.length })),
    // Weight only when it is something they record or their coach asked about — never assumed.
    weight: o.weights.length || fields.includes("bodyweight")
      ? { readings: o.weights.length, first: o.weights[0]?.value ?? null, latest: o.weights.at(-1)?.value ?? null, unit: prefs.weight_unit }
      : null,
    measurements: measured.map((m) => ({ label: m.label, first: m.first?.value ?? null, latest: m.latest?.value ?? null, readings: m.readings, unit: prefs.length_unit })),
  };
}

async function nutritionSummary(e: MyEnrollment, plans: ClientPlan[], today: string, now: Date): Promise<NutritionSummary> {
  const plan = currentPlanOf(plans, "nutrition", e.openAssignmentId);
  const v = plan ? versionInForce(plan.versions, now) : null;
  const c = v?.content as NutritionContent | undefined;
  const [day] = await foodDays(e.id, today, today);
  return {
    plan: v && c ? { title: v.title, version: v.version, calories: c.targets?.calories ?? null, proteinG: c.targets?.proteinG ?? null, meals: c.meals.length } : null,
    today: { entries: day?.entries.length ?? 0, complete: day?.complete ?? false },
  };
}

async function packageSummary(e: MyEnrollment): Promise<PackageSummary | null> {
  const supabase = (await createClient())!;
  const { data: en } = await supabase.from("enrollments").select("purchase_id").eq("id", e.id).maybeSingle();
  if (!en?.purchase_id) return null;
  const p = rows(await supabase.from("purchases")
    .select("id, state, service_type, paid_through_at, inclusions_snapshot, subscriptions(cancel_at_period_end)")
    .eq("id", en.purchase_id).maybeSingle());
  if (!p) return null;
  const snap = (p.inclusions_snapshot ?? {}) as Record<string, unknown>;
  const sub = (Array.isArray(p.subscriptions) ? p.subscriptions[0] : p.subscriptions) as { cancel_at_period_end?: boolean } | null;
  const included = (num(snap.calls_included_per_month) ?? 0) > 0;
  let allowance: PackageSummary["allowance"] = null;
  if (included) {
    const a = rows(await supabase.rpc("my_call_allowance", { p_enrollment: e.id })) as { allowed: number; used: number | null; period_end: string | null } | null;
    allowance = a ? { allowed: a.allowed, used: a.used, periodEnd: a.period_end } : null;
  }
  return {
    purchaseId: p.id as string,
    title: (snap.title as string) ?? e.planTitle,
    state: p.state as string,
    serviceType: p.service_type as string,
    paidThrough: (p.paid_through_at as string) ?? null,
    cancelling: p.state === "cancelling" || Boolean(sub?.cancel_at_period_end),
    callsIncluded: included,
    allowance,
  };
}

async function onboardingSteps(e: MyEnrollment, userId: string, pkg: PackageSummary | null, doc: Awaited<ReturnType<typeof getEnrollmentDocument>>): Promise<OnboardingStep[]> {
  const supabase = (await createClient())!;
  const [training, appts] = await Promise.all([
    supabase.from("client_training_profiles").select("customer_id").eq("customer_id", userId).maybeSingle(),
    supabase.from("appointments").select("id", { count: "exact", head: true }).eq("enrollment_id", e.id),
  ]);
  if (training.error || appts.error) throw new Error("onboarding");
  const steps: OnboardingStep[] = [
    { key: "training", label: "Tell your coach about your training, equipment and food", href: "/account/training-profile", done: Boolean(training.data) },
  ];
  const latest = doc?.presentations[0];
  if (latest?.acknowledgement_requested) {
    steps.push({
      key: "ack",
      label: "Read your welcome & expectations and confirm you've read them",
      href: `/account/expectations/${e.id}`,
      done: Boolean(latest.acknowledged_at),
      note: "Your coaching isn't held up by this.",
    });
  }
  if (pkg?.callsIncluded && e.state === "active") {
    steps.push({ key: "book", label: "Book your first session", href: "/account/appointments", done: (appts.count ?? 0) > 0 });
  }
  return steps;
}

function noticesFor(e: MyEnrollment, plans: ClientPlan[], doc: Awaited<ReturnType<typeof getEnrollmentDocument>>, now: Date): ClientNotice[] {
  const since = now.getTime() - RECENT_DAYS * 86_400_000;
  const out: ClientNotice[] = [];
  for (const p of plans) {
    // Only this coach's plans; an earlier coach's updates stay in the history.
    if (p.assignment_id !== e.openAssignmentId) continue;
    for (const v of p.versions) {
      if (!v.published_at || !v.notified || v.withdrawn_at || Date.parse(v.published_at) < since) continue;
      const scheduled = v.effective_from && Date.parse(v.effective_from) > now.getTime();
      out.push({
        key: `planver:${v.id}`,
        enrollmentId: e.id,
        coachName: p.coachName,
        title: `${v.version === 1 ? "New" : "Updated"} ${p.kind === "workout" ? "workout" : "nutrition"} plan${scheduled ? `, starting ${v.effective_from!.slice(0, 10)}` : ""}`,
        detail: v.change_summary ? v.change_summary.slice(0, 160) : null,
        href: `/account/plan/${e.id}/history?v=${v.id}`,
        at: v.published_at,
        actionNeeded: false,
      });
    }
  }
  for (const pr of doc?.presentations ?? []) {
    if (pr.source === "purchase" || pr.source === "legacy") continue;
    const waiting = pr.acknowledgement_requested && !pr.acknowledged_at;
    if (!waiting && Date.parse(pr.presented_at) < since) continue;
    out.push({
      key: `exp:${pr.id}`,
      enrollmentId: e.id,
      coachName: pr.coachName,
      title: pr.source === "reassignment" ? "Welcome & expectations from your new coach" : "Updated welcome & expectations",
      detail: "Reading it doesn't mean you accept any change. Questions go to your coach or TalentYak support.",
      href: `/account/expectations/${e.id}`,
      at: pr.presented_at,
      actionNeeded: waiting,
    });
  }
  return out;
}

async function relationship(e: MyEnrollment, session: SessionContext, now: Date, today: string): Promise<Relationship> {
  const tz = session.profile.timezone;
  const [writeState, plans, doc] = await Promise.all([
    trackingWriteState(e.id),
    plansForEnrollment(e.id).catch(() => null),
    getEnrollmentDocument(e.id).catch(() => null),
  ]);
  const withPlans = <T>(name: string, fn: (p: ClientPlan[]) => Promise<T>) =>
    attempt(name, async () => {
      if (!plans) throw new Error("plans");
      return fn(plans);
    });
  const pkg = await attempt("package", () => packageSummary(e));
  const [today_, checkins, nutrition, progress, onboarding] = await Promise.all([
    withPlans("today", (p) => todayFor(e, p, today, tz, now)),
    attempt("checkins", () => checkinSummary(e, writeState === "live" || writeState === "logging_paused", today)),
    withPlans("nutrition", (p) => nutritionSummary(e, p, today, now)),
    withPlans("progress", (p) => progressSummary(e, p, today, tz, session.userId)),
    attempt("onboarding", () => onboardingSteps(e, session.userId, pkg.ok ? pkg.data : null, doc)),
  ]);
  const notices: Loaded<ClientNotice[]> = plans ? { ok: true, data: noticesFor(e, plans, doc, now) } : { ok: false };
  return { e, writeState, pkg, today: today_, checkins, nutrition, progress, onboarding, notices };
}

export async function clientDashboard(session: SessionContext): Promise<ClientDashboard> {
  const now = new Date();
  const tz = session.profile.timezone;
  const today = localDate(now, tz);
  const supabase = (await createClient())!;
  const all = await myEnrollments(session.userId);
  const current = all.filter((e) => e.state === "active" || e.state === "paused");

  const [relationships, schedule, messages, marks, unread] = await Promise.all([
    Promise.all(current.map((e) => relationship(e, session, now, today))),
    attempt("schedule", async () => {
      const s = await loadSchedule("customer", { userId: session.userId });
      const soon = s.upcoming.filter((a) => a.state === "booked").slice(0, 5);
      const info = await Promise.all(
        soon.map(async (a) => {
          const { data } = await supabase.rpc("appointment_call_info", { p_appointment: a.id });
          const c = data as { opens_at: string; closes_at: string } | null;
          if (!c) return false;
          const times: CallTimes = { startsAt: a.starts_at, endsAt: a.ends_at, opensAt: c.opens_at, closesAt: c.closes_at };
          return callClock(now.getTime(), times).canJoin;
        }),
      );
      const { data: cancelled, error } = await supabase.from("appointments")
        .select("id, kind, state, state_reason, starts_at, ends_at, provider_timezone, customer_timezone, series_id, time_note, purpose, enrollment_id, purchase_id, customer_id, provider_id")
        .eq("customer_id", session.userId).eq("state", "cancelled").gte("starts_at", now.toISOString()).order("starts_at").limit(5);
      if (error) throw new Error("cancelled");
      const names = new Map(s.upcoming.concat(s.past).map((a) => [a.provider_id, a.otherName]));
      return {
        upcoming: s.upcoming.map((a) => ({ ...a, joinable: info[soon.indexOf(a)] === true })),
        toAnswer: s.proposals.filter((p) => p.state === "pending" && p.proposed_by !== session.userId),
        mine: s.proposals.filter((p) => p.state === "pending" && p.proposed_by === session.userId),
        // Answered in the last few days without a booking (loadSchedule reads only recent ones).
        recentlyClosed: s.proposals.filter((p) => p.proposed_by === session.userId && ["declined", "expired", "conflicted"].includes(p.state)),
        cancelled: ((cancelled ?? []) as unknown as ScheduleAppointment[]).map((a) => ({ ...a, otherName: names.get(a.provider_id) ?? "Your coach", otherTz: a.provider_timezone })),
      };
    }),
    attempt("messages", async () => {
      const list = rows(await supabase.rpc("my_conversations")) as { conversation_id: string; role: string; state: string; can_send: boolean; other_name: string; unread_count: number }[];
      const mine = list.filter((c) => c.role === "customer");
      const { data: convs } = mine.length ? await supabase.from("conversations").select("id, enrollment_id").in("id", mine.map((c) => c.conversation_id)) : { data: [] };
      return mine.map((c) => ({
        id: c.conversation_id,
        enrollmentId: ((convs ?? []).find((x) => x.id === c.conversation_id)?.enrollment_id as string) ?? null,
        coachName: c.other_name,
        unread: Number(c.unread_count),
        canSend: c.can_send,
        state: c.state,
      }));
    }),
    attempt("marks", async () => rows(await supabase.from("dashboard_marks").select("item_key, action, snoozed_until, through_seq").eq("area", "client"))),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);

  return {
    now: now.toISOString(),
    today,
    current: relationships,
    pending: all.filter((e) => e.state === "pending"),
    ended: all.filter((e) => e.state === "ended"),
    schedule,
    messages,
    marks: marks as ClientDashboard["marks"],
    unreadNotifications: unread.error ? null : (unread.count ?? 0),
  };
}
