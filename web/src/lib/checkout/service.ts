import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, stripeMode } from "@/lib/payments/stripe";
import { env } from "@/lib/env";
import { isPublicVertical } from "@/verticals/registry";
import { evaluateSaleReadiness } from "@/lib/policy/live-gate";
import { friendlyError } from "@/lib/errors";
import type { SessionContext } from "@/lib/auth";

/**
 * Starting a checkout.
 *
 * Everything that decides what is charged happens here, on the server, from
 * the database: which offer version, its price in the chosen currency, whether
 * the coach can take the customer, whether the purchase can be sold at all.
 * The browser supplies only an offer version id, a currency code and an
 * idempotency key — and the currency is checked against what the coach
 * actually priced.
 *
 * The browser's return from Stripe grants nothing. Access is granted when the
 * webhook confirms the money (invariant 5).
 */

export class CheckoutError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "CheckoutError";
  }
}

/** Stripe checkout sessions must live at least 30 minutes. The place is held a little longer. */
const SESSION_MINUTES = 31;
const HOLD_SECONDS = 35 * 60;

export interface StartedCheckout {
  url: string;
  attemptId: string;
}

async function stripeCustomerFor(session: SessionContext, stripe: Stripe): Promise<string> {
  const admin = createAdminClient()!;
  const { data: existing } = await admin
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("profile_id", session.userId)
    .maybeSingle();
  if (existing) return existing.stripe_customer_id;

  const customer = await stripe.customers.create(
    {
      email: session.email,
      name: session.profile.preferred_name ?? undefined,
      metadata: { profile_id: session.userId },
    },
    // Two concurrent first checkouts create one customer, not two.
    { idempotencyKey: `customer:${session.userId}` },
  );

  const { error } = await admin.from("billing_customers").insert({
    profile_id: session.userId,
    stripe_customer_id: customer.id,
    livemode: customer.livemode,
  });
  if (error) {
    // Lost a race to a concurrent insert: use the row that won.
    const { data: winner } = await admin
      .from("billing_customers").select("stripe_customer_id").eq("profile_id", session.userId).single();
    if (winner) return winner.stripe_customer_id;
    throw new CheckoutError("We couldn't set up billing. Please try again.");
  }
  return customer.id;
}

export async function startCheckout(args: {
  session: SessionContext;
  offerVersionId: string;
  currency: string;
  idempotencyKey: string;
  /** The expectations versions that were on screen. The database refuses if either is no longer live. */
  shownCoachExpectations: string;
  shownPlatformExpectations: string;
  /** One-off sessions: the time chosen on the checkout page, held while paying. */
  slotStartsAt?: string | null;
}): Promise<StartedCheckout> {
  const stripe = getStripe();
  const admin = createAdminClient();
  if (!stripe || !admin) throw new CheckoutError("Payments aren't available right now.");

  if (
    !/^[0-9a-f-]{36}$/i.test(args.offerVersionId) || !/^[A-Z]{3}$/.test(args.currency) || !/^[A-Za-z0-9_-]{16,64}$/.test(args.idempotencyKey)
    || !/^[0-9a-f-]{36}$/i.test(args.shownCoachExpectations) || !/^[0-9a-f-]{36}$/i.test(args.shownPlatformExpectations)
  ) {
    throw new CheckoutError("That checkout link isn't valid. Go back and choose the plan again.");
  }

  const { data: version } = await admin
    .from("offer_versions")
    .select("id, title, description, service_type, billing_structure, billing_interval, billing_interval_count, programme_included, calls_included_per_month, check_in_cadence, messaging_channel, form_review_included, offers!inner(id, vertical_slug, provider_id, providers!inner(slug))")
    .eq("id", args.offerVersionId)
    .maybeSingle();
  if (!version) throw new CheckoutError("This plan is no longer available.");

  const offer = (Array.isArray(version.offers) ? version.offers[0] : version.offers) as unknown as {
    id: string; vertical_slug: string; provider_id: string; providers: { slug: string } | { slug: string }[];
  };
  const providerSlug = (Array.isArray(offer.providers) ? offer.providers[0] : offer.providers).slug;

  // A service that is not public can never be bought, whatever the database says.
  if (!isPublicVertical(offer.vertical_slug)) throw new CheckoutError("This plan is not available.");

  // Real money: every lock must be open. Test mode is the sandbox and proceeds.
  if (stripeMode() === "live") {
    const readiness = evaluateSaleReadiness(version);
    if (!readiness.ready) {
      console.warn("[checkout] live sale refused:", readiness.blockers.join(" | "));
      throw new CheckoutError("This plan can't be purchased yet.");
    }
  }

  const { data: records, error } = await admin.rpc("create_checkout_records", {
    p: {
      customer_id: args.session.userId,
      offer_version_id: version.id,
      currency: args.currency,
      display_currency: args.session.profile.display_currency,
      idempotency_key: args.idempotencyKey,
      hold_seconds: HOLD_SECONDS,
      expectations_coach_version_id: args.shownCoachExpectations,
      expectations_platform_version_id: args.shownPlatformExpectations,
      slot_starts_at: args.slotStartsAt && !Number.isNaN(Date.parse(args.slotStartsAt)) ? args.slotStartsAt : null,
    },
  });
  if (error || !records) throw new CheckoutError(friendlyError(error, "We couldn't start checkout. Please try again."), error?.message);

  // Same key as before: return the same session if it is still usable.
  if (records.reused && !["created", "redirected"].includes(String(records.state))) {
    throw new CheckoutError("That checkout has ended. Go back and choose the plan again.");
  }
  if (records.reused && records.stripe_checkout_session_id) {
    const existing = await stripe.checkout.sessions.retrieve(records.stripe_checkout_session_id);
    if (existing.status === "open" && existing.url) return { url: existing.url, attemptId: records.attempt_id };
    throw new CheckoutError(
      existing.status === "complete"
        ? "This checkout is already complete."
        : "That checkout has expired. Go back and choose the plan again.",
    );
  }

  const metadata = {
    purchase_id: String(records.purchase_id),
    checkout_attempt_id: String(records.attempt_id),
    offer_version_id: version.id,
    provider_id: offer.provider_id,
  };
  const recurring = version.service_type === "recurring_coaching";

  // The session's expiry is derived from the attempt, not from the clock, so a
  // retry after a crash sends Stripe byte-identical parameters and the
  // idempotency key returns the original session instead of an error.
  const { data: attempt } = await admin
    .from("checkout_attempts").select("expires_at").eq("id", records.attempt_id).single();
  const sessionExpiry = Math.floor(new Date(attempt!.expires_at).getTime() / 1000) - (HOLD_SECONDS - SESSION_MINUTES * 60);
  if (sessionExpiry < Math.floor(Date.now() / 1000) + 30 * 60 + 15) {
    await admin.rpc("close_checkout_attempt", { p_attempt_id: records.attempt_id, p_state: "expired", p_reason: "retry_too_late" });
    throw new CheckoutError("That checkout has expired. Go back and choose the plan again.");
  }

  try {
    const customerId = await stripeCustomerFor(args.session, stripe);

    const session = await stripe.checkout.sessions.create(
      {
        mode: recurring ? "subscription" : "payment",
        customer: customerId,
        client_reference_id: String(records.attempt_id),
        metadata,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: String(records.currency).toLowerCase(),
              // From the database, never from the browser.
              unit_amount: Number(records.amount_minor),
              product_data: {
                name: version.title,
                ...(version.description ? { description: version.description.slice(0, 500) } : {}),
                metadata: { offer_version_id: version.id },
              },
              ...(recurring
                ? {
                    recurring: {
                      // The billing shape the COACH chose — not a hardcoded quarter.
                      interval: (version.billing_interval ?? "month") as "month" | "year",
                      interval_count: version.billing_interval_count ?? 1,
                    },
                  }
                : {}),
            },
          },
        ],
        ...(recurring
          ? { subscription_data: { metadata } }
          : { payment_intent_data: { metadata } }),
        expires_at: sessionExpiry,
        success_url: `${env.siteUrl}/checkout/return?attempt=${records.attempt_id}`,
        cancel_url: `${env.siteUrl}/coaches/${providerSlug}?checkout=cancelled`,
        // No promotion codes: platform-funded promotions are not approved.
        allow_promotion_codes: false,
      },
      { idempotencyKey: `checkout:${records.attempt_id}` },
    );

    if (!session.url) throw new Error("Stripe returned no checkout URL");
    await admin.rpc("attach_checkout_session", { p_attempt_id: records.attempt_id, p_session_id: session.id });
    return { url: session.url, attemptId: String(records.attempt_id) };
  } catch (err) {
    // Starting the payment failed: give the place back immediately rather than
    // holding it for half an hour against a checkout that does not exist.
    await admin.rpc("close_checkout_attempt", {
      p_attempt_id: records.attempt_id, p_state: "failed", p_reason: "stripe_session_create_failed",
    });
    console.error("[checkout] session create failed:", err instanceof Error ? err.message : err);
    throw new CheckoutError("We couldn't start the payment. Nothing was charged. Please try again.");
  }
}
