"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { friendlyError } from "@/lib/errors";
import { canonicalTimezone, isValidTimezone } from "@/lib/preferences";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { ImageRejected, reencodeProfilePhoto } from "@/lib/uploads/image";
import { MoneyError, parseDecimalToMinor } from "@/lib/money/money";
import { chargeCurrency } from "@/lib/payments/currencies";
import { formatMinor } from "@/lib/format";

/*
 * Coach actions.
 *
 * Every action runs as the signed-in coach, through their own database session.
 * Row-level security and the database's action functions decide what is
 * allowed — an approved coach publishes their own plans at their own prices
 * without anyone's sign-off; an unapproved or suspended coach cannot, however
 * the request is made. These functions validate input and translate refusals
 * into words; they are not the security boundary.
 */

const GENERIC_SAVE = "That didn't save. Please try again.";

function listField(form: FormData, name: string, maxItems: number, maxLength: number): string[] {
  return field(form, name, 2000)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((s) => s.slice(0, maxLength));
}

async function db() {
  const supabase = await createClient();
  if (!supabase) throw new Error("Database not configured");
  return supabase;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function saveProfileAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach/profile");
  const supabase = await db();

  const displayName = field(form, "display_name", 80);
  const headline = field(form, "headline", 200);
  const bio = field(form, "bio", 4000);
  const approach = field(form, "approach", 2000);
  const specialties = listField(form, "specialties", 12, 40);
  const languages = listField(form, "languages", 12, 30);
  const since = field(form, "experience_since", 4);
  const timezone = canonicalTimezone(field(form, "timezone", 64)) ?? "";
  const rowVersion = Number(field(form, "row_version", 12));

  const fieldErrors: Record<string, string> = {};
  if (displayName.length < 2) fieldErrors.display_name = "Enter the name clients will see.";
  if (languages.length === 0) fieldErrors.languages = "Add at least one language you coach in.";
  if (timezone && !isValidTimezone(timezone)) fieldErrors.timezone = "Choose a timezone from the list.";
  const year = since ? Number(since) : null;
  if (since && (!Number.isInteger(year) || year! < 1950 || year! > new Date().getUTCFullYear())) {
    fieldErrors.experience_since = "Enter the year you started coaching, for example 2019.";
  }
  if (Object.keys(fieldErrors).length) return fail("Check the highlighted fields.", { fieldErrors });

  const { data: updated, error } = await supabase
    .from("provider_public_profiles")
    .update({
      display_name: displayName,
      headline: headline || null,
      bio: bio || null,
      approach: approach || null,
      specialties,
      languages,
      experience_since: year ? `${year}-01-01` : null,
    })
    .eq("provider_id", session.provider.id)
    .eq("row_version", rowVersion)
    .select("row_version");

  if (error) return fail(friendlyError(error, GENERIC_SAVE));
  // Someone saved this profile in another tab since it was loaded.
  if (!updated?.length) {
    return fail("This profile was changed somewhere else since you opened it. Reload the page to see the latest version, then make your changes again.");
  }

  await supabase
    .from("providers")
    .update({ display_name: displayName, ...(timezone ? { timezone } : {}) })
    .eq("id", session.provider.id);

  revalidatePath("/coach", "layout");
  revalidatePath("/coaches", "layout");
  return succeed(session.provider.published_at ? "Saved. Your public profile shows the change now." : "Saved.");
}

export async function submitProfileAction(_state?: ActionState, _form?: FormData): Promise<ActionState> {
  await requireCoach("/coach/profile");
  const supabase = await db();
  const { error } = await supabase.rpc("submit_my_profile_for_review");
  if (error) return fail(friendlyError(error, GENERIC_SAVE));
  revalidatePath("/coach", "layout");
  return succeed("Submitted. You'll get an email when your profile has been reviewed.");
}

export async function setProfilePublishedAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/profile");
  const publish = field(form, "publish", 5) === "true";
  const supabase = await db();
  const { error } = await supabase.rpc("set_my_profile_published", { p_published: publish });
  if (error) return fail(friendlyError(error, GENERIC_SAVE));
  revalidatePath("/coach", "layout");
  revalidatePath("/coaches", "layout");
  return succeed(publish ? "Your profile is public." : "Your profile is hidden and new sign-ups are closed.");
}

export async function uploadPhotoAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach/profile");

  if (session.provider.suspended_at || session.provider.status === "suspended") {
    return fail("Your coach account is suspended, so the profile can't be changed.");
  }
  const limit = await rateLimit("coach_photo", session.userId, 10, 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  if (form.get("consent") !== "on") {
    return fail("Confirm you're happy for this photo to appear on your public profile.");
  }

  let image: Buffer;
  try {
    image = await reencodeProfilePhoto(form.get("photo") as File);
  } catch (err) {
    return fail(err instanceof ImageRejected ? err.message : GENERIC_SAVE);
  }

  // Storage has no client write policy at all; the server writes the
  // re-encoded copy, never the original.
  const admin = createAdminClient();
  if (!admin) return fail(GENERIC_SAVE);
  const path = `${session.provider.id}/${randomUUID()}.webp`;
  const { error: uploadError } = await admin.storage
    .from("coach-photos-pending")
    .upload(path, image, { contentType: "image/webp", upsert: false });
  if (uploadError) return fail(GENERIC_SAVE);

  const { data: previous } = await admin
    .from("provider_public_profiles").select("photo_pending_path").eq("provider_id", session.provider.id).single();

  const { error } = await admin
    .from("provider_public_profiles")
    .update({ photo_pending_path: path, photo_pending_at: new Date().toISOString(), photo_review_note: null, photo_consent_at: new Date().toISOString() })
    .eq("provider_id", session.provider.id);
  if (error) {
    await admin.storage.from("coach-photos-pending").remove([path]);
    return fail(GENERIC_SAVE);
  }
  if (previous?.photo_pending_path) {
    await admin.storage.from("coach-photos-pending").remove([previous.photo_pending_path]);
  }

  revalidatePath("/coach/profile");
  return succeed("Photo uploaded. It appears on your profile once it has been checked.");
}

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

export async function setCapacityAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach");
  const unlimited = field(form, "unlimited", 5) === "on";
  const raw = field(form, "max_active_clients", 6);
  const accepting = field(form, "accepting", 5) === "on";

  if (unlimited && raw !== "") {
    return fail("You've entered a number of clients and also ticked “No limit”. Choose one.", {
      fieldErrors: { max_active_clients: "Clear this, or untick “No limit”." },
    });
  }
  let max: number | null = null;
  if (!unlimited) {
    max = Number(raw);
    if (!Number.isInteger(max) || max < 1 || max > 500) {
      return fail("Enter how many clients you can take, from 1 to 500.", {
        fieldErrors: { max_active_clients: "Enter a whole number from 1 to 500." },
      });
    }
  }

  const supabase = await db();
  const { error } = await supabase.rpc("set_my_capacity", {
    p_max_active_clients: max,
    p_accepting_new_clients: accepting,
  });
  if (error) return fail(friendlyError(error, GENERIC_SAVE));
  revalidatePath("/coach", "layout");
  return succeed(accepting ? "Saved. You're accepting new clients." : "Saved. New sign-ups are closed.");
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

type PlanKind = "monthly" | "one_off";

function planShape(kind: PlanKind) {
  return kind === "monthly"
    ? { service_type: "recurring_coaching", billing_structure: "monthly_recurring", billing_interval: "month", billing_interval_count: 1, auto_renews: true }
    : { service_type: "one_off_consultation", billing_structure: "single_payment", billing_interval: null, billing_interval_count: null, auto_renews: false };
}

function slugify(text: string): string {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "plan";
  return `${base}-${randomUUID().slice(0, 6)}`;
}

export async function createPlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach/plans");
  const title = field(form, "title", 120);
  const kind = field(form, "kind", 10) as PlanKind;

  if (title.length < 3) return fail("Give the plan a name clients will recognise.", { fieldErrors: { title: "At least 3 characters." } });
  if (kind !== "monthly" && kind !== "one_off") return fail("Choose monthly coaching or a one-off session.");

  const supabase = await db();
  const { data: policies } = await supabase.from("current_policy_set").select("*").single();
  if (!policies) return fail(GENERIC_SAVE);

  const { data: offer, error: offerError } = await supabase
    .from("offers")
    .insert({ provider_id: session.provider.id, vertical_slug: session.provider.vertical_slug, slug: slugify(title), status: "draft" })
    .select("id")
    .single();
  if (offerError || !offer) return fail(friendlyError(offerError, GENERIC_SAVE));

  const { error } = await supabase.from("offer_versions").insert({
    offer_id: offer.id,
    version: 1,
    title,
    ...planShape(kind),
    // Placeholders: publishing stamps the policies in force at that moment.
    commission_policy_id: policies.commission_policy_id,
    cancellation_policy_id: policies.cancellation_policy_id,
    payment_failure_policy_id: policies.payment_failure_policy_id,
    recognition_policy_id: policies.recognition_policy_id,
    billing_terms_policy_id: policies.billing_terms_policy_id,
  });
  if (error) return fail(friendlyError(error, GENERIC_SAVE));

  redirect(`/coach/plans/${offer.id}`);
}

function optionalInt(form: FormData, name: string, min: number, max: number): number | null | "invalid" {
  const raw = field(form, name, 6);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : "invalid";
}

export async function saveDraftAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/plans");
  const versionId = field(form, "version_id", 40);
  const offerId = field(form, "offer_id", 40);
  const rowVersion = Number(field(form, "row_version", 12));

  const title = field(form, "title", 120);
  const description = field(form, "description", 4000);
  const intendedClient = field(form, "intended_client", 300);
  const checkInCadence = field(form, "check_in_cadence", 60);
  const messagingChannel = field(form, "messaging_channel", 60);
  const programmeReview = field(form, "programme_review_cadence", 60);
  const additional = listField(form, "additional_inclusions", 20, 120);
  const calls = optionalInt(form, "calls_included_per_month", 0, 31);
  const callMinutes = optionalInt(form, "call_duration_minutes", 5, 240);
  const responseHours = optionalInt(form, "response_time_hours", 1, 336);

  const fieldErrors: Record<string, string> = {};
  if (title.length < 3) fieldErrors.title = "At least 3 characters.";
  if (calls === "invalid") fieldErrors.calls_included_per_month = "A whole number from 0 to 31.";
  if (callMinutes === "invalid") fieldErrors.call_duration_minutes = "Minutes, from 5 to 240.";
  if (responseHours === "invalid") fieldErrors.response_time_hours = "Hours, from 1 to 336.";
  // A one-off session states its length before anyone buys it (M09). Monthly
  // coaching may name a fixed number of calls; left empty, it is flexible and
  // sessions are arranged as needed with no quota.
  const oneOff = form.get("service_type") === "one_off_consultation";
  if (oneOff && callMinutes === null) {
    fieldErrors.call_duration_minutes = "Say how long the session is.";
  }
  if (!oneOff && typeof calls === "number" && calls > 0 && callMinutes === null) {
    fieldErrors.call_duration_minutes = "Say how long each call is.";
  }
  if (Object.keys(fieldErrors).length) return fail("Check the highlighted fields.", { fieldErrors });

  const supabase = await db();
  const { data, error } = await supabase
    .from("offer_versions")
    .update({
      title,
      description,
      intended_client: intendedClient || null,
      calls_included_per_month: oneOff ? null : calls,
      call_duration_minutes: oneOff ? callMinutes : typeof calls === "number" && calls > 0 ? callMinutes : null,
      check_in_cadence: checkInCadence || null,
      response_time_hours: responseHours,
      programme_included: form.get("programme_included") === "on",
      programme_review_cadence: programmeReview || null,
      form_review_included: form.get("form_review_included") === "on",
      messaging_channel: messagingChannel || null,
      additional_inclusions: additional,
    })
    .eq("id", versionId)
    .eq("row_version", rowVersion)
    .is("published_at", null)
    .select("id");

  if (error) return fail(friendlyError(error, GENERIC_SAVE));
  if (!data?.length) {
    return fail("This draft was changed somewhere else, or has been published, since you opened it. Reload to see the latest version.");
  }
  revalidatePath(`/coach/plans/${offerId}`);
  return succeed("Draft saved.");
}

export async function setPriceAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/plans");
  const versionId = field(form, "version_id", 40);
  const offerId = field(form, "offer_id", 40);
  const currency = chargeCurrency(field(form, "currency", 3));
  const amountText = field(form, "amount", 20);

  if (!currency) return fail("Choose a currency.", { fieldErrors: { currency: "Choose a currency." } });

  let minor: number;
  try {
    minor = parseDecimalToMinor(amountText, currency.code);
  } catch (err) {
    const message = err instanceof MoneyError ? "Enter an amount like 80 or 79.50, without a currency symbol." : GENERIC_SAVE;
    return fail(message, { fieldErrors: { amount: message } });
  }
  if (minor < currency.minimumMinor) {
    const message = `The lowest price card payments allow in ${currency.code} is ${formatMinor(currency.minimumMinor, currency.code)}.`;
    return fail(message, { fieldErrors: { amount: message } });
  }
  if (minor > 1_000_000_00) {
    return fail("That price is higher than the system accepts.", { fieldErrors: { amount: "Too high." } });
  }

  const supabase = await db();
  // A published version's prices are frozen by the database; this only ever
  // succeeds on a draft.
  const { error } = await supabase
    .from("offer_prices")
    .upsert({ offer_version_id: versionId, currency: currency.code, amount_minor: minor }, { onConflict: "offer_version_id,currency" });
  if (error) return fail(friendlyError(error, "That price couldn't be saved. Prices on a published plan can't change — create a new version instead."));

  revalidatePath(`/coach/plans/${offerId}`);
  return succeed(`Price set: ${formatMinor(minor, currency.code)}.`);
}

export async function removePriceAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/plans");
  const priceId = field(form, "price_id", 40);
  const offerId = field(form, "offer_id", 40);
  const supabase = await db();
  const { data, error } = await supabase.from("offer_prices").delete().eq("id", priceId).select("id");
  if (error || !data?.length) return fail("That price couldn't be removed. Prices on a published plan can't change.");
  revalidatePath(`/coach/plans/${offerId}`);
  return succeed("Price removed.");
}

export async function publishVersionAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/plans");
  const versionId = field(form, "version_id", 40);
  const offerId = field(form, "offer_id", 40);
  if (form.get("confirm") !== "on") {
    return fail("Confirm you've checked the plan. Once published, its price and inclusions can't be edited — only replaced by a new version.");
  }
  const supabase = await db();
  const { error } = await supabase.rpc("publish_offer_version", { p_version_id: versionId });
  if (error) return fail(friendlyError(error, GENERIC_SAVE));
  revalidatePath(`/coach/plans/${offerId}`);
  revalidatePath("/coach/plans");
  revalidatePath("/coaches", "layout");
  return succeed("Published. New clients can now sign up to this version. Existing clients keep the terms they signed up under.");
}

export async function newVersionAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/plans");
  const offerId = field(form, "offer_id", 40);
  const supabase = await db();

  const { data: versions } = await supabase
    .from("offer_versions")
    .select("*, offer_prices(currency, amount_minor)")
    .eq("offer_id", offerId)
    .order("version", { ascending: false });
  if (!versions?.length) return fail("That plan wasn't found.");
  if (versions.some((v) => !v.published_at)) {
    return fail("There's already an unpublished draft of this plan. Edit that one.");
  }

  const source = versions.find((v) => v.published_at && !v.superseded_at) ?? versions[0];
  const {
    id: _id, version: _v, published_at: _p, published_by: _pb, superseded_at: _s, created_at: _c, row_version: _r,
    offer_prices: prices, ...copy
  } = source as Record<string, unknown> & { offer_prices: { currency: string; amount_minor: number }[] };

  const { data: created, error } = await supabase
    .from("offer_versions")
    .insert({ ...copy, version: (versions[0].version as number) + 1 })
    .select("id")
    .single();
  if (error || !created) return fail(friendlyError(error, GENERIC_SAVE));

  if (prices?.length) {
    await supabase.from("offer_prices").insert(
      prices.map((p) => ({ offer_version_id: created.id, currency: p.currency, amount_minor: p.amount_minor })),
    );
  }
  revalidatePath(`/coach/plans/${offerId}`);
  return succeed("New draft created from the current version. Change what you need, then publish it. Clients already signed up are not affected.");
}

export async function deleteDraftAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/plans");
  const versionId = field(form, "version_id", 40);
  const offerId = field(form, "offer_id", 40);
  const supabase = await db();
  const { data, error } = await supabase.from("offer_versions").delete().eq("id", versionId).is("published_at", null).select("id");
  if (error || !data?.length) return fail("Only an unpublished draft can be discarded.");
  revalidatePath(`/coach/plans/${offerId}`);
  return succeed("Draft discarded.");
}

export async function setSaleStateAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireCoach("/coach/plans");
  const offerId = field(form, "offer_id", 40);
  const state = field(form, "state", 10);
  if (!["paused", "archived", "published"].includes(state)) return fail("Unknown action.");
  if (state === "archived" && form.get("confirm") !== "on") {
    return fail("Confirm you want to archive this plan. Archiving stops new sign-ups for good; clients already on it keep their plan.");
  }
  const supabase = await db();
  const { error } = await supabase.rpc("set_offer_sale_state", { p_offer_id: offerId, p_state: state });
  if (error) return fail(friendlyError(error, GENERIC_SAVE));
  revalidatePath(`/coach/plans/${offerId}`);
  revalidatePath("/coach/plans");
  revalidatePath("/coaches", "layout");
  return succeed(
    state === "paused" ? "Paused. No new sign-ups; existing clients continue."
      : state === "archived" ? "Archived. Existing clients continue on their plan."
      : "Back on sale.",
  );
}

// ---------------------------------------------------------------------------
// Payout details
// ---------------------------------------------------------------------------

export async function setPayoutDestinationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireCoach("/coach/payouts");
  if (session.aal !== "aal2") {
    return fail("Confirm it's you with your authenticator app first. Go to Sign-in security, then come back.");
  }

  const limit = await rateLimit("payout_destination", session.userId, 5, 24 * 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  const supabase = await db();
  const { error } = await supabase.rpc("set_my_payout_destination", {
    p_channel: field(form, "channel", 40),
    p_account_reference: field(form, "account_reference", 120),
    p_account_holder_name: field(form, "account_holder_name", 120),
    p_country: field(form, "country", 2),
    p_currency: field(form, "currency", 3).toUpperCase(),
  });
  if (error) return fail(friendlyError(error, GENERIC_SAVE));
  revalidatePath("/coach/payouts");
  return succeed("Saved. The new details are checked before any payout uses them; until then, payouts stay on hold.");
}
