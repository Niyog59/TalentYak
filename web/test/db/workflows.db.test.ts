/**
 * Workflow tests against the real database.
 *
 * Where access-matrix.db.test.ts proves what people CANNOT do, this file proves
 * the legitimate workflows work — and that each one refuses exactly the cases
 * the founder's rules say it must. Every "may" and "may not" runs through a
 * real signed-in session. The service role is used only to play the part of
 * our own server (checkout creation, webhook effects, the worker), which is
 * the role it plays in production.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  RUN_ID,
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
  projectRef,
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
import {
  entriesForCycleEarning,
  entriesForDisputeLost,
  entriesForDisputeOpened,
  entriesForDisputeWon,
  entriesForRefund,
} from "@/lib/ledger/effects";
import { currentPolicySnapshot, getPolicy } from "@/lib/policy/registry";
import { prepareBatch } from "@/lib/payouts/batching";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;

const USD = "USD";
const V3 = "commission.coaching.v3";

let admin: TestUser;
let adminNoMfa: TestUser;
let customerA: TestUser;
let customerB: TestUser;
let customerC: TestUser;
let coach: CoachFixture;
let coachOther: CoachFixture;
let coachOnboarding: CoachFixture;
const users: string[] = [];
const coaches: CoachFixture[] = [];

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

async function publish(c: CoachFixture, versionId: string) {
  return c.user.client.rpc("publish_offer_version", { p_version_id: versionId });
}

async function checkout(customer: TestUser, versionId: string, key = randomUUID(), currency = USD, slotStartsAt?: string) {
  // What the checkout page displays: the coach's and TalentYak's live
  // expectations versions (Batch 3). Without them the database refuses.
  const { data: v } = await adminClient().from("offer_versions").select("offers(provider_id)").eq("id", versionId).maybeSingle();
  const offer = (Array.isArray(v?.offers) ? v?.offers[0] : v?.offers) as { provider_id: string } | undefined;
  const shown = offer ? await liveExpectationIds(offer.provider_id) : { coach: null, platform: null };
  return adminClient().rpc("create_checkout_records", {
    p: {
      customer_id: customer.id, offer_version_id: versionId, currency, idempotency_key: key, hold_seconds: 1800,
      expectations_coach_version_id: shown.coach, expectations_platform_version_id: shown.platform,
      // Batch 4: a one-off session states its length and has its time chosen first.
      slot_starts_at: slotStartsAt ?? null,
    },
  });
}

/**
 * A published one-off session from coachOther, bought by `customer` at the
 * first free time (Batch 4: a one-off states its length and has its time
 * chosen before payment). coachOther's hours are set in "refunds and disputes".
 */
async function oneOffCheckout(customer: TestUser) {
  const offer = await makeDraftOffer(coachOther, { serviceType: "one_off_consultation" });
  await adminClient().from("offer_versions").update({ call_duration_minutes: 30 }).eq("id", offer.versionId);
  await publish(coachOther, offer.versionId);
  const { data: slots } = await customer.client.rpc("available_slots", { p_provider: coachOther.providerId, p_duration: 30, p_from: null, p_days: 7 });
  return checkout(customer, offer.versionId, randomUUID(), USD, (slots as { starts_at: string }[])[0].starts_at);
}

async function pay(
  purchaseId: string,
  opts: { sourceKey: string; amount?: number; periodStart?: string; periodEnd?: string; serviceType?: "recurring_coaching" | "one_off_consultation" },
) {
  const { data: pu } = await adminClient()
    .from("purchases").select("provider_id, customer_id, commission_policy_id, charge_amount_minor").eq("id", purchaseId).single();
  const amount = opts.amount ?? pu!.charge_amount_minor;
  const entries = entriesForCycleEarning({
    billingCycleId: opts.sourceKey,
    purchaseId,
    providerId: pu!.provider_id,
    customerId: pu!.customer_id,
    serviceAmount: money(amount, USD),
    serviceType: opts.serviceType ?? "recurring_coaching",
    commissionPolicyId: pu!.commission_policy_id,
    delivered: false,
  });
  return adminClient().rpc("record_cycle_payment", {
    p: {
      purchase_id: purchaseId,
      cycle: {
        source_key: opts.sourceKey,
        period_start: opts.periodStart ?? new Date().toISOString(),
        period_end: opts.periodEnd ?? days(30),
        currency: USD,
        amount_minor: amount,
        stripe_payment_intent_id: `pi_test_${opts.sourceKey}`,
      },
      entries,
    },
  });
}

async function ledgerFor(purchaseId: string) {
  return sql<{ account: string; effect: string; amount_minor: number; provider_id: string; state: string | null }>(`
    select le.account, le.effect, le.amount_minor::int, le.provider_id, es.state
    from ledger_entries le left join earning_states es on es.ledger_entry_id = le.id
    where le.purchase_id = ${lit(purchaseId)} order by le.created_at`);
}

describe("workflows", { skip }, () => {
  before(async () => {
    console.log(`\n  Workflow tests against project ${projectRef()} (run ${RUN_ID})\n`);

    admin = await createTestUser("wf-admin");
    adminNoMfa = await createTestUser("wf-admin-nomfa");
    customerA = await createTestUser("wf-cust-a");
    customerB = await createTestUser("wf-cust-b");
    customerC = await createTestUser("wf-cust-c");
    users.push(admin.id, adminNoMfa.id, customerA.id, customerB.id, customerC.id);

    await setRole(admin.id, "admin");
    await setRole(adminNoMfa.id, "admin");
    await upgradeToAal2(admin);

    coach = await makeCoach("wf-coach", { max: 2 });
    coachOther = await makeCoach("wf-other", { max: 5 });
    coachOnboarding = await makeCoach("wf-onboarding", { status: "onboarding", published: false, accepting: false });
    for (const c of [coach, coachOther, coachOnboarding]) {
      coaches.push(c);
      users.push(c.user.id);
    }

    // Batch 3: nothing is sellable until both parts of the welcome document are live.
    await ensurePlatformExpectations();
    await publishCoachExpectations(coach);
    await publishCoachExpectations(coachOther);
  });

  after(async () => {
    const sb = adminClient();
    for (const c of coaches) {
      await sb.from("capacity_reservations").delete().eq("provider_id", c.providerId);
      await sb.from("offers").update({ status: "archived", archived_at: new Date().toISOString() }).eq("provider_id", c.providerId);
      await sb.from("providers").update({ status: "retired", active: false, published_at: null, accepting_new_clients: false }).eq("id", c.providerId);
      await sb.from("provider_public_profiles").delete().eq("provider_id", c.providerId);
    }
    await deleteTestUsers(users);
  });

  // =========================================================================
  describe("policy set parity", () => {
    test("the database publishes under the same policy ids as the code", async () => {
      const [row] = await sql<Record<string, string | string[]>>(`select * from current_policy_set`);
      const snap = currentPolicySnapshot();
      assert.equal(row.commission_policy_id, snap.commissionPolicyId);
      assert.equal(row.cancellation_policy_id, snap.cancellationPolicyId);
      assert.equal(row.payment_failure_policy_id, snap.paymentFailurePolicyId);
      assert.equal(row.recognition_policy_id, snap.recognitionPolicyId);
      assert.equal(row.billing_terms_policy_id, snap.billingTermsPolicyId);
    });

    test("publishable billing structures match the billing-terms policy", async () => {
      const [row] = await sql<{ publishable_billing_structures: string[] }>(`select publishable_billing_structures from current_policy_set`);
      const terms = getPolicy(currentPolicySnapshot().billingTermsPolicyId);
      assert.equal(terms.kind, "billing_terms");
      if (terms.kind !== "billing_terms") return;
      const set = new Set(row.publishable_billing_structures);
      assert.equal(set.has("prepaid_term"), terms.prepaidTermEnabled);
      assert.equal(set.has("monthly_recurring"), terms.monthlyRecurringEnabled);
      assert.equal(set.has("monthly_under_commitment"), terms.monthlyUnderCommitmentEnabled);
    });
  });

  // =========================================================================
  describe("admin reach requires MFA", () => {
    test("an admin who has not completed MFA reads no private data", async () => {
      await adminClient().from("provider_private").upsert({ provider_id: coach.providerId, vetting_notes: "fixture note" });
      const noMfa = await adminNoMfa.client.from("provider_private").select("vetting_notes").eq("provider_id", coach.providerId);
      assert.ok(wasDenied(noMfa), "aal1 admin must have no admin reach");
      const withMfa = await admin.client.from("provider_private").select("vetting_notes").eq("provider_id", coach.providerId);
      assert.equal(withMfa.data?.length, 1, "aal2 admin does");
    });

    test("an admin without MFA cannot run admin actions", async () => {
      const { error } = await adminNoMfa.client.rpc("admin_set_provider_status", {
        p_provider_id: coachOnboarding.providerId, p_action: "start_review", p_reason: null,
      });
      assert.equal(errorCode(error), "admin_mfa_required");
    });
  });

  // =========================================================================
  describe("coach publication — the agreed rules", () => {
    test("an unapproved coach cannot publish an offer", async () => {
      const offer = await makeDraftOffer(coachOnboarding);
      const { error } = await publish(coachOnboarding, offer.versionId);
      assert.equal(errorCode(error), "provider_not_approved");
    });

    test("an approved coach cannot mark an offer published by writing the table directly", async () => {
      const offer = await makeDraftOffer(coach);
      const { error } = await coach.user.client.from("offers").update({ status: "published" }).eq("id", offer.offerId);
      assert.equal(errorCode(error), "publish_through_action");
      const { error: vErr } = await coach.user.client
        .from("offer_versions").update({ published_at: new Date().toISOString() }).eq("id", offer.versionId);
      assert.equal(errorCode(vErr), "publish_through_action");
    });

    test("the action check is a real false when unset, never NULL (regression: 0023)", async () => {
      const [row] = await sql<{ v: boolean | null }>(`select in_action('offer_publication') as v`);
      assert.strictEqual(row.v, false, "NULL here silently disabled every guard");
    });

    test("direct manipulation is refused on every attempt, across fresh sessions (regression: 0023)", async () => {
      // The bug was intermittent, depending on which pooled connection served
      // the request. Repeat through fresh sign-ins to cover many connections.
      const { createClient } = await import("@supabase/supabase-js");
      for (let i = 0; i < 8; i++) {
        const fresh = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        await fresh.auth.signInWithPassword({ email: coach.user.email, password: coach.user.password });

        const offer = await makeDraftOffer({ ...coach, user: { ...coach.user, client: fresh } });
        const direct = await fresh.from("offers").update({ status: "published" }).eq("id", offer.offerId);
        assert.equal(errorCode(direct.error), "publish_through_action", `attempt ${i}: offer`);

        await fresh.from("providers").update({
          status: "approved", max_active_clients: 999, capacity_ceiling: null, accepting_new_clients: true,
        }).eq("id", coachOnboarding.providerId);
        await coachOnboarding.user.client.from("providers").update({
          status: "approved", approved_at: new Date().toISOString(), max_active_clients: 999,
        }).eq("id", coachOnboarding.providerId);

        const [p] = await sql<{ status: string; max_active_clients: number | null; approved_at: string | null }>(
          `select status, max_active_clients, approved_at from providers where id = ${lit(coachOnboarding.providerId)}`);
        assert.notEqual(p.max_active_clients, 999, `attempt ${i}: capacity`);
        assert.equal(p.approved_at, null, `attempt ${i}: self-approval`);
        assert.notEqual(p.status, "approved", `attempt ${i}: status`);
      }
    });

    test("an approved coach publishes their own offer with no founder approval", async () => {
      const offer = await makeDraftOffer(coach, { priceMinor: 12_345 });
      const { data, error } = await publish(coach, offer.versionId);
      assert.equal(error, null, error?.message);
      assert.equal(data, offer.versionId);

      const [v] = await sql<{ published_at: string; commission_policy_id: string }>(
        `select published_at, commission_policy_id from offer_versions where id = ${lit(offer.versionId)}`);
      assert.ok(v.published_at);
      assert.equal(v.commission_policy_id, V3, "the coach-supplied policy id is replaced by the current one");

      const pub = await anonymousClient().from("offer_prices").select("amount_minor").eq("offer_version_id", offer.versionId);
      assert.equal(pub.data?.[0]?.amount_minor, 12_345, "the coach's own price is what the public sees — no floor, ceiling or adjustment");
    });

    test("publishing needs a price", async () => {
      const offer = await makeDraftOffer(coach, { priceMinor: 0 });
      const { error } = await publish(coach, offer.versionId);
      assert.equal(errorCode(error), "offer_version_has_no_price");
    });

    test("a prepaid package cannot be published while its refund rules are undecided", async () => {
      const offer = await makeDraftOffer(coach, { billing: "prepaid_term", termMonths: 6 });
      const { error } = await publish(coach, offer.versionId);
      assert.equal(errorCode(error), "billing_structure_not_publishable");
    });

    test("another coach cannot publish it", async () => {
      const offer = await makeDraftOffer(coach);
      const { error } = await publish(coachOther, offer.versionId);
      assert.equal(errorCode(error), "not_owner");
    });

    test("a new version supersedes the old, and the old one's terms stay frozen", async () => {
      const offer = await makeDraftOffer(coach, { priceMinor: 10_000 });
      await publish(coach, offer.versionId);

      const { data: v2 } = await coach.user.client.from("offer_versions").insert({
        offer_id: offer.offerId, version: 2, title: "Fixture plan v2", service_type: "recurring_coaching",
        billing_structure: "monthly_recurring", billing_interval: "month", billing_interval_count: 1,
        commission_policy_id: V3, cancellation_policy_id: "cancellation.v1", payment_failure_policy_id: "payment_failure.v1",
        recognition_policy_id: "recognition.v1", billing_terms_policy_id: "billing_terms.v1",
      }).select("id").single();
      await coach.user.client.from("offer_prices").insert({ offer_version_id: v2!.id, currency: USD, amount_minor: 15_000 });
      const { error } = await publish(coach, v2!.id);
      assert.equal(error, null, error?.message);

      const rows = await sql<{ id: string; superseded_at: string | null }>(
        `select id, superseded_at from offer_versions where offer_id = ${lit(offer.offerId)} order by version`);
      assert.ok(rows[0].superseded_at, "v1 superseded");
      assert.equal(rows[1].superseded_at, null, "v2 live");

      const { error: editErr } = await coach.user.client.from("offer_prices")
        .update({ amount_minor: 1 }).eq("offer_version_id", offer.versionId);
      assert.ok(editErr, "v1's price can never be edited");
    });

    test("a suspended coach cannot publish", async () => {
      const temp = await makeCoach("wf-tosuspend");
      coaches.push(temp); users.push(temp.user.id);
      const offer = await makeDraftOffer(temp);
      const s = await admin.client.rpc("admin_set_provider_status", {
        p_provider_id: temp.providerId, p_action: "suspend", p_reason: "test suspension",
      });
      assert.equal(s.error, null, s.error?.message);
      const { error } = await publish(temp, offer.versionId);
      assert.ok(error, "suspended coach refused");
    });
  });

  // =========================================================================
  describe("capacity — validated coach action", () => {
    test("an approved coach can change their own capacity and availability", async () => {
      const { data, error } = await coach.user.client.rpc("set_my_capacity", { p_max_active_clients: 3, p_accepting_new_clients: true });
      assert.equal(error, null, error?.message);
      assert.equal(data.max_active_clients, 3);
      const { data: row } = await adminClient().from("providers").select("max_active_clients").eq("id", coach.providerId).single();
      assert.equal(row!.max_active_clients, 3);
    });

    test("an unapproved coach cannot open for new clients", async () => {
      const { error } = await coachOnboarding.user.client.rpc("set_my_capacity", { p_max_active_clients: 3, p_accepting_new_clients: true });
      assert.equal(errorCode(error), "not_approved");
    });

    test("capacity cannot drop below existing commitments", async () => {
      const offer = await makeDraftOffer(coachOther);
      await publish(coachOther, offer.versionId);
      const r1 = await checkout(customerA, offer.versionId);
      const r2 = await checkout(customerB, offer.versionId);
      assert.equal(r1.error, null, r1.error?.message);
      assert.equal(r2.error, null, r2.error?.message);

      const { error } = await coachOther.user.client.rpc("set_my_capacity", { p_max_active_clients: 1, p_accepting_new_clients: true });
      assert.equal(errorCode(error), "capacity_below_commitments");

      for (const r of [r1, r2]) {
        await adminClient().rpc("close_checkout_attempt", { p_attempt_id: r.data.attempt_id, p_state: "abandoned", p_reason: "test" });
      }
    });

    test("an admin restriction caps what the coach can set", async () => {
      const c = await admin.client.rpc("admin_set_capacity_ceiling", {
        p_provider_id: coachOther.providerId, p_ceiling: 4, p_reason: "new coach",
      });
      assert.equal(c.error, null, c.error?.message);
      const { error } = await coachOther.user.client.rpc("set_my_capacity", { p_max_active_clients: 10, p_accepting_new_clients: true });
      assert.equal(errorCode(error), "capacity_above_restriction");
      const ok = await coachOther.user.client.rpc("set_my_capacity", { p_max_active_clients: 4, p_accepting_new_clients: true });
      assert.equal(ok.error, null);
      await admin.client.rpc("admin_set_capacity_ceiling", { p_provider_id: coachOther.providerId, p_ceiling: null, p_reason: null });
    });

    test("a coach cannot lift their own restriction", async () => {
      const { error } = await coachOther.user.client.rpc("admin_set_capacity_ceiling", {
        p_provider_id: coachOther.providerId, p_ceiling: null, p_reason: null,
      });
      assert.equal(errorCode(error), "admin_mfa_required");
    });
  });

  // =========================================================================
  describe("profile review and publication", () => {
    test("a coach submits for review, cannot approve themselves, and publishes once approved", async () => {
      const sub = await coachOnboarding.user.client.rpc("submit_my_profile_for_review");
      assert.equal(sub.error, null, sub.error?.message);
      assert.equal(sub.data, "submitted");

      const self = await coachOnboarding.user.client.rpc("admin_set_provider_status", {
        p_provider_id: coachOnboarding.providerId, p_action: "approve", p_reason: null,
      });
      assert.equal(errorCode(self.error), "admin_mfa_required");

      const early = await coachOnboarding.user.client.rpc("set_my_profile_published", { p_published: true });
      assert.equal(errorCode(early.error), "not_approved");

      const approve = await admin.client.rpc("admin_set_provider_status", {
        p_provider_id: coachOnboarding.providerId, p_action: "approve", p_reason: null,
      });
      assert.equal(approve.error, null, approve.error?.message);

      const pubd = await coachOnboarding.user.client.rpc("set_my_profile_published", { p_published: true });
      assert.equal(pubd.error, null, pubd.error?.message);

      const dir = await anonymousClient().from("public_coach_directory").select("provider_id").eq("provider_id", coachOnboarding.providerId);
      assert.equal(dir.data?.length, 1, "now publicly listed");

      const history = await sql<{ action: string }>(
        `select action from provider_status_events where provider_id = ${lit(coachOnboarding.providerId)} order by created_at`);
      assert.deepEqual(history.map((h) => h.action), ["submit_for_review", "approve"]);
    });

    test("suspension needs a recorded reason", async () => {
      const { error } = await admin.client.rpc("admin_set_provider_status", {
        p_provider_id: coachOnboarding.providerId, p_action: "suspend", p_reason: "",
      });
      assert.equal(errorCode(error), "reason_required");
    });
  });

  // =========================================================================
  describe("checkout and payment effects", () => {
    let versionId: string;

    before(async () => {
      await coach.user.client.rpc("set_my_capacity", { p_max_active_clients: 2, p_accepting_new_clients: true });
      const offer = await makeDraftOffer(coach, { priceMinor: 10_000 });
      await publish(coach, offer.versionId);
      versionId = offer.versionId;
    });

    test("checkout creation is idempotent per key", async () => {
      const key = randomUUID();
      const a = await checkout(customerC, versionId, key);
      const b = await checkout(customerC, versionId, key);
      assert.equal(a.error, null, a.error?.message);
      assert.equal(b.data.reused, true);
      assert.equal(a.data.attempt_id, b.data.attempt_id);
      assert.equal(a.data.amount_minor, 10_000, "the price comes from the database, not the caller");
      await adminClient().rpc("close_checkout_attempt", { p_attempt_id: a.data.attempt_id, p_state: "abandoned", p_reason: "test" });
    });

    test("a currency the coach does not sell in is refused rather than converted", async () => {
      const { error } = await checkout(customerC, versionId, randomUUID(), "EUR");
      assert.equal(errorCode(error), "currency_not_offered");
    });

    test("a pending checkout grants nothing: no enrollment, no earnings, no paid access", async () => {
      const r = await checkout(customerA, versionId);
      const purchaseId = r.data.purchase_id;
      const [pu] = await sql<{ state: string; paid_through_at: string | null }>(`select state, paid_through_at from purchases where id = ${lit(purchaseId)}`);
      assert.equal(pu.state, "pending_payment");
      assert.equal(pu.paid_through_at, null);
      assert.equal((await sql(`select 1 from enrollments where purchase_id = ${lit(purchaseId)}`)).length, 0);
      assert.equal((await ledgerFor(purchaseId)).length, 0);
      await adminClient().rpc("close_checkout_attempt", { p_attempt_id: r.data.attempt_id, p_state: "abandoned", p_reason: "test" });
    });

    let purchaseA: string;

    test("a paid period opens the relationship and records 80/20 as pending earnings", async () => {
      const r = await checkout(customerA, versionId);
      purchaseA = r.data.purchase_id;
      const res = await pay(purchaseA, { sourceKey: `in_${RUN_ID}_a1` });
      assert.equal(res.error, null, res.error?.message);
      assert.equal(res.data.entries_written, 2);
      assert.ok(res.data.enrollment_id);

      const ledger = await ledgerFor(purchaseA);
      const coachRow = ledger.find((l) => l.account === "coach_payable");
      const platform = ledger.find((l) => l.account === "platform_revenue");
      assert.equal(coachRow?.amount_minor, 8000);
      assert.equal(platform?.amount_minor, 2000);
      assert.equal(coachRow?.state, "pending", "paid is not delivered");

      const [pu] = await sql<{ state: string; paid_through_at: string }>(`select state, paid_through_at from purchases where id = ${lit(purchaseA)}`);
      assert.equal(pu.state, "active");
      assert.ok(pu.paid_through_at);

      const [res0] = await sql<{ state: string }>(`select state from capacity_reservations where id = ${lit(r.data.reservation_id)}`);
      assert.equal(res0.state, "converted");
    });

    test("a replayed payment records nothing twice", async () => {
      const again = await pay(purchaseA, { sourceKey: `in_${RUN_ID}_a1` });
      assert.equal(again.error, null);
      assert.equal(again.data.entries_written, 0);
      assert.equal((await ledgerFor(purchaseA)).length, 2);
      assert.equal((await sql(`select 1 from billing_cycles where purchase_id = ${lit(purchaseA)}`)).length, 1);
      assert.equal((await sql(`select 1 from enrollments where purchase_id = ${lit(purchaseA)}`)).length, 1);
    });

    test("a different event describing the same invoice does not double-count", async () => {
      // Same source key arriving via, say, invoice.payment_succeeded instead of invoice.paid.
      const other = await pay(purchaseA, { sourceKey: `in_${RUN_ID}_a1`, periodStart: days(-1) });
      assert.equal(other.data.entries_written, 0);
      const coachRows = (await ledgerFor(purchaseA)).filter((l) => l.account === "coach_payable");
      assert.equal(coachRows.length, 1);
    });

    test("a failed renewal leaves paid-through access and history intact; recovery reactivates", async () => {
      const fail = await adminClient().rpc("record_payment_failure", {
        p: { purchase_id: purchaseA, source_key: `in_${RUN_ID}_a2`, stripe_invoice_id: `in_${RUN_ID}_a2`, period_start: days(30), period_end: days(60) },
      });
      assert.equal(fail.error, null, fail.error?.message);
      let [pu] = await sql<{ state: string; paid_through_at: string }>(`select state, paid_through_at from purchases where id = ${lit(purchaseA)}`);
      assert.equal(pu.state, "past_due");
      assert.ok(new Date(pu.paid_through_at) > new Date(), "the month already paid for still runs");
      assert.equal((await ledgerFor(purchaseA)).length, 2, "no history erased, no earnings added");

      const recover = await pay(purchaseA, { sourceKey: `in_${RUN_ID}_a2`, periodStart: days(30), periodEnd: days(60) });
      assert.equal(recover.error, null, recover.error?.message);
      [pu] = await sql<{ state: string; paid_through_at: string }>(`select state, paid_through_at from purchases where id = ${lit(purchaseA)}`);
      assert.equal(pu.state, "active");
      const [cyc] = await sql<{ state: string }>(`select state from billing_cycles where source_key = ${lit(`in_${RUN_ID}_a2`)}`);
      assert.equal(cyc.state, "paid");
    });

    test("a later subscription observation applies; an older one is ignored; an equal one is harmless", async () => {
      const base = {
        purchase_id: purchaseA, stripe_subscription_id: `sub_${RUN_ID}_a`, stripe_customer_id: `cus_${RUN_ID}`,
        current_period_start: new Date().toISOString(), current_period_end: days(30),
      };
      const t1 = new Date(Date.now() - 60_000).toISOString();
      const t2 = new Date().toISOString();

      const newer = await adminClient().rpc("sync_subscription_state", { p: { ...base, status: "active", cancel_at_period_end: true, observed_at: t2 } });
      assert.equal(newer.error, null, newer.error?.message);
      assert.equal(newer.data.purchase_state, "cancelling");

      const older = await adminClient().rpc("sync_subscription_state", { p: { ...base, status: "active", cancel_at_period_end: false, observed_at: t1 } });
      assert.equal(older.data.applied, false, "a stale 'still renewing' must not undo a newer cancellation");

      const equal = await adminClient().rpc("sync_subscription_state", { p: { ...base, status: "active", cancel_at_period_end: true, observed_at: t2 } });
      assert.equal(equal.data.applied, true);
      assert.equal(equal.data.purchase_state, "cancelling");

      // Resume, so later tests start from an active purchase.
      await adminClient().rpc("sync_subscription_state", { p: { ...base, status: "active", cancel_at_period_end: false, observed_at: new Date().toISOString() } });
    });

    test("a late payment after the hold lapsed, with room left, enrolls and records the exception", async () => {
      const r = await checkout(customerB, versionId);
      await sql(`update capacity_reservations set expires_at = now() - interval '1 minute' where id = ${lit(r.data.reservation_id)}`);
      const res = await pay(r.data.purchase_id, { sourceKey: `in_${RUN_ID}_b1` });
      assert.equal(res.error, null, res.error?.message);
      assert.equal(res.data.late, true);
      assert.equal(res.data.requires_review, false);
      assert.ok(res.data.enrollment_id);
      const [ex] = await sql<{ severity: string }>(
        `select severity from reconciliation_exceptions where purchase_id = ${lit(r.data.purchase_id)} and kind = 'late_payment_after_expiry'`);
      assert.equal(ex.severity, "info");
    });

    test("a late payment when the coach is now full is never overbooked and never lost", async () => {
      // coach max 2: customerA and customerB are active.
      const r = await checkout(customerC, versionId).catch(() => null);
      if (r && !r.error) {
        await adminClient().rpc("close_checkout_attempt", { p_attempt_id: r.data.attempt_id, p_state: "abandoned", p_reason: "test" });
      }
      assert.equal(errorCode(r?.error), "coach_full", "a new checkout is refused when full");

      // Construct the late case directly: a purchase whose hold lapsed while full.
      await sql(`update providers set max_active_clients = 3 where id = ${lit(coach.providerId)}`);
      const late = await checkout(customerC, versionId);
      assert.equal(late.error, null, late.error?.message);
      await sql(`update capacity_reservations set expires_at = now() - interval '1 minute' where id = ${lit(late.data.reservation_id)}`);
      await sql(`update providers set max_active_clients = 2 where id = ${lit(coach.providerId)}`);

      const res = await pay(late.data.purchase_id, { sourceKey: `in_${RUN_ID}_c1` });
      assert.equal(res.error, null, res.error?.message);
      assert.equal(res.data.requires_review, true);
      assert.equal(res.data.enrollment_id, null, "not overbooked");
      const ledger = await ledgerFor(late.data.purchase_id);
      assert.equal(ledger.length, 2, "the money is recorded");
      assert.equal(ledger.find((l) => l.account === "coach_payable")?.state, "held");
      const [ex] = await sql<{ severity: string }>(
        `select severity from reconciliation_exceptions where purchase_id = ${lit(late.data.purchase_id)} and kind = 'late_payment_after_expiry'`);
      assert.equal(ex.severity, "critical");
    });

    test("closing an abandoned checkout releases only its own hold and never a completed one", async () => {
      const r = await checkout(customerC, versionId).catch(() => null);
      // Coach is full, so use coachOther for this check.
      const offer = await makeDraftOffer(coachOther);
      await publish(coachOther, offer.versionId);
      const mine = await checkout(customerC, offer.versionId);
      const theirs = await checkout(customerA, offer.versionId);
      await adminClient().rpc("close_checkout_attempt", { p_attempt_id: mine.data.attempt_id, p_state: "expired", p_reason: "test" });
      const [m] = await sql<{ state: string }>(`select state from capacity_reservations where id = ${lit(mine.data.reservation_id)}`);
      const [t] = await sql<{ state: string }>(`select state from capacity_reservations where id = ${lit(theirs.data.reservation_id)}`);
      assert.equal(m.state, "expired");
      assert.equal(t.state, "held", "the other customer's hold is untouched");

      const closedCompleted = await adminClient().rpc("close_checkout_attempt", {
        p_attempt_id: (await sql<{ id: string }>(`select checkout_attempt_id as id from purchases where id = ${lit(purchaseA)}`))[0].id,
        p_state: "expired", p_reason: "test",
      });
      assert.equal(closedCompleted.data, false, "a completed checkout cannot be expired");
      await adminClient().rpc("close_checkout_attempt", { p_attempt_id: theirs.data.attempt_id, p_state: "abandoned", p_reason: "test" });
      void r;
    });
  });

  // =========================================================================
  describe("refunds and disputes", () => {
    let purchaseId: string;
    let providerId: string;
    const cycleKey = `pi_${RUN_ID}_refund`;

    before(async () => {
      // Batch 4: one-off sessions are booked inside the coach's hours.
      await coachOther.user.client.from("availability_windows").insert(
        Array.from({ length: 7 }, (_, d) => ({ provider_id: coachOther.providerId, weekday: d, start_time: "00:00", end_time: "23:45" })),
      );
      const r = await oneOffCheckout(customerB);
      purchaseId = r.data.purchase_id;
      providerId = coachOther.providerId;
      await pay(purchaseId, { sourceKey: cycleKey, serviceType: "one_off_consultation" });
    });

    async function refund(stripeId: string, amount: number, previously: number) {
      const [cycle] = await sql<{ id: string }>(`select id from billing_cycles where source_key = ${lit(cycleKey)}`);
      const entries = entriesForRefund({
        refundId: stripeId, billingCycleId: cycleKey, purchaseId, providerId, customerId: customerB.id,
        serviceAmount: money(10_000, USD), serviceType: "one_off_consultation", commissionPolicyId: V3,
        previouslyRefunded: money(previously, USD), refundAmount: money(amount, USD),
      });
      return adminClient().rpc("record_refund_effects", {
        p: {
          purchase_id: purchaseId, billing_cycle_id: cycle.id, previously_refunded_minor: previously,
          refund: { stripe_refund_id: stripeId, currency: USD, amount_minor: amount, state: "succeeded" },
          entries,
        },
      });
    }

    test("a partial refund reverses both shares", async () => {
      const r = await refund(`re_${RUN_ID}_1`, 2500, 0);
      assert.equal(r.error, null, r.error?.message);
      const ledger = await ledgerFor(purchaseId);
      assert.ok(ledger.some((l) => l.account === "coach_payable" && l.amount_minor === -2000));
      assert.ok(ledger.some((l) => l.account === "platform_revenue" && l.amount_minor === -500));
    });

    test("a replayed refund reverses nothing twice", async () => {
      const r = await refund(`re_${RUN_ID}_1`, 2500, 0);
      assert.equal(r.data.entries_written, 0);
    });

    test("a refund computed from a stale cumulative total is refused so it retries", async () => {
      const r = await refund(`re_${RUN_ID}_2`, 2500, 0);
      assert.equal(errorCode(r.error), "stale_refund_basis");
    });

    test("refunding the rest reconciles to zero and marks the purchase refunded", async () => {
      const r = await refund(`re_${RUN_ID}_2`, 7500, 2500);
      assert.equal(r.error, null, r.error?.message);
      const ledger = await ledgerFor(purchaseId);
      const coachNet = ledger.filter((l) => l.account === "coach_payable").reduce((s, l) => s + l.amount_minor, 0);
      const platformNet = ledger.filter((l) => l.account === "platform_revenue").reduce((s, l) => s + l.amount_minor, 0);
      assert.equal(coachNet, 0);
      assert.equal(platformNet, 0);
      const [pu] = await sql<{ state: string }>(`select state from purchases where id = ${lit(purchaseId)}`);
      assert.equal(pu.state, "refunded");
    });

    test("a dispute holds, and a LOST dispute delivered before the OPEN one converges", async () => {
      const r = await oneOffCheckout(customerA);
      const pid = r.data.purchase_id;
      await pay(pid, { sourceKey: `pi_${RUN_ID}_disp`, serviceType: "one_off_consultation" });

      const input = {
        disputeId: `dp_${RUN_ID}`, purchaseId: pid, providerId: coachOther.providerId, customerId: customerA.id,
        disputedAmount: money(10_000, USD), commissionPolicyId: V3, serviceType: "one_off_consultation" as const,
      };
      const lostEntries = [...entriesForDisputeOpened(input), ...entriesForDisputeLost(input)];
      const openEntries = entriesForDisputeOpened(input);
      const dispute = (state: string) => ({ stripe_dispute_id: input.disputeId, currency: USD, amount_minor: 10_000, state, reason: "fraudulent" });

      const lost = await adminClient().rpc("record_dispute_effects", { p: { purchase_id: pid, dispute: dispute("lost"), entries: lostEntries } });
      assert.equal(lost.error, null, lost.error?.message);
      const lateOpen = await adminClient().rpc("record_dispute_effects", { p: { purchase_id: pid, dispute: dispute("open"), entries: openEntries } });
      assert.equal(lateOpen.data.state, "lost", "a stale 'open' cannot reopen a closed dispute");

      const ledger = await ledgerFor(pid);
      const coachNet = ledger.filter((l) => l.account === "coach_payable").reduce((s, l) => s + l.amount_minor, 0);
      assert.equal(coachNet, 0, "lost dispute nets the coach to zero exactly once");
      const hold = ledger.filter((l) => l.account === "dispute_holdback").reduce((s, l) => s + l.amount_minor, 0);
      assert.equal(hold, 0, "hold released");
    });

    test("a WON dispute releases the hold and changes nothing else", async () => {
      const r = await oneOffCheckout(customerC);
      const pid = r.data.purchase_id;
      await pay(pid, { sourceKey: `pi_${RUN_ID}_won`, serviceType: "one_off_consultation" });
      const input = {
        disputeId: `dp_${RUN_ID}_won`, purchaseId: pid, providerId: coachOther.providerId, customerId: customerC.id,
        disputedAmount: money(10_000, USD), commissionPolicyId: V3, serviceType: "one_off_consultation" as const,
      };
      const d = (state: string) => ({ stripe_dispute_id: input.disputeId, currency: USD, amount_minor: 10_000, state });

      await adminClient().rpc("record_dispute_effects", { p: { purchase_id: pid, dispute: d("open"), entries: entriesForDisputeOpened(input) } });
      let ledger = await ledgerFor(pid);
      assert.equal(ledger.find((l) => l.account === "coach_payable" && l.effect === "service_earned")?.state, "held");

      await adminClient().rpc("record_dispute_effects", {
        p: { purchase_id: pid, dispute: d("won"), entries: [...entriesForDisputeOpened(input), ...entriesForDisputeWon(input)] },
      });
      ledger = await ledgerFor(pid);
      assert.equal(ledger.find((l) => l.account === "coach_payable" && l.effect === "service_earned")?.state, "pending",
        "released back to pending — a one-off still needs its completion event");
      assert.equal(ledger.filter((l) => l.account === "coach_payable").reduce((s, l) => s + l.amount_minor, 0), 8000);
    });
  });

  // =========================================================================
  describe("recognition, payouts and coach change", () => {
    let purchaseId: string;
    let enrollmentId: string;
    let paidCycleKey: string;

    before(async () => {
      // Make coach's first client's first period fully in the past, so it can
      // be recognised as delivered.
      const [pu] = await sql<{ id: string }>(
        `select id from purchases where provider_id = ${lit(coach.providerId)} and customer_id = ${lit(customerA.id)} and state = 'active' limit 1`);
      purchaseId = pu.id;
      const [e] = await sql<{ id: string }>(`select id from enrollments where purchase_id = ${lit(purchaseId)}`);
      enrollmentId = e.id;
      paidCycleKey = `in_${RUN_ID}_a1`;
      await sql(`update billing_cycles set period_start = now() - interval '40 days', period_end = now() - interval '10 days'
                 where source_key = ${lit(paidCycleKey)}`);
    });

    test("a delivered recurring period becomes eligible; an undelivered one does not", async () => {
      const r = await adminClient().rpc("recognise_delivered_cycles");
      assert.equal(r.error, null, r.error?.message);
      const rows = await sql<{ source_key: string; state: string }>(`
        select bc.source_key, es.state from earning_states es
        join ledger_entries le on le.id = es.ledger_entry_id
        join billing_cycles bc on bc.id = le.billing_cycle_id
        where le.purchase_id = ${lit(purchaseId)} and le.account = 'coach_payable'`);
      assert.equal(rows.find((x) => x.source_key === paidCycleKey)?.state, "eligible");
      assert.equal(rows.find((x) => x.source_key === `in_${RUN_ID}_a2`)?.state, "pending");
    });

    test("a coach needs MFA to change where they are paid", async () => {
      const { error } = await coach.user.client.rpc("set_my_payout_destination", {
        p_channel: "Bank transfer", p_account_reference: "NP-TEST-0001-9876", p_account_holder_name: "Fixture",
        p_country: "NP", p_currency: USD,
      });
      assert.equal(errorCode(error), "mfa_required");
    });

    test("with MFA the destination is saved, masked, and pending review", async () => {
      await upgradeToAal2(coach.user);
      const { data, error } = await coach.user.client.rpc("set_my_payout_destination", {
        p_channel: "Bank transfer", p_account_reference: "NP-TEST-0001-9876", p_account_holder_name: "Fixture",
        p_country: "NP", p_currency: USD,
      });
      assert.equal(error, null, error?.message);
      assert.equal(data.review_state, "pending_review");
      assert.ok(!String(data.masked_reference).includes("0001"), "masked");
      const mine = await coach.user.client.rpc("get_my_payout_destination");
      assert.equal(mine.data.masked_reference.endsWith("9876"), true);
      assert.ok(!JSON.stringify(mine.data).includes("NP-TEST-0001"));
    });

    test("an unreviewed destination keeps money out of a batch", async () => {
      const r = await admin.client.rpc("admin_prepare_payout_batch", { p_currency: USD, p_eligible_through: new Date().toISOString().slice(0, 10), p_minimum_minor: 0, p_label: `test ${RUN_ID} a` });
      assert.equal(r.error, null, r.error?.message);
      const held = (r.data.held as { provider_id: string; reason: string }[]).find((h) => h.provider_id === coach.providerId);
      assert.equal(held?.reason, "destination_not_approved");
    });

    let itemId: string;
    let batchId: string;

    test("the SQL batch agrees with the code's batching rules, and a coach cannot prepare one", async () => {
      const [dest] = await sql<{ id: string }>(`select id from provider_payout_destinations where provider_id = ${lit(coach.providerId)} and superseded_at is null`);
      const approve = await admin.client.rpc("admin_review_payout_destination", { p_destination_id: dest.id, p_decision: "approved" });
      assert.equal(approve.error, null, approve.error?.message);

      const coachTry = await coach.user.client.rpc("admin_prepare_payout_batch", { p_currency: USD, p_eligible_through: new Date().toISOString().slice(0, 10), p_minimum_minor: 0, p_label: null });
      assert.equal(errorCode(coachTry.error), "admin_mfa_required");

      // Snapshot what the code would decide for THIS coach.
      const eligible = await sql<{ ledger_entry_id: string; provider_id: string; currency: string; amount_minor: number }>(`
        select es.ledger_entry_id, es.provider_id, es.currency, le.amount_minor::int
        from earning_states es join ledger_entries le on le.id = es.ledger_entry_id
        where es.state = 'eligible' and es.currency = 'USD' and es.batch_id is null and es.provider_id = ${lit(coach.providerId)}`);
      const preview = prepareBatch(
        eligible.map((e) => ({ ledgerEntryId: e.ledger_entry_id, providerId: e.provider_id, currency: e.currency, amountMinor: e.amount_minor })),
        [{ providerId: coach.providerId, displayName: "x", payoutDestinationId: dest.id, payoutDestinationApproved: true, payoutReferenceMasked: "••" }],
        { minimumPayoutMinorUnits: 0 },
      );

      // Two operators at once: the earnings are claimed exactly once.
      const through = new Date().toISOString().slice(0, 10);
      const [a, b] = await Promise.all([
        admin.client.rpc("admin_prepare_payout_batch", { p_currency: USD, p_eligible_through: through, p_minimum_minor: 0, p_label: `test ${RUN_ID} b1` }),
        admin.client.rpc("admin_prepare_payout_batch", { p_currency: USD, p_eligible_through: through, p_minimum_minor: 0, p_label: `test ${RUN_ID} b2` }),
      ]);
      assert.equal(a.error, null, a.error?.message);
      assert.equal(b.error, null, b.error?.message);
      const mineA = (a.data.items as { provider_id: string; amount_minor: number; item_id: string }[]).filter((i) => i.provider_id === coach.providerId);
      const mineB = (b.data.items as { provider_id: string; amount_minor: number; item_id: string }[]).filter((i) => i.provider_id === coach.providerId);
      assert.equal(mineA.length + mineB.length, 1, "claimed by exactly one batch");

      const item = mineA[0] ?? mineB[0];
      itemId = item.item_id;
      batchId = mineA.length ? a.data.batch_id : b.data.batch_id;
      assert.equal(item.amount_minor, preview.lines[0]?.amount.minor, "database and code agree on the amount");
    });

    test("export records a file, not a payment", async () => {
      const ex = await admin.client.rpc("admin_export_payout_batch", { p_batch_id: batchId });
      assert.equal(ex.error, null, ex.error?.message);
      const row = (ex.data.rows as { item_id: string; masked_reference: string }[]).find((r) => r.item_id === itemId);
      assert.ok(row && !row.masked_reference.includes("0001"), "the export carries a masked reference");
      const [b] = await sql<{ state: string }>(`select state from payout_batches where id = ${lit(batchId)}`);
      assert.equal(b.state, "exported");
      const states = await sql<{ state: string }>(`select state from earning_states where batch_id = ${lit(batchId)} and provider_id = ${lit(coach.providerId)}`);
      assert.ok(states.every((s) => s.state === "batched"), "exported is NOT paid");
    });

    test("paid requires evidence, is recorded once, and a return restores the balance", async () => {
      const noRef = await admin.client.rpc("admin_record_payout_paid", { p_item_id: itemId, p_external_reference: "", p_paid_at: new Date().toISOString(), p_evidence_note: "statement" });
      assert.equal(errorCode(noRef.error), "reference_required");

      const paid = await admin.client.rpc("admin_record_payout_paid", { p_item_id: itemId, p_external_reference: `TX-${RUN_ID}`, p_paid_at: new Date().toISOString(), p_evidence_note: "bank statement line 4" });
      assert.equal(paid.error, null, paid.error?.message);
      const again = await admin.client.rpc("admin_record_payout_paid", { p_item_id: itemId, p_external_reference: `TX-${RUN_ID}`, p_paid_at: new Date().toISOString(), p_evidence_note: "bank statement line 4" });
      assert.equal(again.data.already, true);
      assert.equal((await sql(`select 1 from ledger_entries where effect_key = ${lit(`payout:${itemId}:paid`)}`)).length, 1, "one payout entry");

      const returned = await admin.client.rpc("admin_record_payout_failed", { p_item_id: itemId, p_reason: "returned by bank", p_returned_after_payment: true });
      assert.equal(returned.error, null, returned.error?.message);
      const states = await sql<{ state: string }>(`
        select es.state from earning_states es join ledger_entries le on le.id = es.ledger_entry_id
        where le.purchase_id = ${lit(purchaseId)} and le.account = 'coach_payable' and le.effect = 'service_earned' and le.billing_cycle_id =
          (select id from billing_cycles where source_key = ${lit(paidCycleKey)})`);
      assert.equal(states[0].state, "eligible", "the coach is owed it again");
      const [net] = await sql<{ n: number }>(`select coalesce(sum(amount_minor),0)::int as n from ledger_entries where effect_key in (${lit(`payout:${itemId}:paid`)}, ${lit(`payout:${itemId}:returned`)})`);
      assert.equal(net.n, 0);
    });

    test("a coach change moves future service, holds the unfinished period, and revokes old access", async () => {
      // A health record logged under the original coach.
      const log = await customerA.client.from("bodyweight_logs").insert({ enrollment_id: enrollmentId, logged_on: new Date().toISOString().slice(0, 10), weight_kg: 70 }).select("id").single();
      assert.equal(log.error, null, log.error?.message);
      const before = await coach.user.client.from("bodyweight_logs").select("id").eq("id", log.data!.id);
      assert.equal(before.data?.length, 1, "the current coach sees it");
      const adminRead = await admin.client.from("bodyweight_logs").select("id").eq("id", log.data!.id);
      assert.ok(wasDenied(adminRead), "invariant 3: not even an MFA admin reads health records");

      const other = await customerB.client.rpc("request_coach_change", { p_enrollment_id: enrollmentId, p_reason: "not mine", p_preferred_provider_id: null });
      assert.equal(errorCode(other.error), "not_found", "a customer cannot request a change on someone else's coaching");

      const req = await customerA.client.rpc("request_coach_change", { p_enrollment_id: enrollmentId, p_reason: "schedule clash", p_preferred_provider_id: coachOther.providerId });
      assert.equal(req.error, null, req.error?.message);
      const dup = await customerA.client.rpc("request_coach_change", { p_enrollment_id: enrollmentId, p_reason: "again", p_preferred_provider_id: null });
      assert.equal(errorCode(dup.error), "request_already_open");

      const applied = await admin.client.rpc("admin_apply_coach_change", {
        p_request_id: req.data, p_new_provider_id: coachOther.providerId, p_effective_at: new Date().toISOString(),
        p_history_scope: "none", p_note: "customer request",
      });
      assert.equal(applied.error, null, applied.error?.message);
      assert.ok(applied.data.held_earnings >= 1, "the unfinished paid period is held for allocation");

      const oldCoach = await coach.user.client.from("bodyweight_logs").select("id").eq("id", log.data!.id);
      assert.ok(wasDenied(oldCoach), "the former coach loses access");
      const newCoach = await coachOther.user.client.from("bodyweight_logs").select("id").eq("id", log.data!.id);
      assert.ok(wasDenied(newCoach), "history_scope 'none': the new coach does not see earlier records");

      const earned = await sql<{ provider_id: string; state: string }>(`
        select le.provider_id, es.state from ledger_entries le join earning_states es on es.ledger_entry_id = le.id
        where le.billing_cycle_id = (select id from billing_cycles where source_key = ${lit(paidCycleKey)}) and le.account = 'coach_payable' and le.effect = 'service_earned'`);
      assert.equal(earned[0].provider_id, coach.providerId, "delivered earnings stay with the original coach");

      const future = await pay(purchaseId, { sourceKey: `in_${RUN_ID}_a3`, periodStart: days(61), periodEnd: days(91) });
      assert.equal(future.error, null, future.error?.message);
      const [fut] = await sql<{ provider_id: string }>(`
        select le.provider_id from ledger_entries le where le.billing_cycle_id = (select id from billing_cycles where source_key = ${lit(`in_${RUN_ID}_a3`)}) and le.account = 'coach_payable'`);
      assert.equal(fut.provider_id, coachOther.providerId, "future service is earned by the new coach");
    });
  });

  // =========================================================================
  describe("protected intake", () => {
    test("a sensitive field can never be written into the broad booking column", async () => {
      await sql(`insert into services (id, vertical_slug, name, price_cents, status) values ('talentyak-test-${RUN_ID}', 'fitness', 'fixture', 100, 'hidden') on conflict do nothing`);
      const { error } = await adminClient().from("bookings").insert({
        service_id: `talentyak-test-${RUN_ID}`, vertical_slug: "fitness", customer_email: "x@example.test",
        intake_response: { goal: "general", injuries: "left knee" },
      });
      assert.equal(errorCode(error), "sensitive_intake_in_booking");
      await sql(`delete from services where id = 'talentyak-test-${RUN_ID}'`);
    });

    test("health intake: customer and current coach only — grief intake: customer and admin only", async () => {
      const [pu] = await sql<{ id: string }>(`select id from purchases where customer_id = ${lit(customerB.id)} and provider_id = ${lit(coach.providerId)} and state = 'active' limit 1`);
      await adminClient().from("protected_intake").insert({ purchase_id: pu.id, vertical_slug: "fitness", sensitivity: "health", data: { injuries: "fixture" } });

      assert.equal((await customerB.client.from("protected_intake").select("id").eq("purchase_id", pu.id)).data?.length, 1);
      assert.equal((await coach.user.client.from("protected_intake").select("id").eq("purchase_id", pu.id)).data?.length, 1);
      assert.ok(wasDenied(await coachOther.user.client.from("protected_intake").select("id").eq("purchase_id", pu.id)));
      assert.ok(wasDenied(await admin.client.from("protected_intake").select("id").eq("purchase_id", pu.id)), "admin cannot read health intake");
      assert.ok(wasDenied(await customerA.client.from("protected_intake").select("id").eq("purchase_id", pu.id)));
    });
  });

  // =========================================================================
  describe("outbox worker primitives", () => {
    const topic = `test.noop.${RUN_ID}`;

    async function enqueue(key: string) {
      const { data } = await adminClient().rpc("enqueue_outbox", {
        p_topic: topic, p_payload: { k: key }, p_dedupe_key: key, p_scheduled_for: "2000-01-01T00:00:00Z", p_expires_at: null,
      });
      return data as string;
    }

    test("enqueue is deduplicated by key", async () => {
      const a = await enqueue(`dedupe-${RUN_ID}`);
      const b = await enqueue(`dedupe-${RUN_ID}`);
      assert.equal(a, b);
      assert.equal((await sql(`select 1 from outbox where topic = ${lit(topic)} and dedupe_key = ${lit(`dedupe-${RUN_ID}`)}`)).length, 1);
    });

    test("two workers claiming at once never get the same job", async () => {
      for (let i = 0; i < 6; i++) await enqueue(`claim-${RUN_ID}-${i}`);
      const [w1, w2] = await Promise.all([
        adminClient().rpc("claim_outbox_jobs", { p_worker: "w1", p_limit: 4, p_lease_seconds: 60 }),
        adminClient().rpc("claim_outbox_jobs", { p_worker: "w2", p_limit: 4, p_lease_seconds: 60 }),
      ]);
      const ids1 = new Set((w1.data as { id: string }[]).map((j) => j.id));
      const overlap = (w2.data as { id: string }[]).filter((j) => ids1.has(j.id));
      assert.equal(overlap.length, 0);
      for (const [w, res] of [["w1", w1], ["w2", w2]] as const) {
        for (const j of res.data as { id: string; topic: string }[]) {
          await adminClient().rpc(j.topic === topic ? "complete_outbox_job" : "fail_outbox_job",
            j.topic === topic ? { p_id: j.id, p_worker: w, p_result: null } : { p_id: j.id, p_worker: w, p_error: "released by test", p_retryable: true, p_blocked: false });
        }
      }
    });

    test("a crashed worker's job is recovered after its lease expires", async () => {
      const id = await enqueue(`crash-${RUN_ID}`);
      await sql(`update outbox set state = 'processing', lease_owner = 'dead-worker', lease_expires_at = now() - interval '1 second', attempts = 1 where id = ${lit(id)}`);
      const { data } = await adminClient().rpc("claim_outbox_jobs", { p_worker: "rescuer", p_limit: 50, p_lease_seconds: 60 });
      const got = (data as { id: string; attempts: number }[]).find((j) => j.id === id);
      assert.ok(got, "reclaimed");
      assert.equal(got!.attempts, 2);
      assert.equal((await adminClient().rpc("complete_outbox_job", { p_id: id, p_worker: "dead-worker", p_result: null })).data, false,
        "the dead worker cannot complete it afterwards");
      assert.equal((await adminClient().rpc("complete_outbox_job", { p_id: id, p_worker: "rescuer", p_result: null })).data, true);
    });

    test("a retryable failure backs off; the last attempt fails visibly; an MFA admin can retry", async () => {
      const id = await enqueue(`fail-${RUN_ID}`);
      await sql(`update outbox set max_attempts = 2 where id = ${lit(id)}`);
      await sql(`update outbox set state='processing', lease_owner='w', lease_expires_at=now()+interval '1 minute', attempts=1 where id = ${lit(id)}`);
      assert.equal((await adminClient().rpc("fail_outbox_job", { p_id: id, p_worker: "w", p_error: "boom", p_retryable: true, p_blocked: false })).data, "pending");
      const [j] = await sql<{ scheduled_for: string }>(`select scheduled_for from outbox where id = ${lit(id)}`);
      assert.ok(new Date(j.scheduled_for) > new Date(), "backed off into the future");

      await sql(`update outbox set state='processing', lease_owner='w', lease_expires_at=now()+interval '1 minute', attempts=2 where id = ${lit(id)}`);
      assert.equal((await adminClient().rpc("fail_outbox_job", { p_id: id, p_worker: "w", p_error: "boom", p_retryable: true, p_blocked: false })).data, "failed");

      const noMfa = await adminNoMfa.client.rpc("admin_retry_outbox_job", { p_id: id });
      assert.equal(errorCode(noMfa.error), "admin_mfa_required");
      const retry = await admin.client.rpc("admin_retry_outbox_job", { p_id: id });
      assert.equal(retry.error, null, retry.error?.message);
      await sql(`update outbox set state = 'cancelled' where id = ${lit(id)}`);
    });

    test("blocked on configuration does not use up attempts; expiry cancels", async () => {
      const id = await enqueue(`blocked-${RUN_ID}`);
      await sql(`update outbox set state='processing', lease_owner='w', lease_expires_at=now()+interval '1 minute', attempts=1 where id = ${lit(id)}`);
      assert.equal((await adminClient().rpc("fail_outbox_job", { p_id: id, p_worker: "w", p_error: "email not configured", p_retryable: true, p_blocked: true })).data, "blocked");
      const [j] = await sql<{ attempts: number }>(`select attempts from outbox where id = ${lit(id)}`);
      assert.equal(j.attempts, 0);
      await sql(`update outbox set expires_at = now() - interval '1 second', scheduled_for = now() where id = ${lit(id)}`);
      await adminClient().rpc("claim_outbox_jobs", { p_worker: "sweeper", p_limit: 1, p_lease_seconds: 1 });
      const [k] = await sql<{ state: string }>(`select state from outbox where id = ${lit(id)}`);
      assert.equal(k.state, "cancelled");
    });

    test("a client session cannot enqueue or claim work", async () => {
      assert.ok((await customerA.client.rpc("enqueue_outbox", { p_topic: "x", p_payload: {}, p_dedupe_key: null, p_scheduled_for: null, p_expires_at: null })).error);
      assert.ok((await customerA.client.rpc("claim_outbox_jobs", { p_worker: "x", p_limit: 1, p_lease_seconds: 1 })).error);
    });
  });

  // =========================================================================
  describe("rate limits and retention foundations", () => {
    test("a limit of 3 allows 3 and refuses the 4th", async () => {
      const bucket = `test:${RUN_ID}`;
      const results = [];
      for (let i = 0; i < 4; i++) {
        results.push((await adminClient().rpc("hit_rate_limit", { p_bucket: bucket, p_limit: 3, p_window_seconds: 600 })).data.allowed);
      }
      assert.deepEqual(results, [true, true, true, false]);
    });

    test("retention notices refuse real people under a proposed policy, and schedule 30/7/1 for synthetic rows", async () => {
      const [real] = await sql<{ id: string }>(`insert into retention_candidates (policy_id, resource_type, resource_id, profile_id, eligible_at, deletion_due_at)
        values ('retention.programmes.v1', 'programme_and_progress', gen_random_uuid(), ${lit(customerA.id)}, now(), now() + interval '40 days') returning id`);
      const refused = await adminClient().rpc("schedule_retention_notices", { p_candidate_id: real.id });
      assert.equal(errorCode(refused.error), "policy_not_approved");

      const [synthetic] = await sql<{ id: string }>(`insert into retention_candidates (policy_id, resource_type, resource_id, profile_id, eligible_at, deletion_due_at, is_synthetic)
        values ('retention.programmes.v1', 'programme_and_progress', gen_random_uuid(), ${lit(customerA.id)}, now(), now() + interval '40 days', true) returning id`);
      const ok = await adminClient().rpc("schedule_retention_notices", { p_candidate_id: synthetic.id });
      assert.equal(ok.error, null, ok.error?.message);
      assert.equal(ok.data, 3);
      const notices = await sql<{ days_before: number }>(`select days_before from retention_notices where candidate_id = ${lit(synthetic.id)} order by days_before desc`);
      assert.deepEqual(notices.map((n) => n.days_before), [30, 7, 1]);

      const [flag] = await sql<{ destructive_execution_enabled: boolean }>(`select destructive_execution_enabled from retention_settings`);
      assert.equal(flag.destructive_execution_enabled, false, "nothing is deleted in this batch");

      await sql(`update outbox set state = 'cancelled' where topic = 'email.retention_notice' and payload->>'candidate_id' = ${lit(synthetic.id)}`);
      await sql(`update retention_candidates set state = 'cancelled' where id in (${lit(real.id)}, ${lit(synthetic.id)})`);
    });
  });
});

if (skip) {
  console.log(`\n  ⚠ Workflow database tests SKIPPED.\n    ${availability.reason}\n`);
}
