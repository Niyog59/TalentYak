/**
 * The background worker's guarantees, against the real database.
 *
 * M08 requires that a crashed worker cannot strand work, that two workers
 * running at once cannot both do the same job, that retries back off and then
 * fail visibly, and that a queued message cannot be queued twice. Those are
 * properties of the SQL functions in 0018, so they are tested here rather than
 * in a unit test with the database mocked out.
 *
 * `claim_outbox_jobs` claims ANY due job, not only ours. So every test puts
 * back, exactly as it found it, any unrelated job it happened to claim — a test
 * run must never advance real work.
 *
 * When the project is not confirmed available, every test SKIPS.
 */

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { adminClient, createTestUser, dbAvailability, deleteTestUsers, wasDenied } from "./harness.ts";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;

const RUN = randomUUID().slice(0, 8);
const TOPIC = "test.noop";
const mine = new Set<string>();

interface Job {
  id: string;
  topic: string;
  attempts: number;
  state: string;
  lease_owner: string | null;
}

async function enqueue(key: string, extra: { scheduledFor?: string } = {}): Promise<string> {
  const { data, error } = await adminClient().rpc("enqueue_outbox", {
    p_topic: TOPIC,
    p_payload: { run: RUN },
    p_dedupe_key: `${RUN}:${key}`,
    ...(extra.scheduledFor ? { p_scheduled_for: extra.scheduledFor } : {}),
    p_expires_at: null,
  });
  if (error) throw new Error(error.message);
  mine.add(data as string);
  return data as string;
}

/** Claims, then returns anything that was not ours to the state it was in. */
async function claim(worker: string, limit: number, leaseSeconds = 120): Promise<Job[]> {
  const { data, error } = await adminClient().rpc("claim_outbox_jobs", {
    p_worker: worker,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(error.message);
  const jobs = (data ?? []) as Job[];
  const foreign = jobs.filter((j) => !mine.has(j.id));
  for (const j of foreign) {
    await adminClient()
      .from("outbox")
      .update({ state: "pending", lease_owner: null, lease_expires_at: null, attempts: Math.max(0, j.attempts - 1) })
      .eq("id", j.id);
  }
  return jobs.filter((j) => mine.has(j.id));
}

describe("the background worker", { skip }, () => {
  after(async () => {
    if (mine.size) await adminClient().from("outbox").delete().in("id", [...mine]);
  });

  test("queueing the same message twice queues it once", async () => {
    const a = await enqueue("dedupe");
    const b = await enqueue("dedupe");
    assert.equal(a, b);
  });

  test("two workers claiming at the same moment never take the same job", async () => {
    const ids = await Promise.all(Array.from({ length: 12 }, (_, i) => enqueue(`race-${i}`)));
    const [a, b] = await Promise.all([claim(`w-a-${RUN}`, 100), claim(`w-b-${RUN}`, 100)]);
    const claimedA = a.filter((j) => ids.includes(j.id)).map((j) => j.id);
    const claimedB = b.filter((j) => ids.includes(j.id)).map((j) => j.id);
    const overlap = claimedA.filter((id) => claimedB.includes(id));
    assert.deepEqual(overlap, [], "a job was claimed by both workers");
    assert.equal(claimedA.length + claimedB.length, ids.length, "some jobs were claimed by neither");
  });

  test("a worker that dies mid-job does not strand it: the lease runs out and another worker takes it", async () => {
    const id = await enqueue("crash");
    const first = await claim(`w-dead-${RUN}`, 100, 1);
    assert.ok(first.some((j) => j.id === id));

    await new Promise((r) => setTimeout(r, 2100)); // the dead worker's 1-second lease expires
    const second = await claim(`w-alive-${RUN}`, 100);
    const job = second.find((j) => j.id === id);
    assert.ok(job, "the abandoned job was not reclaimed");
    assert.equal(job!.attempts, 2, "the reclaim was not counted as an attempt");
  });

  test("only the worker holding the lease can record the outcome", async () => {
    const id = await enqueue("lease-holder");
    await claim(`w-old-${RUN}`, 100, 1);
    await new Promise((r) => setTimeout(r, 2100));
    await claim(`w-new-${RUN}`, 100);

    const stale = await adminClient().rpc("complete_outbox_job", { p_id: id, p_worker: `w-old-${RUN}`, p_result: { by: "old" } });
    assert.equal(stale.data, false, "a worker whose lease was taken over overwrote the outcome");
    const current = await adminClient().rpc("complete_outbox_job", { p_id: id, p_worker: `w-new-${RUN}`, p_result: { by: "new" } });
    assert.equal(current.data, true);
  });

  test("a failure backs off before retrying, and gives up visibly after the last attempt", async () => {
    const id = await enqueue("backoff");
    await claim(`w-f-${RUN}`, 100);
    const { data: next } = await adminClient().rpc("fail_outbox_job", {
      p_id: id, p_worker: `w-f-${RUN}`, p_error: "provider timeout", p_retryable: true, p_blocked: false,
    });
    assert.equal(next, "pending");
    const { data: row } = await adminClient().from("outbox").select("scheduled_for").eq("id", id).single();
    assert.ok(new Date(row!.scheduled_for).getTime() > Date.now() + 20_000, "the retry was not delayed");

    // On the final permitted attempt, the same failure is recorded as failed.
    await adminClient().from("outbox").update({ scheduled_for: new Date().toISOString(), max_attempts: 2 }).eq("id", id);
    await claim(`w-f2-${RUN}`, 100);
    const { data: final } = await adminClient().rpc("fail_outbox_job", {
      p_id: id, p_worker: `w-f2-${RUN}`, p_error: "provider timeout", p_retryable: true, p_blocked: false,
    });
    assert.equal(final, "failed");
  });

  test("a job whose lease expires on its final attempt is failed visibly, not reclaimed forever", async () => {
    const id = await enqueue("last-lease");
    await adminClient().from("outbox").update({ max_attempts: 1 }).eq("id", id);
    await claim(`w-last-${RUN}`, 100, 1);
    await new Promise((r) => setTimeout(r, 2100));
    await claim(`w-sweep-${RUN}`, 100);
    const { data: row } = await adminClient().from("outbox").select("state, last_error").eq("id", id).single();
    assert.equal(row?.state, "failed");
    assert.match(row?.last_error ?? "", /lease expired on final attempt/i);
  });

  test("a scheduled job is not taken before its time", async () => {
    const id = await enqueue("later", { scheduledFor: new Date(Date.now() + 3600_000).toISOString() });
    const claimed = await claim(`w-early-${RUN}`, 100);
    assert.ok(!claimed.some((j) => j.id === id), "a future job was claimed early");
  });

  test("a signed-in person cannot claim, complete or queue work", async () => {
    const person = await createTestUser("worker-probe");
    try {
      assert.ok(wasDenied(await person.client.rpc("claim_outbox_jobs", { p_worker: "x", p_limit: 1, p_lease_seconds: 60 })));
      assert.ok((await person.client.rpc("enqueue_outbox", { p_topic: TOPIC, p_payload: {}, p_dedupe_key: null, p_expires_at: null })).error);
    } finally {
      await deleteTestUsers([person.id]);
    }
  });
});

describe("delivery events from the email provider", { skip }, () => {
  const outboxIds: string[] = [];
  after(async () => {
    if (outboxIds.length) await adminClient().from("outbox").delete().in("id", outboxIds);
  });

  async function delivery(messageId: string, state = "accepted") {
    const { data: job } = await adminClient()
      .from("outbox")
      .insert({ topic: TOPIC, payload: { run: RUN }, dedupe_key: `${RUN}:evt:${messageId}`, state: "done" })
      .select("id")
      .single();
    outboxIds.push(job!.id);
    await adminClient().from("notification_deliveries").insert({
      outbox_id: job!.id, template: "test", recipient_email: "nobody@example.test", subject: "test",
      provider_message_id: messageId, state,
    });
    return job!.id as string;
  }

  const stateOf = async (outboxId: string) =>
    (await adminClient().from("notification_deliveries").select("state, error").eq("outbox_id", outboxId).single()).data;

  test("accepted becomes delivered; a later bounce overrides; nothing goes backwards", async () => {
    const { applyResendEvent } = await import("@/lib/email/events");
    const msg = `msg_${RUN}_a`;
    const id = await delivery(msg);

    assert.equal((await applyResendEvent({ type: "email.delivered", data: { email_id: msg } })).applied, true);
    assert.equal((await stateOf(id))?.state, "delivered");

    const bounce = await applyResendEvent({ type: "email.bounced", data: { email_id: msg, bounce: { type: "Permanent", message: "mailbox does not exist" } } });
    assert.equal(bounce.applied, true);
    const after = await stateOf(id);
    assert.equal(after?.state, "bounced");
    assert.match(after?.error ?? "", /mailbox does not exist/);

    // A delivered event arriving late must not un-bounce the message.
    assert.equal((await applyResendEvent({ type: "email.delivered", data: { email_id: msg } })).applied, false);
    assert.equal((await stateOf(id))?.state, "bounced");
  });

  test("events it does not act on are ignored, not errors", async () => {
    const { applyResendEvent } = await import("@/lib/email/events");
    const r = await applyResendEvent({ type: "email.opened", data: { email_id: "x" } });
    assert.equal(r.applied, false);
  });
});
