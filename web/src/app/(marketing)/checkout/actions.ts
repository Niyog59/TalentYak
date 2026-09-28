"use server";

import { redirect } from "next/navigation";
import { requireOnboarded } from "@/lib/auth";
import { type ActionState, fail, field } from "@/lib/actions";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import { CheckoutError, startCheckout } from "@/lib/checkout/service";
import { planPurchasable, purchaseMode } from "@/lib/launch";
import { getPublicPlan } from "@/lib/offers/public";

export async function startCheckoutAction(_: ActionState, form: FormData): Promise<ActionState> {
  const versionId = field(form, "version_id", 40);
  const currency = field(form, "currency", 3).toUpperCase();
  const session = await requireOnboarded(`/checkout/${versionId}?currency=${currency}`);

  if (form.get("agree") !== "on") {
    return fail("Confirm you've read how billing and cancelling work.", { fieldErrors: { agree: "Required to continue." } });
  }

  const limit = await rateLimit("checkout_start", session.userId, 10, 600);
  if (!limit.allowed) return fail(tooMany(limit));

  // Re-checked here, not trusted from the page: may this person buy at all,
  // is it still on sale, and does the coach still have room. The database
  // re-checks price, capacity and eligibility again when it records it.
  const found = await getPublicPlan(versionId);
  if (!found) return fail("This package is no longer on sale. Nothing was charged.");
  if (!planPurchasable(purchaseMode(session), found.plan)) return fail("TalentYak isn't taking payments yet. Nothing was charged — you can join the waitlist instead.");
  if (found.plan.service_type === "recurring_coaching" && found.coach.availability !== "available") {
    return fail(`${found.coach.display_name} isn't taking new clients right now. Nothing was charged — you can join the waitlist instead.`);
  }

  let url: string;
  try {
    ({ url } = await startCheckout({
      session,
      offerVersionId: versionId,
      currency,
      idempotencyKey: field(form, "idempotency_key", 64),
      shownCoachExpectations: field(form, "expectations_coach_version_id", 40),
      shownPlatformExpectations: field(form, "expectations_platform_version_id", 40),
      slotStartsAt: field(form, "slot_starts_at", 40) || null,
    }));
  } catch (err) {
    // The document changed between reading and paying: show the new one rather
    // than letting the purchase record something the customer never saw.
    if (err instanceof CheckoutError && err.code === "expectations_changed") {
      redirect(`/checkout/${versionId}?currency=${currency}&changed=1`);
    }
    return fail(err instanceof CheckoutError ? err.message : "We couldn't start checkout. Nothing was charged. Please try again.");
  }
  // Stripe-hosted checkout. Card details never touch TalentYak (invariant 4).
  redirect(url);
}
