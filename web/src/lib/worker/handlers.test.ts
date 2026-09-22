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
      "email.delivery_check",
      // Handlers built ahead of their producers (Batches 2 and 4).
      "email.appointment_confirmed",
      "email.appointment_changed",
      "email.appointment_cancelled",
      "email.appointment_reminder",
      "email.reservation_expired",
      "email.unread_messages",
      "email.expectations_updated",
    ]) {
      assert.equal(typeof HANDLERS[topic], "function", `no handler for ${topic}`);
    }
  });
});

/**
 * What must still be true at the moment of sending.
 *
 * These exercise the recheck that runs immediately before the provider is
 * called. Each one describes a world that changed between queueing and
 * sending, and asserts that nothing was sent — and that the job finished as
 * `done` rather than `failed`, because skipping was the correct outcome.
 */

const CUSTOMER = "00000000-0000-4000-8000-0000000000c1";
const COACH_PROFILE = "00000000-0000-4000-8000-0000000000c2";
const PROVIDER = "00000000-0000-4000-8000-0000000000p1";
const APPOINTMENT = "00000000-0000-4000-8000-0000000000a1";
const QUEUED_START = "2026-10-01T09:00:00.000Z";

interface World {
  appointment?: Record<string, unknown> | null;
  suspended?: boolean;
  emailAllowed?: boolean;
}

function worldContext(transport: EmailTransport, world: World = {}) {
  const sent: OutgoingEmail[] = [];
  const notifications: Record<string, unknown>[] = [];

  const appointment =
    world.appointment === undefined
      ? {
          id: APPOINTMENT,
          starts_at: QUEUED_START,
          state: "booked",
          customer_id: CUSTOMER,
          provider_id: PROVIDER,
          providers: { profile_id: COACH_PROFILE },
        }
      : world.appointment;

  const rows: Record<string, (value: unknown) => unknown> = {
    appointments: () => appointment,
    profiles: (id) => ({
      id,
      email: id === CUSTOMER ? "customer@talentyak.com" : "coach@talentyak.com",
      preferred_name: id === CUSTOMER ? "Sita" : "Anjali",
      full_name: null,
      timezone: id === CUSTOMER ? "America/Chicago" : "Asia/Kathmandu",
      suspended_at: world.suspended ? "2026-09-01T00:00:00Z" : null,
    }),
    providers: () => ({
      id: PROVIDER,
      profile_id: COACH_PROFILE,
      display_name: "Anjali",
      provider_public_profiles: { display_name: "Anjali R." },
    }),
  };

  const admin = {
    from: (table: string) => ({
      upsert: async () => ({ data: null, error: null }),
      select: () => ({
        eq: (_col: string, value: unknown) => ({
          maybeSingle: async () => ({ data: rows[table]?.(value) ?? null, error: null }),
        }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "notification_email_allowed") {
        return { data: world.emailAllowed ?? true, error: null };
      }
      if (name === "create_notification") {
        notifications.push(args);
        return { data: "notification-1", error: null };
      }
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;

  const ctx: HandlerContext = {
    admin,
    transport: async (email) => {
      sent.push(email);
      return transport(email);
    },
    enqueue: async () => {},
  };
  return { ctx, sent, notifications };
}

const reminderJob = (payload: Record<string, unknown> = {}): OutboxJob => ({
  id: "00000000-0000-4000-8000-000000000002",
  topic: "email.appointment_reminder",
  payload: { appointment_id: APPOINTMENT, recipient: "customer", starts_at: QUEUED_START, ...payload },
  attempts: 0,
  max_attempts: 8,
});

describe("what must still be true when the message is sent", () => {
  test("a reminder for a session that moved is skipped, not sent late and wrong", async () => {
    const { ctx, sent } = worldContext(accepted, {
      appointment: {
        id: APPOINTMENT,
        // Moved an hour later after the reminder was queued.
        starts_at: "2026-10-01T10:00:00.000Z",
        state: "booked",
        customer_id: CUSTOMER,
        provider_id: PROVIDER,
        providers: { profile_id: COACH_PROFILE },
      },
    });

    const outcome = await HANDLERS["email.appointment_reminder"](reminderJob(), ctx);

    assert.equal(outcome.kind, "done", "skipping is a correct outcome, not a failure");
    assert.deepEqual(sent, [], "nothing was handed to the sending service");
    assert.equal((outcome as { result: Record<string, unknown> }).result.reason, "skipped");
    assert.match(String((outcome as { result: Record<string, unknown> }).result.detail), /rescheduled/);
  });

  test("a reminder for a cancelled session is skipped", async () => {
    const { ctx, sent } = worldContext(accepted, {
      appointment: {
        id: APPOINTMENT, starts_at: QUEUED_START, state: "cancelled_by_provider",
        customer_id: CUSTOMER, provider_id: PROVIDER, providers: { profile_id: COACH_PROFILE },
      },
    });

    const outcome = await HANDLERS["email.appointment_reminder"](reminderJob(), ctx);

    assert.equal(outcome.kind, "done");
    assert.deepEqual(sent, []);
    assert.match(String((outcome as { result: Record<string, unknown> }).result.detail), /cancelled_by_provider/);
  });

  test("a reminder for a session that has already started is skipped", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { ctx, sent } = worldContext(accepted, {
      appointment: {
        id: APPOINTMENT, starts_at: past, state: "booked",
        customer_id: CUSTOMER, provider_id: PROVIDER, providers: { profile_id: COACH_PROFILE },
      },
    });

    const outcome = await HANDLERS["email.appointment_reminder"](reminderJob({ starts_at: past }), ctx);

    assert.equal(outcome.kind, "done");
    assert.deepEqual(sent, []);
    assert.match(String((outcome as { result: Record<string, unknown> }).result.detail), /already started/);
  });

  test("a cancellation still sends, because the session being gone is the point", async () => {
    const { ctx, sent } = worldContext(accepted, {
      appointment: {
        id: APPOINTMENT, starts_at: QUEUED_START, state: "cancelled_by_provider",
        customer_id: CUSTOMER, provider_id: PROVIDER, providers: { profile_id: COACH_PROFILE },
      },
    });

    const outcome = await HANDLERS["email.appointment_cancelled"]({
      ...reminderJob(), topic: "email.appointment_cancelled", payload: { appointment_id: APPOINTMENT, recipient: "customer", by_coach: true },
    }, ctx);

    assert.equal(outcome.kind, "done");
    assert.equal(sent.length, 1, "the cancellation was sent");
  });

  test("switching an optional email off suppresses the email but still records it in the inbox", async () => {
    const { ctx, sent, notifications } = worldContext(accepted, { emailAllowed: false });

    const outcome = await HANDLERS["email.appointment_reminder"](reminderJob(), ctx);

    assert.equal(outcome.kind, "done");
    assert.deepEqual(sent, [], "no email was sent");
    assert.equal(notifications.length, 1, "the person is still told, in their inbox");
    assert.equal((outcome as { result: Record<string, unknown> }).result.reason, "preference");
  });

  test("a suspended recipient is not emailed, and gets no inbox row either", async () => {
    const { ctx, sent, notifications } = worldContext(accepted, { suspended: true });

    const outcome = await HANDLERS["email.appointment_reminder"](reminderJob(), ctx);

    assert.equal(outcome.kind, "done");
    assert.deepEqual(sent, []);
    assert.deepEqual(notifications, []);
    assert.match(String((outcome as { result: Record<string, unknown> }).result.detail), /suspended/);
  });

  test("an unread-message email cannot be sent while conversations are unbuilt", async () => {
    // The producer belongs to Batch 2. Until the read state can actually be
    // checked, this must refuse rather than assume the messages are unread.
    const { ctx, sent } = worldContext(accepted);

    const outcome = await HANDLERS["email.unread_messages"]({
      ...reminderJob(), topic: "email.unread_messages",
      payload: { profile_id: CUSTOMER, conversation_id: "c1", from_name: "Anjali R.", count: 3, since: QUEUED_START },
    }, ctx);

    assert.equal(outcome.kind, "done");
    assert.deepEqual(sent, [], "no message content and no email left the system");
    assert.match(String((outcome as { result: Record<string, unknown> }).result.detail), /Batch 2/);
  });

  test("a session email never carries health or message content in its subject", async () => {
    const { ctx, sent } = worldContext(accepted);
    await HANDLERS["email.appointment_confirmed"]({
      ...reminderJob(), topic: "email.appointment_confirmed",
      payload: { appointment_id: APPOINTMENT, recipient: "customer" },
    }, ctx);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].subject, "Your session is booked");
    // Stated in the CUSTOMER's zone, not the coach's and not UTC: 09:00 UTC is
    // 04:00 in Chicago. Sending Kathmandu time to a client in Illinois is how
    // somebody misses a session they paid for.
    assert.match(sent[0].html, /04:00/);
    // And the zone is always named, however the platform abbreviates it.
    assert.match(sent[0].html, /GMT-5|CDT|CST/);
  });
});

describe("founder alerts", () => {
  function adminCtx(role: string) {
    const sent: OutgoingEmail[] = [];
    const admin = {
      from: () => ({
        upsert: async () => ({ data: null, error: null }),
        select: () => ({
          eq: (_c: string, id: unknown) => ({
            maybeSingle: async () => ({
              data: { id, email: "founder@talentyak.com", preferred_name: "F", full_name: null, timezone: "UTC", role, suspended_at: null },
              error: null,
            }),
          }),
        }),
      }),
      rpc: async (name: string) => ({ data: name === "notification_email_allowed" ? true : "n1", error: null }),
    } as unknown as SupabaseClient;
    const ctx: HandlerContext = { admin, transport: async (e) => { sent.push(e); return accepted(e); }, enqueue: async () => {} };
    return { ctx, sent };
  }
  const alertJob: OutboxJob = { id: "00000000-0000-4000-8000-000000000009", topic: "email.admin_alert", payload: { admin_id: "p1", title: "Coach change requested", detail: "x", path: "/admin" }, attempts: 0, max_attempts: 8 };

  test("an alert is not sent to someone whose admin role was removed after it was queued", async () => {
    const { ctx, sent } = adminCtx("customer");
    const outcome = await HANDLERS["email.admin_alert"](alertJob, ctx);
    assert.equal(outcome.kind, "done");
    assert.deepEqual(sent, [], "a former admin was sent a founder alert");
    assert.match(String((outcome as { result: Record<string, unknown> }).result.detail), /no longer an administrator/);
  });

  test("a current administrator still receives it", async () => {
    const { ctx, sent } = adminCtx("admin");
    await HANDLERS["email.admin_alert"](alertJob, ctx);
    assert.equal(sent.length, 1);
  });
});

describe("a recipient who no longer exists", () => {
  test("is skipped, not recorded as a failure someone must act on", async () => {
    const sent: OutgoingEmail[] = [];
    // Every lookup finds nothing: the coach's account was deleted after queueing.
    const admin = {
      from: () => ({
        upsert: async () => ({ data: null, error: null }),
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
      rpc: async () => ({ data: null, error: null }),
    } as unknown as SupabaseClient;
    const ctx: HandlerContext = { admin, transport: async (e) => { sent.push(e); return accepted(e); }, enqueue: async () => {} };

    const outcome = await HANDLERS["email.payout_paid"]({
      id: "00000000-0000-4000-8000-00000000000a", topic: "email.payout_paid",
      payload: { provider_id: "gone", amount_minor: 1000, currency: "USD", paid_at: "2026-09-20" }, attempts: 0, max_attempts: 8,
    }, ctx);

    assert.equal(outcome.kind, "done");
    assert.deepEqual(sent, []);
    assert.match(String((outcome as { result: Record<string, unknown> }).result.detail), /no longer exists/);
  });
});
