#!/usr/bin/env node
/**
 * Local Stripe event relay — TEST MODE ONLY.
 *
 * WHY THIS EXISTS. Stripe delivers webhooks to a public URL. A laptop running
 * `next dev` has none, and the Stripe CLI (which normally forwards events) is
 * not installed here. This relay does the same job without it: it reads REAL
 * events from the Stripe test account's Events API, signs each one exactly the
 * way Stripe signs a webhook, and POSTs it to the local webhook route.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT.
 *   Proves:  real Stripe test objects and event types flow through the real
 *            signature check, receipt/lease handling, authoritative re-fetch and
 *            database effects of `/api/webhooks/stripe`.
 *   Does not prove: that Stripe can reach a deployed URL, or that the deployed
 *            endpoint's signing secret is right. Those are checked once the app
 *            is deployed and a webhook endpoint is registered in the dashboard.
 *
 * The signing secret it uses is a locally generated one (STRIPE_WEBHOOK_SECRET
 * in web/.env.local, labelled as local-relay only). It is not a Stripe secret.
 *
 * Usage (from web/):
 *   node ../scripts/stripe-event-relay.mjs                 # follow new events
 *   node ../scripts/stripe-event-relay.mjs --since=<unix>  # start from a time
 *   node ../scripts/stripe-event-relay.mjs --once          # relay backlog, exit
 *   node ../scripts/stripe-event-relay.mjs --event=evt_…   # (re)send one event
 *   --target=http://localhost:3001/api/webhooks/stripe (default)
 *   --mutate-signature                                     # send a bad signature (negative test)
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);

function loadEnv() {
  const file = join(process.cwd(), ".env.local");
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };
const key = env.STRIPE_SECRET_KEY ?? "";
const secret = env.STRIPE_WEBHOOK_SECRET ?? "";
const target = args.target ?? "http://localhost:3001/api/webhooks/stripe";

if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error("Refusing to run: STRIPE_SECRET_KEY is not a TEST key. This relay never touches live mode.");
  process.exit(2);
}
if (!secret.startsWith("whsec_")) {
  console.error("Refusing to run: STRIPE_WEBHOOK_SECRET is not set in web/.env.local.");
  process.exit(2);
}
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(target)) {
  console.error("Refusing to run: the relay only delivers to localhost.");
  process.exit(2);
}

async function stripe(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${key}` } });
  const body = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${body.error?.message}`);
  return body;
}

async function deliver(event) {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  let signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  if (args["mutate-signature"]) signature = signature.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
  const res = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${timestamp},v1=${signature}` },
    body: payload,
  });
  const text = await res.text();
  console.log(`${new Date().toISOString()}  ${event.id}  ${event.type.padEnd(40)} → ${res.status} ${text.slice(0, 120)}`);
  return res.status;
}

async function listSince(since) {
  const events = [];
  let startingAfter = null;
  for (;;) {
    const page = await stripe(`events?limit=100&created[gte]=${since}${startingAfter ? `&starting_after=${startingAfter}` : ""}`);
    events.push(...page.data);
    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  // The API lists newest first; deliver in the order they happened.
  return events.reverse();
}

if (args.event) {
  const event = await stripe(`events/${args.event}`);
  const status = await deliver(event);
  process.exit(status >= 200 && status < 300 ? 0 : 1);
}

const seen = new Set();
let since = Number(args.since ?? Math.floor(Date.now() / 1000) - 5);
console.log(`Relaying Stripe TEST events created since ${new Date(since * 1000).toISOString()} to ${target}`);

for (;;) {
  const events = await listSince(since);
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    await deliver(event);
  }
  if (args.once) break;
  if (events.length) since = Math.max(since, events[events.length - 1].created - 60);
  await new Promise((r) => setTimeout(r, 2500));
}
