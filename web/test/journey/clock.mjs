/**
 * Renewal and failed-payment tests, in Stripe TEST MODE, using a Stripe test
 * clock so a month can pass in seconds.
 *
 * A test clock only governs customers created against it, so this builds its
 * own synthetic customer and purchase (through the app's own
 * `create_checkout_records`, so the purchase is recorded exactly as a real
 * checkout would record it), subscribes with a test payment-method token, then
 * moves the clock forward. The relay delivers the resulting real Stripe events
 * to the local webhook.
 *
 *   node test/journey/clock.mjs setup <credentials.json>   # customer, purchase, subscription
 *   node test/journey/clock.mjs advance <days>             # move the clock
 *   node test/journey/clock.mjs fail                       # swap in a card that will be declined
 *   node test/journey/clock.mjs state                      # what the database now says
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }),
);
if (!env.STRIPE_SECRET_KEY.startsWith("sk_test_")) throw new Error("TEST key only.");
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2026-07-29.dahlia" });

const STATE_FILE = process.env.JOURNEY_CLOCK_FILE ?? "/tmp/talentyak-clock.json";
const [command, arg] = process.argv.slice(2);

const sb = async (path, init = {}) => {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
};

if (command === "setup") {
  const people = JSON.parse(readFileSync(arg, "utf8"));

  // A second synthetic customer, bound to the clock.
  const email = `talentyak-test-clock-${randomUUID().slice(0, 8)}@example.test`;
  const auth = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: `Pw-${randomUUID()}`, email_confirm: true }),
  });
  const user = await auth.json();
  if (!user.id) throw new Error(`could not create clock customer: ${JSON.stringify(user)}`);
  await sb(`profiles?id=eq.${user.id}`, { method: "PATCH", body: JSON.stringify({ timezone: "America/New_York", display_currency: "USD", preferred_name: "Clock Test" }) });

  // The live version of the journey coach's published plan.
  const [version] = await sb(
    `offer_versions?published_at=not.is.null&superseded_at=is.null&select=id,offer_id,title,offers!inner(provider_id,providers!inner(display_name))&order=published_at.desc&limit=1`,
  );

  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000), name: "TalentYak journey clock" });
  const customer = await stripe.customers.create({ email, test_clock: clock.id, metadata: { profile_id: user.id } });
  await sb("billing_customers", { method: "POST", body: JSON.stringify({ profile_id: user.id, stripe_customer_id: customer.id, livemode: false }) });

  // The app's own checkout record function — same path a real checkout takes.
  const records = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/create_checkout_records`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p: { customer_id: user.id, offer_version_id: version.id, currency: "USD", display_currency: "USD", idempotency_key: randomUUID(), hold_seconds: 2100 } }),
  }).then((r) => r.json());
  if (!records?.purchase_id) throw new Error(`checkout records failed: ${JSON.stringify(records)}`);

  const pm = await stripe.paymentMethods.attach("pm_card_visa", { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  const product = await stripe.products.create({ name: version.title, metadata: { journey_fixture: "true" } });
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price_data: { currency: "usd", unit_amount: Number(records.amount_minor), recurring: { interval: "month" }, product: product.id } }],
    default_payment_method: pm.id,
    metadata: {
      purchase_id: String(records.purchase_id),
      checkout_attempt_id: String(records.attempt_id),
      offer_version_id: version.id,
      provider_id: version.offers.provider_id,
    },
    payment_behavior: "allow_incomplete",
  });

  writeFileSync(STATE_FILE, JSON.stringify({ clock: clock.id, customer: customer.id, profile: user.id, purchase: records.purchase_id, subscription: subscription.id, coach: people.coach.id }, null, 2));
  console.log(JSON.stringify({ clock: clock.id, purchase: records.purchase_id, subscription_status: subscription.status }, null, 2));
}

if (command === "advance") {
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  const clock = await stripe.testHelpers.testClocks.retrieve(state.clock);
  const to = clock.frozen_time + Number(arg ?? 32) * 86400;
  await stripe.testHelpers.testClocks.advance(state.clock, { frozen_time: to });
  for (let i = 0; i < 60; i++) {
    const current = await stripe.testHelpers.testClocks.retrieve(state.clock);
    if (current.status === "ready") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`clock now ${new Date(to * 1000).toISOString()}`);
}

if (command === "fail") {
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  const pm = await stripe.paymentMethods.attach("pm_card_chargeCustomerFail", { customer: state.customer });
  await stripe.customers.update(state.customer, { invoice_settings: { default_payment_method: pm.id } });
  await stripe.subscriptions.update(state.subscription, { default_payment_method: pm.id });
  console.log("next charge will be declined");
}

if (command === "dispute") {
  // Stripe's dispute test token: the charge succeeds, then a dispute is opened
  // against it a moment later, exactly as a real chargeback arrives.
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  const pm = await stripe.paymentMethods.attach("pm_card_createDispute", { customer: state.customer });
  await stripe.customers.update(state.customer, { invoice_settings: { default_payment_method: pm.id } });
  await stripe.subscriptions.update(state.subscription, { default_payment_method: pm.id });
  const invoices = await stripe.invoices.list({ customer: state.customer, status: "open", limit: 1 });
  if (invoices.data[0]) {
    const paid = await stripe.invoices.pay(invoices.data[0].id);
    console.log(`paid invoice ${paid.id} with the disputing card (${paid.status})`);
  } else {
    console.log("no open invoice; advance the clock first");
  }
}

if (command === "state") {
  if (!existsSync(STATE_FILE)) throw new Error("no clock scenario yet");
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  const [purchase] = await sb(`purchases?id=eq.${state.purchase}&select=state,paid_through_at,charge_amount_minor`);
  const cycles = await sb(`billing_cycles?purchase_id=eq.${state.purchase}&select=sequence,period_start,period_end,amount_minor,state&order=sequence`);
  const ledger = await sb(`ledger_entries?purchase_id=eq.${state.purchase}&select=account,effect,amount_minor,effect_key&order=occurred_at`);
  console.log(JSON.stringify({ purchase, cycles, ledger }, null, 2));
}
