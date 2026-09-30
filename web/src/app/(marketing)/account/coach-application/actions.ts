"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { friendlyError } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { kickWorker } from "@/lib/worker/outbox";
import { featureRefusal } from "@/lib/features/server";
import { timezoneOptions } from "@/lib/preferences";
import {
  APPLICATION_PRIVACY_VERSION,
  LIMITS,
  checkApplication,
  mergeChoices,
  type ApplicationFields,
} from "@/lib/coach-applications/rules";
import { CertificateRejected, cleanCertificate } from "@/lib/coach-applications/files";
import { COACH_AGREEMENT_VERSION } from "@/lib/coach-agreement";

/*
 * What an applicant can do with their own application.
 *
 * Every write runs through a database function as the applicant themself
 * (0062), which checks the application is theirs, the email is confirmed and
 * the switch allows it. The server key is used only for the two things a
 * person must not be able to do directly: storing a checked file, and signing
 * the agreement (which creates the coach record). Nothing here logs what an
 * applicant wrote, their email, or a file path.
 */

const PAGE = "/account/coach-application";
const BUCKET = "provider-evidence";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC = "That didn't go through and nothing was changed. Please try again.";

async function db() {
  const supabase = await createClient();
  if (!supabase) throw new Error("Database not configured");
  return supabase;
}

function uuidField(form: FormData, name: string): string | null {
  const v = field(form, name, 40);
  return UUID.test(v) ? v : null;
}

function listField(form: FormData, name: string): string[] {
  return form
    .getAll(name)
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().slice(0, LIMITS.other_item))
    .filter(Boolean);
}

async function removeFiles(paths: (string | null)[] | null | undefined): Promise<void> {
  const list = (paths ?? []).filter((p): p is string => Boolean(p));
  if (!list.length) return;
  const admin = createAdminClient();
  if (!admin) return;
  // Best effort: a file left behind is private and unreferenced; the
  // application record no longer points at it either way.
  await admin.storage.from(BUCKET).remove(list).catch(() => undefined);
}

/** Checks, stores and records one certificate file. Returns an error message, or null. */
async function attachFile(userId: string, applicationId: string, certificateId: string, file: File): Promise<string | null> {
  let clean;
  try {
    clean = await cleanCertificate(file);
  } catch (err) {
    return err instanceof CertificateRejected ? err.message : "That file couldn't be read.";
  }
  const admin = createAdminClient();
  if (!admin) return "Uploads aren't available right now. Please try again later.";

  const path = `coach-applications/${applicationId}/${certificateId}/${randomBytes(12).toString("base64url")}.${clean.extension}`;
  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, clean.body, { contentType: clean.contentType, upsert: false });
  if (upErr) return "That file couldn't be stored. Please try again.";

  const { data: replaced, error } = await admin.rpc("coach_application_attach_file", {
    p_user: userId,
    p_certificate: certificateId,
    p_path: path,
    p_kind: clean.kind,
    p_bytes: clean.body.length,
  });
  if (error) {
    await removeFiles([path]);
    return friendlyError(error, "That file couldn't be added. Please try again.");
  }
  await removeFiles([replaced as string | null]);
  return null;
}

function chosenFile(form: FormData, name: string): File | null {
  const f = form.get(name);
  return f instanceof File && f.size > 0 ? f : null;
}

// ---------------------------------------------------------------------------
// The application itself
// ---------------------------------------------------------------------------

export async function saveApplicationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded(PAGE);
  const applicationId = uuidField(form, "application_id");
  const fields: ApplicationFields = {
    full_name: field(form, "full_name", LIMITS.full_name + 10),
    country: field(form, "country", 10),
    timezone: field(form, "timezone", 64),
    languages: mergeChoices(listField(form, "languages"), field(form, "languages_other", 300)),
    specialties: mergeChoices(listField(form, "specialties"), field(form, "specialties_other", 300)),
    experience_years: field(form, "experience_years", 10),
    experience: field(form, "experience", LIMITS.experience + 10),
    online_experience: field(form, "online_experience", LIMITS.online_experience + 10),
    instagram: field(form, "instagram", LIMITS.instagram + 10),
    website: field(form, "website", LIMITS.website + 10),
    profile_url: field(form, "profile_url", LIMITS.profile_url + 10),
    availability: field(form, "availability", LIMITS.availability + 10),
    new_client_capacity: field(form, "new_client_capacity", 5),
    consistency_answer: field(form, "consistency_answer", LIMITS.consistency_answer + 10),
  };

  if (!session.emailConfirmed) return fail("Confirm your email address first, using the link we sent you. Your answers are still here.");
  if (!applicationId && form.get("privacy") !== "on") {
    return fail("Tick the box to say you've read how we use your application.", { fieldErrors: { privacy: "Required." } });
  }

  const zones = new Set(timezoneOptions());
  const errors = checkApplication(fields, (tz) => zones.has(tz));
  if (Object.keys(errors).length) {
    return fail("Some answers need attention. Nothing was lost — fix the highlighted fields and save again.", { fieldErrors: errors });
  }

  const limit = await rateLimit("coach_application_save", session.userId, 30, 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  if (!applicationId) {
    // Rechecked on every save: a page opened before applications closed can't start one.
    const refused = await featureRefusal("coach_applications");
    if (refused) return fail(refused);
  }

  const supabase = await db();
  const { error } = await supabase.rpc("coach_application_save", {
    p_application: applicationId,
    p_fields: { ...fields, privacy_version: APPLICATION_PRIVACY_VERSION },
  });
  if (error) return fail(friendlyError(error, GENERIC));

  revalidatePath(PAGE);
  if (!applicationId) redirect(`${PAGE}?saved=1#qualifications`);
  return succeed("Saved. Your changes are on your application.");
}

export async function submitApplicationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded(PAGE);
  const applicationId = uuidField(form, "application_id");
  if (!applicationId) return fail(GENERIC);
  if (!session.emailConfirmed) return fail("Confirm your email address first, using the link we sent you.");
  const limit = await rateLimit("coach_application_submit", session.userId, 10, 86_400);
  if (!limit.allowed) return fail(tooMany(limit));

  const { error } = await (await db()).rpc("coach_application_submit", { p_application: applicationId });
  if (error) return fail(friendlyError(error, GENERIC));
  kickWorker();
  revalidatePath(PAGE);
  redirect(`${PAGE}?sent=1`);
}

export async function withdrawApplicationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded(PAGE);
  const applicationId = uuidField(form, "application_id");
  if (!applicationId) return fail(GENERIC);
  if (form.get("confirm") !== "on") return fail("Tick the box to confirm you want to withdraw.", { fieldErrors: { confirm: "Required." } });
  const limit = await rateLimit("coach_application_change", session.userId, 20, 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  const { data, error } = await (await db()).rpc("coach_application_withdraw", { p_application: applicationId });
  if (error) return fail(friendlyError(error, GENERIC));
  await removeFiles(data as string[] | null);
  revalidatePath(PAGE);
  return succeed("Your application is withdrawn and your certificate files are deleted. You can also delete the rest of your details below.");
}

export async function eraseApplicationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded(PAGE);
  const applicationId = uuidField(form, "application_id");
  if (!applicationId) return fail(GENERIC);
  if (form.get("confirm") !== "on") return fail("Tick the box to confirm you want to delete your application.", { fieldErrors: { confirm: "Required." } });
  const limit = await rateLimit("coach_application_change", session.userId, 20, 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  const { data, error } = await (await db()).rpc("coach_application_erase", { p_application: applicationId });
  if (error) return fail(friendlyError(error, GENERIC));
  await removeFiles(data as string[] | null);
  revalidatePath(PAGE);
  redirect(`${PAGE}?deleted=1`);
}

// ---------------------------------------------------------------------------
// Qualifications
// ---------------------------------------------------------------------------

export async function addCertificateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded(PAGE);
  const applicationId = uuidField(form, "application_id");
  if (!applicationId) return fail(GENERIC);
  const qualification = field(form, "qualification", 170);
  const issuingBody = field(form, "issuing_body", 170);
  const expires = field(form, "expires_on", 10);
  const file = chosenFile(form, "file");

  const errors: Record<string, string> = {};
  if (qualification.length < 2 || qualification.length > 160) errors.qualification = "Enter the qualification's name (up to 160 characters).";
  if (issuingBody.length < 2 || issuingBody.length > 160) errors.issuing_body = "Enter the organisation that issued it (up to 160 characters).";
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) errors.expires_on = "Enter a date, or leave it empty if it doesn't expire.";
  if (Object.keys(errors).length) return fail("Check the highlighted fields.", { fieldErrors: errors });

  const limit = await rateLimit("coach_application_upload", session.userId, 20, 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  const { data: certificateId, error } = await (await db()).rpc("coach_application_add_certificate", {
    p_application: applicationId,
    p_qualification: qualification,
    p_issuing_body: issuingBody,
    p_expires_on: expires || null,
  });
  if (error || !certificateId) return fail(friendlyError(error, GENERIC));

  if (file) {
    const problem = await attachFile(session.userId, applicationId, certificateId as string, file);
    revalidatePath(PAGE);
    if (problem) return fail(`The qualification was added, but its file wasn't: ${problem} You can try the file again from the list.`);
  }
  revalidatePath(PAGE);
  return succeed(file ? "Qualification and file added." : "Qualification added.");
}

export async function attachCertificateFileAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded(PAGE);
  const applicationId = uuidField(form, "application_id");
  const certificateId = uuidField(form, "certificate_id");
  const file = chosenFile(form, "file");
  if (!applicationId || !certificateId) return fail(GENERIC);
  if (!file) return fail("Choose a photo or PDF of the certificate.", { fieldErrors: { file: "Choose a file." } });
  const limit = await rateLimit("coach_application_upload", session.userId, 20, 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  const problem = await attachFile(session.userId, applicationId, certificateId, file);
  revalidatePath(PAGE);
  return problem ? fail(problem) : succeed("File added.");
}

export async function removeCertificateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded(PAGE);
  const certificateId = uuidField(form, "certificate_id");
  if (!certificateId) return fail(GENERIC);
  const limit = await rateLimit("coach_application_change", session.userId, 20, 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  const { data, error } = await (await db()).rpc("coach_application_remove_certificate", { p_certificate: certificateId });
  if (error) return fail(friendlyError(error, GENERIC));
  await removeFiles([data as string | null]);
  revalidatePath(PAGE);
  return succeed("Removed, with its file.");
}

// ---------------------------------------------------------------------------
// The agreement
// ---------------------------------------------------------------------------

export async function signAgreementAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded(`${PAGE}/agreement`);
  const applicationId = uuidField(form, "application_id");
  const version = field(form, "version", 60);
  const signedName = field(form, "signed_name", 130);
  if (!applicationId) return fail(GENERIC);
  if (version !== COACH_AGREEMENT_VERSION) return fail("The agreement changed while this page was open. Reload the page and read the current version.");
  if (form.get("agree") !== "on") return fail("Tick the box to confirm you've read and agree to the agreement.", { fieldErrors: { agree: "Required." } });
  if (signedName.length < 2 || signedName.length > 120) return fail("Type your full name to sign.", { fieldErrors: { signed_name: "Type your full name." } });
  const limit = await rateLimit("coach_agreement_sign", session.userId, 10, 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  // The server key creates the coach record, so the application is first
  // read through the applicant's own session: only their own counts.
  const { data: mine } = await (await db()).from("coach_applications").select("id, status").eq("id", applicationId).maybeSingle();
  if (!mine || mine.status !== "approved") return fail("There's no agreement waiting for you.");

  const admin = createAdminClient();
  if (!admin) return fail(GENERIC);
  const { error } = await admin.rpc("sign_coach_agreement", {
    p_user: session.userId,
    p_application: applicationId,
    p_version: COACH_AGREEMENT_VERSION,
    p_signed_name: signedName,
  });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath(PAGE);
  redirect("/coach/profile?welcome=1");
}

export async function declineAgreementAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded(`${PAGE}/agreement`);
  const applicationId = uuidField(form, "application_id");
  if (!applicationId) return fail(GENERIC);
  if (form.get("confirm") !== "on") return fail("Tick the box to confirm you don't want to go ahead.", { fieldErrors: { confirm: "Required." } });
  const limit = await rateLimit("coach_application_change", session.userId, 20, 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  const { data, error } = await (await db()).rpc("decline_coach_agreement", { p_application: applicationId });
  if (error) return fail(friendlyError(error, GENERIC));
  await removeFiles(data as string[] | null);
  revalidatePath(PAGE);
  redirect(`${PAGE}?declined=1`);
}
