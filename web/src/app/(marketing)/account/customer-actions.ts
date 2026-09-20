"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, field, succeed } from "@/lib/actions";
import { friendlyError } from "@/lib/errors";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { BillingError, billingPortalUrl, setCancelAtPeriodEnd } from "@/lib/payments/billing";
import { kickWorker } from "@/lib/worker/outbox";

export async function cancelPlanAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded("/account/billing");
  const purchaseId = field(form, "purchase_id", 40);
  const cancel = field(form, "cancel", 5) === "true";
  const limit = await rateLimit("plan_cancel", session.userId, 20, 3600);
  if (!limit.allowed) return fail(tooMany(limit));
  try {
    await setCancelAtPeriodEnd(session.userId, purchaseId, cancel);
  } catch (err) {
    return fail(err instanceof BillingError ? err.message : "That didn't work. Nothing was changed. Please try again.");
  }
  revalidatePath("/account", "layout");
  return succeed(
    cancel
      ? "Cancelled. You keep your coaching until the end of the month you've paid for, and won't be charged again."
      : "Your plan will continue. You'll be charged on your usual date.",
  );
}

export async function billingPortalAction(_: ActionState): Promise<ActionState> {
  const session = await requireOnboarded("/account/billing");
  let url: string;
  try {
    url = await billingPortalUrl(session.userId);
  } catch (err) {
    return fail(err instanceof BillingError ? err.message : "Billing isn't available right now. Please try again.");
  }
  redirect(url);
}

export async function requestCoachChangeAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireOnboarded("/account");
  const limit = await rateLimit("coach_change", session.userId, 5, 24 * 3600);
  if (!limit.allowed) return fail(tooMany(limit));

  const enrollmentId = field(form, "enrollment_id", 40);
  const reason = field(form, "reason", 2000);
  if (reason.length < 3) return fail("Tell us a little about why you'd like a change.", { fieldErrors: { reason: "Required." } });

  const supabase = (await createClient())!;
  const { error } = await supabase.rpc("request_coach_change", { p_enrollment_id: enrollmentId, p_reason: reason, p_preferred_provider_id: null });
  if (error) return fail(friendlyError(error, "Your request couldn't be sent. Please try again."));
  kickWorker();
  revalidatePath("/account");
  return succeed("Request sent. TalentYak will contact you about a new coach. Your current plan and price don't change.");
}
