#!/usr/bin/env node
/**
 * Proves that a queued notification actually reaches a real inbox.
 *
 *   node scripts/send-test-notification.mjs <address>            # enqueue
 *   node scripts/send-test-notification.mjs <address> --report   # read outcome
 *   node scripts/send-test-notification.mjs <address> --cleanup  # remove fixture
 *
 * WHY THIS EXISTS. Everything else in the test suite stops short of sending:
 * fixtures use `@example.test`, which the worker refuses on purpose. That
 * proves the logic and proves nothing about whether mail leaves the building.
 * This is the one deliberate, founder-authorised send.
 *
 * WHAT IT WILL NOT DO:
 *
 * - **Pick a recipient.** The address is required on the command line. There is
 *   no default and no fallback, because a default address is how a test send
 *   reaches somebody who never asked for it.
 * - **Send to a stranger.** It refuses anything but an address the founder
 *   named, and refuses reserved test domains too — those bounce and damage the
 *   sending domain's reputation.
 * - **Send anything itself.** It writes a job to the outbox. The worker sends
 *   it, through exactly the same path as a real notification, so what this
 *   proves is the real path and not a special case.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const text = readFileSync(join(root, "web", ".env.local"), "utf8");
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
} catch {
  /* Reported below as a missing variable. */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const recipient = process.argv[2];
const mode = process.argv.includes("--report")
  ? "report"
  : process.argv.includes("--cleanup")
    ? "cleanup"
    : "enqueue";

if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in web/.env.local.");
  process.exit(1);
}

if (!recipient || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
  console.error(
    "Usage: node scripts/send-test-notification.mjs <address> [--report|--cleanup]\n\n" +
      "The address is required. This script sends real email to a real person,\n" +
      "so it will not guess who that should be.",
  );
  process.exit(1);
}

if (/@[^@]*\.(test|invalid|example|localhost)$/i.test(recipient) || /@example\.(com|org|net)$/i.test(recipient)) {
  console.error(`${recipient} is a reserved test domain. The worker refuses these, and so does this script.`);
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

async function rest(path, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`);
  return body;
}

async function auth(path, init = {}) {
  const response = await fetch(`${url}/auth/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`auth ${path}: ${response.status} ${text}`);
  return body;
}

/** The fixture account, found or made. Returns { id, created }. */
async function fixtureProfile() {
  const existing = await auth(`admin/users?page=1&per_page=200`);
  const found = (existing.users ?? []).find((u) => (u.email ?? "").toLowerCase() === recipient.toLowerCase());
  if (found) return { id: found.id, created: false };

  const made = await auth("admin/users", {
    method: "POST",
    // Confirmed on creation, so Supabase itself sends nothing. The only message
    // this script causes is the one it queues.
    body: JSON.stringify({ email: recipient, email_confirm: true, password: `Pw-${crypto.randomUUID()}` }),
  });
  return { id: made.id, created: true };
}

const DEDUPE = "founder-delivery-check";

if (mode === "enqueue") {
  const profile = await fixtureProfile();
  console.log(`Recipient profile: ${profile.id} (${profile.created ? "created for this check" : "already existed — will not be deleted"})`);

  // The delivery-check topic is an essential category, so no preference can
  // suppress it and the check measures delivery rather than a setting. This
  // script grants no role: a test must not leave standing privilege behind it.

  // Clear only THIS check's previous job, so the dedupe key does not make the
  // run a no-op. Scoped to the one dedupe key: a broader delete here would
  // reach real notification history.
  await rest(`outbox?dedupe_key=eq.${DEDUPE}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });

  const [job] = await rest("outbox", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      // A dedicated, clearly labelled message. (Founder alerts are sent only to
      // current administrators, and this check must not grant that role.)
      topic: "email.delivery_check",
      payload: { profile_id: profile.id },
      dedupe_key: DEDUPE,
      state: "pending",
    }),
  });

  console.log(`\nQueued outbox job ${job.id} (topic ${job.topic}, state ${job.state}).`);
  console.log("Nothing has been sent yet. Run the worker, then re-run with --report.");
  process.exit(0);
}

if (mode === "report") {
  const jobs = await rest(`outbox?dedupe_key=eq.${DEDUPE}&select=id,topic,state,attempts,last_error,result,completed_at`);
  const job = jobs[0];
  if (!job) {
    console.log("No job found. Run the enqueue step first.");
    process.exit(0);
  }

  console.log("OUTBOX");
  console.log(`  id        ${job.id}`);
  console.log(`  state     ${job.state}`);
  console.log(`  attempts  ${job.attempts}`);
  console.log(`  result    ${JSON.stringify(job.result)}`);
  if (job.last_error) console.log(`  error     ${job.last_error}`);

  const deliveries = await rest(
    `notification_deliveries?outbox_id=eq.${job.id}&select=template,recipient_email,subject,state,provider,provider_message_id,error,created_at`,
  );
  console.log("\nDELIVERY RECORD");
  if (!deliveries.length) {
    console.log("  none — the provider was never called for this job.");
  }
  for (const d of deliveries) {
    console.log(`  template  ${d.template}`);
    console.log(`  to        ${d.recipient_email}`);
    console.log(`  subject   ${d.subject}`);
    console.log(`  state     ${d.state}   (accepted = the provider took it; not proof it landed)`);
    console.log(`  provider  ${d.provider} ${d.provider_message_id ?? ""}`);
    if (d.error) console.log(`  error     ${d.error}`);
  }

  const inbox = await rest(`notifications?outbox_id=eq.${job.id}&select=id,category_id,title,path,read_at`);
  console.log("\nIN-APP NOTIFICATION");
  if (!inbox.length) console.log("  none.");
  for (const n of inbox) {
    console.log(`  ${n.category_id}: ${n.title}  → ${n.path}  (${n.read_at ? "read" : "unread"})`);
  }
  process.exit(0);
}

if (mode === "cleanup") {
  const jobs = await rest(`outbox?dedupe_key=eq.${DEDUPE}&select=id`);
  for (const job of jobs) {
    await rest(`notifications?outbox_id=eq.${job.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    await rest(`notification_deliveries?outbox_id=eq.${job.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }
  await rest(`outbox?dedupe_key=eq.${DEDUPE}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  console.log("Removed the delivery-check job, its delivery record and its notification.");
  console.log("The recipient account was left alone: deleting an account is a founder action.");
  process.exit(0);
}
