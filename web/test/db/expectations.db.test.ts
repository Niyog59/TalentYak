/**
 * Coaching Welcome & Expectations (Batch 3), as real signed-in people.
 *
 *   · nothing is sellable until the coach has published
 *   · a coach drafts, previews and publishes their own section, never ours
 *   · a published version never changes
 *   · checkout records exactly the versions that were on screen, and refuses
 *     when a publish lands between reading and paying
 *   · the purchase's version is what the client is given when they join
 *   · acknowledging records a reading and nothing else — no price, billing,
 *     refund, service or access changes, and not reading takes nothing away
 *   · revisions are presented without rewriting what was acknowledged before
 *   · existing clients get no invented history
 *   · nobody reads another client's copy, and a former coach loses access
 *
 * When the project is not confirmed available, every test SKIPS.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  FIXTURE_EXPECTATIONS,
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
  upgradeToAal2,
  wasDenied,
  type CoachFixture,
  type TestUser,
} from "./harness.ts";
import { money } from "@/lib/money/money";
import { entriesForCycleEarning } from "@/lib/ledger/effects";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;
const USD = "USD";
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

let coach: CoachFixture;
let coachOther: CoachFixture;
let customerA: TestUser;
let customerB: TestUser;
let customerLegacy: TestUser;
let admin: TestUser;
let adminNoMfa: TestUser;
let offerVersionId = "";
let otherOfferVersionId = "";
const users: string[] = [];
const enrollments: string[] = [];

// Shared across the ordered tests below.
let versionA = "";
let versionB = "";
let purchaseId = "";
let enrollmentId = "";
let purchasePresentation = "";
let legacyEnrollment = "";

async function checkout(customer: TestUser, versionId: string, shown: { coach: string | null; platform: string | null }) {
  return adminClient().rpc("create_checkout_records", {
    p: {
      customer_id: customer.id, offer_version_id: versionId, currency: USD, idempotency_key: randomUUID(), hold_seconds: 1800,
      expectations_coach_version_id: shown.coach, expectations_platform_version_id: shown.platform,
    },
  });
}

async function pay(id: string) {
  const { data: pu } = await adminClient()
    .from("purchases").select("provider_id, customer_id, commission_policy_id, charge_amount_minor").eq("id", id).single();
  const sourceKey = `exp-${randomUUID()}`;
  return adminClient().rpc("record_cycle_payment", {
    p: {
      purchase_id: id,
      cycle: { source_key: sourceKey, period_start: new Date().toISOString(), period_end: days(30), currency: USD, amount_minor: pu!.charge_amount_minor, stripe_payment_intent_id: `pi_test_${sourceKey}` },
      entries: entriesForCycleEarning({
        billingCycleId: sourceKey, purchaseId: id, providerId: pu!.provider_id, customerId: pu!.customer_id,
        serviceAmount: money(pu!.charge_amount_minor, USD), serviceType: "recurring_coaching",
        commissionPolicyId: pu!.commission_policy_id, delivered: false,
      }),
    },
  });
}

/** Everything commercial about the relationship, to prove acknowledging leaves it alone. */
async function commercialState() {
  const sb = adminClient();
  const [{ data: pu }, { data: cycles }, { data: en }, { data: ledger }] = await Promise.all([
    sb.from("purchases").select("state, charge_amount_minor, charge_currency, paid_through_at, ends_at, cancelled_at, inclusions_snapshot, offer_version_id, cancellation_policy_id, commission_policy_id, expectations_coach_version_id, expectations_platform_version_id").eq("id", purchaseId).single(),
    sb.from("billing_cycles").select("id, state, amount_minor, period_end").eq("purchase_id", purchaseId).order("sequence"),
    sb.from("enrollments").select("state, provider_id, ended_at").eq("id", enrollmentId).single(),
    sb.from("ledger_entries").select("id, amount_minor, account").eq("purchase_id", purchaseId).order("created_at"),
  ]);
  return JSON.stringify({ pu, cycles, en, ledger });
}

describe("coaching welcome & expectations", { skip }, () => {
  before(async () => {
    await ensurePlatformExpectations();

    coach = await makeCoach("exp-coach", { max: 10 });
    coachOther = await makeCoach("exp-coach-other", { max: 10 });
    customerA = await createTestUser("exp-cust-a");
    customerB = await createTestUser("exp-cust-b");
    customerLegacy = await createTestUser("exp-cust-legacy");
    admin = await createTestUser("exp-admin");
    adminNoMfa = await createTestUser("exp-admin-nomfa");
    users.push(coach.user.id, coachOther.user.id, customerA.id, customerB.id, customerLegacy.id, admin.id, adminNoMfa.id);
    await setRole(admin.id, "admin");
    await setRole(adminNoMfa.id, "admin");
    await upgradeToAal2(admin);

    for (const [c, set] of [[coach, (id: string) => (offerVersionId = id)], [coachOther, (id: string) => (otherOfferVersionId = id)]] as const) {
      const offer = await makeDraftOffer(c);
      const { error } = await c.user.client.rpc("publish_offer_version", { p_version_id: offer.versionId });
      if (error) throw new Error(`publish offer: ${error.message}`);
      set(offer.versionId);
    }
  });

  after(async () => {
    const sb = adminClient();
    for (const e of enrollments) {
      await sb.from("outbox").delete().eq("topic", "email.expectations_updated").eq("payload->>enrollment_id", e);
      const { data: convs } = await sb.from("conversations").select("id").eq("enrollment_id", e);
      for (const c of convs ?? []) await sb.from("outbox").delete().eq("topic", "email.unread_messages").eq("payload->>conversation_id", c.id);
    }
    for (const c of [coach, coachOther]) {
      if (!c) continue;
      await sb.from("capacity_reservations").delete().eq("provider_id", c.providerId);
      await sb.from("offers").update({ status: "archived", archived_at: new Date().toISOString() }).eq("provider_id", c.providerId);
      await sb.from("providers").update({ status: "retired", active: false, published_at: null, accepting_new_clients: false }).eq("id", c.providerId);
    }
    await deleteTestUsers(users);
  });

  // -------------------------------------------------------------------------
  describe("before and while a coach publishes", () => {
    test("a plan cannot be bought until the coach has published their expectations", async () => {
      const shown = await liveExpectationIds(coach.providerId);
      assert.equal(shown.coach, null);
      const { error } = await checkout(customerA, offerVersionId, shown);
      assert.equal(errorCode(error), "expectations_missing");
    });

    test("a coach cannot publish with required parts missing, and the draft is kept", async () => {
      const { data: draft, error } = await coach.user.client.rpc("save_my_expectations_draft", {
        p: { ...FIXTURE_EXPECTATIONS, appointments: "", coach_part: [] },
      });
      assert.equal(error, null, error?.message);
      const publish = await coach.user.client.rpc("publish_my_expectations", { p_draft: draft, p_material: true, p_summary: null });
      assert.equal(errorCode(publish.error), "expectations_incomplete");
      const { data: row } = await coach.user.client.from("coach_expectation_versions").select("published_at").eq("id", draft).single();
      assert.equal(row!.published_at, null);
    });

    test("the coach can read their own draft (the preview); nobody else can", async () => {
      const own = await coach.user.client.from("coach_expectation_versions").select("id").eq("provider_id", coach.providerId).is("published_at", null);
      assert.equal((own.data ?? []).length, 1);
      assert.ok(wasDenied(await anonymousClient().from("coach_expectation_versions").select("id").eq("provider_id", coach.providerId)));
      assert.ok(wasDenied(await customerA.client.from("coach_expectation_versions").select("id").eq("provider_id", coach.providerId)));
      assert.ok(wasDenied(await coachOther.user.client.from("coach_expectation_versions").select("id").eq("provider_id", coach.providerId)));
    });

    test("an approved coach publishes, and the live version becomes public", async () => {
      versionA = await publishCoachExpectations(coach, { provides: "Version A wording <script>alert(1)</script> https://example.test/x" });
      const pub = await anonymousClient().from("coach_expectation_versions").select("id, version, provides").eq("provider_id", coach.providerId);
      assert.equal((pub.data ?? []).length, 1, "anyone can read the live version before buying");
      assert.equal(pub.data![0].id, versionA);
      // Stored exactly as typed. It is text; the page renders it as text.
      assert.match(pub.data![0].provides, /<script>alert\(1\)<\/script>/);
    });

    test("a coach cannot write a version row directly, only through the functions", async () => {
      const insert = await coach.user.client.from("coach_expectation_versions")
        .insert({ provider_id: coach.providerId, version: 99, published_at: new Date().toISOString() }).select("id");
      assert.ok(wasDenied(insert), "a coach inserted a published version directly");
      const update = await coach.user.client.from("coach_expectation_versions").update({ provides: "rewritten" }).eq("id", versionA).select("id");
      assert.ok(wasDenied(update));
    });

    test("a published version is immutable, even to the server", async () => {
      const upd = await adminClient().from("coach_expectation_versions").update({ provides: "rewritten" }).eq("id", versionA);
      assert.ok(upd.error, "a published version was edited");
      const del = await adminClient().from("coach_expectation_versions").delete().eq("id", versionA);
      assert.ok(del.error, "a published version was deleted");
    });
  });

  // -------------------------------------------------------------------------
  describe("TalentYak's section is not the coach's to change", () => {
    test("a coach cannot save or publish the platform section", async () => {
      const save = await coach.user.client.rpc("admin_save_platform_expectations_draft", { p: { conduct: "x", privacy: "x", support: "x" } });
      assert.equal(errorCode(save.error), "admin_only");
      const insert = await coach.user.client.from("platform_expectation_versions").insert({ version: 999, conduct: "x" }).select("id");
      assert.ok(wasDenied(insert));
      const live = (await liveExpectationIds(coach.providerId)).platform!;
      const update = await coach.user.client.from("platform_expectation_versions").update({ conduct: "x" }).eq("id", live).select("id");
      assert.ok(wasDenied(update));
    });

    test("an admin without a verified second factor cannot either", async () => {
      const save = await adminNoMfa.client.rpc("admin_save_platform_expectations_draft", { p: { conduct: "x", privacy: "x", support: "x" } });
      assert.equal(errorCode(save.error), "admin_only");
    });

    test("a verified admin can draft it, but only links to pages on this site are accepted", async () => {
      const bad = await admin.client.rpc("admin_save_platform_expectations_draft", {
        p: { conduct: "c", privacy: "p", support: "s", policy_links: ["https://evil.example/terms"] },
      });
      assert.ok(bad.error, "an external link was stored");
      const sneaky = await admin.client.rpc("admin_save_platform_expectations_draft", {
        p: { conduct: "c", privacy: "p", support: "s", policy_links: ["//evil.example"] },
      });
      assert.ok(sneaky.error, "a protocol-relative link was stored");
      const good = await admin.client.rpc("admin_save_platform_expectations_draft", {
        p: { conduct: "c", privacy: "p", support: "s", policy_links: ["/legal/terms"] },
      });
      assert.equal(good.error, null, good.error?.message);
      // A draft left behind would sit in the admin screen; remove it.
      await adminClient().from("platform_expectation_versions").delete().eq("id", good.data);
    });
  });

  // -------------------------------------------------------------------------
  describe("what was shown is what is bought", () => {
    test("a publish between reading and paying stops the purchase", async () => {
      const shownA = await liveExpectationIds(coach.providerId);
      assert.equal(shownA.coach, versionA);
      versionB = await publishCoachExpectations(coach, { provides: "Version B wording." }, { summary: "Clearer wording." });

      const stale = await checkout(customerA, offerVersionId, shownA);
      assert.equal(errorCode(stale.error), "expectations_changed", "a purchase recorded a version that was no longer live");
      const { count } = await adminClient().from("purchases").select("id", { count: "exact", head: true })
        .eq("customer_id", customerA.id).eq("state", "pending_payment");
      assert.equal(count, 0, "a refused checkout left a pending purchase behind");
    });

    test("racing a publish never records a version other than the one shown", async () => {
      const shown = await liveExpectationIds(coach.providerId);
      assert.equal(shown.coach, versionB);
      const [co] = await Promise.all([
        checkout(customerA, offerVersionId, shown),
        publishCoachExpectations(coach, { provides: "Version C wording." }),
      ]);
      if (co.error) {
        assert.equal(errorCode(co.error), "expectations_changed");
        // Lost the race: read the current version and buy with that.
        const again = await checkout(customerA, offerVersionId, await liveExpectationIds(coach.providerId));
        assert.equal(again.error, null, again.error?.message);
        purchaseId = again.data.purchase_id;
      } else {
        purchaseId = co.data.purchase_id;
      }
      const { data: pu } = await adminClient().from("purchases").select("expectations_coach_version_id, expectations_platform_version_id").eq("id", purchaseId).single();
      const { data: attempt } = await adminClient().from("purchases").select("checkout_attempt_id").eq("id", purchaseId).single();
      assert.ok(attempt);
      // Whichever way the race went, the record is a version that was live at
      // the moment of the check, and named by the page.
      assert.ok([versionB].includes(pu!.expectations_coach_version_id) || pu!.expectations_coach_version_id === (await liveExpectationIds(coach.providerId)).coach);
      assert.ok(pu!.expectations_platform_version_id);
    });

    test("the purchase's version is what the client is given when payment completes", async () => {
      const { data: pu } = await adminClient().from("purchases").select("expectations_coach_version_id").eq("id", purchaseId).single();
      const paid = await pay(purchaseId);
      assert.equal(paid.error, null, paid.error?.message);
      enrollmentId = paid.data.enrollment_id;
      enrollments.push(enrollmentId);

      const { data: rows } = await customerA.client.from("enrollment_expectations")
        .select("id, source, coach_version_id, purchase_id, acknowledgement_requested").eq("enrollment_id", enrollmentId);
      assert.equal((rows ?? []).length, 1);
      assert.equal(rows![0].source, "purchase");
      assert.equal(rows![0].coach_version_id, pu!.expectations_coach_version_id, "the client was given a different version from the one they bought with");
      assert.equal(rows![0].purchase_id, purchaseId);
      assert.equal(rows![0].acknowledgement_requested, true);
      purchasePresentation = rows![0].id;

      // No notice at purchase: they have just read it.
      const { count } = await adminClient().from("outbox").select("id", { count: "exact", head: true })
        .eq("topic", "email.expectations_updated").eq("payload->>enrollment_id", enrollmentId);
      assert.equal(count, 0);
    });

    test("both people find it in their conversation", async () => {
      const { data: conv } = await customerA.client.from("conversations").select("id").eq("enrollment_id", enrollmentId).single();
      const asClient = await customerA.client.from("messages").select("kind, sender_role, expectations_presentation_id").eq("conversation_id", conv!.id).eq("kind", "expectations_link");
      assert.equal((asClient.data ?? []).length, 1);
      assert.equal(asClient.data![0].sender_role, "system");
      assert.equal(asClient.data![0].expectations_presentation_id, purchasePresentation);
      const asCoach = await coach.user.client.from("messages").select("id").eq("conversation_id", conv!.id).eq("kind", "expectations_link");
      assert.equal((asCoach.data ?? []).length, 1);
      const version = await customerA.client.from("coach_expectation_versions").select("id").eq("id", (await adminClient().from("enrollment_expectations").select("coach_version_id").eq("id", purchasePresentation).single()).data!.coach_version_id);
      assert.equal((version.data ?? []).length, 1, "the client could not read the version they were given");
    });

    test("nobody can post an expectations link themselves", async () => {
      const { data: conv } = await customerA.client.from("conversations").select("id").eq("enrollment_id", enrollmentId).single();
      const forged = await customerA.client.from("messages").insert({
        conversation_id: conv!.id, seq: 999, sender_role: "system", kind: "expectations_link", body: "x",
        client_message_id: randomUUID(), expectations_presentation_id: purchasePresentation,
      }).select("id");
      assert.ok(wasDenied(forged));
    });

    test("the recorded version on an active purchase cannot be changed", async () => {
      const { error } = await adminClient().from("purchases").update({ expectations_coach_version_id: versionA }).eq("id", purchaseId);
      assert.ok(error, "the purchase's recorded expectations were rewritten");
    });
  });

  // -------------------------------------------------------------------------
  describe("reading and acknowledging", () => {
    test("an unread document takes nothing away: coaching and messages carry on", async () => {
      const { data: conv } = await customerA.client.from("conversations").select("id").eq("enrollment_id", enrollmentId).single();
      const sent = await customerA.client.rpc("send_message", { p_conversation: conv!.id, p_client_id: randomUUID(), p_body: "Hello before reading", p_media: null });
      assert.equal(sent.error, null, sent.error?.message);
      const live = await adminClient().rpc("coaching_is_live", { e_id: enrollmentId });
      assert.equal(live.data, true);
    });

    test("another client cannot see, or acknowledge, this client's copy", async () => {
      assert.ok(wasDenied(await customerB.client.from("enrollment_expectations").select("id").eq("enrollment_id", enrollmentId)));
      assert.ok(wasDenied(await anonymousClient().from("enrollment_expectations").select("id").eq("enrollment_id", enrollmentId)));
      assert.ok(wasDenied(await coachOther.user.client.from("enrollment_expectations").select("id").eq("enrollment_id", enrollmentId)));
      const ack = await customerB.client.rpc("acknowledge_expectations", { p_presentation: purchasePresentation });
      assert.equal(errorCode(ack.error), "not_found");
    });

    test("the coach cannot acknowledge on the client's behalf", async () => {
      const ack = await coach.user.client.rpc("acknowledge_expectations", { p_presentation: purchasePresentation });
      assert.equal(errorCode(ack.error), "not_found");
    });

    test("acknowledging records who, which version and when — and changes nothing commercial", async () => {
      const before = await commercialState();
      const ack = await customerA.client.rpc("acknowledge_expectations", { p_presentation: purchasePresentation });
      assert.equal(ack.error, null, ack.error?.message);
      const again = await customerA.client.rpc("acknowledge_expectations", { p_presentation: purchasePresentation });
      assert.equal(again.data.acknowledged_at, ack.data.acknowledged_at, "a second click moved the recorded time");
      assert.equal(await commercialState(), before, "acknowledging changed a price, bill, refund, entitlement or ledger row");

      const { data: rec } = await adminClient().from("expectation_acknowledgements").select("actor_profile_id, coach_version_id, acknowledged_at").eq("presentation_id", purchasePresentation).single();
      assert.equal(rec!.actor_profile_id, customerA.id);
      assert.ok(Math.abs(Date.parse(rec!.acknowledged_at) - Date.now()) < 5 * 60_000, "not the server's clock");
      const asCoach = await coach.user.client.from("expectation_acknowledgements").select("id").eq("presentation_id", purchasePresentation);
      assert.equal((asCoach.data ?? []).length, 1, "the coach can see that it was read");
    });

    test("an acknowledgement cannot be forged, edited or removed", async () => {
      const forged = await customerA.client.from("expectation_acknowledgements").insert({
        presentation_id: purchasePresentation, actor_profile_id: customerA.id, coach_version_id: versionA,
        platform_version_id: (await liveExpectationIds(coach.providerId)).platform, acknowledged_at: "2020-01-01T00:00:00Z",
      }).select("id");
      assert.ok(wasDenied(forged));
      const edited = await adminClient().from("expectation_acknowledgements").update({ acknowledged_at: "2020-01-01T00:00:00Z" }).eq("presentation_id", purchasePresentation);
      assert.ok(edited.error, "an acknowledgement was edited");
      const removed = await adminClient().from("expectation_acknowledgements").delete().eq("presentation_id", purchasePresentation);
      assert.ok(removed.error, "an acknowledgement was deleted");
    });
  });

  // -------------------------------------------------------------------------
  describe("revisions and existing clients", () => {
    before(async () => {
      // A client who joined before this feature existed: a relationship with
      // no purchase snapshot of any expectations.
      const sb = adminClient();
      const { data: e } = await sb.from("enrollments").insert({ customer_id: customerLegacy.id, provider_id: coach.providerId, state: "active" }).select("id").single();
      legacyEnrollment = e!.id;
      enrollments.push(legacyEnrollment);
      await sb.from("enrollment_assignments").insert({ enrollment_id: legacyEnrollment, provider_id: coach.providerId, effective_from: days(-60), reason: "initial_purchase" });
    });

    test("an existing client is given no invented history", async () => {
      const { data } = await customerLegacy.client.from("enrollment_expectations").select("id").eq("enrollment_id", legacyEnrollment);
      assert.equal((data ?? []).length, 0, "a document was attached to a purchase that never showed one");
    });

    test("a meaningful revision is presented and noticed, and the earlier acknowledgement stands", async () => {
      const before = await commercialState();
      const d = await publishCoachExpectations(coach, { response_expectation: "Within two working days." }, { material: true, summary: "Slower replies on weekends." });

      const { data: rows } = await customerA.client.from("enrollment_expectations")
        .select("id, source, coach_version_id, previous_id, acknowledgement_requested, expectation_acknowledgements(id)")
        .eq("enrollment_id", enrollmentId).order("presented_at", { ascending: false });
      assert.equal(rows![0].coach_version_id, d);
      assert.equal(rows![0].source, "revision");
      assert.equal(rows![0].previous_id, purchasePresentation);
      assert.equal(rows![0].acknowledgement_requested, true);
      const earlier = rows!.find((r) => r.id === purchasePresentation)!;
      // One acknowledgement per presentation, so the API returns it as an object.
      const acks = earlier.expectation_acknowledgements;
      assert.ok(Array.isArray(acks) ? acks.length === 1 : Boolean(acks), "the earlier acknowledgement was lost");
      assert.equal(await commercialState(), before, "a revision changed the purchase's terms or the relationship");

      // The notice carries identifiers only — never the document's words.
      const { data: jobs } = await adminClient().from("outbox").select("payload, dedupe_key").eq("topic", "email.expectations_updated").eq("payload->>enrollment_id", enrollmentId);
      assert.equal((jobs ?? []).length, 1);
      assert.deepEqual(Object.keys(jobs![0].payload).sort(), ["customer_id", "enrollment_id", "presentation_id", "provider_id"]);
      assert.equal(JSON.stringify(jobs![0].payload).includes("Within two"), false);
    });

    test("the same revision reaches the existing client, labelled as new to them", async () => {
      const { data } = await customerLegacy.client.from("enrollment_expectations").select("source, acknowledgement_requested, purchase_id").eq("enrollment_id", legacyEnrollment);
      assert.equal((data ?? []).length, 1);
      assert.equal(data![0].source, "legacy");
      assert.equal(data![0].purchase_id, null, "presented as if it had been part of their purchase");
      assert.equal(data![0].acknowledgement_requested, true);
    });

    test("a minor correction is shared for information, without asking or emailing", async () => {
      await publishCoachExpectations(coach, { response_expectation: "Within two working days (weekdays)." }, { material: false });
      const { data: rows } = await customerA.client.from("enrollment_expectations")
        .select("acknowledgement_requested").eq("enrollment_id", enrollmentId).order("presented_at", { ascending: false }).limit(1);
      assert.equal(rows![0].acknowledgement_requested, false);
      const { count } = await adminClient().from("outbox").select("id", { count: "exact", head: true })
        .eq("topic", "email.expectations_updated").eq("payload->>enrollment_id", enrollmentId);
      assert.equal(count, 1, "a minor correction sent an email");
    });
  });

  // -------------------------------------------------------------------------
  describe("a coach change", () => {
    test("the incoming coach's version is presented; the former coach loses access", async () => {
      await publishCoachExpectations(coachOther);
      const sb = adminClient();
      const now = new Date().toISOString();
      await sb.from("enrollment_assignments").update({ effective_to: now }).eq("enrollment_id", enrollmentId).is("effective_to", null);
      const { error } = await sb.from("enrollment_assignments").insert({
        enrollment_id: enrollmentId, provider_id: coachOther.providerId, previous_provider_id: coach.providerId,
        effective_from: now, reason: "test_reassignment",
      });
      assert.equal(error, null, error?.message);
      await sb.from("enrollments").update({ provider_id: coachOther.providerId }).eq("id", enrollmentId);

      const { data: rows } = await customerA.client.from("enrollment_expectations").select("source, provider_id").eq("enrollment_id", enrollmentId).order("presented_at", { ascending: false }).limit(1);
      assert.equal(rows![0].source, "reassignment");
      assert.equal(rows![0].provider_id, coachOther.providerId);
      assert.ok(wasDenied(await coach.user.client.from("enrollment_expectations").select("id").eq("enrollment_id", enrollmentId)), "the former coach can still read the client's document");
      const asNew = await coachOther.user.client.from("enrollment_expectations").select("id").eq("enrollment_id", enrollmentId);
      assert.ok((asNew.data ?? []).length >= 1);
      // The client still has everything they were ever shown.
      const all = await customerA.client.from("enrollment_expectations").select("id").eq("enrollment_id", enrollmentId);
      assert.equal((all.data ?? []).length, 4);
      void otherOfferVersionId;
    });
  });
});
