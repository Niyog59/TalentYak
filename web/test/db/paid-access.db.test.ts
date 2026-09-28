/**
 * The approved paid-access rules (founder instruction, 2026-09-22), as real
 * signed-in people.
 *
 *   · cancelling keeps access until the paid period ends   — the pause only
 *     happens once paid_through has passed
 *   · once it has, new coaching activity stops             — the coach cannot
 *     write programming, and messages are already refused
 *   · everything already recorded stays readable           — both sides
 *   · a failed payment deletes nothing
 *   · paying restores what was paused                      — and only that:
 *     never a suspension, never a coach change
 *
 * When the project is not confirmed available, every test SKIPS.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  adminClient,
  createTestUser,
  dbAvailability,
  deleteTestUsers,
  makeCoach,
  errorCode,
  wasDenied,
  type CoachFixture,
  type TestUser,
} from "./harness.ts";
import { PAUSED_FOR_PAYMENT_NOTICE, currentMessagingPolicy, currentPolicySnapshot, getPolicy } from "../../src/lib/policy/registry.ts";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;

let customer: TestUser;
let coach: CoachFixture;
let coachB: CoachFixture;
let enrollmentId = "";
let programmeId = "";
const users: string[] = [];

const setState = (state: string) => adminClient().from("enrollments").update({ state }).eq("id", enrollmentId);

async function writeProgramme(who: TestUser, title: string) {
  return who.client.from("programs").insert({ enrollment_id: enrollmentId, title }).select("id");
}

describe("paid access: pause, preserve, restore", { skip }, () => {
  before(async () => {
    customer = await createTestUser("paid-customer");
    coach = await makeCoach("paid-coach");
    coachB = await makeCoach("paid-coach-b");
    users.push(customer.id, coach.user.id, coachB.user.id);

    const sb = adminClient();
    const { data: e, error } = await sb.from("enrollments")
      .insert({ customer_id: customer.id, provider_id: coach.providerId, state: "active" }).select("id").single();
    if (error) throw new Error(`enrollment: ${error.message}`);
    enrollmentId = e.id as string;
    await sb.from("enrollment_assignments").insert({
      enrollment_id: enrollmentId, provider_id: coach.providerId,
      effective_from: new Date(Date.now() - 86_400_000).toISOString(),
    });
  });

  after(async () => {
    const sb = adminClient();
    const { data: convs } = await sb.from("conversations").select("id").eq("enrollment_id", enrollmentId);
    for (const c of convs ?? []) {
      await sb.from("outbox").delete().eq("topic", "email.unread_messages").eq("payload->>conversation_id", c.id);
    }
    await sb.from("programs").delete().eq("enrollment_id", enrollmentId);
    await sb.from("enrollment_assignments").delete().eq("enrollment_id", enrollmentId);
    await sb.from("enrollments").delete().eq("id", enrollmentId);
    await deleteTestUsers(users);
  });

  test("the approved policy ids are what the database publishes under", async () => {
    const { data: row } = await adminClient()
      .from("current_policy_set").select("cancellation_policy_id, payment_failure_policy_id").single();
    assert.equal(row!.cancellation_policy_id, "cancellation.v2");
    assert.equal(row!.payment_failure_policy_id, "payment_failure.v2");
    assert.equal(row!.cancellation_policy_id, currentPolicySnapshot().cancellationPolicyId);
    assert.equal(row!.payment_failure_policy_id, currentPolicySnapshot().paymentFailurePolicyId);
    assert.equal(getPolicy(row!.payment_failure_policy_id).status, "confirmed");

    const { data: settings } = await adminClient().from("messaging_settings").select("policy_id, policy_status, paused_notice").single();
    assert.equal(settings!.policy_id, currentMessagingPolicy().id);
    assert.equal(settings!.policy_status, "confirmed");
    assert.equal(settings!.paused_notice, PAUSED_FOR_PAYMENT_NOTICE, "the approved wording must be stored, not paraphrased");
  });

  test("while the relationship is active the coach can add coaching work", async () => {
    const written = await writeProgramme(coach.user, "Week 1");
    assert.equal(written.error, null, written.error?.message);
    programmeId = written.data![0].id as string;
  });

  test("a cancelled renewal changes nothing while the paid period is still running", async () => {
    // What a cancellation does: the purchase is 'cancelling', paid_through is
    // in the future, and end_lapsed_enrollments leaves the relationship alone.
    const before = await adminClient().from("enrollments").select("state").eq("id", enrollmentId).single();
    await adminClient().rpc("end_lapsed_enrollments");
    const after = await adminClient().from("enrollments").select("state").eq("id", enrollmentId).single();
    assert.equal(after.data!.state, before.data!.state);
    assert.equal(after.data!.state, "active", "access was taken away before the paid time ran out");
  });

  describe("once the paid period has run out and the renewal failed", () => {
    before(async () => {
      await setState("paused");
    });

    test("the coach cannot add new coaching work", async () => {
      const written = await writeProgramme(coach.user, "Week 2 — should not be written");
      assert.ok(
        written.error || (written.data ?? []).length === 0,
        "a coach wrote new programming for a relationship whose payment had lapsed",
      );
      const { count } = await adminClient().from("programs").select("id", { count: "exact", head: true }).eq("enrollment_id", enrollmentId);
      assert.equal(count, 1);
    });

    test("nothing is deleted, and both sides still read what exists", async () => {
      const asCoach = await coach.user.client.from("programs").select("id, title").eq("enrollment_id", enrollmentId);
      assert.equal((asCoach.data ?? []).length, 1, "the coach lost the training record while payment was being fixed");
      const asCustomer = await customer.client.from("programs").select("id, title").eq("enrollment_id", enrollmentId);
      assert.equal((asCustomer.data ?? []).length, 1, "the customer lost their own programme");
      assert.equal(asCustomer.data![0].title, "Week 1");
    });

    test("the customer's new entries wait for payment (founder decision 2026-09-27, M12) — and nothing they can read is taken away", async () => {
      const log = await customer.client.rpc("save_body_entry", {
        p_enrollment: enrollmentId, p_date: new Date().toISOString().slice(0, 10), p_weight: 70, p_weight_unit: "kg",
        p_waist: null, p_hips: null, p_chest: null, p_arm: null, p_length_unit: "cm", p_base: null,
      });
      assert.equal(errorCode(log.error), "tracking_paused", "a new entry was accepted as coaching activity while payment had lapsed");
      const { data: state } = await customer.client.rpc("tracking_write_state", { p_enrollment: enrollmentId });
      assert.equal(state, "paused", "the customer's screens are told why, so entries are kept on the device");
    });

    test("the customer is shown the approved words, and can still read the conversation", async () => {
      const { data: conv } = await adminClient().from("conversations").select("id").eq("enrollment_id", enrollmentId).single();
      const { data } = await customer.client.rpc("conversation_status", { p_conversation: conv!.id });
      const status = data as { state: string; can_send: boolean; reason: string; role: string };
      assert.equal(status.state, "paused");
      assert.equal(status.can_send, false);
      assert.equal(status.reason, PAUSED_FOR_PAYMENT_NOTICE);
    });

    test("coaching_is_live() says no, which is what bookings and future coaching actions must check", async () => {
      const { data } = await adminClient().rpc("coaching_is_live", { e_id: enrollmentId });
      assert.equal(data, false);
    });
  });

  describe("when the payment goes through", () => {
    test("the relationship resumes and the coach can work again, with the history intact", async () => {
      const { data: resumed } = await adminClient().rpc("resume_paid_enrollment", { p_enrollment: enrollmentId });
      assert.equal(resumed, true);
      const { data: state } = await adminClient().from("enrollments").select("state").eq("id", enrollmentId).single();
      assert.equal(state!.state, "active");

      const written = await writeProgramme(coach.user, "Week 2");
      assert.equal(written.error, null, written.error?.message);
      const { data: all } = await customer.client.from("programs").select("title").eq("enrollment_id", enrollmentId).order("title");
      assert.deepEqual((all ?? []).map((r) => r.title), ["Week 1", "Week 2"], "history was lost across the pause");
      await adminClient().from("programs").delete().eq("id", written.data![0].id);

      // Entries held on the customer's device while paused now save.
      const log = await customer.client.rpc("save_body_entry", {
        p_enrollment: enrollmentId, p_date: new Date().toISOString().slice(0, 10), p_weight: 70, p_weight_unit: "kg",
        p_waist: null, p_hips: null, p_chest: null, p_arm: null, p_length_unit: "cm", p_base: null,
      });
      assert.equal(log.error, null, log.error?.message);
      await adminClient().from("bodyweight_logs").delete().eq("enrollment_id", enrollmentId);
    });

    test("a person cannot resume their own coaching without paying", async () => {
      for (const who of [customer, coach.user]) {
        const result = await who.client.rpc("resume_paid_enrollment", { p_enrollment: enrollmentId });
        assert.ok(result.error, "a signed-in person resumed a paused relationship themselves");
      }
    });

    test("it never lifts a suspension", async () => {
      await setState("paused");
      await adminClient().from("profiles").update({ suspended_at: new Date().toISOString() }).eq("id", coach.user.id);
      try {
        const { data: resumed } = await adminClient().rpc("resume_paid_enrollment", { p_enrollment: enrollmentId });
        assert.equal(resumed, true, "the relationship itself resumes — the money was paid");
        // ...but the suspension still governs what the coach may do.
        const written = await writeProgramme(coach.user, "Written while suspended");
        assert.ok(written.error || (written.data ?? []).length === 0, "a suspended coach wrote programming after a payment");
        const reads = await coach.user.client.from("programs").select("id").eq("enrollment_id", enrollmentId);
        assert.ok(wasDenied(reads), "a suspended coach still read a client's records");
        const { data: live } = await adminClient().rpc("coaching_is_live", { e_id: enrollmentId });
        assert.equal(live, false, "coaching counted as live while a party was suspended");
      } finally {
        await adminClient().from("profiles").update({ suspended_at: null }).eq("id", coach.user.id);
      }
    });

    test("it never undoes a coach change, and leaves the relationship paused instead", async () => {
      const sb = adminClient();
      await setState("paused");
      // A reassignment in progress: the old assignment is closed, the new one
      // starts in a moment.
      const handoverAt = new Date().toISOString();
      await sb.from("enrollment_assignments").update({ effective_to: handoverAt })
        .eq("enrollment_id", enrollmentId).is("effective_to", null);

      const { data: resumed } = await sb.rpc("resume_paid_enrollment", { p_enrollment: enrollmentId });
      assert.equal(resumed, false, "a payment reopened a relationship with no coach assigned");
      const { data: state } = await sb.from("enrollments").select("state").eq("id", enrollmentId).single();
      assert.equal(state!.state, "paused", "the relationship was reopened without an assignment");

      // Reassigned to a new coach: the payment resumes it under that coach.
      // The new assignment starts exactly where the old one ended: the
      // database refuses overlapping assignments, which is the point.
      const { error: handover } = await sb.from("enrollment_assignments").insert({
        enrollment_id: enrollmentId, provider_id: coachB.providerId, previous_provider_id: coach.providerId,
        effective_from: handoverAt, history_scope: "programme_and_logs",
      });
      assert.equal(handover, null, handover?.message);
      await sb.from("enrollments").update({ provider_id: coachB.providerId }).eq("id", enrollmentId);
      const { data: again } = await sb.rpc("resume_paid_enrollment", { p_enrollment: enrollmentId });
      assert.equal(again, true);
      const previous = await coach.user.client.from("programs").select("id").eq("enrollment_id", enrollmentId);
      assert.ok(wasDenied(previous), "the previous coach regained access when the payment came through");
    });
  });
});
