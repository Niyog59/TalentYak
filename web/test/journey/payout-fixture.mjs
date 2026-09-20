/**
 * A clearly labelled FIXTURE earning, so the payout screens can be tested.
 *
 * Earnings only become payable once the coaching period they paid for has
 * ended, and a Stripe test clock moves Stripe's clock, not the database's. So
 * this records one payment whose period is already over — through the app's own
 * `record_cycle_payment`, the same function the webhook calls, with the same
 * 20% split — and then runs the real recognition sweep.
 *
 * Every row it creates is marked `fixture:` in its source key, and there is no
 * Stripe payment behind it. It exists to exercise the payout batch flow; it is
 * not evidence that anybody paid anything.
 *
 *   node test/journey/payout-fixture.mjs <credentials.json>
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }),
);

const call = async (path, init = {}) => {
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
const rpc = (fn, body) => call(`rpc/${fn}`, { method: "POST", body: JSON.stringify(body) });

const people = JSON.parse(readFileSync(process.argv[2], "utf8"));

// A separate synthetic customer, so a real journey purchase is not muddied.
const email = `talentyak-test-fixture-${randomUUID().slice(0, 8)}@example.test`;
const user = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: `Pw-${randomUUID()}`, email_confirm: true }),
}).then((r) => r.json());

const [version] = await call(
  "offer_versions?published_at=not.is.null&superseded_at=is.null&select=id,offers!inner(provider_id)&order=published_at.desc&limit=1",
);
const providerId = version.offers.provider_id;

const records = await rpc("create_checkout_records", {
  p: { customer_id: user.id, offer_version_id: version.id, currency: "USD", display_currency: "USD", idempotency_key: randomUUID(), hold_seconds: 2100 },
});

// A period that ended five weeks ago, so the recognition sweep can see it as
// delivered. The split is computed the same way the webhook computes it.
const sourceKey = `fixture:payout-journey:${randomUUID().slice(0, 8)}`;
const periodEnd = new Date(Date.now() - 5 * 86400_000);
const periodStart = new Date(periodEnd.getTime() - 30 * 86400_000);
const amount = Number(records.amount_minor);
const commission = Math.round(amount * 0.2);

await rpc("record_cycle_payment", {
  p: {
    purchase_id: records.purchase_id,
    cycle: {
      source_key: sourceKey,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      currency: "USD",
      amount_minor: amount,
      stripe_invoice_id: null,
      stripe_payment_intent_id: null,
    },
    entries: [
      // Same field names the application's ledger builder produces.
      { account: "coach_payable", effect: "service_earned", currency: "USD", amountMinor: amount - commission, effectKey: `cycle:${sourceKey}:coach_earned`, commissionPolicyId: "commission.coaching.v3" },
      { account: "platform_revenue", effect: "commission_earned", currency: "USD", amountMinor: commission, effectKey: `cycle:${sourceKey}:commission`, commissionPolicyId: "commission.coaching.v3" },
    ],
  },
});

const recognised = await rpc("recognise_delivered_cycles", {});
const balances = await call(`coach_balances?provider_id=eq.${providerId}&select=*`);
console.log(JSON.stringify({ fixture_source_key: sourceKey, recognised, balances }, null, 2));
void people;
