/**
 * M10 — private calls, as real signed-in people.
 *
 * Covers: who may obtain a join pass (the two people only; outsiders, the
 * anonymous and other coaches get "not found"), the room's window (early,
 * in session, closed), one room per session under repeated and simultaneous
 * requests, the per-person pass limit, that rooms and passes are unreadable
 * and unwritable from the browser, closing on cancellation / suspension /
 * coach change / window end, attendance recorded once per provider presence
 * and readable only by the two people, webhook replays, outcomes as
 * append-only records with explained corrections, client reports through
 * support cases, and that none of it touches money.
 *
 * The provider itself is not called here: these tests prove what the database
 * allows. Real rooms and real calls are verified in the browser.
 *
 * When the project is not confirmed available, every test SKIPS.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  adminClient,
  anonymousClient,
  createTestUser,
  dbAvailability,
  deleteTestUsers,
  ensurePlatformExpectations,
  errorCode,
  liveExpectationIds,
  makeCoach,
  makeDraftOffer,
  publishCoachExpectations,
  setRole,
  sql,
  lit,
  upgradeToAal2,
  wasDenied,
  type CoachFixture,
  type TestUser,
} from "./harness.ts";
import { money } from "@/lib/money/money";
import { entriesForCycleEarning } from "@/lib/ledger/effects";
import { currentCallsPolicy } from "@/lib/policy/registry";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;
const USD = "USD";
const KTM_OFFSET_MIN = 5 * 60 + 45;

function ktm(days: number, hh: number, mm = 0): string {
  const nowKtm = new Date(Date.now() + KTM_OFFSET_MIN * 60_000);
  const base = Date.UTC(nowKtm.getUTCFullYear(), nowKtm.getUTCMonth(), nowKtm.getUTCDate() + days, hh, mm);
  return new Date(base - KTM_OFFSET_MIN * 60_000).toISOString();
}
const key = () => randomUUID().replaceAll("-", "").slice(0, 24);

let coach: CoachFixture;
let coach2: CoachFixture;
let clientA: TestUser;
let clientB: TestUser;
let outsider: TestUser;
let admin: TestUser;
const users: string[] = [];
let enrollA = "";
let purchaseA = "";
let enrollB = "";
let day = 3;
const appointments: string[] = [];

async function checkout(customer: TestUser, versionId: string) {
  const { data: v } = await adminClient().from("offer_versions").select("offers(provider_id)").eq("id", versionId).single();
  const providerId = ((Array.isArray(v!.offers) ? v!.offers[0] : v!.offers) as { provider_id: string }).provider_id;
  const shown = await liveExpectationIds(providerId);
  return adminClient().rpc("create_checkout_records", {
    p: {
      customer_id: customer.id, offer_version_id: versionId, currency: USD, idempotency_key: randomUUID(), hold_seconds: 2100,
      expectations_coach_version_id: shown.coach, expectations_platform_version_id: shown.platform,
    },
  });
}

async function enrol(customer: TestUser, versionId: string): Promise<{ enrollment: string; purchase: string }> {
  const co = await checkout(customer, versionId);
  if (co.error) throw new Error(`checkout: ${co.error.message}`);
  const purchaseId = co.data.purchase_id as string;
  const { data: pu } = await adminClient().from("purchases").select("provider_id, customer_id, commission_policy_id, charge_amount_minor").eq("id", purchaseId).single();
  const sourceKey = `call-${randomUUID()}`;
  const paid = await adminClient().rpc("record_cycle_payment", {
    p: {
      purchase_id: purchaseId,
      cycle: {
        source_key: sourceKey, period_start: new Date().toISOString(), period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        currency: USD, amount_minor: pu!.charge_amount_minor, stripe_payment_intent_id: `pi_test_${sourceKey}`,
      },
      entries: entriesForCycleEarning({
        billingCycleId: sourceKey, purchaseId, providerId: pu!.provider_id, customerId: pu!.customer_id,
        serviceAmount: money(pu!.charge_amount_minor, USD), serviceType: "recurring_coaching", commissionPolicyId: pu!.commission_policy_id, delivered: false,
      }),
    },
  });
  if (paid.error) throw new Error(`pay: ${paid.error.message}`);
  return { enrollment: paid.data.enrollment_id, purchase: purchaseId };
}

async function publishedOffer(c: CoachFixture) {
  const offer = await makeDraftOffer(c, { slug: `call-${key().slice(0, 6)}` });
  const { error } = await c.user.client.rpc("publish_offer_version", { p_version_id: offer.versionId });
  if (error) throw new Error(`publish offer: ${error.message}`);
  return offer.versionId;
}

/**
 * A confirmed session, agreed the normal way (client proposes a valid time,
 * coach accepts), then moved to a time near now. Moving the clock is fixture
 * set-up only; every assertion runs as a signed-in person.
 */
async function booked(client: TestUser, c: CoachFixture, enrollment: string, startInMin: number, lengthMin = 45): Promise<string> {
  const p = await client.client.rpc("propose_appointment", {
    p: { kind: "coaching", enrollment_id: enrollment, starts_at: ktm(day++, 9), duration_minutes: 60, request_key: key() },
  });
  if (p.error) throw new Error(`propose: ${p.error.message}`);
  const r = await c.user.client.rpc("respond_to_proposal", { p_proposal: p.data.proposal_id, p_action: "accept" });
  if (r.error) throw new Error(`accept: ${r.error.message}`);
  const id = r.data.appointment_id as string;
  if (!id) throw new Error(`accept did not book: ${JSON.stringify(r.data)}`);
  await sql(`update appointments set starts_at = now() + interval '${startInMin} minutes',
      ends_at = now() + interval '${startInMin + lengthMin} minutes',
      blocked_from = now() + interval '${startInMin} minutes',
      blocked_to = now() + interval '${startInMin + lengthMin} minutes'
    where id = ${lit(id)}`);
  appointments.push(id);
  return id;
}

const join = (who: TestUser, id: string, audioOnly = false) => who.client.rpc("call_join_request", { p_appointment: id, p_audio_only: audioOnly });
const room = async (appointmentId: string) =>
  (await adminClient().from("call_rooms").select("*").eq("appointment_id", appointmentId).order("created_at", { ascending: false }).limit(1).maybeSingle()).data;
const closeJobs = async (roomId: string) =>
  (await adminClient().from("outbox").select("id, state").eq("topic", "call.close_room").eq("payload->>room_id", roomId)).data ?? [];
/** Retire an in-window session once a test is done with it, so the next can use the coach's time. */
const retire = (id: string) => sql(`update appointments set state = 'cancelled', state_reason = 'test_done' where id = ${lit(id)} and state = 'booked'`);

describe("private calls", { skip }, () => {
  before(async () => {
    await ensurePlatformExpectations();
    coach = await makeCoach("call-coach", { max: 20 });
    coach2 = await makeCoach("call-coach2", { max: 20 });
    clientA = await createTestUser("call-a");
    clientB = await createTestUser("call-b");
    outsider = await createTestUser("call-out");
    admin = await createTestUser("call-admin");
    await setRole(admin.id, "admin");
    await upgradeToAal2(admin);
    users.push(clientA.id, clientB.id, outsider.id, admin.id, coach.user.id, coach2.user.id);
    for (const u of [clientA, clientB, outsider]) await adminClient().from("profiles").update({ timezone: "America/New_York" }).eq("id", u.id);

    for (const c of [coach, coach2]) {
      await publishCoachExpectations(c);
      const rows = Array.from({ length: 7 }, (_, d) => ({ provider_id: c.providerId, weekday: d, start_time: "06:00", end_time: "21:00" }));
      const { error } = await c.user.client.from("availability_windows").insert(rows);
      if (error) throw new Error(`windows: ${error.message}`);
      await c.user.client.from("coach_schedule_settings").upsert({ provider_id: c.providerId, horizon_days: 90 });
    }
    const a = await enrol(clientA, await publishedOffer(coach));
    enrollA = a.enrollment;
    purchaseA = a.purchase;
    enrollB = (await enrol(clientB, await publishedOffer(coach2))).enrollment;
  });

  after(async () => {
    const sb = adminClient();
    if (appointments.length) {
      await sb.from("outbox").delete().in("topic", ["call.close_room", "call.fetch_attendance", "email.session_outcome_recorded"])
        .in("payload->>appointment_id", appointments);
      const { data: rooms } = await sb.from("call_rooms").select("id").in("appointment_id", appointments);
      const ids = (rooms ?? []).map((r) => r.id as string);
      if (ids.length) await sb.from("outbox").delete().in("topic", ["call.close_room", "call.fetch_attendance"]).in("payload->>room_id", ids);
      await sb.from("outbox").delete().like("topic", "email.appointment%").in("payload->>appointment_id", appointments);
    }
    await sql(`update profiles set suspended_at = null where id in (${[clientA.id, clientB.id].map(lit).join(",")})`).catch(() => undefined);
    for (const c of [coach, coach2]) {
      if (!c) continue;
      await sb.from("capacity_reservations").delete().eq("provider_id", c.providerId);
      await sb.from("offers").update({ status: "archived", archived_at: new Date().toISOString() }).eq("provider_id", c.providerId);
      await sb.from("providers").update({ status: "retired", active: false, published_at: null, accepting_new_clients: false }).eq("id", c.providerId);
    }
    await deleteTestUsers(users);
  });

  test("the calls policy is mirrored and is a development default", async () => {
    const { data } = await adminClient().from("call_settings").select("*").single();
    const p = currentCallsPolicy();
    assert.equal(data!.policy_id, p.id);
    assert.equal(data!.policy_status, "sandbox_default");
    assert.equal(data!.join_opens_minutes_before, p.joinOpensMinutesBefore);
    assert.equal(data!.grace_after_end_minutes, p.graceAfterEndMinutes);
    assert.deepEqual(data!.closing_warning_minutes, [...p.closingWarningMinutes]);
    assert.equal(data!.join_pass_seconds, p.joinPassSeconds);
    assert.equal(data!.join_requests_per_10_minutes, p.joinRequestsPer10Minutes);
    assert.equal(data!.attendance_check_delay_minutes, p.attendanceCheckDelayMinutes);
  });

  describe("who may join, and when", () => {
    let s1 = "";

    test("too early: refused with the opening time, and no room or pass is made", async () => {
      const early = await booked(clientA, coach, enrollA, 180);
      const r = await join(clientA, early);
      assert.equal(r.error, null, r.error?.message);
      assert.equal(r.data.ok, false);
      assert.equal(r.data.reason, "too_early");
      assert.ok(Date.parse(r.data.opens_at) < Date.parse(r.data.starts_at));
      assert.equal(await room(early), null);
      await retire(early);
    });

    test("the two people get a pass for the SAME room; the pass is theirs and short-lived", async () => {
      s1 = await booked(clientA, coach, enrollA, 5);
      const a = await join(clientA, s1, true);
      assert.equal(a.error, null, a.error?.message);
      assert.equal(a.data.ok, true);
      assert.equal(a.data.role, "customer");
      assert.equal(a.data.user_id, clientA.id, "the identity is the session's, never the browser's choice");
      assert.equal(a.data.audio_only, true);
      assert.match(a.data.room_name, /^ty-[0-9a-f]{32}$/);
      assert.notEqual(a.data.room_name, s1, "the room name is not the session id");
      assert.ok(Date.parse(a.data.pass_expires_at) - Date.now() <= 125_000);

      const c = await join(coach.user, s1);
      assert.equal(c.data.ok, true);
      assert.equal(c.data.role, "coach");
      assert.equal(c.data.room_id, a.data.room_id);
    });

    test("repeated and simultaneous requests never make a second room", async () => {
      const many = await Promise.all(Array.from({ length: 6 }, () => join(clientA, s1)));
      for (const r of many) assert.equal(r.data?.ok, true, r.error?.message);
      assert.equal(new Set(many.map((r) => r.data.room_id)).size, 1);
      const { data } = await adminClient().from("call_rooms").select("id").eq("appointment_id", s1);
      assert.equal(data!.length, 1);
    });

    test("an outsider, another coach and the anonymous are told the session doesn't exist", async () => {
      assert.equal(errorCode((await join(outsider, s1)).error), "not_found");
      assert.equal(errorCode((await join(coach2.user, s1)).error), "not_found");
      assert.ok((await anonymousClient().rpc("call_join_request", { p_appointment: s1, p_audio_only: false })).error);
    });

    test("rooms and passes cannot be read or written from the browser; admins can read them", async () => {
      for (const who of [clientA, coach.user]) {
        assert.ok(wasDenied(await who.client.from("call_rooms").select("room_name").eq("appointment_id", s1)));
        assert.ok(wasDenied(await who.client.from("call_join_passes").select("id").eq("appointment_id", s1)));
        assert.ok((await who.client.from("call_rooms").insert({ appointment_id: s1, room_name: `ty-${"c".repeat(32)}`, opens_at: new Date().toISOString(), closes_at: new Date(Date.now() + 3600_000).toISOString() })).error);
        assert.ok((await who.client.rpc("mark_call_room_ready", { p_room: (await room(s1))!.id, p_url: "https://x.daily.co/y" })).error);
        assert.ok((await who.client.rpc("request_call_close", { p_room: (await room(s1))!.id, p_reason: "x" })).error);
        assert.ok((await who.client.rpc("record_call_attendance", { p_room: (await room(s1))!.id, p_rows: [], p_source: "provider_api", p_complete: true })).error);
      }
      assert.equal(wasDenied(await admin.client.from("call_rooms").select("id").eq("appointment_id", s1)), false);
    });

    test("each person's passes are limited per session", async () => {
      let limited = false;
      for (let i = 0; i < 25 && !limited; i++) limited = errorCode((await join(coach.user, s1)).error) === "rate_limited";
      assert.equal(limited, true);
    });

    test("cancelling closes the room at once: new passes refused, closing queued", async () => {
      const r = await clientA.client.rpc("cancel_appointment", { p_appointment: s1, p_scope: "this", p_reason: "test" });
      assert.equal(r.error, null, r.error?.message);
      const rm = await room(s1);
      assert.equal(rm!.state, "closing");
      assert.equal(rm!.close_reason, "session_cancelled");
      assert.equal((await closeJobs(rm!.id)).length, 1);
      const again = await join(clientA, s1);
      assert.equal(again.data.ok, false);
      assert.equal(again.data.reason, "not_booked");
    });

    test("a late arrival after the booked end can still join until the room closes", async () => {
      const late = await booked(clientA, coach, enrollA, -50, 45);
      const r = await join(clientA, late);
      assert.equal(r.data.ok, true, "5 minutes past the booked end, inside the grace");
      await retire(late);
    });

    test("after the room's window, joining is refused and the sweep closes the room", async () => {
      const past = await booked(clientA, coach, enrollA, -3, 45);
      const r = await join(clientA, past);
      assert.equal(r.data.ok, true);
      await sql(`update call_rooms set closes_at = now() - interval '1 minute', opens_at = now() - interval '2 hours' where appointment_id = ${lit(past)}`);
      const swept = await adminClient().rpc("close_due_call_rooms");
      assert.equal(swept.error, null, swept.error?.message);
      assert.ok(Number(swept.data) >= 1);
      assert.equal((await room(past))!.state, "closing");
      assert.equal((await room(past))!.close_reason, "window_ended");
      // A closed room is never reopened: a later request, still inside the
      // session's own window, gets a NEW room.
      await sql(`update call_rooms set state = 'closed', closed_at = now() where appointment_id = ${lit(past)}`);
      const again = await join(clientA, past);
      assert.equal(again.data.ok, true);
      assert.notEqual(again.data.room_id, r.data.room_id);
      await retire(past);
    });
  });

  describe("losing access closes the room, even mid-call", () => {
    test("a suspended client: room closing, passes refused", async () => {
      const s = await booked(clientA, coach, enrollA, -10);
      assert.equal((await join(clientA, s)).data.ok, true);
      await sql(`update profiles set suspended_at = now() where id = ${lit(clientA.id)}`);
      const rm = await room(s);
      assert.equal(rm!.state, "closing");
      assert.equal(rm!.close_reason, "account_suspended");
      const r = await join(clientA, s);
      assert.ok(r.error || r.data.ok === false);
      await sql(`update profiles set suspended_at = null where id = ${lit(clientA.id)}`);
      await retire(s);
    });

    test("a suspended coach: room closing", async () => {
      const s = await booked(clientB, coach2, enrollB, -10);
      assert.equal((await join(clientB, s)).data.ok, true);
      await sql(`update providers set suspended_at = now() where id = ${lit(coach2.providerId)}`);
      assert.equal((await room(s))!.close_reason, "coach_suspended");
      assert.equal(errorCode((await join(coach2.user, s)).error), "not_found", "a suspended coach is not a party");
      await sql(`update providers set suspended_at = null where id = ${lit(coach2.providerId)}`);
      await retire(s);
    });

    test("a coach change: the previous coach's room closes and passes are refused", async () => {
      const s = await booked(clientB, coach2, enrollB, -10);
      assert.equal((await join(coach2.user, s)).data.ok, true);
      await sql(`update enrollment_assignments set effective_to = now() where enrollment_id = ${lit(enrollB)} and effective_to is null`);
      assert.equal((await room(s))!.close_reason, "coach_changed");
      const r = await join(coach2.user, s);
      assert.equal(r.data?.ok ?? false, false);
    });
  });

  describe("attendance", () => {
    let s = "";
    let roomId = "";

    test("recorded once per provider presence, only for the two people", async () => {
      s = await booked(clientA, coach, enrollA, -20, 30);
      const r = await join(clientA, s);
      roomId = r.data.room_id;
      const t = Math.floor(Date.now() / 1000) - 600;
      const rows = [
        { meeting_id: "m1", participant_id: `pa-${key()}`, user_id: clientA.id, joined_at: t, duration: 540.4 },
        { meeting_id: "m1", participant_id: `pc-${key()}`, user_id: coach.user.id, joined_at: t - 30, duration: 570 },
        { meeting_id: "m1", participant_id: `px-${key()}`, user_id: outsider.id, joined_at: t, duration: 5 },
        { meeting_id: "m1", participant_id: `pm-${key()}`, user_id: clientA.id, joined_at: "not a time", duration: 5 },
      ];
      const first = await adminClient().rpc("record_call_attendance", { p_room: roomId, p_rows: rows, p_source: "provider_api", p_complete: false });
      assert.equal(first.error, null, first.error?.message);
      assert.equal(first.data, 2);
      const replay = await adminClient().rpc("record_call_attendance", { p_room: roomId, p_rows: rows, p_source: "provider_webhook", p_complete: true });
      assert.equal(replay.data, 0, "the same presence from the webhook changes nothing");
    });

    test("the two people read it; nobody else does, and nobody can change it", async () => {
      const mine = await clientA.client.from("call_attendance").select("role, duration_seconds").eq("appointment_id", s);
      assert.equal(mine.data!.length, 2);
      assert.equal((await coach.user.client.from("call_attendance").select("id").eq("appointment_id", s)).data!.length, 2);
      assert.ok(wasDenied(await outsider.client.from("call_attendance").select("id").eq("appointment_id", s)));
      assert.ok((await clientA.client.from("call_attendance").update({ duration_seconds: 1 }).eq("appointment_id", s)).error);
      await assert.rejects(sql(`update call_attendance set duration_seconds = 1 where appointment_id = ${lit(s)}`), /history_immutable/);
    });

    test("a webhook event is handled once", async () => {
      const id = `evt-${key()}`;
      const a = await adminClient().rpc("claim_call_provider_event", { p_event_id: id, p_type: "participant.left", p_room_name: (await room(s))!.room_name });
      const b = await adminClient().rpc("claim_call_provider_event", { p_event_id: id, p_type: "participant.left", p_room_name: (await room(s))!.room_name });
      assert.equal(a.data.new, true);
      assert.equal(b.data.new, false);
    });

    test("joining is not delivery: no outcome appears, and nothing touches money", async () => {
      const before = await sql<{ n: number }>(`select count(*)::int n from ledger_entries where purchase_id = ${lit(purchaseA)}`);
      await adminClient().rpc("close_due_call_rooms");
      const { data } = await adminClient().from("appointment_outcomes").select("id").eq("appointment_id", s);
      assert.equal(data!.length, 0, "no automatic outcome, no automatic no-show");
      const afterRows = await sql<{ n: number }>(`select count(*)::int n from ledger_entries where purchase_id = ${lit(purchaseA)}`);
      assert.equal(afterRows[0].n, before[0].n);
      await retire(s);
    });
  });

  describe("outcomes, corrections and reports", () => {
    let s = "";
    let firstOutcome = "";

    test("only the coach (or TalentYak) records, and only once it has started", async () => {
      s = await booked(clientA, coach, enrollA, -40, 30);
      assert.equal(errorCode((await clientA.client.rpc("record_appointment_outcome", { p_appointment: s, p_outcome: "attended", p_note: null })).error), "not_found");
      assert.equal(errorCode((await outsider.client.rpc("record_appointment_outcome", { p_appointment: s, p_outcome: "attended", p_note: null })).error), "not_found");
    });

    test("a technical interruption is recorded, the client is told, and nothing else happens", async () => {
      const before = await sql<{ n: number }>(`select count(*)::int n from ledger_entries where purchase_id = ${lit(purchaseA)}`);
      const r = await coach.user.client.rpc("record_appointment_outcome", { p_appointment: s, p_outcome: "technical_failure", p_note: "Call kept dropping" });
      assert.equal(r.error, null, r.error?.message);
      firstOutcome = r.data as string;
      const { data: jobs } = await adminClient().from("outbox").select("payload").eq("topic", "email.session_outcome_recorded").eq("payload->>outcome_id", firstOutcome);
      assert.equal(jobs!.length, 1);
      assert.equal((jobs![0].payload as { recipient: string }).recipient, "customer");
      const afterRows = await sql<{ n: number }>(`select count(*)::int n from ledger_entries where purchase_id = ${lit(purchaseA)}`);
      assert.equal(afterRows[0].n, before[0].n, "no charge, refund or payout from an outcome");
      const { data: a } = await adminClient().from("appointments").select("state").eq("id", s).single();
      assert.equal(a!.state, "booked", "the session itself is unchanged");
    });

    test("a second record is a correction: it needs a reason and keeps the first", async () => {
      assert.equal(errorCode((await coach.user.client.rpc("record_appointment_outcome", { p_appointment: s, p_outcome: "attended", p_note: null })).error), "correction_reason_required");
      const r = await coach.user.client.rpc("record_appointment_outcome", { p_appointment: s, p_outcome: "attended", p_note: "We reconnected by audio and finished" });
      assert.equal(r.error, null, r.error?.message);
      const { data } = await clientA.client.from("appointment_outcomes").select("id, outcome, corrects").eq("appointment_id", s).order("recorded_at");
      assert.equal(data!.length, 2);
      assert.equal(data![0].outcome, "technical_failure", "the first record is untouched");
      assert.equal(data![1].corrects, firstOutcome);
      await assert.rejects(sql(`update appointment_outcomes set outcome = 'attended' where id = ${lit(firstOutcome)}`), /history_immutable/);
    });

    test("the client can say the outcome is wrong — once — through a support case", async () => {
      assert.equal(errorCode((await coach.user.client.rpc("open_session_case", { p_appointment: s, p_topic: "outcome_incorrect", p_description: "Coach disputing their own record" })).error), "not_found");
      assert.equal(errorCode((await outsider.client.rpc("open_session_case", { p_appointment: s, p_topic: "call_problem", p_description: "Not my session at all" })).error), "not_found");
      const a = await clientA.client.rpc("open_session_case", { p_appointment: s, p_topic: "outcome_incorrect", p_description: "We never actually finished the session." });
      assert.equal(a.error, null, a.error?.message);
      const b = await clientA.client.rpc("open_session_case", { p_appointment: s, p_topic: "outcome_incorrect", p_description: "Clicking again should not open another case." });
      assert.equal(b.data, a.data, "a repeated click returns the case already open");
      const { data: c } = await clientA.client.from("support_cases").select("category, session_topic, appointment_id").eq("id", a.data).single();
      assert.deepEqual(c, { category: "session", session_topic: "outcome_incorrect", appointment_id: s });
      const { data: ev } = await clientA.client.from("appointment_events").select("reason").eq("appointment_id", s).eq("reason", "outcome_questioned");
      assert.equal(ev!.length, 1, "the history shows the record was questioned");
      // The reporter sees their own report; the coach is not told a report exists.
      const mine = await clientA.client.rpc("appointment_call_info", { p_appointment: s });
      assert.deepEqual(mine.data.my_open_reports, ["outcome_incorrect"]);
      const theirs = await coach.user.client.rpc("appointment_call_info", { p_appointment: s });
      assert.equal(theirs.data.open_reports, 0);
      assert.deepEqual(theirs.data.my_open_reports, []);
      assert.equal((await admin.client.rpc("appointment_call_info", { p_appointment: s })).data.open_reports, 1);
      assert.equal((await outsider.client.rpc("appointment_call_info", { p_appointment: s })).data, null);
    });

    test("a client can't question an outcome that doesn't exist; either person can report a call problem", async () => {
      const t = await booked(clientA, coach, enrollA, -2, 30);
      assert.equal(errorCode((await clientA.client.rpc("open_session_case", { p_appointment: t, p_topic: "outcome_incorrect", p_description: "There is nothing recorded yet." })).error), "no_outcome");
      const r = await coach.user.client.rpc("open_session_case", { p_appointment: t, p_topic: "call_problem", p_description: "Client's audio cut out every minute." });
      assert.equal(r.error, null, r.error?.message);
      await retire(t);
    });

    test("an administrator can correct the record, and both people are told", async () => {
      const r = await admin.client.rpc("record_appointment_outcome", { p_appointment: s, p_outcome: "technical_failure", p_note: "Support reviewed the call record" });
      assert.equal(r.error, null, r.error?.message);
      const { data: jobs } = await adminClient().from("outbox").select("payload").eq("topic", "email.session_outcome_recorded").eq("payload->>outcome_id", r.data as string);
      assert.deepEqual(jobs!.map((j) => (j.payload as { recipient: string }).recipient).sort(), ["coach", "customer"]);
    });
  });

  describe("session purpose", () => {
    test("either person sets it; it's capped; outsiders can't", async () => {
      const s = await booked(clientA, coach, enrollA, 120);
      assert.equal((await clientA.client.rpc("set_appointment_purpose", { p_appointment: s, p_purpose: "Review week 3" })).error, null);
      const { data } = await coach.user.client.from("appointments").select("purpose").eq("id", s).single();
      assert.equal(data!.purpose, "Review week 3");
      assert.ok((await clientA.client.rpc("set_appointment_purpose", { p_appointment: s, p_purpose: "x".repeat(141) })).error);
      assert.equal(errorCode((await outsider.client.rpc("set_appointment_purpose", { p_appointment: s, p_purpose: "mine now" })).error), "not_found");
      await retire(s);
    });
  });
});
