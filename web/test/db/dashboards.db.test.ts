/**
 * M15 dashboards, as real signed-in people.
 *
 *   · a coach's conversations keep unread (not opened) and unanswered (the
 *     client wrote last) apart; opening one clears unread, only a reply
 *     clears unanswered; no message text is returned; another coach and the
 *     client get nothing
 *   · "no reply needed" is only for a coach's own conversation, and the
 *     database decides how far it reaches — a new client message is past it
 *   · marks are private, bounded (a snooze of a week at most, never in the
 *     past) and only of the allowed kinds; nobody writes them directly
 *   · the activity summary is dates and counts through the coach's own
 *     access, and nothing for anyone else's client
 *   · calls left are shown only for a package with a fixed number of calls,
 *     counted the way booking counts them, and only to the two people on it
 *
 * When the project is not confirmed available, every test SKIPS.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  adminClient,
  createTestUser,
  dbAvailability,
  deleteTestUsers,
  errorCode,
  liveExpectationIds,
  lit,
  makeCoach,
  makeDraftOffer,
  publishCoachExpectations,
  sql,
  type CoachFixture,
  type TestUser,
} from "./harness.ts";
import { money } from "@/lib/money/money";
import { entriesForCycleEarning } from "@/lib/ledger/effects";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;
const USD = "USD";
const KTM_OFFSET_MIN = 5 * 60 + 45;
const DAY = 86_400_000;

function ktm(days: number, hh: number): string {
  const nowKtm = new Date(Date.now() + KTM_OFFSET_MIN * 60_000);
  const base = Date.UTC(nowKtm.getUTCFullYear(), nowKtm.getUTCMonth(), nowKtm.getUTCDate() + days, hh, 0);
  return new Date(base - KTM_OFFSET_MIN * 60_000).toISOString();
}
const key = () => randomUUID().replaceAll("-", "").slice(0, 24);

let coachA: CoachFixture;
let coachB: CoachFixture;
let client: TestUser; // fixed-allowance plan with coach A
let client2: TestUser; // flexible plan with coach A
let outsider: TestUser;
const users: string[] = [];
let E1 = "";
let E2 = "";
let conv1 = "";

async function checkout(customer: TestUser, versionId: string) {
  const shown = await liveExpectationIds(coachA.providerId);
  return adminClient().rpc("create_checkout_records", {
    p: {
      customer_id: customer.id, offer_version_id: versionId, currency: USD, idempotency_key: randomUUID(), hold_seconds: 2100,
      expectations_coach_version_id: shown.coach, expectations_platform_version_id: shown.platform,
    },
  });
}

async function enrol(customer: TestUser, versionId: string): Promise<string> {
  const co = await checkout(customer, versionId);
  if (co.error) throw new Error(`checkout: ${co.error.message}`);
  const purchaseId = co.data.purchase_id as string;
  const { data: pu } = await adminClient().from("purchases").select("provider_id, customer_id, commission_policy_id, charge_amount_minor").eq("id", purchaseId).single();
  const sourceKey = `dash-${randomUUID()}`;
  const paid = await adminClient().rpc("record_cycle_payment", {
    p: {
      purchase_id: purchaseId,
      cycle: {
        source_key: sourceKey, period_start: new Date(Date.now() - 60_000).toISOString(), period_end: new Date(Date.now() + 30 * DAY).toISOString(),
        currency: USD, amount_minor: pu!.charge_amount_minor, stripe_payment_intent_id: `pi_test_${sourceKey}`,
      },
      entries: entriesForCycleEarning({
        billingCycleId: sourceKey, purchaseId, providerId: pu!.provider_id, customerId: pu!.customer_id,
        serviceAmount: money(pu!.charge_amount_minor, USD), serviceType: "recurring_coaching", commissionPolicyId: pu!.commission_policy_id, delivered: false,
      }),
    },
  });
  if (paid.error) throw new Error(`pay: ${paid.error.message}`);
  return paid.data.enrollment_id as string;
}

async function publishedOffer(opts: { slug: string; calls?: number; minutes?: number }) {
  const offer = await makeDraftOffer(coachA, { slug: opts.slug });
  if (opts.calls !== undefined) {
    const { error } = await adminClient().from("offer_versions").update({ calls_included_per_month: opts.calls, call_duration_minutes: opts.minutes ?? 60 }).eq("id", offer.versionId);
    if (error) throw new Error(error.message);
  }
  const { error } = await coachA.user.client.rpc("publish_offer_version", { p_version_id: offer.versionId });
  if (error) throw new Error(`publish offer: ${error.message}`);
  return offer.versionId;
}

const send = (who: TestUser, body: string) => who.client.rpc("send_message", { p_conversation: conv1, p_client_id: randomUUID(), p_body: body, p_media: null });

async function attention(who: TestUser) {
  const { data, error } = await who.client.rpc("coach_message_attention");
  assert.equal(error, null);
  return (data ?? []) as Record<string, unknown>[];
}

const mark = (who: TestUser, area: string, item: string, action: string, until: string | null = null) =>
  who.client.rpc("set_dashboard_mark", { p_area: area, p_item: item, p_action: action, p_until: until });

describe("M15 dashboards", { skip }, () => {
  before(async () => {
    coachA = await makeCoach("dash-coach-a");
    coachB = await makeCoach("dash-coach-b");
    client = await createTestUser("dash-client");
    client2 = await createTestUser("dash-client-2");
    outsider = await createTestUser("dash-outsider");
    users.push(coachA.user.id, coachB.user.id, client.id, client2.id, outsider.id);

    await publishCoachExpectations(coachA);
    const rows = Array.from({ length: 7 }, (_, d) => ({ provider_id: coachA.providerId, weekday: d, start_time: "06:00", end_time: "21:00" }));
    const w = await coachA.user.client.from("availability_windows").insert(rows);
    if (w.error) throw new Error(`windows: ${w.error.message}`);
    const s = await coachA.user.client.from("coach_schedule_settings").upsert({ provider_id: coachA.providerId, horizon_days: 70 });
    if (s.error) throw new Error(`settings: ${s.error.message}`);

    const fixed = await publishedOffer({ slug: `dash-fixed-${key().slice(0, 6)}`, calls: 2, minutes: 60 });
    const flexible = await publishedOffer({ slug: `dash-flex-${key().slice(0, 6)}` });
    E1 = await enrol(client, fixed);
    E2 = await enrol(client2, flexible);
    const { data: c } = await adminClient().from("conversations").select("id").eq("enrollment_id", E1).eq("provider_id", coachA.providerId).single();
    conv1 = c!.id as string;
  });

  after(async () => {
    const sb = adminClient();
    await sql(`delete from outbox where payload->>'conversation_id' = ${lit(conv1 || randomUUID())}`);
    await sb.from("outbox").delete().like("topic", "email.appointment%").gte("created_at", new Date(Date.now() - 3 * 3600_000).toISOString()).in("payload->>recipient", ["customer", "coach"]);
    for (const c of [coachA, coachB]) {
      if (!c) continue;
      await sb.from("capacity_reservations").delete().eq("provider_id", c.providerId);
      await sb.from("offers").update({ status: "archived", archived_at: new Date().toISOString() }).eq("provider_id", c.providerId);
      await sb.from("providers").update({ status: "retired", active: false, published_at: null, accepting_new_clients: false }).eq("id", c.providerId);
    }
    await deleteTestUsers(users);
  });

  test("unread and unanswered are kept apart, and no message text is returned", async () => {
    assert.equal((await send(client, "Quick question about my squat")).error, null);
    assert.equal((await send(client, "and my knee")).error, null);

    let [row] = (await attention(coachA.user)).filter((r) => r.conversation_id === conv1);
    assert.equal(Number(row.unread_count), 2);
    assert.equal(row.awaiting_reply, true);
    assert.ok(row.waiting_since);
    for (const k of Object.keys(row)) assert.ok(!/body|preview|text/.test(k), `returned ${k}`);
    assert.ok(!JSON.stringify(row).includes("squat"));

    // Opening it clears unread — and nothing else.
    const { data: status } = await coachA.user.client.rpc("conversation_status", { p_conversation: conv1 });
    await coachA.user.client.rpc("mark_conversation_read", { p_conversation: conv1, p_seq: (status as { last_seq: number }).last_seq });
    [row] = (await attention(coachA.user)).filter((r) => r.conversation_id === conv1);
    assert.equal(Number(row.unread_count), 0);
    assert.equal(row.awaiting_reply, true, "reading is not answering");

    // Only a reply answers it.
    assert.equal((await send(coachA.user, "Let's look at it on Thursday")).error, null);
    [row] = (await attention(coachA.user)).filter((r) => r.conversation_id === conv1);
    assert.equal(row.awaiting_reply, false);

    // The other client's conversation has nothing waiting; nobody else sees these.
    const other = (await attention(coachA.user)).find((r) => r.enrollment_id === E2);
    assert.equal(other?.awaiting_reply, false);
    assert.equal((await attention(coachB.user)).length, 0);
    assert.equal((await attention(client)).length, 0, "a client never gets the coach's view");
  });

  test("'no reply needed' reaches only as far as the database says, and only for the coach's own conversation", async () => {
    await send(client, "Thanks!");
    const set = await mark(coachA.user, "coach", `msg:${conv1}`, "handled");
    assert.equal(set.error, null);
    let [row] = (await attention(coachA.user)).filter((r) => r.conversation_id === conv1);
    assert.equal(Number(row.handled_through_seq), Number(row.last_client_seq));

    await send(client, "Actually, one more thing");
    [row] = (await attention(coachA.user)).filter((r) => r.conversation_id === conv1);
    assert.ok(Number(row.last_client_seq) > Number(row.handled_through_seq), "a new message is past the mark");

    assert.equal(errorCode((await mark(coachB.user, "coach", `msg:${conv1}`, "handled")).error), "mark_not_permitted");
    assert.equal(errorCode((await mark(client, "coach", `msg:${conv1}`, "handled")).error), "mark_not_permitted");
    assert.equal(errorCode((await mark(coachA.user, "coach", `checkin:${randomUUID()}`, "handled")).error), "mark_invalid");
  });

  test("marks are private, bounded, and written only through the function", async () => {
    const item = `proposal:${randomUUID()}`;
    assert.equal(errorCode((await mark(coachA.user, "coach", item, "snoozed", new Date(Date.now() + 8 * DAY).toISOString())).error), "mark_invalid");
    assert.equal(errorCode((await mark(coachA.user, "coach", item, "snoozed", new Date(Date.now() - 60_000).toISOString())).error), "mark_invalid");
    assert.equal((await mark(coachA.user, "coach", item, "snoozed", new Date(Date.now() + DAY).toISOString())).error, null);

    assert.equal((await mark(client, "client", `planver:${randomUUID()}`, "dismissed")).error, null);
    assert.equal(errorCode((await mark(client, "client", `msg:${conv1}`, "handled")).error), "mark_invalid");
    assert.equal(errorCode((await mark(client, "client", item, "snoozed", new Date(Date.now() + DAY).toISOString())).error), "mark_invalid");
    assert.equal(errorCode((await mark(client, "coach", item, "snoozed", new Date(Date.now() + DAY).toISOString())).error), "mark_not_permitted");
    assert.equal(errorCode((await mark(coachA.user, "coach", "msg:not-a-uuid", "handled")).error), "mark_invalid");

    const { data: mine } = await coachA.user.client.from("dashboard_marks").select("item_key");
    assert.ok((mine ?? []).some((m) => m.item_key === item));
    const { data: theirs } = await outsider.client.from("dashboard_marks").select("item_key");
    assert.equal((theirs ?? []).length, 0);
    const { data: clientSees } = await client.client.from("dashboard_marks").select("item_key");
    assert.ok((clientSees ?? []).every((m) => m.item_key.startsWith("planver:")), "the client sees only their own marks");

    const direct = await outsider.client.from("dashboard_marks").insert({ profile_id: outsider.id, area: "client", item_key: `exp:${randomUUID()}`, action: "dismissed" });
    assert.ok(direct.error, "marks are written only through set_dashboard_mark");

    await coachA.user.client.rpc("clear_dashboard_mark", { p_area: "coach", p_item: item });
    const { data: after } = await coachA.user.client.from("dashboard_marks").select("item_key").eq("item_key", item);
    assert.equal((after ?? []).length, 0);
  });

  test("the activity summary is dates and counts, through the coach's own access", async () => {
    const sb = adminClient();
    const today = new Date().toISOString().slice(0, 10);
    const w = await sb.from("workout_logs").insert({ enrollment_id: E1, performed_at: today, status: "completed", title: "Fixture" });
    assert.equal(w.error, null, w.error?.message);
    const b = await sb.from("bodyweight_logs").insert({ enrollment_id: E1, logged_on: today, weight_kg: 70.4 });
    assert.equal(b.error, null, b.error?.message);

    const { data, error } = await coachA.user.client.rpc("coach_client_activity", { p_since: new Date(Date.now() - 7 * DAY).toISOString() });
    assert.equal(error, null);
    const row = ((data ?? []) as Record<string, unknown>[]).find((r) => r.enrollment_id === E1)!;
    assert.equal(row.records_visible, true);
    assert.equal(row.last_workout_on, today);
    assert.equal(Number(row.workouts_since), 1);
    assert.equal(Number(row.body_since), 1);
    assert.ok(row.last_client_message_at);
    assert.ok(!JSON.stringify(row).includes("70.4"), "no values, only that something was recorded");

    const { data: other } = await coachB.user.client.rpc("coach_client_activity", { p_since: new Date(Date.now() - 7 * DAY).toISOString() });
    assert.equal((other ?? []).length, 0);
    const { data: asClient } = await client.client.rpc("coach_client_activity", { p_since: new Date(Date.now() - 7 * DAY).toISOString() });
    assert.equal((asClient ?? []).length, 0);
  });

  test("calls left: only for a package with a fixed number, counted as booking counts them", async () => {
    const allowance = async (who: TestUser, e: string) => (await who.client.rpc("my_call_allowance", { p_enrollment: e })).data as { allowed: number; used: number | null } | null;
    assert.deepEqual(await allowance(client, E1).then((a) => [a?.allowed, a?.used]), [2, 0]);
    assert.equal(await allowance(client2, E2), null, "flexible coaching has no quota to show");
    assert.equal(await allowance(outsider, E1), null);
    assert.equal(await allowance(coachB.user, E1), null);
    assert.equal((await allowance(coachA.user, E1))?.allowed, 2);

    const p = await coachA.user.client.rpc("propose_appointment", { p: { kind: "coaching", duration_minutes: 60, request_key: key(), enrollment_id: E1, starts_at: ktm(10, 9) } });
    assert.equal(p.error, null, p.error?.message);
    const r = await client.client.rpc("respond_to_proposal", { p_proposal: p.data.proposal_id, p_action: "accept" });
    assert.equal(r.data?.state, "accepted", JSON.stringify(r.data));
    assert.deepEqual(await allowance(client, E1).then((a) => [a?.allowed, a?.used]), [2, 1]);
  });
});
