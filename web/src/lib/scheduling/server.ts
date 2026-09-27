import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  APPOINTMENT_COLUMNS,
  PROPOSAL_COLUMNS,
  type AppointmentCard,
  type ProposalCard,
} from "@/lib/scheduling/types";

/*
 * Reads go through the signed-in person's session, so row-level security
 * decides what they see. The one exception is the other person's display name
 * for rows the person has ALREADY been allowed to read — looked up by id after
 * the access check, and only the name.
 */

export interface ScheduleAppointment extends AppointmentCard {
  enrollment_id: string | null;
  purchase_id: string | null;
  customer_id: string;
  provider_id: string;
  otherName: string;
  otherTz: string;
}

export interface ScheduleProposal extends ProposalCard {
  kind: "coaching" | "consultation";
  enrollment_id: string | null;
  purchase_id: string | null;
  customer_id: string;
  provider_id: string;
  otherName: string;
  otherTz: string | null;
}

export interface CoachScheduleSettings {
  durations_minutes: number[];
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  min_notice_minutes: number;
  horizon_days: number;
  daily_limit: number | null;
  auto_confirm_client_requests: boolean;
}

async function names(role: "customer" | "coach", ids: { customer_id: string; provider_id: string }[]) {
  const admin = createAdminClient();
  const out = new Map<string, { name: string; tz: string | null }>();
  if (!admin || ids.length === 0) return out;
  if (role === "customer") {
    const { data } = await admin.from("providers").select("id, display_name, timezone").in("id", [...new Set(ids.map((i) => i.provider_id))]);
    for (const p of data ?? []) out.set(p.id as string, { name: p.display_name as string, tz: (p.timezone as string) ?? null });
  } else {
    const { data } = await admin.from("profiles").select("id, preferred_name, full_name, timezone").in("id", [...new Set(ids.map((i) => i.customer_id))]);
    for (const p of data ?? []) {
      const first = (p.preferred_name as string) || ((p.full_name as string) ?? "").split(" ")[0] || "Client";
      out.set(p.id as string, { name: first, tz: (p.timezone as string) ?? null });
    }
  }
  return out;
}

export async function loadSchedule(role: "customer" | "coach", who: { userId: string; providerId?: string }): Promise<{
  upcoming: ScheduleAppointment[];
  past: ScheduleAppointment[];
  proposals: ScheduleProposal[];
}> {
  const supabase = await createClient();
  if (!supabase) return { upcoming: [], past: [], proposals: [] };
  const col = role === "customer" ? "customer_id" : "provider_id";
  const val = role === "customer" ? who.userId : who.providerId ?? "";
  const since = new Date(Date.now() - 2 * 3600_000).toISOString();
  const cols = `${APPOINTMENT_COLUMNS}, enrollment_id, purchase_id, customer_id, provider_id`;

  const [up, past, props] = await Promise.all([
    supabase.from("appointments").select(cols).eq(col, val).gte("starts_at", since).in("state", ["held", "booked", "tentative", "on_hold"]).order("starts_at").limit(100),
    supabase.from("appointments").select(cols).eq(col, val).lt("starts_at", since).in("state", ["booked", "cancelled"]).order("starts_at", { ascending: false }).limit(20),
    supabase.from("appointment_proposals").select(`${PROPOSAL_COLUMNS}, kind, enrollment_id, purchase_id, customer_id, provider_id`).eq(col, val)
      .or(`state.eq.pending,created_at.gte.${new Date(Date.now() - 3 * 86_400_000).toISOString()}`).order("created_at", { ascending: false }).limit(50),
  ]);

  const rows = [...(up.data ?? []), ...(past.data ?? []), ...(props.data ?? [])] as { customer_id: string; provider_id: string }[];
  const who2 = await names(role, rows);
  const other = (r: { customer_id: string; provider_id: string }) => who2.get(role === "customer" ? r.provider_id : r.customer_id);
  const toAppt = (r: Record<string, unknown>) => {
    const a = r as unknown as ScheduleAppointment;
    return { ...a, otherName: other(a)?.name ?? (role === "customer" ? "Your coach" : "Client"), otherTz: role === "customer" ? a.provider_timezone : a.customer_timezone };
  };
  return {
    upcoming: (up.data ?? []).map(toAppt),
    past: (past.data ?? []).map(toAppt),
    proposals: ((props.data ?? []) as unknown as ScheduleProposal[]).map((p) => ({
      ...p, otherName: other(p)?.name ?? (role === "customer" ? "Your coach" : "Client"), otherTz: other(p)?.tz ?? null,
    })),
  };
}

export interface AppointmentDetail extends ScheduleAppointment {
  events: { from_state: string | null; to_state: string; actor_role: string; reason: string | null; created_at: string }[];
  outcomes: { outcome: string; note: string | null; recorded_role: string; recorded_at: string }[];
  series: { reference_timezone: string; weekday: number; local_start: string; interval_weeks: number; state: string } | null;
  pending: ScheduleProposal[];
}

export async function loadAppointment(id: string, role: "customer" | "coach"): Promise<AppointmentDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: a } = await supabase.from("appointments").select(`${APPOINTMENT_COLUMNS}, enrollment_id, purchase_id, customer_id, provider_id`).eq("id", id).maybeSingle();
  if (!a) return null;
  const [{ data: events }, { data: outcomes }, { data: series }, { data: pending }] = await Promise.all([
    supabase.from("appointment_events").select("from_state, to_state, actor_role, reason, created_at").eq("appointment_id", id).order("created_at"),
    supabase.from("appointment_outcomes").select("outcome, note, recorded_role, recorded_at").eq("appointment_id", id).order("recorded_at", { ascending: false }),
    a.series_id
      ? supabase.from("appointment_series").select("reference_timezone, weekday, local_start, interval_weeks, state").eq("id", a.series_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("appointment_proposals").select(`${PROPOSAL_COLUMNS}, kind, enrollment_id, purchase_id, customer_id, provider_id`).eq("replaces_appointment_id", id).eq("state", "pending"),
  ]);
  const n = await names(role, [a as { customer_id: string; provider_id: string }]);
  const o = n.get(role === "customer" ? a.provider_id : a.customer_id);
  const base = a as unknown as ScheduleAppointment;
  return {
    ...base,
    otherName: o?.name ?? (role === "customer" ? "Your coach" : "Client"),
    otherTz: role === "customer" ? base.provider_timezone : base.customer_timezone,
    events: events ?? [],
    outcomes: outcomes ?? [],
    series: (series as AppointmentDetail["series"]) ?? null,
    pending: ((pending ?? []) as unknown as ScheduleProposal[]).map((p) => ({ ...p, otherName: o?.name ?? "", otherTz: o?.tz ?? null })),
  };
}

export async function coachScheduleSettings(providerId: string): Promise<CoachScheduleSettings> {
  const supabase = await createClient();
  const fallback: CoachScheduleSettings = {
    durations_minutes: [30, 45, 60], buffer_before_minutes: 0, buffer_after_minutes: 10, min_notice_minutes: 720,
    horizon_days: 28, daily_limit: null, auto_confirm_client_requests: false,
  };
  if (!supabase) return fallback;
  const { data } = await supabase.rpc("coach_schedule", { p_provider: providerId });
  return (data as CoachScheduleSettings | null) ?? fallback;
}

export async function freeSlots(providerId: string, duration: number, days = 14): Promise<string[]> {
  const supabase = await createClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("available_slots", { p_provider: providerId, p_duration: duration, p_from: null, p_days: days });
  if (error) return [];
  return ((data ?? []) as { starts_at: string }[]).map((r) => r.starts_at);
}

/**
 * For a conversation the viewer has ALREADY been allowed to open: the coach's
 * session lengths and the other person's time zone, for cards and suggestions.
 */
export async function conversationSchedule(conversationId: string, role: "customer" | "coach"): Promise<{ durations: number[]; otherTz: string | null }> {
  const admin = createAdminClient();
  if (!admin) return { durations: [60], otherTz: null };
  const { data: conv } = await admin.from("conversations").select("provider_id, customer_id").eq("id", conversationId).maybeSingle();
  if (!conv) return { durations: [60], otherTz: null };
  const [settings, other] = await Promise.all([
    coachScheduleSettings(conv.provider_id as string),
    role === "customer"
      ? admin.from("providers").select("timezone").eq("id", conv.provider_id).maybeSingle()
      : admin.from("profiles").select("timezone").eq("id", conv.customer_id).maybeSingle(),
  ]);
  return { durations: settings.durations_minutes, otherTz: (other.data?.timezone as string) ?? null };
}
