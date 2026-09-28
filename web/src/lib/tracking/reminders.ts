import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications";
import {
  layOutWeek,
  localDate,
  mondayOf,
  normalize,
  startOfLocalDay,
  versionInForce,
  weekday,
  type SessionMove,
  type VersionTiming,
  type WorkoutContent,
} from "@/lib/programmes/content";

/*
 * A gentle nudge: one in-app notice, in the client's evening, on a day their
 * plan has a session that nothing has been logged for yet. Never an email,
 * never on a rest day, never while coaching is paused, at most one a day and
 * three a week, and off for anyone who switched it off. The notice says a
 * workout is planned — never what it is, or anything the client recorded.
 */

const WINDOW_START = 19;
const WINDOW_END = 22;
const WEEKLY_CAP = 3;

function hourIn(tz: string | null, at: Date): number {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", hour: "2-digit", hourCycle: "h23" }).format(at));
  } catch {
    return at.getUTCHours();
  }
}

export async function sendLogReminders(now = new Date()): Promise<number> {
  const admin = createAdminClient();
  if (!admin) return 0;

  const { data: enrollments } = await admin
    .from("enrollments")
    .select("id, customer_id, profiles!enrollments_customer_id_fkey(timezone, suspended_at)")
    .eq("state", "active")
    .limit(2000);

  type Row = { id: string; customer_id: string; profiles: { timezone: string | null; suspended_at: string | null } | null };
  const due = ((enrollments ?? []) as unknown as Row[]).filter((e) => {
    if (!e.profiles || e.profiles.suspended_at) return false;
    const h = hourIn(e.profiles.timezone, now);
    return h >= WINDOW_START && h < WINDOW_END;
  });
  if (!due.length) return 0;

  const { data: optedOut } = await admin
    .from("tracking_preferences")
    .select("customer_id")
    .in("customer_id", due.map((e) => e.customer_id))
    .eq("log_reminders", false);
  const off = new Set((optedOut ?? []).map((r) => r.customer_id as string));

  let sent = 0;
  for (const e of due) {
    if (off.has(e.customer_id)) continue;
    const tz = e.profiles!.timezone;
    const today = localDate(now, tz);
    const dedupeKey = `log-reminder:${e.id}:${today}`;

    const { data: already } = await admin.from("notifications").select("id").eq("profile_id", e.customer_id).eq("dedupe_key", dedupeKey).maybeSingle();
    if (already) continue;
    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", e.customer_id)
      .like("dedupe_key", "log-reminder:%")
      .gte("created_at", new Date(now.getTime() - 7 * 86_400_000).toISOString());
    if ((count ?? 0) >= WEEKLY_CAP) continue;

    const { data: live } = await admin.rpc("coaching_is_live", { e_id: e.id });
    if (live !== true) continue;

    const { data: plans } = await admin.from("client_plans").select("id").eq("enrollment_id", e.id).eq("kind", "workout");
    const planIds = (plans ?? []).map((p) => p.id as string);
    if (!planIds.length) continue;
    const weekStart = mondayOf(today);
    const [{ data: versions }, { data: moves }, { data: logs }] = await Promise.all([
      admin.from("client_plan_versions").select("id, version, content, published_at, effective_from, withdrawn_at").in("plan_id", planIds).not("published_at", "is", null),
      admin.from("plan_session_moves").select("session_key, week_start, to_day, created_at").in("plan_id", planIds).eq("week_start", weekStart),
      admin.from("workout_logs").select("session_key, performed_at, plan_version_id").eq("enrollment_id", e.id).gte("performed_at", weekStart).lte("performed_at", today),
    ]);
    const vs = ((versions ?? []) as (VersionTiming & { content: unknown })[]).map((v) => ({ ...v, content: normalize("workout", v.content).content as WorkoutContent }));
    const byId = new Map(vs.map((v) => [v.id, v]));
    const week = layOutWeek({
      weekStart,
      versionForDay: (date) => {
        const v = versionInForce(vs, date === today ? now : startOfLocalDay(date, tz));
        return v ? { id: v.id, content: v.content } : null;
      },
      versionById: (id) => {
        const v = byId.get(id);
        return v ? { id: v.id, content: v.content } : null;
      },
      moves: (moves ?? []) as SessionMove[],
      started: (logs ?? []).filter((l) => l.session_key && l.plan_version_id).map((l) => ({ performed_on: l.performed_at as string, session_key: l.session_key as string, version_id: l.plan_version_id as string })),
    });
    const todays = week[weekday(today)].sessions;
    const loggedKeys = new Set((logs ?? []).filter((l) => l.performed_at === today).map((l) => l.session_key as string));
    if (!todays.length || todays.every((p) => loggedKeys.has(p.session.key))) continue;

    await notify({
      profileId: e.customer_id,
      category: "coaching",
      title: "A workout is on your plan today",
      body: "If you've trained, you can log it whenever suits you — or leave it. You can switch these reminders off on your progress page.",
      path: `/account/plan/${e.id}`,
      dedupeKey,
    });
    sent++;
  }
  return sent;
}
