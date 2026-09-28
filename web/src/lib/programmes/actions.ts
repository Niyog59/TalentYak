"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCoach, requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { cleanText } from "@/lib/expectations/text";
import {
  LIMITS,
  isDateOnly,
  isKey,
  localDate,
  missingForPublish,
  normalize,
  startOfLocalDay,
  type PlanKind,
} from "@/lib/programmes/content";
import { planError } from "@/lib/programmes/labels";
import { myClient } from "@/lib/programmes/server";

/*
 * Coaches and clients act through their own sessions. The database functions
 * decide who may do what — a paused, suspended, reassigned or ended
 * relationship is refused there, not here — keep a published version frozen,
 * and queue the client's notice. This file validates input and turns refusals
 * into words; it is not the security boundary.
 */

const MAX_CONTENT_CHARS = 150_000;

function kindOf(form: FormData): PlanKind | null {
  const k = form.get("kind");
  return k === "workout" || k === "nutrition" ? k : null;
}

function readContent(form: FormData, kind: PlanKind) {
  const raw = form.get("content");
  if (typeof raw !== "string" || raw.length > MAX_CONTENT_CHARS) return { error: "That plan is too large to save. Split it into fewer sessions or meals." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "That didn't save. Reload the page and try again." };
  }
  const { content, problems } = normalize(kind, parsed);
  if (problems.length) return { error: `Please fix: ${problems.join(" ")}` };
  return { content };
}

function coachPaths(enrollmentId?: string, kind?: PlanKind) {
  revalidatePath("/coach/programmes");
  if (enrollmentId) {
    revalidatePath(`/coach/programmes/clients/${enrollmentId}`);
    if (kind) revalidatePath(`/coach/programmes/clients/${enrollmentId}/${kind}`);
    revalidatePath(`/account/plan/${enrollmentId}`);
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function saveTemplateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach/programmes");
  const supabase = await createClient();
  if (!supabase) return fail("That didn't save. Please try again.");
  const limit = await rateLimit("plan_template_save", session.userId, 60, 600);
  if (!limit.allowed) return fail(tooMany(limit));

  const kind = kindOf(form);
  if (!kind) return fail("That didn't save. Reload the page and try again.");
  const title = cleanText(form.get("title"), LIMITS.title);
  if (!title) return fail("Give the template a name.", { fieldErrors: { title: "Give the template a name." } });
  const read = readContent(form, kind);
  if ("error" in read) return fail(read.error!);

  const id = field(form, "template_id", 36);
  if (id) {
    if (!isKey(id)) return fail("That template couldn't be found.");
    const { data, error } = await supabase.from("plan_templates").update({ title, content: read.content }).eq("id", id).select("id").maybeSingle();
    if (error || !data) return fail(planError(error?.message, "That didn't save. Please try again."));
    revalidatePath("/coach/programmes");
    revalidatePath(`/coach/programmes/templates/${id}`);
    return succeed("Template saved. Plans already copied from it are not changed.");
  }

  const { data, error } = await supabase
    .from("plan_templates")
    .insert({ provider_id: session.provider.id, kind, title, content: read.content })
    .select("id")
    .single();
  if (error || !data) return fail(planError(error?.message, "That didn't save. Please try again."));
  revalidatePath("/coach/programmes");
  redirect(`/coach/programmes/templates/${data.id}?saved=1`);
}

export async function archiveTemplateAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/programmes");
  const supabase = await createClient();
  const id = field(form, "template_id", 36);
  if (!supabase || !isKey(id)) return fail("That didn't work. Please try again.");
  const archive = form.get("archive") === "1";
  const { data, error } = await supabase
    .from("plan_templates")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) return fail(planError(error?.message, "That didn't work. Please try again."));
  revalidatePath("/coach/programmes");
  revalidatePath(`/coach/programmes/templates/${id}`);
  return succeed(archive ? "Template archived. Plans copied from it are unchanged." : "Template restored.");
}

// ---------------------------------------------------------------------------
// Client plans
// ---------------------------------------------------------------------------

async function ensurePlan(enrollmentId: string, kind: PlanKind) {
  const supabase = (await createClient())!;
  const { data, error } = await supabase.rpc("ensure_my_client_plan", { p_enrollment: enrollmentId, p_kind: kind });
  return { planId: (data as string | null) ?? null, error };
}

/** When the client's chosen day starts, in the client's own timezone. */
async function effectiveFrom(form: FormData, enrollmentId: string): Promise<{ at: string | null } | { error: string }> {
  if (form.get("when") !== "date") return { at: null };
  const date = field(form, "effective_date", 10);
  if (!isDateOnly(date)) return { error: "Choose the date the update starts." };
  const admin = createAdminClient();
  const { data: e } = admin ? await admin.from("enrollments").select("customer_id").eq("id", enrollmentId).maybeSingle() : { data: null };
  const { data: person } = admin && e ? await admin.from("profiles").select("timezone").eq("id", e.customer_id).maybeSingle() : { data: null };
  const tz = (person?.timezone as string | null) ?? null;
  if (date <= localDate(new Date(), tz)) return { error: "Choose a date after today, or publish it to start now." };
  return { at: startOfLocalDay(date, tz).toISOString() };
}

export async function savePlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach/programmes");
  const supabase = await createClient();
  if (!supabase) return fail("That didn't save. Please try again.");
  const limit = await rateLimit("plan_save", session.userId, 60, 600);
  if (!limit.allowed) return fail(tooMany(limit));

  const enrollmentId = field(form, "enrollment_id", 36);
  const kind = kindOf(form);
  if (!isKey(enrollmentId) || !kind) return fail("That didn't save. Reload the page and try again.");
  // A former coach, or another coach's client, is refused by the database too;
  // this just gives the right words first.
  if (!(await myClient(enrollmentId))) return fail("This client isn't assigned to you.");

  const title = cleanText(form.get("title"), LIMITS.title);
  if (!title) return fail("Give the plan a name.", { fieldErrors: { title: "Give the plan a name." } });
  const read = readContent(form, kind);
  if ("error" in read) return fail(read.error!);

  const { planId, error: planErr } = await ensurePlan(enrollmentId, kind);
  if (planErr || !planId) return fail(planError(planErr?.message, "That didn't save. Please try again."));

  const { error } = await supabase.rpc("save_plan_draft", { p_plan: planId, p_title: title, p_content: read.content });
  if (error) return fail(planError(error.message, "That didn't save. Please try again."));

  if (form.get("intent") !== "publish") {
    coachPaths(enrollmentId, kind);
    return succeed("Draft saved. Your client sees nothing until you publish.");
  }

  const missing = missingForPublish(kind, read.content!);
  if (missing.length) {
    coachPaths(enrollmentId, kind);
    return fail(`Draft saved, but not published. Still needed: ${missing.join("; ")}.`);
  }

  const when = await effectiveFrom(form, enrollmentId);
  if ("error" in when) {
    coachPaths(enrollmentId, kind);
    return fail(`Draft saved, but not published. ${when.error}`, { fieldErrors: { effective_date: when.error } });
  }
  const notify = form.get("quiet") !== "on";
  const summary = cleanText(form.get("change_summary"), LIMITS.summary);

  const pub = await rateLimit("plan_publish", session.userId, 20, 600);
  if (!pub.allowed) return fail(tooMany(pub));

  const { data, error: publishError } = await supabase.rpc("publish_plan_draft", {
    p_plan: planId,
    p_effective_from: when.at,
    p_notify: notify,
    p_summary: summary || null,
  });
  coachPaths(enrollmentId, kind);
  if (publishError || !data) {
    return fail(planError(publishError?.message, "Draft saved, but publishing failed. Please try again."), publishError?.message?.includes("plan_summary_required")
      ? { fieldErrors: { change_summary: "Say briefly what changed, so your client knows." } }
      : {});
  }
  const r = data as { version: number; effective_from: string; notified: boolean; replaced_scheduled: number };
  const later = Date.parse(r.effective_from) > Date.now() + 60_000;
  return succeed(
    `Version ${r.version} is published${later ? " and scheduled" : " and is now current"}.` +
      (r.notified ? " Your client has been told." : " Your client wasn't sent a notice (minor correction).") +
      (r.replaced_scheduled ? ` It replaces ${r.replaced_scheduled === 1 ? "a planned update" : `${r.replaced_scheduled} planned updates`} that hadn't started.` : ""),
  );
}

export async function startDraftFromAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach/programmes");
  const supabase = await createClient();
  if (!supabase) return fail("That didn't work. Please try again.");
  const limit = await rateLimit("plan_save", session.userId, 60, 600);
  if (!limit.allowed) return fail(tooMany(limit));

  const enrollmentId = field(form, "enrollment_id", 36);
  const kind = kindOf(form);
  const templateId = field(form, "template_id", 36);
  const versionId = field(form, "version_id", 36);
  if (!isKey(enrollmentId) || !kind || (!isKey(templateId) && !isKey(versionId))) return fail("Choose what to start from.");
  if (!(await myClient(enrollmentId))) return fail("This client isn't assigned to you.");

  const { planId, error: planErr } = await ensurePlan(enrollmentId, kind);
  if (planErr || !planId) return fail(planError(planErr?.message, "That didn't work. Please try again."));
  const { error } = await supabase.rpc("start_plan_draft_from", {
    p_plan: planId,
    p_template: isKey(templateId) ? templateId : null,
    p_version: isKey(templateId) ? null : versionId,
  });
  if (error) return fail(planError(error.message, "That didn't work. Please try again."));
  coachPaths(enrollmentId, kind);
  redirect(`/coach/programmes/clients/${enrollmentId}/${kind}?copied=1`);
}

export async function discardDraftAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/programmes");
  const supabase = await createClient();
  const planId = field(form, "plan_id", 36);
  const enrollmentId = field(form, "enrollment_id", 36);
  const kind = kindOf(form) ?? undefined;
  if (!supabase || !isKey(planId)) return fail("That didn't work. Please try again.");
  const { error } = await supabase.rpc("discard_plan_draft", { p_plan: planId });
  if (error) return fail(planError(error.message, "That didn't work. Please try again."));
  coachPaths(enrollmentId, kind);
  return succeed("Draft discarded. Published versions are unchanged.");
}

export async function withdrawScheduledAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/programmes");
  const supabase = await createClient();
  const versionId = field(form, "version_id", 36);
  const enrollmentId = field(form, "enrollment_id", 36);
  const kind = kindOf(form) ?? undefined;
  if (!supabase || !isKey(versionId)) return fail("That didn't work. Please try again.");
  const { error } = await supabase.rpc("withdraw_scheduled_plan_version", { p_version: versionId });
  if (error) return fail(planError(error.message, "That didn't work. Please try again."));
  coachPaths(enrollmentId, kind);
  return succeed("The planned update is cancelled. Your client keeps their current plan.");
}

// ---------------------------------------------------------------------------
// Moving a session within one week — client or coach
// ---------------------------------------------------------------------------

export async function moveSessionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded("/account/plan");
  const supabase = await createClient();
  if (!supabase) return fail("That didn't work. Please try again.");
  const limit = await rateLimit("plan_move", session.userId, 30, 600);
  if (!limit.allowed) return fail(tooMany(limit));

  const planId = field(form, "plan_id", 36);
  const versionId = field(form, "version_id", 36);
  const sessionKey = field(form, "session_key", 36);
  const weekStart = field(form, "week_start", 10);
  const toRaw = field(form, "to_day", 2);
  const toDay = toRaw === "" ? null : Number(toRaw);
  if (!isKey(planId) || !isKey(versionId) || !isKey(sessionKey) || !isDateOnly(weekStart) || (toDay !== null && !(toDay >= 0 && toDay <= 6))) {
    return fail("Choose a day to move it to.");
  }
  const { error } = await supabase.rpc("move_plan_session", {
    p_plan: planId,
    p_version: versionId,
    p_session_key: sessionKey,
    p_week_start: weekStart,
    p_to_day: toDay,
    p_reason: cleanText(form.get("reason"), 300) || null,
  });
  if (error) return fail(planError(error.message, "That didn't work. Please try again."));
  const enrollmentId = field(form, "enrollment_id", 36);
  if (isKey(enrollmentId)) {
    revalidatePath(`/account/plan/${enrollmentId}`);
    revalidatePath(`/coach/programmes/clients/${enrollmentId}`);
  }
  return succeed(toDay === null ? "Moved back to its planned day." : "Moved for this week. The workout itself is unchanged.");
}

// ---------------------------------------------------------------------------
// The client's own training & food profile
// ---------------------------------------------------------------------------

export async function saveTrainingProfileAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded("/account/training-profile");
  const supabase = await createClient();
  if (!supabase) return fail("That didn't save. Please try again.");
  const limit = await rateLimit("training_profile_save", session.userId, 20, 600);
  if (!limit.allowed) return fail(tooMany(limit));

  const experience = form.get("experience");
  const intOrNull = (name: string, min: number, max: number) => {
    const v = field(form, name, 4);
    if (!v) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
  };
  const minutes = intOrNull("session_minutes", 10, 240);
  const days = intOrNull("days_per_week", 1, 7);
  const fieldErrors: Record<string, string> = {};
  if (Number.isNaN(minutes)) fieldErrors.session_minutes = "Enter minutes between 10 and 240.";
  if (Number.isNaN(days)) fieldErrors.days_per_week = "Choose between 1 and 7 days.";
  if (Object.keys(fieldErrors).length) return fail("Please check the highlighted answers.", { fieldErrors });

  const EQUIPMENT = ["gym", "dumbbells", "barbell", "kettlebells", "bands", "pullup_bar", "bench", "cardio_machine", "none"];
  const training = {
    customer_id: session.userId,
    experience: experience === "new" || experience === "some" || experience === "experienced" ? experience : null,
    experience_note: cleanText(form.get("experience_note"), 500) || null,
    equipment: form.getAll("equipment").map(String).filter((e) => EQUIPMENT.includes(e)),
    equipment_note: cleanText(form.get("equipment_note"), 500) || null,
    session_minutes: minutes,
    days_per_week: days,
    food_preferences: cleanText(form.get("food_preferences"), 1000) || null,
    local_foods: cleanText(form.get("local_foods"), 1000) || null,
  };
  const health = {
    customer_id: session.userId,
    limitations: cleanText(form.get("limitations"), 2000) || null,
    allergies: cleanText(form.get("allergies"), 1000) || null,
  };

  const [a, b] = await Promise.all([
    supabase.from("client_training_profiles").upsert(training, { onConflict: "customer_id" }),
    supabase.from("client_health_profiles").upsert(health, { onConflict: "customer_id" }),
  ]);
  if (a.error || b.error) return fail("That didn't save. Please try again.");
  revalidatePath("/account/training-profile");
  return succeed("Saved. Your current coach can see this when planning.");
}
