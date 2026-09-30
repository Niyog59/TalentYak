import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HANDLERS, type HandlerContext, type OutboxJob } from "@/lib/worker/handlers";
import type { EmailTransport, OutgoingEmail } from "@/lib/email";
import { coachApplicationDecisionEmail, coachApplicationReceivedEmail } from "@/lib/email/templates";

const ctxT = { siteUrl: "https://talentyak.test", supportEmail: null };

describe("coach application emails", () => {
  test("the receipt explains next steps without promising a timeline or clients", () => {
    const e = coachApplicationReceivedEmail(ctxT, { name: "Asha" });
    assert.match(e.text, /no fixed timeline/);
    assert.match(e.text, /doesn't guarantee clients/);
    assert.match(e.html, /\/account\/coach-application/);
  });

  test("an approval invites the applicant to the agreement; no decision email carries a reason", () => {
    const approved = coachApplicationDecisionEmail(ctxT, { name: "Asha", decision: "approved" });
    assert.match(approved.html, /\/account\/coach-application\/agreement/);
    assert.match(approved.text, /final approval/);
    for (const decision of ["approved", "waitlisted", "declined"] as const) {
      const e = coachApplicationDecisionEmail(ctxT, { name: "Asha", decision });
      assert.doesNotMatch(e.text, /reason|note/i, `${decision} says nothing about the reviewer's reasoning`);
    }
  });

  test("names are escaped", () => {
    const e = coachApplicationDecisionEmail(ctxT, { name: "<script>x</script>", decision: "declined" });
    assert.doesNotMatch(e.html, /<script>/);
  });
});

const APP = "00000000-0000-4000-8000-0000000000e1";
const PROFILE = "00000000-0000-4000-8000-0000000000e2";

function world(app: Record<string, unknown> | null, latestEventId: string | null) {
  const sent: OutgoingEmail[] = [];
  const enqueued: unknown[] = [];
  const single = (data: unknown) => ({ maybeSingle: async () => ({ data, error: null }) });
  const admin = {
    from: (table: string) => ({
      upsert: async () => ({ data: null, error: null }),
      select: () => ({
        eq: (_c: string, v: unknown) => {
          if (table === "coach_applications") return single(app);
          if (table === "profiles") {
            return {
              ...single({ id: v, email: "asha@talentyak.com", preferred_name: "Asha", full_name: null, timezone: "Asia/Kathmandu", suspended_at: null, role: "customer" }),
              is: async () => ({ data: [{ id: "admin-1", email: "founder@talentyak.com", preferred_name: null, full_name: null, timezone: null }], error: null }),
            };
          }
          return { in: () => ({ order: () => ({ limit: () => single(latestEventId ? { id: latestEventId } : null) }) }) };
        },
      }),
    }),
    rpc: async (name: string) => (name === "notification_email_allowed" ? { data: true, error: null } : { data: "n-1", error: null }),
  } as unknown as SupabaseClient;
  const transport: EmailTransport = async (email) => {
    sent.push(email);
    return { status: "accepted", providerMessageId: "m-1" };
  };
  const ctx: HandlerContext = { admin, transport, enqueue: async (...args: unknown[]) => { enqueued.push(args); } };
  return { ctx, sent, enqueued };
}

const job = (topic: string, payload: Record<string, unknown>): OutboxJob => ({
  id: "00000000-0000-4000-8000-0000000000f1",
  topic,
  payload,
  attempts: 0,
  max_attempts: 8,
});

const approved = { id: APP, profile_id: PROFILE, status: "approved", full_name: "Asha", agreement_signed_at: null };

describe("coach application decisions are sent once, and only while true", () => {
  test("a current decision is sent, with an idempotency key tied to the job", async () => {
    const { ctx, sent } = world(approved, "event-1");
    const outcome = await HANDLERS["email.coach_application_decision"](job("email.coach_application_decision", { application_id: APP, status: "approved", event_id: "event-1" }), ctx);
    assert.equal(outcome.kind, "done");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].idempotencyKey, "outbox:00000000-0000-4000-8000-0000000000f1", "a retried job can't deliver twice");
  });

  test("a decision the founder has since changed is skipped", async () => {
    const { ctx, sent } = world({ ...approved, status: "reviewing" }, "event-2");
    const outcome = await HANDLERS["email.coach_application_decision"](job("email.coach_application_decision", { application_id: APP, status: "approved", event_id: "event-1" }), ctx);
    assert.equal(outcome.kind, "done");
    assert.deepEqual(sent, []);
  });

  test("an older decision superseded by a later one (even the same status) is skipped", async () => {
    const { ctx, sent } = world(approved, "event-3");
    await HANDLERS["email.coach_application_decision"](job("email.coach_application_decision", { application_id: APP, status: "approved", event_id: "event-1" }), ctx);
    assert.deepEqual(sent, []);
  });

  test("no approval email after the applicant has already signed", async () => {
    const { ctx, sent } = world({ ...approved, agreement_signed_at: "2026-09-30T00:00:00Z" }, "event-1");
    await HANDLERS["email.coach_application_decision"](job("email.coach_application_decision", { application_id: APP, status: "approved", event_id: "event-1" }), ctx);
    assert.deepEqual(sent, []);
  });

  test("a deleted application is never emailed", async () => {
    const { ctx, sent } = world(null, null);
    const outcome = await HANDLERS["email.coach_application_received"](job("email.coach_application_received", { application_id: APP }), ctx);
    assert.equal(outcome.kind, "done");
    assert.deepEqual(sent, []);
  });

  test("the founder alert names no one and is keyed per founder", async () => {
    const { ctx, enqueued } = world({ ...approved, status: "new" }, null);
    await HANDLERS["email.coach_application_submitted"](job("email.coach_application_submitted", { application_id: APP }), ctx);
    assert.equal(enqueued.length, 1);
    const [topic, payload, key] = enqueued[0] as [string, Record<string, string>, string];
    assert.equal(topic, "email.admin_alert");
    assert.doesNotMatch(JSON.stringify(payload), /Asha|asha@/);
    assert.equal(key, "admin_alert:00000000-0000-4000-8000-0000000000f1:admin-1");
  });
});
