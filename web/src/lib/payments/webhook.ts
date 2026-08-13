import "server-only";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/payments/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { computePayout } from "@/lib/payouts";
import { env } from "@/lib/env";

export async function handleStripeWebhook(req: Request): Promise<Response> {
  const stripe = getStripe();
  if (!stripe || !env.stripeWebhookSecret) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 501 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      await req.text(),
      signature,
      env.stripeWebhookSecret,
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Database not configured" }, { status: 501 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const bookingId =
        session.metadata?.booking_id ?? session.client_reference_id;
      if (!bookingId) break;

      if (session.subscription) {
        await admin
          .from("bookings")
          .update({ stripe_subscription_id: String(session.subscription) })
          .eq("id", bookingId);
      }

      // One-time payments settle here; subscription cycles arrive as invoices.
      if (session.mode === "payment" && session.payment_intent) {
        await recordPayment(admin, {
          bookingId,
          paymentIntentId: String(session.payment_intent),
          checkoutSessionId: session.id,
          amountCents: session.amount_total ?? 0,
          kind: "one_time",
          raw: session as unknown as Record<string, unknown>,
        });
      }
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object;
      const subscriptionId =
        typeof invoice.parent?.subscription_details?.subscription === "string"
          ? invoice.parent.subscription_details.subscription
          : null;
      if (!subscriptionId) break;

      const { data: booking } = await admin
        .from("bookings")
        .select("id")
        .eq("stripe_subscription_id", subscriptionId)
        .maybeSingle();
      if (!booking) break;

      await recordPayment(admin, {
        bookingId: booking.id,
        invoiceId: invoice.id,
        amountCents: invoice.amount_paid ?? 0,
        kind: "subscription_cycle",
        raw: invoice as unknown as Record<string, unknown>,
      });
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object;
      const intentId =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;
      if (!intentId) break;
      await admin
        .from("payments")
        .update({ status: "refunded" })
        .eq("stripe_payment_intent_id", intentId);
      break;
    }
  }

  return NextResponse.json({ received: true });
}

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

/**
 * Records a succeeded payment and writes its payout ledger row using
 * the vertical's registered rule. If no provider is assigned yet, the
 * ledger row is created unassigned and linked when the founder assigns.
 */
async function recordPayment(
  admin: AdminClient,
  args: {
    bookingId: string;
    paymentIntentId?: string;
    checkoutSessionId?: string;
    invoiceId?: string;
    amountCents: number;
    kind: "one_time" | "subscription_cycle";
    raw: Record<string, unknown>;
  },
) {
  const { data: booking } = await admin
    .from("bookings")
    .select("id, service_id, vertical_slug, provider_id, providers(founding)")
    .eq("id", args.bookingId)
    .maybeSingle();
  if (!booking) return;

  const { data: payment, error } = await admin
    .from("payments")
    .insert({
      booking_id: booking.id,
      stripe_payment_intent_id: args.paymentIntentId ?? null,
      stripe_checkout_session_id: args.checkoutSessionId ?? null,
      stripe_invoice_id: args.invoiceId ?? null,
      amount_cents: args.amountCents,
      status: "succeeded",
      kind: args.kind,
      raw: args.raw,
    })
    .select("id")
    .single();
  if (error || !payment) return; // duplicate intent -> unique index rejects

  // Supabase returns to-one joins as object or single-element array
  // depending on schema introspection; normalize both.
  const joined = booking.providers as unknown;
  const provider = (Array.isArray(joined) ? joined[0] : joined) as
    | { founding: boolean }
    | null
    | undefined;
  const split = computePayout({
    verticalSlug: booking.vertical_slug,
    serviceId: booking.service_id,
    grossCents: args.amountCents,
    providerFounding: provider?.founding ?? false,
  });

  await admin.from("payout_ledger").insert({
    payment_id: payment.id,
    booking_id: booking.id,
    provider_id: booking.provider_id,
    gross_cents: split.grossCents,
    direct_costs_cents: split.directCostsCents,
    provider_share_cents: split.providerShareCents,
    platform_share_cents: split.platformShareCents,
    rule: split.rule,
  });

  await admin.from("booking_events").insert({
    booking_id: booking.id,
    actor: "stripe",
    note: `Payment succeeded: $${(args.amountCents / 100).toFixed(2)} (${args.kind})`,
  });
}
