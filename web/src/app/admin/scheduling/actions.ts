"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { scheduleError } from "@/lib/scheduling/types";

/*
 * Admin role and a verified second factor are checked here and again by the
 * database (is_admin() requires aal2). Nothing here moves money: a refund goes
 * through the existing refund flow on the purchase.
 */

export async function saveSchedulingSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAdmin("/admin/scheduling");
  const supabase = (await createClient())!;
  const num = (name: string) => Number(field(form, name, 6));
  const reminders = field(form, "reminder_offsets_minutes", 60).split(/[,\s]+/).filter(Boolean).map(Number);
  if (reminders.some((m) => !Number.isInteger(m) || m < 5 || m > 10080) || reminders.length > 4) {
    return fail("Reminders: up to four values, each 5 to 10080 minutes before.", { fieldErrors: { reminder_offsets_minutes: "Check the values." } });
  }
  const { error } = await supabase.from("scheduling_settings").update({
    proposal_ttl_hours: num("proposal_ttl_hours"),
    reminder_offsets_minutes: reminders,
    default_min_notice_minutes: num("default_min_notice_hours") * 60,
    default_horizon_days: num("default_horizon_days"),
    default_buffer_minutes: num("default_buffer_minutes"),
    slot_hold_minutes: num("slot_hold_minutes"),
    confirm_beyond_paid_through: form.get("confirm_beyond_paid_through") === "on",
    updated_at: new Date().toISOString(),
    updated_by: session.userId,
  }).eq("id", true);
  if (error) return fail("That didn't save. Check the values are in range.");
  revalidatePath("/admin/scheduling");
  return succeed("Saved. These remain development defaults, not approved rules.");
}

export async function resolveConsultationAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/scheduling");
  const supabase = (await createClient())!;
  const { error } = await supabase.rpc("admin_resolve_consultation", {
    p_purchase: field(form, "purchase_id", 40),
    p_action: field(form, "action", 30),
    p_note: field(form, "note", 200),
  });
  if (error) return fail(scheduleError(error.message));
  revalidatePath("/admin/scheduling");
  return succeed("Done.");
}

export async function adminCancelAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/scheduling");
  const supabase = (await createClient())!;
  const reason = field(form, "reason", 200);
  if (!reason) return fail("Give a reason; both people see it.", { fieldErrors: { reason: "Required." } });
  const { error } = await supabase.rpc("cancel_appointment", {
    p_appointment: field(form, "appointment_id", 40), p_scope: "this", p_reason: `TalentYak support: ${reason}`,
  });
  if (error) return fail(scheduleError(error.message));
  revalidatePath("/admin/scheduling");
  return succeed("Cancelled. Both people have been told.");
}
