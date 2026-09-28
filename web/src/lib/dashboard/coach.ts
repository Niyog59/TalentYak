import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProviderSummary, SessionContext } from "@/lib/auth";
import { attempt, rows, type Loaded } from "@/lib/dashboard/load";
import type { BalanceRow, CoachTask, Mark } from "@/lib/dashboard/tasks";
import { callClock } from "@/lib/calls/window";
import { periodLabel } from "@/lib/checkins/status";
import { localDate, scheduledVersions, type VersionTiming } from "@/lib/programmes/content";
import { loadSchedule, type ScheduleAppointment } from "@/lib/scheduling/server";
import { durationLabel, whenIn } from "@/lib/scheduling/types";

/*
 * The coach's "who needs my attention?", read through their own session.
 * Every source is the feature's own query — the check-in queue, the
 * conversation list, the booking requests, the plans — so a task leaves the
 * list only when that record changes. Each source loads separately; if one
 * can't be read the queue says which, and its counts don't pretend to be
 * complete.
 */

export type SourceName = "checkins" | "messages" | "bookings" | "plans";

export const SOURCE_LABEL: Record<SourceName, string> = {
  checkins: "check-ins",
  messages: "messages",
  bookings: "booking requests",
  plans: "plans",
};

export interface CoachClientRow {
  enrollmentId: string;
  name: string;
  /** The name, with the plan when this client has more than one relationship with the coach. */
  label: string;
  offerTitle: string;
  purchaseState: string;
  enrollmentState: string | null;
  paidThrough: string | null;
  assignedFrom: string;
  conversationId: string | null;
  activity: {
    recordsVisible: boolean;
    lastWorkoutOn: string | null;
    lastBodyOn: string | null;
    lastFoodOn: string | null;
    lastCheckinAt: string | null;
    lastMessageAt: string | null;
    workouts: number;
    body: number;
    foodDays: number;
    checkins: number;
  } | null;
}

export interface PlanWork {
  enrollmentId: string;
  name: string;
  /** No published workout plan for this stint yet. */
  awaitingWorkout: boolean;
  drafts: { kind: string; updatedAt: string }[];
  scheduled: { kind: string; version: number; from: string }[];
}

export interface CapacitySummary {
  status: string;
  max_active_clients: number | null;
  capacity_ceiling: number | null;
  accepting_new_clients: boolean;
  commitments: number;
  held_checkouts: number;
}

export interface PayoutRow {
  id: string;
  currency: string;
  amount_minor: number;
  state: string;
  paid_at: string | null;
  created_at: string;
}

export interface CoachDashboard {
  /** When this was read; every "waiting" and "due" is measured from it. */
  now: string;
  tasks: CoachTask[];
  failed: SourceName[];
  marks: Loaded<Mark[]>;
  unreadMessages: number | null;
  clients: Loaded<CoachClientRow[]>;
  plans: Loaded<PlanWork[]>;
  today: Loaded<(ScheduleAppointment & { joinable: boolean })[]>;
  capacity: Loaded<CapacitySummary>;
  away: Loaded<{ away_until: string | null; away_note: string | null } | null>;
  earnings: Loaded<{ balances: BalanceRow[]; payouts: PayoutRow[] }>;
}

interface QueueRow {
  checkin_id: string;
  enrollment_id: string;
  client_name: string;
  period_start: string;
  period_end: string;
  status: string;
  last_submitted_at: string | null;
  current_revision: number;
  feedback_published: boolean;
  review_due: string | null;
  mine: boolean;
  may_review: boolean;
}

interface AttentionRow {
  conversation_id: string;
  enrollment_id: string;
  client_name: string;
  state: string;
  can_send: boolean;
  unread_count: number;
  last_client_seq: number | null;
  waiting_since: string | null;
  awaiting_reply: boolean;
}

async function checkinTasks(): Promise<CoachTask[]> {
  const supabase = (await createClient())!;
  const queue = (rows(await supabase.rpc("coach_checkin_queue")) ?? []) as QueueRow[];
  // Waiting for this coach's feedback on the latest version, and theirs to give.
  const waiting = queue.filter((q) => q.mine && q.may_review && !q.feedback_published && (q.status === "submitted" || q.status === "reopened"));
  if (!waiting.length) return [];

  // A form-check clip counts only when the client attached one to what they
  // sent AND this coach may watch it: the media policy answers the second.
  const subs = rows(await supabase.from("checkin_submissions").select("checkin_id, revision, media_ids").in("checkin_id", waiting.map((w) => w.checkin_id))) ?? [];
  const latest = new Map<string, string[]>();
  for (const w of waiting) {
    const s = subs.filter((x) => x.checkin_id === w.checkin_id).sort((a, b) => (b.revision as number) - (a.revision as number))[0];
    latest.set(w.checkin_id, (s?.media_ids as string[] | null) ?? []);
  }
  const mediaIds = [...new Set([...latest.values()].flat())];
  const videos = new Set<string>();
  if (mediaIds.length) {
    const media = rows(await supabase.from("media_assets").select("id").in("id", mediaIds).eq("media_kind", "video").is("deleted_at", null)) ?? [];
    for (const m of media) videos.add(m.id as string);
  }

  // Paid access has ended (or is paused): the review is still this coach's to
  // finish under the approved exception, and says so.
  const enrollments = [...new Set(waiting.map((w) => w.enrollment_id))];
  const live = new Map(
    await Promise.all(enrollments.map(async (id) => [id, (await supabase.rpc("coaching_is_live", { e_id: id })).data === true] as const)),
  );

  return waiting.map((w) => {
    const rereview = w.status === "reopened";
    const formReview = (latest.get(w.checkin_id) ?? []).some((id) => videos.has(id));
    return {
      key: `checkin:${w.checkin_id}`,
      kind: "checkin" as const,
      enrollmentId: w.enrollment_id,
      clientName: w.client_name,
      title: rereview ? `${w.client_name} updated a check-in you'd already answered` : `Check-in from ${w.client_name}`,
      detail: [periodLabel(w.period_start, w.period_end), formReview ? "includes a form-check clip" : null].filter(Boolean).join(" · "),
      href: `/coach/check-ins/${w.checkin_id}`,
      dueAt: w.review_due,
      dueLabel: w.review_due ? ("reply_by" as const) : null,
      since: w.last_submitted_at,
      rereview,
      formReview,
      afterPaidAccess: live.get(w.enrollment_id) === false,
      snoozable: true,
    };
  });
}

async function messageTasks(): Promise<{ tasks: CoachTask[]; unread: number }> {
  const supabase = (await createClient())!;
  const list = (rows(await supabase.rpc("coach_message_attention")) ?? []) as AttentionRow[];
  const unread = list.reduce((n, c) => n + Number(c.unread_count), 0);
  const tasks = list
    // Only a conversation the coach can still reply in is theirs to answer.
    .filter((c) => c.awaiting_reply && c.can_send)
    .map((c) => {
      const n = Number(c.unread_count);
      return {
        key: `msg:${c.conversation_id}`,
        kind: "message" as const,
        enrollmentId: c.enrollment_id,
        clientName: c.client_name,
        title: `${c.client_name} is waiting for a reply`,
        detail: n ? `${n} unread message${n === 1 ? "" : "s"}` : "Read — not answered yet",
        href: `/coach/messages/${c.conversation_id}`,
        dueAt: null,
        dueLabel: null,
        since: c.waiting_since,
        lastClientSeq: Number(c.last_client_seq ?? 0),
        unread: n,
        snoozable: true,
      };
    });
  return { tasks, unread };
}

async function bookingTasks(providerId: string, userId: string, tz: string | null): Promise<CoachTask[]> {
  const s = await loadSchedule("coach", { userId, providerId });
  return s.proposals
    .filter((p) => p.state === "pending" && p.proposer_role === "customer")
    .map((p) => ({
      key: `proposal:${p.id}`,
      kind: "booking" as const,
      enrollmentId: p.enrollment_id,
      clientName: p.otherName,
      title: p.replaces_appointment_id ? `${p.otherName} asked to move a session` : p.kind === "consultation" ? `${p.otherName} chose a time for their one-off session` : `${p.otherName} asked for a session`,
      detail: `${whenIn(p.starts_at, tz)} · ${durationLabel(p.duration_minutes)}${p.recurrence === "weekly" ? " · every week" : ""}`,
      href: "/coach/calendar#answer-heading",
      dueAt: p.expires_at,
      dueLabel: "expires" as const,
      since: null,
      snoozable: true,
    }));
}

type VersionRow = VersionTiming & { plan_id: string; updated_at: string };

async function planWork(clientRows: { enrollment_id: string; client_name: string; enrollmentState: string | null }[], providerId: string): Promise<PlanWork[]> {
  const supabase = (await createClient())!;
  const ids = clientRows.map((c) => c.enrollment_id);
  if (!ids.length) return [];
  const [{ data: assignments, error: aErr }, plansRes] = await Promise.all([
    supabase.from("enrollment_assignments").select("id, enrollment_id").in("enrollment_id", ids).eq("provider_id", providerId).is("effective_to", null),
    supabase.from("client_plans").select("id, enrollment_id, assignment_id, kind").in("enrollment_id", ids).eq("provider_id", providerId),
  ]);
  if (aErr) throw new Error("assignments");
  const plans = rows(plansRes) ?? [];
  const versions = plans.length
    ? ((rows(await supabase.from("client_plan_versions").select("id, plan_id, version, published_at, effective_from, withdrawn_at, updated_at").in("plan_id", plans.map((p) => p.id))) ?? []) as VersionRow[])
    : [];
  const now = new Date();
  return clientRows.map((c) => {
    const stint = (assignments ?? []).find((a) => a.enrollment_id === c.enrollment_id)?.id;
    // This stint's plans only: a copy started from an earlier coach's plan is
    // the new coach's own once it exists.
    const mine = plans.filter((p) => p.enrollment_id === c.enrollment_id && (!stint || p.assignment_id === stint));
    const of = (kind: string) => versions.filter((v) => mine.some((p) => p.id === v.plan_id && p.kind === kind));
    const workout = of("workout");
    return {
      enrollmentId: c.enrollment_id,
      name: c.client_name,
      awaitingWorkout: !workout.some((v) => v.published_at && !v.withdrawn_at),
      drafts: mine.flatMap((p) => versions.filter((v) => v.plan_id === p.id && !v.published_at).map((v) => ({ kind: p.kind as string, updatedAt: v.updated_at }))),
      scheduled: mine.flatMap((p) => scheduledVersions(versions.filter((v) => v.plan_id === p.id), now).map((v) => ({ kind: p.kind as string, version: v.version, from: v.effective_from! }))),
    };
  });
}

export async function coachDashboard(session: SessionContext & { provider: ProviderSummary }): Promise<CoachDashboard> {
  const supabase = (await createClient())!;
  const provider = session.provider;
  const tz = provider.timezone;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const clientsBase = attempt("clients", async () => {
    const list = (rows(await supabase.rpc("my_clients")) ?? []) as { enrollment_id: string; client_name: string; offer_title: string; purchase_state: string; assigned_from: string; paid_through: string | null }[];
    const ids = list.map((c) => c.enrollment_id);
    const [states, activity, convs] = await Promise.all([
      ids.length ? supabase.from("enrollments").select("id, state").in("id", ids) : Promise.resolve({ data: [], error: null }),
      supabase.rpc("coach_client_activity", { p_since: weekAgo }),
      ids.length ? supabase.from("conversations").select("id, enrollment_id, assignment_id, created_at").in("enrollment_id", ids).eq("provider_id", provider.id) : Promise.resolve({ data: [], error: null }),
    ]);
    const act = new Map(((activity.data ?? []) as Record<string, unknown>[]).map((a) => [a.enrollment_id as string, a]));
    return list.map((c): CoachClientRow => {
      const a = act.get(c.enrollment_id);
      const conv = ((convs.data ?? []) as { id: string; enrollment_id: string; created_at: string }[])
        .filter((x) => x.enrollment_id === c.enrollment_id)
        .sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
      return {
        enrollmentId: c.enrollment_id,
        name: c.client_name,
        label: list.filter((x) => x.client_name === c.client_name).length > 1 ? `${c.client_name} (${c.offer_title})` : c.client_name,
        offerTitle: c.offer_title,
        purchaseState: c.purchase_state,
        enrollmentState: ((states.data ?? []) as { id: string; state: string }[]).find((s) => s.id === c.enrollment_id)?.state ?? null,
        paidThrough: c.paid_through,
        assignedFrom: c.assigned_from,
        conversationId: conv?.id ?? null,
        activity: activity.error || !a
          ? null
          : {
              recordsVisible: a.records_visible === true,
              lastWorkoutOn: (a.last_workout_on as string) ?? null,
              lastBodyOn: (a.last_body_on as string) ?? null,
              lastFoodOn: (a.last_food_on as string) ?? null,
              lastCheckinAt: (a.last_checkin_at as string) ?? null,
              lastMessageAt: (a.last_client_message_at as string) ?? null,
              workouts: Number(a.workouts_since ?? 0),
              body: Number(a.body_since ?? 0),
              foodDays: Number(a.food_since ?? 0),
              checkins: Number(a.checkins_since ?? 0),
            },
      };
    });
  });

  const [checkins, messages, bookings, clients, marks, today, capacity, away, earnings] = await Promise.all([
    attempt("checkin tasks", checkinTasks),
    attempt("message tasks", messageTasks),
    attempt("booking tasks", () => bookingTasks(provider.id, session.userId, tz)),
    clientsBase,
    attempt("marks", async () => (rows(await supabase.from("dashboard_marks").select("item_key, action, snoozed_until, through_seq").eq("area", "coach")) ?? []) as Mark[]),
    attempt("today", async () => {
      const s = await loadSchedule("coach", { userId: session.userId, providerId: provider.id });
      const day = localDate(now, tz);
      const todays = s.upcoming.filter((a) => localDate(new Date(a.starts_at), tz) === day || (Date.parse(a.starts_at) <= now.getTime() && Date.parse(a.ends_at) > now.getTime()));
      return Promise.all(
        todays.map(async (a) => {
          if (a.state !== "booked") return { ...a, joinable: false };
          // A coaching call can be joined only while that coaching is live (M10 refuses otherwise).
          if (a.enrollment_id && (await supabase.rpc("coaching_is_live", { e_id: a.enrollment_id })).data !== true) return { ...a, joinable: false };
          const { data } = await supabase.rpc("appointment_call_info", { p_appointment: a.id });
          const c = data as { opens_at: string; closes_at: string } | null;
          const joinable = c ? callClock(now.getTime(), { startsAt: a.starts_at, endsAt: a.ends_at, opensAt: c.opens_at, closesAt: c.closes_at }).canJoin : false;
          return { ...a, joinable };
        }),
      );
    }),
    attempt("capacity", async () => rows(await supabase.rpc("my_capacity_summary")) as CapacitySummary),
    attempt("away", async () => rows(await supabase.from("coach_messaging_profiles").select("away_until, away_note").eq("provider_id", provider.id).maybeSingle()) as { away_until: string | null; away_note: string | null } | null),
    attempt("earnings", async () => {
      const [balances, payouts] = await Promise.all([
        supabase.from("coach_balances").select("currency, pending_minor, held_minor, eligible_minor, batched_minor, paid_minor").eq("provider_id", provider.id),
        supabase.from("payout_batch_items").select("id, currency, amount_minor, state, paid_at, created_at").eq("provider_id", provider.id).order("created_at", { ascending: false }).limit(5),
      ]);
      return { balances: (rows(balances) ?? []) as BalanceRow[], payouts: (rows(payouts) ?? []) as PayoutRow[] };
    }),
  ]);

  const plans: Loaded<PlanWork[]> = clients.ok
    ? await attempt("plans", () =>
        planWork(
          clients.data
            .filter((c) => c.enrollmentState === "active" || c.enrollmentState === "paused")
            .map((c) => ({ enrollment_id: c.enrollmentId, client_name: c.label, enrollmentState: c.enrollmentState })),
          provider.id,
        ),
      )
    : { ok: false };

  // Plans to write or finish, for clients whose coaching is live.
  const planTasks: CoachTask[] = plans.ok && clients.ok
    ? plans.data
        .filter((p) => clients.data.find((c) => c.enrollmentId === p.enrollmentId)?.enrollmentState === "active")
        .filter((p) => p.awaitingWorkout || p.drafts.length)
        .map((p) => {
          const since = p.drafts.length
            ? p.drafts.map((d) => d.updatedAt).sort()[0]
            : clients.data.find((c) => c.enrollmentId === p.enrollmentId)?.assignedFrom ?? null;
          return {
            key: `plan:${p.enrollmentId}`,
            kind: "plan" as const,
            enrollmentId: p.enrollmentId,
            clientName: p.name,
            title: p.awaitingWorkout ? `${p.name} doesn't have a workout plan from you yet` : `Finish the draft plan for ${p.name}`,
            detail: p.drafts.length ? `${p.drafts.length} draft${p.drafts.length === 1 ? "" : "s"} not published` : null,
            href: `/coach/programmes/clients/${p.enrollmentId}`,
            dueAt: null,
            dueLabel: null,
            since,
            snoozable: true,
          };
        })
    : [];

  const failed: SourceName[] = [];
  if (!checkins.ok) failed.push("checkins");
  if (!messages.ok) failed.push("messages");
  if (!bookings.ok) failed.push("bookings");
  if (!plans.ok) failed.push("plans");

  // Two relationships with the same client: say which plan each item belongs to.
  const labelOf = new Map(clients.ok ? clients.data.filter((c) => c.label !== c.name).map((c) => [c.enrollmentId, c.label] as const) : []);
  const labelled = (t: CoachTask): CoachTask => {
    const l = t.enrollmentId ? labelOf.get(t.enrollmentId) : undefined;
    return l && !t.title.includes(l) ? { ...t, detail: [l, t.detail].filter(Boolean).join(" · ") } : t;
  };

  return {
    now: now.toISOString(),
    tasks: [...(checkins.ok ? checkins.data : []), ...(messages.ok ? messages.data.tasks : []), ...(bookings.ok ? bookings.data : []), ...planTasks].map(labelled),
    failed,
    marks,
    unreadMessages: messages.ok ? messages.data.unread : null,
    clients,
    plans,
    today,
    capacity,
    away,
    earnings,
  };
}
