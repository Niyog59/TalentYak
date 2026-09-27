/**
 * M09 — flexible scheduling, as real signed-in people in different zones.
 *
 * Coach in Asia/Kathmandu (+05:45, no clock changes), clients in
 * America/New_York and Australia/Sydney. Covers: proposals and counter-
 * proposals, acceptance, decline, expiry, repeated clicks, full-interval and
 * buffer conflicts for coach AND client, simultaneous acceptances, rescheduling
 * that keeps the original until replaced, availability edits, weekly series
 * across a clock change, this-versus-future edits, tentative versus confirmed
 * against the paid period, reconciliation on pause / suspension / cancellation,
 * fixed-allowance plans without quotas on flexible ones, one-off consultation
 * slot holds with expiry and late payment, outsiders, and reminder suppression.
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
import { currentSchedulingPolicy } from "@/lib/policy/registry";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;
const USD = "USD";
const KTM_OFFSET_MIN = 5 * 60 + 45;

/** A wall-clock time in Kathmandu, `days` from today there, as an ISO instant. */
function ktm(days: number, hh: number, mm = 0): string {
  const nowKtm = new Date(Date.now() + KTM_OFFSET_MIN * 60_000);
  const base = Date.UTC(nowKtm.getUTCFullYear(), nowKtm.getUTCMonth(), nowKtm.getUTCDate() + days, hh, mm);
  return new Date(base - KTM_OFFSET_MIN * 60_000).toISOString();
}
const plusMin = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();
const key = () => randomUUID().replaceAll("-", "").slice(0, 24);

let coach: CoachFixture;
let coachOther: CoachFixture;
let customerA: TestUser; // New York
let customerB: TestUser; // Sydney
let customerC: TestUser; // fixed-allowance plan
let buyer1: TestUser;
let buyer2: TestUser;
let outsider: TestUser;
let admin: TestUser;
const users: string[] = [];

let flexibleVersion = "";
let fixedVersion = "";
let otherVersion = "";
let consultVersion = "";
let enrollA = "";
let enrollB = "";
let enrollAOther = "";
let enrollC = "";
let purchaseA = "";

async function checkout(customer: TestUser, versionId: string, extra: Record<string, unknown> = {}) {
  const { data: v } = await adminClient().from("offer_versions").select("offers(provider_id)").eq("id", versionId).single();
  const providerId = ((Array.isArray(v!.offers) ? v!.offers[0] : v!.offers) as { provider_id: string }).provider_id;
  const shown = await liveExpectationIds(providerId);
  return adminClient().rpc("create_checkout_records", {
    p: {
      customer_id: customer.id, offer_version_id: versionId, currency: USD, idempotency_key: randomUUID(), hold_seconds: 2100,
      expectations_coach_version_id: shown.coach, expectations_platform_version_id: shown.platform, ...extra,
    },
  });
}

async function pay(purchaseId: string, serviceType: "recurring_coaching" | "one_off_consultation" = "recurring_coaching") {
  const { data: pu } = await adminClient().from("purchases").select("provider_id, customer_id, commission_policy_id, charge_amount_minor").eq("id", purchaseId).single();
  const sourceKey = `sch-${randomUUID()}`;
  return adminClient().rpc("record_cycle_payment", {
    p: {
      purchase_id: purchaseId,
      cycle: {
        source_key: sourceKey, period_start: new Date().toISOString(),
        period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        currency: USD, amount_minor: pu!.charge_amount_minor, stripe_payment_intent_id: `pi_test_${sourceKey}`,
      },
      entries: entriesForCycleEarning({
        billingCycleId: sourceKey, purchaseId, providerId: pu!.provider_id, customerId: pu!.customer_id,
        serviceAmount: money(pu!.charge_amount_minor, USD), serviceType, commissionPolicyId: pu!.commission_policy_id, delivered: false,
      }),
    },
  });
}

async function enrol(customer: TestUser, versionId: string): Promise<{ enrollment: string; purchase: string }> {
  const co = await checkout(customer, versionId);
  if (co.error) throw new Error(`checkout: ${co.error.message}`);
  const paid = await pay(co.data.purchase_id);
  if (paid.error) throw new Error(`pay: ${paid.error.message}`);
  return { enrollment: paid.data.enrollment_id, purchase: co.data.purchase_id };
}

async function publishedOffer(c: CoachFixture, opts: Parameters<typeof makeDraftOffer>[1] & { calls?: number; minutes?: number } = {}) {
  const offer = await makeDraftOffer(c, opts);
  if (opts.calls !== undefined || opts.minutes !== undefined) {
    const { error } = await adminClient().from("offer_versions")
      .update({ calls_included_per_month: opts.calls ?? null, call_duration_minutes: opts.minutes ?? null }).eq("id", offer.versionId);
    if (error) throw new Error(error.message);
  }
  const { error } = await c.user.client.rpc("publish_offer_version", { p_version_id: offer.versionId });
  if (error) throw new Error(`publish offer: ${error.message}`);
  return offer.versionId;
}

const propose = (who: TestUser, p: Record<string, unknown>) =>
  who.client.rpc("propose_appointment", { p: { kind: "coaching", duration_minutes: 60, request_key: key(), ...p } });
const respond = (who: TestUser, proposal: string, action: "accept" | "decline" | "withdraw") =>
  who.client.rpc("respond_to_proposal", { p_proposal: proposal, p_action: action });
const reconcile = () => adminClient().rpc("reconcile_appointments");
const appt = async (id: string) => (await adminClient().from("appointments").select("*").eq("id", id).single()).data!;

describe("flexible scheduling", { skip }, () => {
  before(async () => {
    await ensurePlatformExpectations();
    coach = await makeCoach("sch-coach", { max: 20 });
    coachOther = await makeCoach("sch-coach-other", { max: 20 });
    for (const [label, tz] of [["a", "America/New_York"], ["b", "Australia/Sydney"], ["c", "America/Chicago"], ["buy1", "Europe/London"], ["buy2", "America/Denver"], ["out", "Asia/Kathmandu"]] as const) {
      const u = await createTestUser(`sch-${label}`);
      await adminClient().from("profiles").update({ timezone: tz }).eq("id", u.id);
      users.push(u.id);
      if (label === "a") customerA = u;
      if (label === "b") customerB = u;
      if (label === "c") customerC = u;
      if (label === "buy1") buyer1 = u;
      if (label === "buy2") buyer2 = u;
      if (label === "out") outsider = u;
    }
    admin = await createTestUser("sch-admin");
    await setRole(admin.id, "admin");
    await upgradeToAal2(admin);
    users.push(admin.id, coach.user.id, coachOther.user.id);

    await publishCoachExpectations(coach);
    await publishCoachExpectations(coachOther);

    // Availability: every day 06:00–21:00 Kathmandu, through the coach's own session.
    for (const c of [coach, coachOther]) {
      const rows = Array.from({ length: 7 }, (_, d) => ({ provider_id: c.providerId, weekday: d, start_time: "06:00", end_time: "21:00" }));
      const { error } = await c.user.client.from("availability_windows").insert(rows);
      if (error) throw new Error(`windows: ${error.message}`);
      const s = await c.user.client.from("coach_schedule_settings").upsert({ provider_id: c.providerId, horizon_days: 70, buffer_after_minutes: 10 });
      if (s.error) throw new Error(`settings: ${s.error.message}`);
    }

    flexibleVersion = await publishedOffer(coach, { slug: `flex-${key().slice(0, 6)}` });
    fixedVersion = await publishedOffer(coach, { slug: `fixed-${key().slice(0, 6)}`, calls: 1, minutes: 60 });
    otherVersion = await publishedOffer(coachOther, { slug: `other-${key().slice(0, 6)}` });
    consultVersion = await publishedOffer(coach, { slug: `consult-${key().slice(0, 6)}`, serviceType: "one_off_consultation", minutes: 30 });

    const a = await enrol(customerA, flexibleVersion);
    enrollA = a.enrollment; purchaseA = a.purchase;
    enrollB = (await enrol(customerB, flexibleVersion)).enrollment;
    enrollAOther = (await enrol(customerA, otherVersion)).enrollment;
    enrollC = (await enrol(customerC, fixedVersion)).enrollment;
  });

  after(async () => {
    const sb = adminClient();
    await sb.from("outbox").delete().like("topic", "email.appointment%").in("payload->>recipient", ["customer", "coach"])
      .gte("created_at", new Date(Date.now() - 3 * 3600_000).toISOString());
    for (const c of [coach, coachOther]) {
      if (!c) continue;
      await sb.from("capacity_reservations").delete().eq("provider_id", c.providerId);
      await sb.from("offers").update({ status: "archived", archived_at: new Date().toISOString() }).eq("provider_id", c.providerId);
      await sb.from("providers").update({ status: "retired", active: false, published_at: null, accepting_new_clients: false }).eq("id", c.providerId);
    }
    await deleteTestUsers(users);
  });

  // -------------------------------------------------------------------------
  describe("time zones", () => {
    test("the policy is mirrored and is a development default, not an approved rule", async () => {
      const { data } = await adminClient().from("scheduling_settings").select("policy_id, policy_status, proposal_ttl_hours, reminder_offsets_minutes").single();
      const policy = currentSchedulingPolicy();
      assert.equal(data!.policy_id, policy.id);
      assert.equal(data!.policy_status, "sandbox_default");
      assert.equal(policy.status, "sandbox_default");
      // The values are adjustable on the admin page, so only their presence is asserted here.
      assert.ok(data!.proposal_ttl_hours > 0);
      assert.ok(Array.isArray(data!.reminder_offsets_minutes));
    });

    test("Kathmandu's +05:45 is honoured, and clock-change times are resolved deliberately", async () => {
      const rows = await sql<{ label: string; instant: string; adjustment: string | null }>(`
        select 'ktm' label, instant, adjustment from local_to_instant ('2026-05-01', '09:00', 'Asia/Kathmandu')
        union all select 'gap', instant, adjustment from local_to_instant ('2026-03-08', '02:30', 'America/New_York')
        union all select 'twice', instant, adjustment from local_to_instant ('2026-11-01', '01:30', 'America/New_York')
        union all select 'normal', instant, adjustment from local_to_instant ('2026-11-01', '09:00', 'America/New_York')`);
      const by = Object.fromEntries(rows.map((r) => [r.label, r]));
      assert.equal(new Date(by.ktm.instant).toISOString(), "2026-05-01T03:15:00.000Z");
      assert.equal(by.ktm.adjustment, null);
      // 02:30 does not exist that night: moved to 03:30 EDT, and labelled.
      assert.equal(new Date(by.gap.instant).toISOString(), "2026-03-08T07:30:00.000Z");
      assert.match(by.gap.adjustment!, /does not exist.*moved to 03:30/);
      // 01:30 happens twice: the FIRST (EDT, 05:30Z) is used, and labelled.
      assert.equal(new Date(by.twice.instant).toISOString(), "2026-11-01T05:30:00.000Z");
      assert.match(by.twice.adjustment!, /happens twice.*first one/);
      assert.equal(new Date(by.normal.instant).toISOString(), "2026-11-01T14:00:00.000Z");
      assert.equal(by.normal.adjustment, null);
    });

    test("an offset is never accepted as a time zone", async () => {
      const r = await propose(coach.user, { enrollment_id: enrollA, starts_at: ktm(40, 9), recurrence: "weekly", reference_timezone: "+05:45" });
      assert.ok(r.error);
    });
  });

  // -------------------------------------------------------------------------
  describe("proposals and agreement", () => {
    let t1 = "";
    let proposal1 = "";
    let appointment1 = "";

    test("a client sees only bookable times — inside the coach's hours, beyond the notice period", async () => {
      const { data, error } = await customerA.client.rpc("available_slots", { p_provider: coach.providerId, p_duration: 60, p_from: null, p_days: 4 });
      assert.equal(error, null, error?.message);
      assert.ok((data ?? []).length > 10);
      for (const row of data as { starts_at: string }[]) {
        const local = new Date(Date.parse(row.starts_at) + KTM_OFFSET_MIN * 60_000);
        const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
        assert.ok(minutes >= 6 * 60 && minutes + 60 <= 21 * 60, `slot outside the coach's hours: ${row.starts_at}`);
        assert.ok(Date.parse(row.starts_at) >= Date.now() + 12 * 3600_000 - 60_000, "slot inside the notice period");
      }
    });

    test("a client's request outside the coach's hours, or too soon, is refused", async () => {
      assert.equal(errorCode((await propose(customerA, { enrollment_id: enrollA, starts_at: ktm(3, 22) })).error), "outside_availability");
      assert.equal(errorCode((await propose(customerA, { enrollment_id: enrollA, starts_at: new Date(Date.now() + 2 * 3600_000).toISOString() })).error), "too_soon");
    });

    test("a proposal is pending, holds no time, and appears as a card in the conversation", async () => {
      t1 = ktm(3, 9);
      const r = await propose(customerA, { enrollment_id: enrollA, starts_at: t1 });
      assert.equal(r.error, null, r.error?.message);
      assert.equal(r.data.state, "pending");
      proposal1 = r.data.proposal_id;
      const { count } = await adminClient().from("appointments").select("id", { count: "exact", head: true }).eq("enrollment_id", enrollA);
      assert.equal(count, 0, "a proposal created an appointment");
      const { data: conv } = await customerA.client.from("conversations").select("id").eq("enrollment_id", enrollA).single();
      const cards = await coach.user.client.from("messages").select("kind, appointment_proposal_id").eq("conversation_id", conv!.id).eq("kind", "appointment_proposal");
      assert.ok((cards.data ?? []).some((c) => c.appointment_proposal_id === proposal1));
    });

    test("the proposer cannot accept their own proposal", async () => {
      assert.equal(errorCode((await respond(customerA, proposal1, "accept")).error), "not_your_turn");
    });

    test("a plain chat message about a time changes nothing", async () => {
      const { data: conv } = await customerA.client.from("conversations").select("id").eq("enrollment_id", enrollA).single();
      await customerA.client.rpc("send_message", { p_conversation: conv!.id, p_client_id: randomUUID(), p_body: "Can we move to Tuesday 5pm? Also I'll pay $10 extra.", p_media: null });
      const { count } = await adminClient().from("appointment_proposals").select("id", { count: "exact", head: true }).eq("enrollment_id", enrollA);
      assert.equal(count, 1);
    });

    test("acceptance creates one confirmed appointment, its notices and reminders; a repeated click changes nothing", async () => {
      const [first, second] = await Promise.all([respond(coach.user, proposal1, "accept"), respond(coach.user, proposal1, "accept")]);
      assert.equal(first.error, null, first.error?.message);
      assert.equal(second.error, null, second.error?.message);
      const ids = new Set([first.data.appointment_id, second.data.appointment_id]);
      assert.equal(ids.size, 1, "two appointments from one proposal");
      appointment1 = first.data.appointment_id;
      const a = await appt(appointment1);
      assert.equal(a.state, "booked");
      assert.equal(a.provider_timezone, "Asia/Kathmandu");
      assert.equal(a.customer_timezone, "America/New_York");
      const { data: jobs } = await adminClient().from("outbox").select("topic, payload").eq("payload->>appointment_id", appointment1);
      const topics = (jobs ?? []).map((j) => `${j.topic}:${j.payload.recipient}`).sort();
      assert.ok(topics.includes("email.appointment_confirmed:customer") && topics.includes("email.appointment_confirmed:coach"));
      assert.ok(topics.filter((t) => t.startsWith("email.appointment_reminder")).length >= 2);
      // Notices carry identifiers and a time — nothing private.
      for (const j of jobs ?? []) assert.deepEqual(Object.keys(j.payload).filter((k) => !["appointment_id", "recipient", "starts_at", "revision", "dedupe", "previous_starts_at", "by_coach", "scope", "count", "reason"].includes(k)), []);
    });

    test("history is recorded and cannot be rewritten", async () => {
      const ev = await customerA.client.from("appointment_events").select("to_state, reason").eq("appointment_id", appointment1);
      assert.ok((ev.data ?? []).some((e) => e.to_state === "booked" && e.reason === "proposal_accepted"));
      const edit = await adminClient().from("appointment_events").update({ reason: "x" }).eq("appointment_id", appointment1);
      assert.ok(edit.error);
    });

    test("a counter-proposal replaces the pending one, and a decline notifies the proposer", async () => {
      const r = await propose(coach.user, { enrollment_id: enrollA, starts_at: ktm(4, 10) });
      assert.equal(r.error, null, r.error?.message);
      const c = await propose(customerA, { counter_of: r.data.proposal_id, starts_at: ktm(4, 12) });
      assert.equal(c.error, null, c.error?.message);
      const { data: orig } = await adminClient().from("appointment_proposals").select("state").eq("id", r.data.proposal_id).single();
      assert.equal(orig!.state, "countered");
      const d = await respond(coach.user, c.data.proposal_id, "decline");
      assert.equal(d.data.state, "declined");
      const { count } = await adminClient().from("outbox").select("id", { count: "exact", head: true })
        .eq("topic", "email.appointment_proposal_update").eq("payload->>proposal_id", c.data.proposal_id);
      assert.equal(count, 1);
    });

    test("an unanswered proposal expires, holding nothing, and answering it afterwards is harmless", async () => {
      const r = await propose(customerA, { enrollment_id: enrollA, starts_at: ktm(5, 9) });
      await sql(`update appointment_proposals set expires_at = now() - interval '1 minute' where id = ${lit(r.data.proposal_id)}`);
      const late = await respond(coach.user, r.data.proposal_id, "accept");
      assert.equal(late.data.state, "expired");
      const r2 = await propose(customerA, { enrollment_id: enrollA, starts_at: ktm(5, 11) });
      await sql(`update appointment_proposals set expires_at = now() - interval '1 minute' where id = ${lit(r2.data.proposal_id)}`);
      await reconcile();
      const { data } = await adminClient().from("appointment_proposals").select("state").eq("id", r2.data.proposal_id).single();
      assert.equal(data!.state, "expired");
    });

    // -----------------------------------------------------------------------
    test("full-interval and buffer conflicts are refused for the coach", async () => {
      // Another client, 20 minutes into the first meeting.
      assert.equal(errorCode((await propose(customerB, { enrollment_id: enrollB, starts_at: plusMin(t1, 20) })).error), "coach_busy");
      // Five minutes after it ends — inside the coach's 10-minute buffer.
      assert.equal(errorCode((await propose(customerB, { enrollment_id: enrollB, starts_at: plusMin(t1, 65) })).error), "coach_busy");
      // Twenty minutes after it ends — clear.
      const ok = await propose(customerB, { enrollment_id: enrollB, starts_at: plusMin(t1, 80) });
      assert.equal(ok.error, null, ok.error?.message);
      await respond(customerB, ok.data.proposal_id, "withdraw");
    });

    test("and for the client, across coaches", async () => {
      const r = await propose(coachOther.user, { enrollment_id: enrollAOther, starts_at: plusMin(t1, 30) });
      assert.equal(errorCode(r.error), "client_busy");
    });

    test("simultaneous acceptances of overlapping times: one winner, one clear recovery state", async () => {
      const t = ktm(6, 9);
      const pa = await propose(customerA, { enrollment_id: enrollA, starts_at: t });
      const pb = await propose(customerB, { enrollment_id: enrollB, starts_at: plusMin(t, 30) });
      assert.equal(pa.error, null, pa.error?.message);
      assert.equal(pb.error, null, pb.error?.message);
      const [ra, rb] = await Promise.all([respond(coach.user, pa.data.proposal_id, "accept"), respond(coach.user, pb.data.proposal_id, "accept")]);
      const states = [ra.data.state, rb.data.state].sort();
      assert.deepEqual(states, ["accepted", "conflicted"]);
      const loser = ra.data.state === "conflicted" ? pa : pb;
      const { data } = await adminClient().from("appointment_proposals").select("state_reason").eq("id", loser.data.proposal_id).single();
      assert.ok(data!.state_reason, "the losing request has no explanation");
    });

    test("the same, for one client accepting two coaches at once", async () => {
      const t = ktm(7, 9);
      const p1 = await propose(coach.user, { enrollment_id: enrollA, starts_at: t });
      const p2 = await propose(coachOther.user, { enrollment_id: enrollAOther, starts_at: plusMin(t, 15) });
      const [r1, r2] = await Promise.all([respond(customerA, p1.data.proposal_id, "accept"), respond(customerA, p2.data.proposal_id, "accept")]);
      assert.deepEqual([r1.data.state, r2.data.state].sort(), ["accepted", "conflicted"]);
    });

    test("rescheduling keeps the original until the new time is accepted, and drops the old reminders", async () => {
      const r = await propose(customerA, { replaces_appointment_id: appointment1, starts_at: ktm(8, 14) });
      assert.equal(r.error, null, r.error?.message);
      assert.equal((await appt(appointment1)).state, "booked", "the original moved before anyone agreed");
      const acc = await respond(coach.user, r.data.proposal_id, "accept");
      assert.equal(acc.data.state, "accepted");
      const old = await appt(appointment1);
      assert.equal(old.state, "replaced");
      assert.equal(old.replaced_by, acc.data.appointment_id);
      const { data: jobs } = await adminClient().from("outbox").select("state").eq("topic", "email.appointment_reminder").eq("payload->>appointment_id", appointment1);
      assert.ok((jobs ?? []).length > 0 && (jobs ?? []).every((j) => j.state === "cancelled"), "a reminder for the old time is still due");
      const { count } = await adminClient().from("appointments").select("id", { count: "exact", head: true }).eq("enrollment_id", enrollA).eq("state", "booked").eq("starts_at", new Date(ktm(8, 14)).toISOString());
      assert.equal(count, 1, "duplicate confirmed occurrences");
      appointment1 = acc.data.appointment_id;
    });

    test("editing availability never removes a booked meeting; it is listed as a conflict", async () => {
      const local = new Date(Date.parse(ktm(8, 14)) + KTM_OFFSET_MIN * 60_000);
      const weekday = local.getUTCDay();
      const { error } = await coach.user.client.from("availability_windows").delete().eq("provider_id", coach.providerId).eq("weekday", weekday);
      assert.equal(error, null, error?.message);
      assert.equal((await appt(appointment1)).state, "booked");
      const { data } = await coach.user.client.rpc("my_schedule_conflicts");
      assert.ok((data as { appointment_id: string }[]).some((c) => c.appointment_id === appointment1));
      await coach.user.client.from("availability_windows").insert({ provider_id: coach.providerId, weekday, start_time: "06:00", end_time: "21:00" });
    });

    test("cancelling notifies, stops reminders, and is safe to repeat; an outcome can't be recorded in advance", async () => {
      assert.equal(errorCode((await coach.user.client.rpc("record_appointment_outcome", { p_appointment: appointment1, p_outcome: "attended" })).error), "not_yet");
      const c1 = await customerA.client.rpc("cancel_appointment", { p_appointment: appointment1, p_scope: "this", p_reason: null });
      const c2 = await customerA.client.rpc("cancel_appointment", { p_appointment: appointment1, p_scope: "this", p_reason: null });
      assert.equal(c1.data.state, "cancelled");
      assert.equal(c2.data.repeated, true);
      const { data: jobs } = await adminClient().from("outbox").select("topic, state").eq("payload->>appointment_id", appointment1);
      assert.ok((jobs ?? []).some((j) => j.topic === "email.appointment_cancelled"));
      assert.ok((jobs ?? []).filter((j) => j.topic === "email.appointment_reminder").every((j) => j.state === "cancelled"));
    });
  });

  // -------------------------------------------------------------------------
  describe("weekly series", () => {
    let series = "";
    const occ: { id: string; starts_at: string; state: string; occurrence_key: string | null; time_note: string | null }[] = [];

    test("a weekly series keeps its local time in its reference zone across a clock change, confirmed within the paid period and tentative after", async () => {
      // Tuesdays 18:00 New York, starting the week before the clock change.
      const r = await propose(coach.user, {
        enrollment_id: enrollB, starts_at: "2026-10-20T22:00:00.000Z", recurrence: "weekly", reference_timezone: "America/New_York", duration_minutes: 45,
      });
      assert.equal(r.error, null, r.error?.message);
      const acc = await respond(customerB, r.data.proposal_id, "accept");
      assert.equal(acc.error, null, acc.error?.message);
      series = acc.data.series_id;
      const { data } = await adminClient().from("appointments").select("id, starts_at, state, occurrence_key, time_note").eq("series_id", series).order("starts_at");
      occ.push(...(data ?? []));
      assert.ok(occ.length >= 4, `expected several occurrences, got ${occ.length}`);
      for (const o of occ) {
        const local = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).format(new Date(o.starts_at));
        assert.equal(local, "Tue 18:00", `occurrence at ${o.starts_at} is ${local} in New York`);
      }
      // Before the change 22:00Z, after it 23:00Z.
      assert.ok(occ.some((o) => new Date(o.starts_at).toISOString().endsWith("22:00:00.000Z")));
      assert.ok(occ.some((o) => new Date(o.starts_at).toISOString().endsWith("23:00:00.000Z")));
      const { data: pu } = await adminClient().from("purchases").select("paid_through_at").eq("customer_id", customerB.id).eq("provider_id", coach.providerId).single();
      for (const o of occ) {
        assert.equal(o.state, Date.parse(o.starts_at) < Date.parse(pu!.paid_through_at) ? "booked" : "tentative", `occurrence ${o.starts_at}`);
      }
      assert.ok(occ.some((o) => o.state === "tentative"), "no occurrence beyond the paid period to show as tentative");
    });

    test("travelling or changing a display time zone moves nothing", async () => {
      await adminClient().from("profiles").update({ timezone: "Europe/Paris" }).eq("id", customerB.id);
      await reconcile();
      const { data } = await adminClient().from("appointments").select("id, starts_at").eq("series_id", series).order("starts_at");
      for (const o of occ) assert.equal(new Date(data!.find((d) => d.id === o.id)!.starts_at).toISOString(), new Date(o.starts_at).toISOString());
      await adminClient().from("profiles").update({ timezone: "Australia/Sydney" }).eq("id", customerB.id);
    });

    test("moving one occurrence changes only that one, and it is not recreated", async () => {
      const second = occ[1];
      const r = await propose(customerB, { replaces_appointment_id: second.id, series_scope: "this", starts_at: plusMin(second.starts_at, 60), duration_minutes: 45 });
      // Client requests must fit the coach's Kathmandu hours; this one may not.
      const target = r.error ? await propose(coach.user, { replaces_appointment_id: second.id, series_scope: "this", starts_at: plusMin(second.starts_at, 60), duration_minutes: 45 }) : r;
      assert.equal(target.error, null, target.error?.message);
      const acc = await respond(target === r ? coach.user : customerB, target.data.proposal_id, "accept");
      assert.equal(acc.data.state, "accepted", JSON.stringify(acc.data));
      assert.equal((await appt(second.id)).state, "replaced");
      assert.equal((await appt(occ[2].id)).state, occ[2].state, "a later occurrence changed");
      await reconcile();
      const { count } = await adminClient().from("appointments").select("id", { count: "exact", head: true }).eq("occurrence_key", second.occurrence_key!);
      assert.equal(count, 1, "the moved occurrence was regenerated");
    });

    test("changing this and future occurrences ends the old series and starts a new one; earlier ones are kept", async () => {
      const third = occ[2];
      const r = await propose(coach.user, { replaces_appointment_id: third.id, series_scope: "future", starts_at: plusMin(third.starts_at, 30), duration_minutes: 45 });
      assert.equal(r.error, null, r.error?.message);
      const acc = await respond(customerB, r.data.proposal_id, "accept");
      assert.equal(acc.data.state, "accepted", JSON.stringify(acc.data));
      const { data: old } = await adminClient().from("appointment_series").select("state").eq("id", series).single();
      assert.equal(old!.state, "ended");
      assert.equal((await appt(occ[0].id)).state, occ[0].state, "an earlier occurrence changed");
      for (const o of occ.slice(3)) assert.equal((await appt(o.id)).state, "replaced");
      const { data: fresh } = await adminClient().from("appointment_series").select("id, local_start, previous_series_id").eq("previous_series_id", series).single();
      assert.equal(fresh!.local_start, "18:30:00");
    });
  });

  // -------------------------------------------------------------------------
  describe("eligibility and reconciliation", () => {
    let booked = "";
    test("a paused relationship can't arrange meetings, and its booked ones go on hold with a notice — then come back", async () => {
      const r = await propose(coach.user, { enrollment_id: enrollA, starts_at: ktm(9, 9) });
      booked = (await respond(customerA, r.data.proposal_id, "accept")).data.appointment_id;
      await adminClient().from("enrollments").update({ state: "paused" }).eq("id", enrollA);
      assert.equal(errorCode((await propose(customerA, { enrollment_id: enrollA, starts_at: ktm(10, 9) })).error), "relationship_paused");
      await reconcile();
      const held = await appt(booked);
      assert.equal(held.state, "on_hold");
      assert.equal(held.state_reason, "payment_paused");
      const { count } = await adminClient().from("outbox").select("id", { count: "exact", head: true }).eq("topic", "email.appointment_on_hold").eq("payload->>appointment_id", booked);
      assert.ok((count ?? 0) >= 2);
      await adminClient().from("enrollments").update({ state: "active" }).eq("id", enrollA);
      await reconcile();
      assert.equal((await appt(booked)).state, "booked", "payment recovery did not restore the meeting");
    });

    test("suspension puts meetings on hold", async () => {
      await adminClient().from("profiles").update({ suspended_at: new Date().toISOString() }).eq("id", customerA.id);
      await reconcile();
      assert.equal((await appt(booked)).state_reason, "suspended");
      await adminClient().from("profiles").update({ suspended_at: null }).eq("id", customerA.id);
      await reconcile();
      assert.equal((await appt(booked)).state, "booked");
    });

    test("a cancelled plan cancels meetings after its paid period, with a notice", async () => {
      const { data: pu } = await adminClient().from("purchases").select("paid_through_at").eq("id", purchaseA).single();
      const after = new Date(Date.parse(pu!.paid_through_at) + 2 * 86_400_000);
      const r = await propose(coach.user, { enrollment_id: enrollA, starts_at: new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), 4, 0)).toISOString() });
      const acc = await respond(customerA, r.data.proposal_id, "accept");
      assert.equal(acc.data.appointment_state, "tentative", "a meeting after the paid period was confirmed");
      await adminClient().from("purchases").update({ state: "cancelling" }).eq("id", purchaseA);
      await reconcile();
      const a = await appt(acc.data.appointment_id);
      assert.equal(a.state, "cancelled");
      assert.equal(a.state_reason, "relationship_ended");
      assert.equal((await appt(booked)).state, "booked", "a meeting inside the paid period was touched");
      await adminClient().from("purchases").update({ state: "active" }).eq("id", purchaseA);
    });

    test("a plan with a fixed number of calls can't use a call twice; flexible plans have no quota", async () => {
      const r1 = await propose(coach.user, { enrollment_id: enrollC, starts_at: ktm(11, 9) });
      const a1 = await respond(customerC, r1.data.proposal_id, "accept");
      assert.equal(a1.data.state, "accepted", JSON.stringify(a1.data));
      const r2 = await propose(coach.user, { enrollment_id: enrollC, starts_at: ktm(12, 9) });
      const a2 = await respond(customerC, r2.data.proposal_id, "accept");
      assert.equal(a2.data.state, "conflicted");
      assert.equal(a2.data.reason, "allowance_used");
      // Flexible: several meetings in the same period.
      for (const d of [13, 14, 15]) {
        const p = await propose(coach.user, { enrollment_id: enrollB, starts_at: ktm(d, 7) });
        assert.equal((await respond(customerB, p.data.proposal_id, "accept")).data.state, "accepted");
      }
      // Cancelling the used call frees it.
      await customerC.client.rpc("cancel_appointment", { p_appointment: a1.data.appointment_id, p_scope: "this", p_reason: null });
      const r3 = await propose(coach.user, { enrollment_id: enrollC, starts_at: ktm(12, 11) });
      assert.equal((await respond(customerC, r3.data.proposal_id, "accept")).data.state, "accepted");
    });

    test("a coach change cancels meetings with the previous coach, with a notice", async () => {
      const { data: future } = await adminClient().from("appointments").select("id").eq("enrollment_id", enrollC).eq("state", "booked");
      assert.ok((future ?? []).length >= 1);
      await adminClient().from("enrollment_assignments").update({ effective_to: new Date().toISOString() }).eq("enrollment_id", enrollC).is("effective_to", null);
      for (const f of future ?? []) {
        const a = await appt(f.id);
        assert.equal(a.state, "cancelled");
        assert.equal(a.state_reason, "coach_changed");
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("one-off consultations", () => {
    let slot = "";
    let consultPurchase = "";
    test("a consultation can't be bought without a chosen time, and two buyers can't hold the same one", async () => {
      assert.equal(errorCode((await checkout(buyer1, consultVersion)).error), "slot_required");
      slot = ktm(16, 10);
      const one = await checkout(buyer1, consultVersion, { slot_starts_at: slot });
      assert.equal(one.error, null, one.error?.message);
      const held = await appt(one.data.appointment_id);
      assert.equal(held.state, "held");
      assert.equal(held.kind, "consultation");
      const two = await checkout(buyer2, consultVersion, { slot_starts_at: plusMin(slot, 15) });
      assert.equal(errorCode(two.error), "slot_taken");
      consultPurchase = one.data.purchase_id;
      const paid = await pay(one.data.purchase_id, "one_off_consultation");
      assert.equal(paid.error, null, paid.error?.message);
      assert.equal((await appt(one.data.appointment_id)).state, "booked");
    });

    test("an abandoned checkout releases its slot with a notice", async () => {
      const t = ktm(17, 10);
      const co = await checkout(buyer2, consultVersion, { slot_starts_at: t });
      assert.equal(co.error, null, co.error?.message);
      await adminClient().rpc("close_checkout_attempt", { p_attempt_id: co.data.attempt_id, p_state: "expired", p_reason: "test" });
      assert.equal((await appt(co.data.appointment_id)).state, "expired");
      const { count } = await adminClient().from("outbox").select("id", { count: "exact", head: true }).eq("dedupe_key", `reservation_expired:${co.data.appointment_id}`);
      assert.equal(count, 1);
      // Late payment for it: flagged for a person to rebook or refund; nothing oversold.
      await pay(co.data.purchase_id, "one_off_consultation");
      const { data: pu } = await adminClient().from("purchases").select("requires_review, review_reason").eq("id", co.data.purchase_id).single();
      assert.equal(pu!.requires_review, true);
      assert.equal(pu!.review_reason, "consultation_slot_expired");
      assert.equal((await appt(co.data.appointment_id)).state, "expired", "the lapsed slot was silently re-taken");
      const { count: ex } = await adminClient().from("reconciliation_exceptions").select("id", { count: "exact", head: true }).eq("purchase_id", co.data.purchase_id).eq("kind", "consultation_slot_expired");
      assert.equal(ex, 1);
      // An administrator reopens it; the client can then choose a new time.
      const reopen = await admin.client.rpc("admin_resolve_consultation", { p_purchase: co.data.purchase_id, p_action: "reopen_for_rebooking", p_note: "test rebooking" });
      assert.equal(reopen.error, null, reopen.error?.message);
      const again = await propose(buyer2, { kind: "consultation", purchase_id: co.data.purchase_id, starts_at: ktm(18, 10), duration_minutes: 30 });
      assert.equal(again.error, null, again.error?.message);
      assert.equal((await respond(coach.user, again.data.proposal_id, "accept")).data.state, "accepted");
    });

    test("a consultation is used once", async () => {
      const extra = await propose(coach.user, { kind: "consultation", purchase_id: consultPurchase, starts_at: ktm(19, 10), duration_minutes: 30 });
      assert.equal(errorCode(extra.error), "consultation_already_booked");
    });
  });

  // -------------------------------------------------------------------------
  describe("outsiders", () => {
    test("nobody else can read, propose on, answer or cancel", async () => {
      assert.ok(wasDenied(await outsider.client.from("appointments").select("id").eq("enrollment_id", enrollA)));
      assert.ok(wasDenied(await outsider.client.from("appointment_proposals").select("id").eq("enrollment_id", enrollA)));
      assert.ok(wasDenied(await outsider.client.from("appointment_series").select("id").eq("enrollment_id", enrollB)));
      assert.ok(wasDenied(await coachOther.user.client.from("appointments").select("id").eq("enrollment_id", enrollA)));
      assert.equal(errorCode((await propose(outsider, { enrollment_id: enrollA, starts_at: ktm(20, 9) })).error), "not_found");
      const p = await propose(coach.user, { enrollment_id: enrollA, starts_at: ktm(20, 9) });
      assert.equal(errorCode((await respond(outsider, p.data.proposal_id, "accept")).error), "not_found");
      const { data: any } = await adminClient().from("appointments").select("id").eq("enrollment_id", enrollA).eq("state", "booked").limit(1).single();
      assert.equal(errorCode((await outsider.client.rpc("cancel_appointment", { p_appointment: any!.id, p_scope: "this", p_reason: null })).error), "not_found");
      const direct = await customerA.client.from("appointments").update({ state: "cancelled" }).eq("id", any!.id).select("id");
      assert.ok(wasDenied(direct), "a client wrote an appointment directly");
      assert.ok(wasDenied(await outsider.client.from("availability_windows").insert({ provider_id: coach.providerId, weekday: 1, start_time: "01:00", end_time: "02:00" }).select("id")));
    });
  });
});
