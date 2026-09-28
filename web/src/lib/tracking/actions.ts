"use server";

import { revalidatePath } from "next/cache";
import { requireCoach, requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { isKey } from "@/lib/programmes/content";
import { FOCUS_LABEL } from "@/lib/tracking/labels";

/*
 * Settings, not entries: the client's units and reminders, and what the coach
 * finds useful to track. Tracking entries themselves go through the save
 * route, which the device can retry.
 */

export async function saveTrackingPreferencesAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded("/account/progress");
  const supabase = await createClient();
  if (!supabase) return fail("That didn't save. Please try again.");
  const { error } = await supabase.from("tracking_preferences").upsert({
    customer_id: session.userId,
    weight_unit: field(form, "weight_unit", 2) === "lb" ? "lb" : "kg",
    length_unit: field(form, "length_unit", 2) === "in" ? "in" : "cm",
    log_reminders: field(form, "log_reminders", 3) === "on",
  });
  if (error) return fail("That didn't save. Please try again.");
  revalidatePath("/account/progress", "layout");
  return succeed("Saved. Everything you've recorded is shown in these units; nothing stored is changed.");
}

export async function setTrackingFocusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach/programmes");
  const enrollmentId = field(form, "enrollment_id", 40);
  if (!isKey(enrollmentId)) return fail("That client couldn't be found.");
  const limit = await rateLimit("tracking_focus", session.userId, 30, 600);
  if (!limit.allowed) return fail(tooMany(limit));
  const fields = form.getAll("fields").map(String).filter((f) => f in FOCUS_LABEL);
  const supabase = await createClient();
  if (!supabase) return fail("That didn't save. Please try again.");
  const { error } = await supabase.rpc("set_tracking_focus", {
    p_enrollment: enrollmentId,
    p_fields: fields,
    p_note: field(form, "note", 500) || null,
  });
  if (error) {
    return fail(
      error.message.includes("tracking_not_permitted")
        ? "You can't change this right now. Coaching may be paused or ended, or this client may no longer be assigned to you."
        : "That didn't save. Please try again.",
    );
  }
  revalidatePath(`/coach/programmes/clients/${enrollmentId}/progress`);
  return succeed("Saved. Your client sees this on their progress pages — as suggestions, all optional.");
}
