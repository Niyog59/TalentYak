import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

import { HANDLERS, type HandlerContext, type OutboxJob } from "@/lib/worker/handlers";
import type { EmailTransport, OutgoingEmail, SendResult } from "@/lib/email";

/**
 * What the worker does with an email job, without sending anything.
 *
 * The outcome it records has to be the truth: "accepted by the sending
 * service" is not "delivered", a job that cannot run yet is blocked rather than
 * failed, and an address on a reserved test domain is never written to.
 */

function contextWith(transport: EmailTransport, sent: OutgoingEmail[] = []) {
  const recorded: { table: string; row: unknown }[] = [];
  const admin = {
    from: (table: string) => ({
      upsert: async (row: unknown) => {
        recorded.push({ table, row });
        return { data: null, error: null };
      },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  } as unknown as SupabaseClient;

  const queued: { topic: string; dedupeKey: string }[] = [];
  const ctx: HandlerContext = {
    admin,
    transport: async (email) => {
      sent.push(email);
      return transport(email);
    },
    enqueue: async (topic, _payload, dedupeKey) => {
      queued.push({ topic, dedupeKey });
    },
  };
  return { ctx, recorded, queued, sent };
}

const job = (payload: Record<string, unknown>): OutboxJob => ({
  id: "00000000-0000-4000-8000-000000000001",
  topic: "email.coach_invitation",
  payload,
  attempts: 0,
  max_attempts: 8,
});

const accepted: EmailTransport = async () => ({ status: "accepted", providerMessageId: "msg_1" } satisfies SendResult);
const unconfigured: EmailTransport = async () => ({ status: "unconfigured", reason: "no sending domain" } satisfies SendResult);
const failed: EmailTransport = async () => ({ status: "failed", retryable: true, reason: "provider timeout" } satisfies SendResult);

describe("email jobs", () => {
  test("a reserved test address is never written to, and says so", async () => {
    const { ctx, sent } = contextWith(accepted);
    const outcome = await HANDLERS["email.coach_invitation"](
      job({ email: "talentyak-test-someone@example.test", invite_url: "https://talentyak.com/invite/x", expires_at: "2026-10-01T00:00:00Z" }),
      ctx,
    );

    assert.equal(outcome.kind, "done");
    assert.deepEqual(sent, [], "nothing was handed to the sending service");
    const result = (outcome as { result: Record<string, unknown> }).result;
    assert.equal(result.sent, false);
    assert.equal(result.reason, "reserved_test_address");
  });

  test("with sending unconfigured the job is blocked, not failed and not silently dropped", async () => {
    const { ctx } = contextWith(unconfigured);
    const outcome = await HANDLERS["email.coach_invitation"](
      job({ email: "coach@talentyak.com", invite_url: "https://talentyak.com/invite/x", expires_at: "2026-10-01T00:00:00Z" }),
      ctx,
    );
    assert.equal(outcome.kind, "blocked");
  });

  test("a provider failure asks to be retried, and is recorded as failed — never as sent", async () => {
    const { ctx, recorded } = contextWith(failed);
    const outcome = await HANDLERS["email.coach_invitation"](
      job({ email: "coach@talentyak.com", invite_url: "https://talentyak.com/invite/x", expires_at: "2026-10-01T00:00:00Z" }),
      ctx,
    );
    assert.equal(outcome.kind, "retry");
    const delivery = recorded.find((r) => r.table === "notification_deliveries");
    assert.equal((delivery?.row as { state: string }).state, "failed");
  });

  test("an accepted email is recorded as accepted, which is not the same as delivered", async () => {
    const { ctx, recorded, sent } = contextWith(accepted);
    const outcome = await HANDLERS["email.coach_invitation"](
      job({ email: "coach@talentyak.com", invite_url: "https://talentyak.com/invite/x", expires_at: "2026-10-01T00:00:00Z" }),
      ctx,
    );

    assert.equal(outcome.kind, "done");
    const delivery = recorded.find((r) => r.table === "notification_deliveries");
    assert.equal((delivery?.row as { state: string }).state, "accepted");
    assert.equal((outcome as { result: Record<string, unknown> }).result.sent, true);
    assert.match(sent[0].idempotencyKey, /^outbox:/, "a retried send cannot deliver twice");
  });

  test("a job with no recipient fails visibly instead of disappearing", async () => {
    const { ctx } = contextWith(accepted);
    const outcome = await HANDLERS["email.coach_invitation"](job({}), ctx);
    assert.equal(outcome.kind, "fail");
  });

  test("every topic the database can queue has a handler", () => {
    // Topics enqueued by migrations and by the application.
    for (const topic of [
      "email.coach_invitation",
      "email.purchase_confirmed",
      "email.new_client",
      "email.payment_failed",
      "email.subscription_changed",
      "email.refund_processed",
      "email.coach_change_requested",
      "email.coach_changed",
      "email.payout_paid",
      "email.profile_approved",
      "email.admin_alert",
      "email.retention_notice",
      "email.shraddha_reminder",
    ]) {
      assert.equal(typeof HANDLERS[topic], "function", `no handler for ${topic}`);
    }
  });
});
