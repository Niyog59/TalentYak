"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { friendlyError } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { kickWorker } from "@/lib/worker/outbox";
import { EMAILED_STATUSES, STATUS_LABEL, isApplicationStatus } from "@/lib/coach-applications/rules";

/*
 * Founder decisions on coach applications. Each runs requireAdmin() (a second
 * factor completed in this session) and then calls the database AS the
 * founder: the database checks the admin rule again, allows only valid status
 * changes, records the history and queues any email in the same transaction.
 */

const GENERIC = "That didn't work and nothing was changed. Please try again.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const path = (id: string) => `/admin/coach-applications/${id}`;

async function db() {
  const supabase = await createClient();
  if (!supabase) throw new Error("Database not configured");
  return supabase;
}

function uuidField(form: FormData, name: string): string | null {
  const v = field(form, name, 40);
  return UUID.test(v) ? v : null;
}

export async function setApplicationStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAdmin("/admin/coach-applications");
  const id = uuidField(form, "application_id");
  const to = field(form, "status", 20);
  const reason = field(form, "reason", 1000);
  if (!id || !isApplicationStatus(to)) return fail(GENERIC);
  const emails = EMAILED_STATUSES.includes(to);
  if (emails && form.get("confirm") !== "on") {
    return fail(`Tick the box to confirm. "${STATUS_LABEL[to]}" emails the applicant.`, { fieldErrors: { confirm: "Required for a decision that emails the applicant." } });
  }
  const limit = await rateLimit("admin_application_decision", session.userId, 60, 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  const { error } = await (await db()).rpc("admin_set_coach_application_status", { p_application: id, p_to: to, p_reason: reason || null });
  if (error) return fail(friendlyError(error, GENERIC));
  if (emails) kickWorker();
  revalidatePath(path(id));
  revalidatePath("/admin/coach-applications");
  return succeed(emails ? `Set to ${STATUS_LABEL[to]}. The applicant is being emailed; your reason stays private.` : `Set to ${STATUS_LABEL[to]}. The applicant isn't emailed about this.`);
}

export async function resendAcceptanceAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireAdmin("/admin/coach-applications");
  const id = uuidField(form, "application_id");
  if (!id) return fail(GENERIC);
  const limit = await rateLimit("admin_application_resend", session.userId, 10, 3600);
  if (!limit.allowed) return fail(tooMany(limit));
  const { data, error } = await (await db()).rpc("admin_resend_coach_acceptance", { p_application: id });
  if (error) return fail(friendlyError(error, GENERIC));
  kickWorker();
  revalidatePath(path(id));
  return succeed(`Onboarding invitation queued (sent ${data} time${data === 1 ? "" : "s"} in total).`);
}

export async function addApplicationNoteAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/coach-applications");
  const id = uuidField(form, "application_id");
  const body = field(form, "body", 4000);
  if (!id) return fail(GENERIC);
  if (!body) return fail("Write a note first.", { fieldErrors: { body: "Required." } });
  const { error } = await (await db()).rpc("admin_add_coach_application_note", { p_application: id, p_body: body });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath(path(id));
  return succeed("Note added. Only administrators can see it.");
}

export async function saveChecklistAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/coach-applications");
  const id = uuidField(form, "application_id");
  if (!id) return fail(GENERIC);
  const { error } = await (await db()).rpc("admin_set_coach_application_checklist", {
    p_application: id,
    p_qualification: form.get("qualification_checked") === "on",
    p_communication: form.get("communication") === "on",
    p_scenario: form.get("beginner_scenario") === "on",
    p_referral: form.get("healthcare_referral") === "on",
  });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath(path(id));
  return succeed("Checklist saved.");
}

export async function checkCertificateAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/coach-applications");
  const id = uuidField(form, "application_id");
  const certificateId = uuidField(form, "certificate_id");
  const state = field(form, "state", 20);
  const detail = field(form, "detail", 300);
  if (!id || !certificateId || !["unverified", "verified", "could_not_verify"].includes(state)) return fail(GENERIC);
  const { error } = await (await db()).rpc("admin_check_coach_certificate", { p_certificate: certificateId, p_state: state, p_detail: detail || null });
  if (error) return fail(friendlyError(error, GENERIC), error.message === "reason_required" ? { fieldErrors: { detail: "Say what you checked." } } : {});
  revalidatePath(path(id));
  return succeed("Saved.");
}
