"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { friendlyError } from "@/lib/errors";
import { env } from "@/lib/env";
import { enqueue, kickWorker } from "@/lib/worker/outbox";
import { BillingError, issueRefund } from "@/lib/payments/billing";
import { MoneyError, parseDecimalToMinor } from "@/lib/money/money";
import { formatMinor } from "@/lib/format";

/*
 * Founder console actions.
 *
 * Each one runs requireAdmin() — which insists on a completed second factor —
 * and then calls the database AS THE ADMIN, through their own session. The
 * database functions check `is_admin()` again (aal2 included) and write the
 * audit record with the admin's identity. The service role is used only where
 * a file must be copied between storage buckets, and never to skip a check.
 */

const GENERIC = "That didn't work and nothing was changed. Please try again.";

async function adminDb() {
  const supabase = await createClient();
  if (!supabase) throw new Error("Database not configured");
  return supabase;
}

function uuidField(form: FormData, name: string): string | null {
  const v = field(form, name, 40);
  return /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Coach invitations
// ---------------------------------------------------------------------------

export async function inviteCoachAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/coaches");
  const email = field(form, "email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail("Enter a valid email address.", { fieldErrors: { email: "Enter a valid email address." } });
  }

  // The link carries a random token; the database keeps only its hash, so a
  // copy of the database cannot be turned into working invitation links. The
  // invitation also only works for an account with this email address.
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const days = 7;

  const supabase = await adminDb();
  const { data: invitationId, error } = await supabase.rpc("admin_create_coach_invitation", {
    p_email: email,
    p_token_hash: hash,
    p_expires_in_days: days,
  });
  if (error || !invitationId) return fail(friendlyError(error, GENERIC));

  const expiresAt = new Date(Date.now() + days * 86_400_000);
  await enqueue({
    topic: "email.coach_invitation",
    payload: { email, invite_url: `${env.siteUrl}/invite/${token}`, expires_at: expiresAt.toISOString() },
    dedupeKey: `coach_invitation:${invitationId}`,
    expiresAt,
  });
  kickWorker();

  revalidatePath("/admin/coaches");
  return succeed(`Invitation created for ${email}. The email is queued; its delivery status shows in the list below.`);
}

export async function revokeInvitationAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/coaches");
  const id = uuidField(form, "invitation_id");
  if (!id) return fail(GENERIC);
  const { error } = await (await adminDb()).rpc("admin_revoke_coach_invitation", { p_invitation_id: id });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath("/admin/coaches");
  return succeed("Invitation revoked. The link no longer works.");
}

// ---------------------------------------------------------------------------
// Coach review
// ---------------------------------------------------------------------------

export async function providerStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/coaches");
  const providerId = uuidField(form, "provider_id");
  const action = field(form, "action", 30);
  const reason = field(form, "reason", 1000);
  if (!providerId) return fail(GENERIC);

  const supabase = await adminDb();
  const { error } = await supabase.rpc("admin_set_provider_status", { p_provider_id: providerId, p_action: action, p_reason: reason || null });
  if (error) return fail(friendlyError(error, GENERIC));

  if (action === "approve") {
    const { data: provider } = await supabase.from("providers").select("profile_id").eq("id", providerId).single();
    if (provider?.profile_id) {
      await enqueue({ topic: "email.profile_approved", payload: { provider_id: providerId }, dedupeKey: `profile_approved:${providerId}:${Date.now()}` });
      kickWorker();
    }
  }
  revalidatePath(`/admin/coaches/${providerId}`);
  revalidatePath("/admin/coaches");
  return succeed({
    start_review: "Marked as in review.",
    approve: "Approved. The coach can now publish their plans and profile.",
    return_to_onboarding: "Returned to the coach for changes.",
    suspend: "Suspended. Their profile is hidden and new sign-ups are closed. Existing clients need reassigning.",
    reinstate: "Reinstated.",
    retire: "Retired.",
  }[action] ?? "Done.");
}

export async function capacityCeilingAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/coaches");
  const providerId = uuidField(form, "provider_id");
  const raw = field(form, "ceiling", 6);
  const reason = field(form, "reason", 1000);
  if (!providerId) return fail(GENERIC);
  const ceiling = raw === "" ? null : Number(raw);
  if (ceiling !== null && (!Number.isInteger(ceiling) || ceiling < 1)) {
    return fail("Enter a whole number, or leave it empty to remove the limit.", { fieldErrors: { ceiling: "A whole number of 1 or more." } });
  }
  const { error } = await (await adminDb()).rpc("admin_set_capacity_ceiling", { p_provider_id: providerId, p_ceiling: ceiling, p_reason: reason });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath(`/admin/coaches/${providerId}`);
  return succeed(ceiling === null ? "Limit removed. The coach controls their own capacity." : `Capacity limited to ${ceiling}.`);
}

export async function reviewDestinationAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/coaches");
  const destinationId = uuidField(form, "destination_id");
  const providerId = uuidField(form, "provider_id");
  const decision = field(form, "decision", 10);
  if (!destinationId || !["approved", "rejected"].includes(decision)) return fail(GENERIC);
  const { error } = await (await adminDb()).rpc("admin_review_payout_destination", { p_destination_id: destinationId, p_decision: decision });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath(`/admin/coaches/${providerId}`);
  return succeed(decision === "approved" ? "Payout details marked as checked." : "Payout details rejected. The coach will need to enter new ones.");
}

export async function reviewPhotoAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/coaches");
  const providerId = uuidField(form, "provider_id");
  const approve = field(form, "decision", 10) === "approve";
  const note = field(form, "note", 500);
  if (!providerId) return fail(GENERIC);

  const supabase = await adminDb();
  const service = createAdminClient();
  if (!service) return fail(GENERIC);

  if (!approve) {
    const { error } = await supabase.rpc("admin_review_profile_photo", { p_provider_id: providerId, p_approve: false, p_public_path: null, p_note: note });
    if (error) return fail(friendlyError(error, GENERIC));
    revalidatePath(`/admin/coaches/${providerId}`);
    return succeed("Photo rejected. The coach sees your note.");
  }

  const { data: profile } = await service.from("provider_public_profiles").select("photo_pending_path, photo_path").eq("provider_id", providerId).single();
  if (!profile?.photo_pending_path) return fail("There's no photo waiting for review.");

  // Copy the reviewed image into the public bucket, then let the database
  // (checking this admin's own session) point the profile at it.
  const publicPath = `${providerId}/${profile.photo_pending_path.split("/").pop()}`;
  const { data: file, error: downloadError } = await service.storage.from("coach-photos-pending").download(profile.photo_pending_path);
  if (downloadError || !file) return fail(GENERIC);
  const { error: uploadError } = await service.storage.from("coach-photos").upload(publicPath, file, { contentType: "image/webp", upsert: false });
  if (uploadError) return fail(GENERIC);

  const { error } = await supabase.rpc("admin_review_profile_photo", { p_provider_id: providerId, p_approve: true, p_public_path: publicPath, p_note: null });
  if (error) {
    await service.storage.from("coach-photos").remove([publicPath]);
    return fail(friendlyError(error, GENERIC));
  }
  await service.storage.from("coach-photos-pending").remove([profile.photo_pending_path]);
  if (profile.photo_path && profile.photo_path !== publicPath) {
    await service.storage.from("coach-photos").remove([profile.photo_path]);
  }
  revalidatePath(`/admin/coaches/${providerId}`);
  revalidatePath("/coaches", "layout");
  return succeed("Photo approved and now public.");
}

// ---------------------------------------------------------------------------
// Purchases, refunds, exceptions, jobs
// ---------------------------------------------------------------------------

export async function refundAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/purchases");
  const purchaseId = uuidField(form, "purchase_id");
  const cycleId = uuidField(form, "billing_cycle_id");
  const currency = field(form, "currency", 3);
  const reason = field(form, "reason", 1000);
  if (!purchaseId || !cycleId) return fail(GENERIC);
  if (reason.length < 3) return fail("Record why this refund is being made.", { fieldErrors: { reason: "Required." } });
  if (form.get("confirm") !== "on") return fail("Tick the confirmation. A refund returns real money in live mode and can't be undone.");

  let amount: number;
  try {
    amount = parseDecimalToMinor(field(form, "amount", 20), currency);
  } catch (err) {
    return fail(err instanceof MoneyError ? "Enter the amount like 40 or 39.50." : GENERIC, { fieldErrors: { amount: "Enter an amount." } });
  }
  if (amount <= 0) return fail("The amount must be more than zero.", { fieldErrors: { amount: "More than zero." } });

  try {
    await issueRefund(await adminDb(), { purchaseId, billingCycleId: cycleId, amountMinor: amount, reason });
  } catch (err) {
    return fail(err instanceof BillingError ? err.message : GENERIC);
  }
  revalidatePath(`/admin/purchases/${purchaseId}`);
  return succeed(`Refund of ${formatMinor(amount, currency)} sent to Stripe. Its result is recorded from Stripe's response, and again when Stripe confirms it.`);
}

export async function resolveExceptionAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/finance");
  const id = uuidField(form, "exception_id");
  const state = field(form, "state", 20);
  const note = field(form, "note", 2000);
  if (!id) return fail(GENERIC);
  const { error } = await (await adminDb()).rpc("admin_resolve_exception", { p_id: id, p_state: state, p_note: note });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath("/admin/finance");
  return succeed("Updated.");
}

export async function retryJobAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/finance");
  const id = uuidField(form, "job_id");
  if (!id) return fail(GENERIC);
  const { error } = await (await adminDb()).rpc("admin_retry_outbox_job", { p_id: id });
  if (error) return fail(friendlyError(error, GENERIC));
  kickWorker();
  revalidatePath("/admin/finance");
  return succeed("Queued to run again.");
}

export async function releaseHoldAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/finance");
  const id = uuidField(form, "ledger_entry_id");
  const note = field(form, "note", 1000);
  if (!id) return fail(GENERIC);
  const { error } = await (await adminDb()).rpc("admin_release_held_earning", { p_ledger_entry_id: id, p_note: note });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath("/admin/finance");
  return succeed("Hold released.");
}

export async function adjustmentAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/finance");
  const providerId = uuidField(form, "provider_id");
  const currency = field(form, "currency", 3).toUpperCase();
  const reason = field(form, "reason", 1000);
  const key = field(form, "idempotency_key", 64);
  if (!providerId) return fail(GENERIC);
  if (form.get("confirm") !== "on") return fail("Tick the confirmation. Adjustments are permanent ledger entries; a mistake is corrected by another adjustment.");
  let amount: number;
  try {
    amount = parseDecimalToMinor(field(form, "amount", 20), currency);
  } catch {
    return fail("Enter the amount like 25, or -25 to deduct.", { fieldErrors: { amount: "Enter an amount." } });
  }
  const { error } = await (await adminDb()).rpc("admin_record_adjustment", {
    p_provider_id: providerId, p_currency: currency, p_amount_minor: amount, p_reason: reason, p_purchase_id: null, p_idempotency_key: key || null,
  });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath(`/admin/coaches/${providerId}`);
  return succeed(`Adjustment of ${formatMinor(amount, currency)} recorded.`);
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

export async function prepareBatchAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/payouts");
  const currency = field(form, "currency", 3).toUpperCase();
  const through = field(form, "eligible_through", 10);
  const label = field(form, "label", 120);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) return fail("Choose the date earnings must be ready by.", { fieldErrors: { eligible_through: "Choose a date." } });
  let minimum = 0;
  const minText = field(form, "minimum", 20);
  if (minText) {
    try {
      minimum = parseDecimalToMinor(minText, currency);
    } catch {
      return fail("Enter the minimum like 10.", { fieldErrors: { minimum: "Enter an amount." } });
    }
  }
  const { data, error } = await (await adminDb()).rpc("admin_prepare_payout_batch", {
    p_currency: currency, p_eligible_through: through, p_minimum_minor: minimum, p_label: label || null,
  });
  if (error) return fail(friendlyError(error, GENERIC));
  const result = data as {
    batch_id: string | null;
    total_minor: number;
    items?: unknown[];
    held?: { display_name: string; amount_minor: number; reason: string }[];
  };
  revalidatePath("/admin/payouts");
  const reasons: Record<string, string> = {
    negative_balance: "owes more than earned (refund or dispute after payment)",
    no_payout_destination: "no payout details",
    destination_not_approved: "payout details not yet checked",
    below_minimum: "below the minimum",
  };
  const held = (result?.held ?? []).map((h) => `${h.display_name} ${formatMinor(h.amount_minor, currency)} — ${reasons[h.reason] ?? h.reason}`);
  const heldText = held.length ? ` Held back: ${held.join("; ")}.` : "";
  if (!result?.batch_id) return succeed(`No batch created: nothing ready to pay in ${currency}.${heldText}`);
  return succeed(`Batch prepared: ${formatMinor(result.total_minor, currency)} to ${result.items?.length ?? 0} coach(es). Nothing has been paid yet.${heldText}`);
}

export async function markSubmittedAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/payouts");
  const batchId = uuidField(form, "batch_id");
  if (!batchId) return fail(GENERIC);
  const { error } = await (await adminDb()).rpc("admin_mark_batch_submitted", { p_batch_id: batchId, p_note: field(form, "note", 1000) || null });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath(`/admin/payouts/${batchId}`);
  return succeed("Marked as sent to the transfer service. Record each transfer as paid once you have its reference.");
}

export async function revealReferenceAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/payouts");
  const itemId = uuidField(form, "item_id");
  if (!itemId) return fail(GENERIC);
  const { data, error } = await (await adminDb()).rpc("admin_reveal_payout_reference", { p_item_id: itemId });
  if (error) return fail(friendlyError(error, GENERIC));
  const d = data as { channel?: string; account_reference?: string; account_holder_name?: string | null };
  // Returned once, to this admin, and the reveal is logged by the database.
  return succeed(`${d.channel ?? ""}: ${d.account_reference ?? ""}${d.account_holder_name ? ` (${d.account_holder_name})` : ""}`);
}

export async function recordPaidAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/payouts");
  const itemId = uuidField(form, "item_id");
  const batchId = uuidField(form, "batch_id");
  const reference = field(form, "external_reference", 200);
  const paidOn = field(form, "paid_at", 16);
  const note = field(form, "evidence_note", 1000);
  if (!itemId) return fail(GENERIC);
  if (reference.length < 3) return fail("Enter the transfer reference from the transfer service.", { fieldErrors: { external_reference: "Required." } });
  // datetime-local has no zone; the form labels it UTC and it is read as UTC.
  const paidAt = new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(paidOn) ? `${paidOn}:00Z` : "invalid");
  if (!paidOn || Number.isNaN(paidAt.getTime())) return fail("Enter when the transfer was sent.", { fieldErrors: { paid_at: "Required." } });
  const { error } = await (await adminDb()).rpc("admin_record_payout_paid", {
    p_item_id: itemId, p_external_reference: reference, p_paid_at: paidAt.toISOString(), p_evidence_note: note,
  });
  if (error) return fail(friendlyError(error, GENERIC));
  kickWorker();
  revalidatePath(`/admin/payouts/${batchId}`);
  return succeed("Recorded as paid. The coach is notified.");
}

export async function recordFailedAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/payouts");
  const itemId = uuidField(form, "item_id");
  const batchId = uuidField(form, "batch_id");
  const reason = field(form, "reason", 1000);
  if (!itemId) return fail(GENERIC);
  const { error } = await (await adminDb()).rpc("admin_record_payout_failed", {
    p_item_id: itemId, p_reason: reason, p_returned_after_payment: form.get("returned") === "on",
  });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath(`/admin/payouts/${batchId}`);
  return succeed("Recorded. The earnings are back in the coach's balance for a later payout.");
}

// ---------------------------------------------------------------------------
// Coach changes
// ---------------------------------------------------------------------------

export async function applyCoachChangeAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/coach-changes");
  const requestId = uuidField(form, "request_id");
  const newProviderId = uuidField(form, "new_provider_id");
  const scope = field(form, "history_scope", 30);
  const note = field(form, "note", 1000);
  const effective = field(form, "effective_at", 16);
  if (!requestId || !newProviderId) return fail("Choose the new coach.", { fieldErrors: { new_provider_id: "Choose a coach." } });
  const effectiveAt = effective ? new Date(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(effective) ? `${effective}:00Z` : "invalid") : new Date();
  if (Number.isNaN(effectiveAt.getTime())) return fail("Enter a valid date.");
  const { error } = await (await adminDb()).rpc("admin_apply_coach_change", {
    p_request_id: requestId, p_new_provider_id: newProviderId, p_effective_at: effectiveAt.toISOString(), p_history_scope: scope, p_note: note,
  });
  if (error) return fail(friendlyError(error, GENERIC));
  kickWorker();
  revalidatePath("/admin/coach-changes");
  return succeed("Coach changed. The customer and both coaches are notified. Earnings for time already delivered stay with the previous coach.");
}

export async function declineCoachChangeAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin("/admin/coach-changes");
  const requestId = uuidField(form, "request_id");
  const note = field(form, "note", 1000);
  if (!requestId) return fail(GENERIC);
  const { error } = await (await adminDb()).rpc("admin_decline_coach_change", { p_request_id: requestId, p_note: note });
  if (error) return fail(friendlyError(error, GENERIC));
  revalidatePath("/admin/coach-changes");
  return succeed("Declined. Record what you told the customer in the note.");
}
