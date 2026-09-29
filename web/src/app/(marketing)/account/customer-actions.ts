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
import { featureRefusal } from "@/lib/features/server";

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

  // Rechecked here, not only on the page: a tab opened before changing coach
  // was switched off can't send a request. The database refuses as well.
  const paused = await featureRefusal("coach_changing");
  if (paused) return fail(paused);

  const enrollmentId = field(form, "enrollment_id", 40);
  const reason = field(form, "reason", 2000);
  const preferred = field(form, "preferred_provider_id", 40);
  const scope = field(form, "history_scope", 30);
  const values = { reason, preferred_provider_id: preferred, history_scope: scope };
  if (reason.length < 3) return fail("Tell us a little about why you'd like a change.", { fieldErrors: { reason: "Required." }, values });
  if (!["none", "programme_and_logs", "full"].includes(scope)) return fail("Choose what your new coach may see.", { values });
  if (form.get("consent") !== "on") return fail("Tick the box to confirm what you're agreeing to share.", { fieldErrors: { consent: "Required." }, values });

  const supabase = (await createClient())!;
  const { error } = await supabase.rpc("request_coach_change", {
    p_enrollment_id: enrollmentId,
    p_reason: reason,
    p_preferred_provider_id: /^[0-9a-f-]{36}$/i.test(preferred) ? preferred : null,
    p_history_scope: scope,
  });
  if (error) return fail(friendlyError(error, "Your request couldn't be sent. Please try again."), { values });
  kickWorker();
  revalidatePath("/account");
  return succeed("Request sent. TalentYak will contact you before anything changes. Your current coach, plan and price carry on until then.");
}

export async function withdrawCoachChangeAction(_: ActionState, form: FormData): Promise<ActionState> {
  await requireOnboarded("/account");
  const requestId = field(form, "request_id", 40);
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return fail("That didn't work. Please try again.");
  const supabase = (await createClient())!;
  const { data, error } = await supabase.rpc("withdraw_coach_change", { p_request: requestId });
  if (error) return fail(friendlyError(error, "That didn't work. Please try again."));
  revalidatePath("/account");
  return data ? succeed("Withdrawn. Nothing about your coaching has changed.") : fail("That request has already been decided.");
}
