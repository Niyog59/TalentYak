"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCoach, requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { isDateOnly, isKey } from "@/lib/programmes/content";
import { isUuid, normalizeQuestions, starterQuestions, STARTER_TITLE } from "@/lib/checkins/questions";

/*
 * Coaches and clients act through their own sessions. The database functions
 * decide who may do what — a paused, suspended, reassigned or ended
 * relationship is refused there, as is anything outside the approved review
 * exception. This file validates input and turns refusals into words.
 */

function checkinError(message: string | undefined, fallback = "That didn't save. Please try again."): string {
  const m = message ?? "";
  if (m.includes("checkin_not_permitted")) return "You can't do that right now. Coaching may be paused or ended, or this client may no longer be assigned to you.";
  if (m.includes("checkin_template_invalid")) return "Check the questions: each needs wording, and photos, clips and sensitive questions can't be required.";
  if (m.includes("checkin_timezone_invalid")) return "Choose the client's timezone from the list.";
  if (m.includes("checkin_schedule_invalid")) return "Choose a template, how often, and a due day and time.";
  if (m.includes("checkin_schedule_missing")) return "Set up a check-in schedule first.";
  if (m.includes("checkin_break_invalid")) return "Choose a break that ends today or later, no longer than six months.";
  if (m.includes("checkin_feedback_empty")) return "Write some feedback or add a next step before publishing.";
  if (m.includes("checkin_feedback_required")) return "Publish feedback on the latest answers before marking the review complete.";
  if (m.includes("checkin_not_awaiting_review")) return "This check-in isn't waiting for a review.";
  if (m.includes("checkin_step_version_invalid")) return "Choose a plan version that was published after this check-in was sent.";
  if (m.includes("checkin_feedback_invalid")) return "That feedback couldn't be saved as it is. Reload the page and try again.";
  return fallback;
}

function coachPaths(checkinId?: string, enrollmentId?: string) {
  revalidatePath("/coach/check-ins");
  if (checkinId) revalidatePath(`/coach/check-ins/${checkinId}`);
  if (enrollmentId) {
    revalidatePath(`/coach/check-ins/clients/${enrollmentId}`);
    revalidatePath(`/account/progress/${enrollmentId}/check-ins`, "layout");
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function saveCheckinTemplateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach/check-ins");
  const limit = await rateLimit("checkin_template_save", session.userId, 60, 600);
  if (!limit.allowed) return fail(tooMany(limit));
  const title = field(form, "title", 80);
  if (!title) return fail("Give the template a name.", { fieldErrors: { title: "Give the template a name." } });
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(form.get("questions") ?? "[]"));
  } catch {
    return fail("That didn't save. Reload the page and try again.");
  }
  const { questions, problems } = normalizeQuestions(parsed);
  if (problems.length) return fail(`Please fix: ${problems.join(" ")}`);
  const id = field(form, "template_id", 36);
  const supabase = await createClient();
  if (!supabase) return fail("That didn't save. Please try again.");
  const { data, error } = await supabase.rpc("save_checkin_template", { p_template: isKey(id) ? id : null, p_title: title, p_questions: questions });
  if (error || !data) return fail(checkinError(error?.message));
  coachPaths();
  if (!isKey(id)) redirect(`/coach/check-ins/templates/${data}?saved=1`);
  revalidatePath(`/coach/check-ins/templates/${id}`);
  return succeed("Saved as a new version. Check-ins already sent keep the questions they were asked with; the next ones use these.");
}

export async function createStarterTemplateAction(_: ActionState, _form: FormData): Promise<ActionState> {
  await requireCoach("/coach/check-ins");
  const supabase = await createClient();
  if (!supabase) return fail("That didn't work. Please try again.");
  const { data, error } = await supabase.rpc("save_checkin_template", { p_template: null, p_title: STARTER_TITLE, p_questions: starterQuestions() });
  if (error || !data) return fail(checkinError(error?.message, "That didn't work. Please try again."));
  coachPaths();
  redirect(`/coach/check-ins/templates/${data}?saved=1`);
}

export async function archiveCheckinTemplateAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/check-ins");
  const id = field(form, "template_id", 36);
  const supabase = await createClient();
  if (!supabase || !isKey(id)) return fail("That didn't work. Please try again.");
  const archive = form.get("archive") === "1";
  const { error } = await supabase.rpc("archive_checkin_template", { p_template: id, p_archive: archive });
  if (error) return fail(checkinError(error.message, "That didn't work. Please try again."));
  coachPaths();
  revalidatePath(`/coach/check-ins/templates/${id}`);
  return succeed(archive ? "Archived. Schedules already using it carry on; you can't choose it for new ones." : "Restored.");
}

// ---------------------------------------------------------------------------
// Schedules, pauses and breaks
// ---------------------------------------------------------------------------

export async function saveCheckinScheduleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach/check-ins");
  const enrollmentId = field(form, "enrollment_id", 36);
  const templateId = field(form, "template_id", 36);
  if (!isKey(enrollmentId)) return fail("That client couldn't be found.");
  if (!isKey(templateId)) return fail("Choose a template.", { fieldErrors: { template_id: "Choose a template." } });
  const limit = await rateLimit("checkin_schedule_save", session.userId, 30, 600);
  if (!limit.allowed) return fail(tooMany(limit));
  const interval = Number(field(form, "interval_weeks", 2));
  const weekday = Number(field(form, "due_weekday", 2));
  const time = field(form, "due_time", 5);
  const timezone = field(form, "timezone", 64);
  const responseRaw = field(form, "response_days", 2);
  const response = responseRaw ? Number(responseRaw) : null;
  if (![1, 2, 4].includes(interval) || !(weekday >= 1 && weekday <= 7) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return fail("Choose how often, and a due day and time.");
  }
  if (response !== null && !(Number.isInteger(response) && response >= 1 && response <= 14)) {
    return fail("Your reply time must be between 1 and 14 working days, or left blank.", { fieldErrors: { response_days: "1 to 14, or blank." } });
  }
  const supabase = await createClient();
  if (!supabase) return fail("That didn't save. Please try again.");
  const { error } = await supabase.rpc("set_checkin_schedule", {
    p_enrollment: enrollmentId,
    p_template: templateId,
    p_interval_weeks: interval,
    p_due_weekday: weekday,
    p_due_time: time,
    p_timezone: timezone,
    p_response_days: response,
  });
  if (error) return fail(checkinError(error.message));
  coachPaths(undefined, enrollmentId);
  return succeed("Saved. It applies from now on: a check-in already open keeps its questions and due time, and nothing is added for past weeks.");
}

export async function pauseCheckinsAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/check-ins");
  const enrollmentId = field(form, "enrollment_id", 36);
  const supabase = await createClient();
  if (!supabase || !isKey(enrollmentId)) return fail("That didn't work. Please try again.");
  const resume = form.get("resume") === "1";
  const { error } = resume
    ? await supabase.rpc("resume_checkin_schedule", { p_enrollment: enrollmentId })
    : await supabase.rpc("pause_checkin_schedule", { p_enrollment: enrollmentId, p_note: field(form, "note", 300) || null });
  if (error) return fail(checkinError(error.message, "That didn't work. Please try again."));
  coachPaths(undefined, enrollmentId);
  return succeed(resume ? "Resumed from the current period. Nothing is asked for the paused weeks." : "Paused. No new check-ins will be asked for until you resume. Coaching itself carries on as normal.");
}

async function breakAction(form: FormData, path: string, who: "coach" | "client"): Promise<ActionState> {
  const session = who === "coach" ? await requireCoach(path) : await requireOnboarded(path);
  const limit = await rateLimit("checkin_break", session.userId, 20, 600);
  if (!limit.allowed) return fail(tooMany(limit));
  const enrollmentId = field(form, "enrollment_id", 36);
  const from = field(form, "starts_on", 10);
  const to = field(form, "ends_on", 10);
  if (!isKey(enrollmentId)) return fail("That didn't work. Please try again.");
  if (!isDateOnly(from) || !isDateOnly(to) || to < from) return fail("Choose the first and last day of the break.", { fieldErrors: { ends_on: "The last day must be on or after the first." } });
  const supabase = await createClient();
  if (!supabase) return fail("That didn't save. Please try again.");
  const { error } = await supabase.rpc("add_checkin_break", { p_enrollment: enrollmentId, p_from: from, p_to: to, p_note: field(form, "note", 200) || null });
  if (error) return fail(checkinError(error.message));
  coachPaths(undefined, enrollmentId);
  revalidatePath(path);
  return succeed("Break added. No check-in is asked for while it lasts.");
}

export async function addCheckinBreakAction(_: ActionState, form: FormData): Promise<ActionState> {
  return breakAction(form, "/coach/check-ins", "coach");
}

export async function addMyCheckinBreakAction(_: ActionState, form: FormData): Promise<ActionState> {
  const enrollmentId = field(form, "enrollment_id", 36);
  return breakAction(form, `/account/progress/${enrollmentId}/check-ins`, "client");
}

export async function cancelCheckinBreakAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireOnboarded("/account");
  const id = field(form, "break_id", 36);
  const enrollmentId = field(form, "enrollment_id", 36);
  const supabase = await createClient();
  if (!supabase || !isKey(id)) return fail("That didn't work. Please try again.");
  const { error } = await supabase.rpc("cancel_checkin_break", { p_break: id });
  if (error) return fail(checkinError(error.message, "That didn't work. Please try again."));
  coachPaths(undefined, isKey(enrollmentId) ? enrollmentId : undefined);
  return succeed("Break cancelled.");
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

function readSteps(form: FormData): { key: string; text: string; kind: "action" | "plan_change" }[] | null {
  const texts = form.getAll("step_text").map((v) => String(v).trim().slice(0, 200));
  const kinds = form.getAll("step_kind").map(String);
  const keys = form.getAll("step_key").map(String);
  const out: { key: string; text: string; kind: "action" | "plan_change" }[] = [];
  texts.forEach((text, i) => {
    if (!text) return;
    out.push({ key: isUuid(keys[i]) ? keys[i] : crypto.randomUUID(), text, kind: kinds[i] === "plan_change" ? "plan_change" : "action" });
  });
  return out.length > 8 ? null : out;
}

export async function saveFeedbackAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach/check-ins");
  const checkinId = field(form, "checkin_id", 36);
  if (!isKey(checkinId)) return fail("That check-in couldn't be found.");
  const limit = await rateLimit("checkin_feedback", session.userId, 120, 600);
  if (!limit.allowed) return fail(tooMany(limit));
  const steps = readSteps(form);
  if (!steps) return fail("Use at most eight next steps.");
  const body = String(form.get("body") ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (body.length > 5000) return fail("Keep feedback under 5,000 characters.", { fieldErrors: { body: "Under 5,000 characters." } });
  const planId = field(form, "plan_id", 36);
  const supabase = await createClient();
  if (!supabase) return fail("That didn't save. Please try again.");
  const { data: feedbackId, error } = await supabase.rpc("save_checkin_feedback", {
    p_checkin: checkinId,
    p_body: body,
    p_next_steps: steps,
    p_plan: isKey(planId) ? planId : null,
    p_link_conversation: form.get("link_conversation") === "on",
  });
  if (error || !feedbackId) return fail(checkinError(error?.message));
  if (form.get("intent") === "publish") {
    const { error: publishError } = await supabase.rpc("publish_checkin_feedback", { p_feedback: feedbackId });
    if (publishError) return fail(checkinError(publishError.message, "Saved as a draft, but it couldn't be published. Please try again."));
    coachPaths(checkinId);
    return succeed("Published. Your client can read it now and is told. When you've finished, mark the review complete.");
  }
  coachPaths(checkinId);
  return succeed("Draft saved. Your client can't see it until you publish.");
}

export async function discardFeedbackAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/check-ins");
  const id = field(form, "feedback_id", 36);
  const checkinId = field(form, "checkin_id", 36);
  const supabase = await createClient();
  if (!supabase || !isKey(id)) return fail("That didn't work. Please try again.");
  const { error } = await supabase.rpc("discard_checkin_feedback", { p_feedback: id });
  if (error) return fail(checkinError(error.message, "That didn't work. Please try again."));
  coachPaths(isKey(checkinId) ? checkinId : undefined);
  return succeed("Draft discarded.");
}

export async function completeReviewAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/check-ins");
  const checkinId = field(form, "checkin_id", 36);
  const supabase = await createClient();
  if (!supabase || !isKey(checkinId)) return fail("That didn't work. Please try again.");
  const { error } = await supabase.rpc("complete_checkin_review", { p_checkin: checkinId });
  if (error) return fail(checkinError(error.message, "That didn't work. Please try again."));
  coachPaths(checkinId);
  return succeed("Marked complete.");
}

export async function linkStepAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/check-ins");
  const feedbackId = field(form, "feedback_id", 36);
  const stepKey = field(form, "step_key", 36);
  const versionId = field(form, "version_id", 36);
  const checkinId = field(form, "checkin_id", 36);
  const supabase = await createClient();
  if (!supabase || !isKey(feedbackId) || !isUuid(stepKey)) return fail("That didn't work. Please try again.");
  const { error } = await supabase.rpc("link_checkin_step", { p_feedback: feedbackId, p_step: stepKey, p_version: isKey(versionId) ? versionId : null });
  if (error) return fail(checkinError(error.message, "That didn't work. Please try again."));
  coachPaths(isKey(checkinId) ? checkinId : undefined);
  return succeed(isKey(versionId) ? "Linked. Your client sees this step as a published plan update." : "Link removed. The step shows as promised again.");
}
