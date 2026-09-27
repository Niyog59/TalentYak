"use server";

import { revalidatePath } from "next/cache";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { DURATION_CHOICES } from "@/lib/scheduling/types";

/*
 * A coach's availability is their own configuration. They write it through
 * their own session; row-level security limits every row to their provider
 * record. Changing availability never touches a booked session — conflicts
 * are listed on the calendar for the coach to resolve.
 */

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function db() {
  const session = await requireCoach("/coach/calendar");
  const supabase = await createClient();
  if (!supabase) throw new Error("Database not configured");
  return { session, supabase };
}

function int(form: FormData, name: string, lo: number, hi: number): number | null | "invalid" {
  const raw = field(form, name, 6);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : "invalid";
}

export async function saveScheduleSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { session, supabase } = await db();
  const durations = form.getAll("durations").map(Number).filter((d) => DURATION_CHOICES.includes(d)).sort((a, b) => a - b);
  const before = int(form, "buffer_before_minutes", 0, 120);
  const after = int(form, "buffer_after_minutes", 0, 120);
  const notice = int(form, "min_notice_hours", 0, 168);
  const horizon = int(form, "horizon_days", 1, 180);
  const limit = int(form, "daily_limit", 1, 24);
  const fieldErrors: Record<string, string> = {};
  if (durations.length === 0) fieldErrors.durations = "Choose at least one length.";
  if (before === "invalid") fieldErrors.buffer_before_minutes = "0 to 120 minutes.";
  if (after === "invalid") fieldErrors.buffer_after_minutes = "0 to 120 minutes.";
  if (notice === "invalid") fieldErrors.min_notice_hours = "0 to 168 hours.";
  if (horizon === "invalid") fieldErrors.horizon_days = "1 to 180 days.";
  if (limit === "invalid") fieldErrors.daily_limit = "1 to 24, or leave empty.";
  if (Object.keys(fieldErrors).length) return fail("Check the highlighted fields.", { fieldErrors });

  const n = (v: number | null | "invalid", fallback: number | null) => (typeof v === "number" ? v : fallback);
  const { error } = await supabase.from("coach_schedule_settings").upsert({
    provider_id: session.provider.id,
    durations_minutes: durations,
    buffer_before_minutes: n(before, 0),
    buffer_after_minutes: n(after, 0),
    min_notice_minutes: (n(notice, 0) ?? 0) * 60,
    horizon_days: n(horizon, 28),
    daily_limit: n(limit, null),
    auto_confirm_client_requests: form.get("auto_confirm") === "on",
  });
  if (error) return fail("That didn't save. Please try again.");
  revalidatePath("/coach/calendar");
  return succeed("Saved. Sessions already booked are not changed.");
}

export async function addWindowAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { session, supabase } = await db();
  const days = form.getAll("weekday").map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const start = field(form, "start_time", 5);
  const end = field(form, "end_time", 5);
  if (days.length === 0) return fail("Choose at least one day.", { fieldErrors: { weekday: "Required." } });
  if (!TIME.test(start) || !TIME.test(end) || end <= start) return fail("The end time must be after the start time.", { fieldErrors: { end_time: "After the start." } });
  const { error } = await supabase.from("availability_windows").insert(days.map((weekday) => ({ provider_id: session.provider.id, weekday, start_time: start, end_time: end })));
  if (error) return fail("That didn't save. Please try again.");
  revalidatePath("/coach/calendar");
  return succeed("Hours added.");
}

export async function removeWindowAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await db();
  const { error } = await supabase.from("availability_windows").delete().eq("id", field(form, "id", 40));
  if (error) return fail("That didn't save. Please try again.");
  revalidatePath("/coach/calendar");
  return succeed("Removed. Any booked session that no longer fits is listed under Clashes — it stays booked until you decide.");
}

export async function addExceptionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { session, supabase } = await db();
  const kind = form.get("kind") === "extra" ? "extra" : "unavailable";
  const from = field(form, "starts_on", 10);
  const to = field(form, "ends_on", 10) || from;
  const start = field(form, "start_time", 5);
  const end = field(form, "end_time", 5);
  if (!DATE.test(from) || !DATE.test(to) || to < from) return fail("Choose the dates.", { fieldErrors: { starts_on: "Required." } });
  if ((start || end || kind === "extra") && (!TIME.test(start) || !TIME.test(end) || end <= start)) {
    return fail(kind === "extra" ? "Extra hours need a start and end time." : "Give both times, or neither for whole days.", { fieldErrors: { end_time: "Check the times." } });
  }
  const { error } = await supabase.from("availability_exceptions").insert({
    provider_id: session.provider.id, kind, starts_on: from, ends_on: to,
    start_time: start || null, end_time: end || null, note: field(form, "note", 200) || null,
  });
  if (error) return fail("That didn't save. Please try again.");
  revalidatePath("/coach/calendar");
  return succeed(kind === "extra" ? "Extra hours added." : "Time off added. Booked sessions in it are listed under Clashes.");
}

export async function removeExceptionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const { supabase } = await db();
  const { error } = await supabase.from("availability_exceptions").delete().eq("id", field(form, "id", 40));
  if (error) return fail("That didn't save. Please try again.");
  revalidatePath("/coach/calendar");
  return succeed("Removed.");
}
