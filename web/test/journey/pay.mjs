/**
 * Completes a pending purchase in Stripe TEST MODE, without anyone typing a
 * card number.
 *
 * Stripe's hosted Checkout page can only be finished by a human entering card
 * details, so the browser test stops at that page. This script finishes the
 * same purchase the way Stripe's own test suite does: it attaches one of
 * Stripe's test payment-method tokens (`pm_card_visa` — a token, not a card
 * number) to the customer the checkout created, and starts the subscription
 * with the SAME metadata the Checkout Session carries. Everything after that —
 * the webhook, the ledger, the enrolment — runs exactly as it would in
 * production.
 *
 *   node test/journey/pay.mjs <credentials.json> [pm_card_visa|pm_card_chargeCustomerFail|pm_card_createDispute] [--clock]
 */
import { readFileSync } from "node:fs";
import Stripe from "stripe";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }),
);
if (!env.STRIPE_SECRET_KEY.startsWith("sk_test_")) throw new Error("TEST key only.");

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2026-07-29.dahlia" });
const [file, token = "pm_card_visa"] = process.argv.slice(2);
const people = JSON.parse(readFileSync(file, "utf8"));

const rest = async (path) => {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
};

const [purchase] = await rest(
  `purchases?customer_id=eq.${people.customer.id}&state=eq.pending_payment&select=id,provider_id,offer_version_id,charge_amount_minor,charge_currency,checkout_attempt_id,inclusions_snapshot&order=created_at.desc&limit=1`,
);
if (!purchase) throw new Error("No pending purchase for the journey customer. Start a checkout first.");

const [billing] = await rest(`billing_customers?profile_id=eq.${people.customer.id}&select=stripe_customer_id`);
if (!billing) throw new Error("No Stripe customer recorded for this person.");

const pm = await stripe.paymentMethods.attach(token, { customer: billing.stripe_customer_id });
await stripe.customers.update(billing.stripe_customer_id, { invoice_settings: { default_payment_method: pm.id } });

const metadata = {
  purchase_id: purchase.id,
  checkout_attempt_id: purchase.checkout_attempt_id,
  offer_version_id: purchase.offer_version_id,
  provider_id: purchase.provider_id,
};

// A subscription's inline price needs a product object (Checkout creates one
// for you); the app's own checkout path uses Checkout, not this.
const product = await stripe.products.create({ name: purchase.inclusions_snapshot.title, metadata: { journey_fixture: "true" } });

const subscription = await stripe.subscriptions.create({
  customer: billing.stripe_customer_id,
  items: [
    {
      price_data: {
        currency: purchase.charge_currency.toLowerCase(),
        unit_amount: Number(purchase.charge_amount_minor),
        recurring: { interval: "month", interval_count: 1 },
        product: product.id,
      },
    },
  ],
  default_payment_method: pm.id,
  metadata,
  payment_behavior: "allow_incomplete",
  expand: ["latest_invoice"],
});

console.log(
  JSON.stringify(
    {
      purchase_id: purchase.id,
      subscription: subscription.id,
      subscription_status: subscription.status,
      invoice: subscription.latest_invoice?.id,
      invoice_status: subscription.latest_invoice?.status,
      amount_paid: subscription.latest_invoice?.amount_paid,
      currency: subscription.latest_invoice?.currency,
    },
    null,
    2,
  ),
);
