"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { CONFLICT_REASON, OUTCOME_LABEL, scheduleError, whenIn } from "@/lib/scheduling/types";

/*
 * Every scheduling action runs as the signed-in person, through their own
 * database session. The database functions decide who may propose, answer,
 * cancel or record, re-check availability and eligibility, and prevent
 * double bookings. These actions validate input and put refusals into words.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (form: FormData, name: string) => {
  const v = field(form, name, 40);
  return UUID.test(v) ? v : null;
};

function refresh() {
  revalidatePath("/account/appointments", "layout");
  revalidatePath("/coach/calendar", "layout");
  revalidatePath("/account/messages/[id]", "page");
  revalidatePath("/coach/messages/[id]", "page");
}

async function signedIn() {
  const session = await getSession();
  if (!session || session.profile.suspended_at) return null;
  const supabase = await createClient();
  return supabase ? { session, supabase } : null;
}

/**
 * Suggest a time — new, a counter-suggestion, or a new time for an existing
 * meeting. The time arrives either as an instant chosen from a list of free
 * slots, or as a local date and time in a named zone, which the database turns
 * into an instant (and says so if a clock change moved it).
 */
export async function proposeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await signedIn();
  if (!ctx) return fail("Sign in again to continue.");
  const limit = await rateLimit("schedule_propose", ctx.session.userId, 30, 600);
  if (!limit.allowed) return fail(tooMany(limit));

  let startsAt = field(form, "starts_at", 40);
  let note: string | null = null;
  if (!startsAt) {
    const date = field(form, "date", 10);
    const time = field(form, "time", 5);
    const tz = field(form, "timezone", 64);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return fail("Choose a date and a time.", { fieldErrors: { date: "Required.", time: "Required." } });
    }
    const { data, error } = await ctx.supabase.rpc("local_to_instant", { p_date: date, p_time: time, p_tz: tz });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row?.instant) return fail("That time zone isn't recognised. Choose one from the list.");
    startsAt = row.instant as string;
    note = (row.adjustment as string | null) ?? null;
  } else if (Number.isNaN(Date.parse(startsAt))) {
    return fail("Choose a time from the list.");
  }

  const recurrence = form.get("recurrence") === "weekly" ? "weekly" : "none";
  const p: Record<string, unknown> = {
    kind: form.get("kind") === "consultation" ? "consultation" : "coaching",
    enrollment_id: uuid(form, "enrollment_id"),
    purchase_id: uuid(form, "purchase_id"),
    starts_at: startsAt,
    duration_minutes: Number(field(form, "duration_minutes", 4)) || null,
    recurrence,
    // A weekly series is anchored to the clock the time was entered in.
    reference_timezone: recurrence === "weekly" ? field(form, "timezone", 64) || null : null,
    repeat_until: field(form, "repeat_until", 10) || null,
    replaces_appointment_id: uuid(form, "replaces_appointment_id"),
    series_scope: form.get("series_scope") === "future" ? "future" : "this",
    counter_of: uuid(form, "counter_of"),
    request_key: field(form, "request_key", 64),
  };

  const { data, error } = await ctx.supabase.rpc("propose_appointment", { p });
  if (error) return fail(scheduleError(error.message, "That suggestion couldn't be sent. Please try again."));
  refresh();
  const result = data as { state?: string; auto_confirmed?: boolean; reason?: string; appointment_state?: string };
  if (result.auto_confirmed) {
    return result.state === "accepted"
      ? succeed(result.appointment_state === "tentative" ? "Booked — tentative until the next payment goes through." : "Booked. You'll both get a confirmation.")
      : fail(CONFLICT_REASON[result.reason ?? ""] ?? "That time couldn't be confirmed. Choose another.");
  }
  return succeed(`Suggested ${whenIn(startsAt, ctx.session.profile.timezone)}. Nothing is booked until they accept.${note ? ` Note: ${note}.` : ""}`);
}

/** Accept, decline or withdraw. Answering twice returns the first answer. */
export async function respondAction(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await signedIn();
  if (!ctx) return fail("Sign in again to continue.");
  const proposal = uuid(form, "proposal_id");
  const action = field(form, "action", 10);
  if (!proposal || !["accept", "decline", "withdraw"].includes(action)) return fail("That suggestion isn't available.");
  const limit = await rateLimit("schedule_respond", ctx.session.userId, 60, 600);
  if (!limit.allowed) return fail(tooMany(limit));

  const { data, error } = await ctx.supabase.rpc("respond_to_proposal", { p_proposal: proposal, p_action: action });
  if (error) return fail(scheduleError(error.message));
  refresh();
  const r = data as { state: string; reason?: string; appointment_state?: string; repeated?: boolean };
  if (r.repeated && r.state !== "accepted") {
    return fail("That suggestion has already been answered. Refresh to see where it stands.");
  }
  switch (r.state) {
    case "accepted":
      return succeed(r.appointment_state === "tentative"
        ? "Agreed — tentative until the next payment goes through, then confirmed automatically if the time is still free."
        : "Confirmed. You'll both get a confirmation and reminders.");
    case "declined": return succeed("Declined. They've been told.");
    case "withdrawn": return succeed("Withdrawn.");
    case "expired": return fail("That suggestion expired before it was answered. Suggest a new time.");
    case "conflicted": return fail(CONFLICT_REASON[r.reason ?? ""] ?? "That time couldn't be confirmed. Suggest another time.");
    default: return succeed("Done.");
  }
}

export async function cancelAppointmentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await signedIn();
  if (!ctx) return fail("Sign in again to continue.");
  const id = uuid(form, "appointment_id");
  if (!id) return fail("That session isn't available.");
  if (form.get("confirm") !== "on") return fail("Tick the box to confirm.", { fieldErrors: { confirm: "Required." } });
  const scope = form.get("scope") === "future" ? "future" : "this";
  const reason = field(form, "reason", 200) || null;
  const { data, error } = await ctx.supabase.rpc("cancel_appointment", { p_appointment: id, p_scope: scope, p_reason: reason });
  if (error) return fail(scheduleError(error.message));
  refresh();
  const r = data as { count?: number; repeated?: boolean };
  return succeed(r.repeated ? "Already cancelled." : r.count && r.count > 1 ? `${r.count} sessions cancelled. They've been told.` : "Cancelled. They've been told.");
}

/** A record of what happened. Moves no money and changes nothing else. */
export async function recordOutcomeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const ctx = await signedIn();
  if (!ctx) return fail("Sign in again to continue.");
  const id = uuid(form, "appointment_id");
  const outcome = field(form, "outcome", 40);
  if (!id || !(outcome in OUTCOME_LABEL)) return fail("Choose what happened.");
  const { error } = await ctx.supabase.rpc("record_appointment_outcome", {
    p_appointment: id, p_outcome: outcome, p_note: field(form, "note", 500) || null,
  });
  if (error) return fail(scheduleError(error.message));
  refresh();
  return succeed("Recorded.");
}
