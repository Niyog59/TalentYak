import "server-only";
import type { Service } from "@/lib/catalog/types";
import { getStripe } from "@/lib/payments/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

/**
 * Creates a Stripe Checkout session for a booking.
 * One-time services -> mode 'payment'. Subscriptions -> mode
 * 'subscription' billed quarterly (interval month x3) per the
 * pricing decision in the handover.
 */
export async function createCheckoutSession(
  bookingId: string,
  service: Service,
  opts: { email: string },
): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const isSubscription = service.billingType === "subscription";

  const session = await stripe.checkout.sessions.create({
    mode: isSubscription ? "subscription" : "payment",
    customer_email: opts.email,
    client_reference_id: bookingId,
    metadata: { booking_id: bookingId, service_id: service.id },
    line_items: [
      {
        quantity: isSubscription ? 3 : 1, // quarterly = 3 monthly units
        price_data: {
          currency: service.currency,
          unit_amount: service.priceCents,
          product_data: {
            name: service.name,
            description: service.summary,
          },
          ...(isSubscription
            ? { recurring: { interval: "month" as const, interval_count: 3 } }
            : {}),
        },
      },
    ],
    success_url: `${env.siteUrl}/book/${service.id}/received?booking=${bookingId}`,
    cancel_url: `${env.siteUrl}/services/${service.verticalSlug}/${service.id}`,
  });

  const admin = createAdminClient();
  if (admin) {
    await admin
      .from("bookings")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", bookingId);
  }

  return session.url;
}
