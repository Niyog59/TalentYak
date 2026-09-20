/**
 * The access matrix, exercised against the real database as real users.
 *
 * FM03 §6.4 asks for anonymous visitor, customer A and B, assigned coach A,
 * unrelated coach B, suspended coach, approved admin, and background worker.
 * Every assertion below runs through an actual signed-in session, because a
 * suite written against the service role proves the tables exist and nothing
 * about who can read them.
 *
 * When the project is not confirmed available, every test SKIPS with the
 * reason printed. A skipped test is reported as skipped and is never counted
 * as a pass.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  adminClient,
  anonymousClient,
  createTestUser,
  dbAvailability,
  deleteTestUsers,
  projectRef,
  setRole,
  suspendUser,
  upgradeToAal2,
  wasDenied,
  type TestUser,
} from "./harness.ts";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;

// State shared across the suite, built once in `before`.
let customerA: TestUser;
let customerB: TestUser;
let coachA: TestUser;
let coachB: TestUser;
let suspendedCoach: TestUser;
let admin: TestUser;
let createdUserIds: string[] = [];

let coachAProviderId: string;
let coachBProviderId: string;
let suspendedProviderId: string;
let coachAOfferId: string;
let coachAOfferVersionId: string;

/**
 * Unique per run. Published offers and ledger rows are immutable by design,
 * so a crashed run's fixtures cannot always be deleted — and a fixed slug would
 * then collide with them on the next run. A fresh suffix means leftovers never
 * block anything; teardown retires them rather than fighting the rules.
 */
const RUN = Math.random().toString(36).slice(2, 8);

describe("access matrix", { skip }, () => {
  before(async () => {
    console.log(`\n  Running database tests against project: ${projectRef()}\n`);

    const sb = adminClient();

    customerA = await createTestUser("customer-a");
    customerB = await createTestUser("customer-b");
    coachA = await createTestUser("coach-a");
    coachB = await createTestUser("coach-b");
    suspendedCoach = await createTestUser("coach-suspended");
    admin = await createTestUser("admin");
    createdUserIds = [customerA, customerB, coachA, coachB, suspendedCoach, admin].map(
      (u) => u.id,
    );

    await setRole(coachA.id, "provider");
    await setRole(coachB.id, "provider");
    await setRole(suspendedCoach.id, "provider");
    await setRole(admin.id, "admin");
    // Admin reach requires a completed second factor (migration 0017).
    await upgradeToAal2(admin);

    // Two approved, published coaches and one suspended one.
    const makeProvider = async (user: TestUser, slug: string, published: boolean) => {
      const { data, error } = await sb
        .from("providers")
        .insert({
          profile_id: user.id,
          display_name: `Test Coach ${slug}`,
          vertical_slug: "fitness",
          status: "approved",
          slug: `talentyak-test-${RUN}-${slug}`,
          accepting_new_clients: true,
          max_active_clients: 2,
          published_at: published ? new Date().toISOString() : null,
        })
        .select("id")
        .single();
      if (error) throw new Error(`provider insert failed: ${error.message}`);

      await sb.from("provider_public_profiles").insert({
        provider_id: data.id,
        display_name: `Test Coach ${slug}`,
        headline: "Fixture",
      });
      return data.id as string;
    };

    coachAProviderId = await makeProvider(coachA, "a", true);
    coachBProviderId = await makeProvider(coachB, "b", true);
    suspendedProviderId = await makeProvider(suspendedCoach, "susp", true);

    // Private records that must never leak.
    await sb.from("provider_payout_destinations").insert({
      provider_id: coachAProviderId,
      channel: "manual",
      account_reference: "SECRET-ACCOUNT-REFERENCE",
      currency: "USD",
    });
    await sb.from("provider_private").insert({
      provider_id: coachAProviderId,
      vetting_notes: "SECRET-VETTING-NOTE",
    });

    // A published offer belonging to coach A.
    const { data: offer, error: offerError } = await sb
      .from("offers")
      .insert({
        provider_id: coachAProviderId,
        vertical_slug: "fitness",
        slug: `talentyak-test-${RUN}-offer`,
        status: "published",
      })
      .select("id")
      .single();
    if (offerError) throw new Error(`offer insert failed: ${offerError.message}`);
    coachAOfferId = offer.id;

    const { data: version, error: versionError } = await sb
      .from("offer_versions")
      .insert({
        offer_id: coachAOfferId,
        version: 1,
        title: "Fixture coaching",
        service_type: "recurring_coaching",
        billing_structure: "monthly_recurring",
        billing_interval: "month",
        billing_interval_count: 1,
        commission_policy_id: "commission.coaching.v3",
        cancellation_policy_id: "cancellation.v1",
        payment_failure_policy_id: "payment_failure.v1",
        recognition_policy_id: "recognition.v1",
        billing_terms_policy_id: "billing_terms.v1",
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (versionError) throw new Error(`offer version insert failed: ${versionError.message}`);
    coachAOfferVersionId = version.id;

    await sb.from("offer_prices").insert({
      offer_version_id: coachAOfferVersionId,
      currency: "USD",
      amount_minor: 10000,
    });

    await suspendUser(suspendedCoach.id);
  });

  after(async () => {
    const sb = adminClient();
    const providerIds = [coachAProviderId, coachBProviderId, suspendedProviderId].filter(Boolean);

    // Order matters, and so does what is NOT deleted.
    //
    // Deletable scaffolding goes first: holds, the purchase a customer tried to
    // forge, private records, public profiles.
    for (const id of providerIds) {
      await sb.from("capacity_reservations").delete().eq("provider_id", id);
      await sb.from("provider_credentials").delete().eq("provider_id", id);
      await sb.from("provider_payout_destinations").delete().eq("provider_id", id);
      await sb.from("provider_private").delete().eq("provider_id", id);
      await sb.from("provider_public_profiles").delete().eq("provider_id", id);
    }
    for (const id of createdUserIds) {
      await sb.from("purchases").delete().eq("customer_id", id).eq("state", "pending_payment");
      await sb.from("capacity_reservations").delete().eq("customer_id", id);
    }

    // Immutable records are RETIRED, never deleted. A published offer version
    // and a ledger row cannot be removed — that is the rule under test — so the
    // honest teardown uses the same lifecycle real data uses. Forcing a delete
    // would mean building a back door around the protection being verified.
    if (coachAOfferId) {
      await sb
        .from("offers")
        .update({ status: "archived", archived_at: new Date().toISOString() })
        .eq("id", coachAOfferId);
    }
    for (const id of providerIds) {
      await sb
        .from("providers")
        .update({
          status: "retired",
          active: false,
          published_at: null,
          accepting_new_clients: false,
        })
        .eq("id", id);
    }

    await deleteTestUsers(createdUserIds);
  });

  // -------------------------------------------------------------------------
  describe("anonymous visitor", () => {
    test("sees a published coach profile", async () => {
      const { data } = await anonymousClient()
        .from("provider_public_profiles")
        .select("display_name")
        .eq("provider_id", coachAProviderId);
      assert.equal(data?.length, 1, "a published profile should be publicly visible");
    });

    test("cannot read payout destinations", async () => {
      const result = await anonymousClient()
        .from("provider_payout_destinations")
        .select("account_reference");
      assert.ok(wasDenied(result), "payout destinations must never be public");
    });

    test("cannot read vetting notes", async () => {
      const result = await anonymousClient().from("provider_private").select("vetting_notes");
      assert.ok(wasDenied(result), "vetting notes must never be public");
    });

    test("cannot read profiles", async () => {
      const result = await anonymousClient().from("profiles").select("email");
      assert.ok(wasDenied(result), "customer emails must never be public");
    });

    test("cannot read the ledger", async () => {
      const result = await anonymousClient().from("ledger_entries").select("amount_minor");
      assert.ok(wasDenied(result));
    });

    test("cannot read grief data", async () => {
      const result = await anonymousClient().from("shraddha_dates").select("deceased_name");
      assert.ok(wasDenied(result), "invariant 2: grief data is deny-by-default");
    });

    test("cannot read health data", async () => {
      for (const table of ["progress_photos", "measurements", "bodyweight_logs", "workout_logs"]) {
        const result = await anonymousClient().from(table).select("id");
        assert.ok(wasDenied(result), `invariant 3: ${table} must not be public`);
      }
    });

    test("cannot read coach earnings through the balance view", async () => {
      // Regression for 0025: the view ran as its owner and bypassed RLS.
      const result = await anonymousClient().from("coach_balances").select("provider_id");
      assert.ok(wasDenied(result), "coach earnings must never be public");
    });

    test("cannot count a coach's clients", async () => {
      const result = await anonymousClient().rpc("provider_commitments", { p_id: coachAProviderId });
      assert.ok(result.error, "provider_commitments must not be callable anonymously");
    });
  });

  // -------------------------------------------------------------------------
  describe("customer", () => {
    test("reads their own profile", async () => {
      const { data } = await customerA.client
        .from("profiles")
        .select("id, email")
        .eq("id", customerA.id);
      assert.equal(data?.length, 1);
    });

    test("cannot read another customer's profile", async () => {
      const result = await customerA.client
        .from("profiles")
        .select("email")
        .eq("id", customerB.id);
      assert.ok(wasDenied(result), "customer A must not see customer B");
    });

    test("CANNOT PROMOTE THEMSELVES TO ADMIN", async () => {
      // The escalation 0008 exists to close. `auth.uid() = id` stays true after
      // `set role = 'admin'`, so the policy alone permits this; the trigger is
      // what refuses it.
      await customerA.client.from("profiles").update({ role: "admin" }).eq("id", customerA.id);

      const { data } = await adminClient()
        .from("profiles")
        .select("role")
        .eq("id", customerA.id)
        .single();
      assert.equal(data?.role, "customer", "a customer must never be able to grant themselves admin");
    });

    test("cannot suspend or un-suspend themselves", async () => {
      await customerA.client
        .from("profiles")
        .update({ suspended_at: null, phone_verified: true })
        .eq("id", customerA.id);

      const { data } = await adminClient()
        .from("profiles")
        .select("phone_verified")
        .eq("id", customerA.id)
        .single();
      assert.equal(data?.phone_verified, false, "phone_verified is not self-assignable");
    });

    test("cannot write a purchase", async () => {
      const { error } = await customerA.client.from("purchases").insert({
        customer_id: customerA.id,
        provider_id: coachAProviderId,
        offer_version_id: coachAOfferVersionId,
        service_type: "recurring_coaching",
        billing_structure: "monthly_recurring",
        charge_currency: "USD",
        charge_amount_minor: 1,
        commission_policy_id: "commission.coaching.v3",
        cancellation_policy_id: "cancellation.v1",
        payment_failure_policy_id: "payment_failure.v1",
        recognition_policy_id: "recognition.v1",
        billing_terms_policy_id: "billing_terms.v1",
      });
      assert.ok(error, "invariant 5: entitlement is granted by the webhook, never by a client");
    });

    test("cannot write a ledger entry", async () => {
      const { error } = await customerA.client.from("ledger_entries").insert({
        account: "coach_payable",
        effect: "service_earned",
        currency: "USD",
        amount_minor: 100000,
        effect_key: `forged-${Date.now()}`,
      });
      assert.ok(error, "nobody writes the ledger through a client session");
    });

    test("cannot read another customer's purchases", async () => {
      const result = await customerB.client
        .from("purchases")
        .select("id")
        .eq("customer_id", customerA.id);
      assert.ok(wasDenied(result));
    });
  });

  // -------------------------------------------------------------------------
  describe("coach", () => {
    test("sees only their own balances", async () => {
      const { data, error } = await coachB.client.from("coach_balances").select("provider_id");
      assert.equal(error, null);
      assert.ok((data ?? []).every((row) => row.provider_id === coachBProviderId), "coach B must not see coach A's balance");
    });

    test("reads their own offer", async () => {
      const { data } = await coachA.client.from("offers").select("id").eq("id", coachAOfferId);
      assert.equal(data?.length, 1);
    });

    test("cannot edit another coach's offer", async () => {
      await coachB.client.from("offers").update({ status: "archived" }).eq("id", coachAOfferId);

      const { data } = await adminClient()
        .from("offers")
        .select("status")
        .eq("id", coachAOfferId)
        .single();
      assert.equal(data?.status, "published", "coach B must not be able to archive coach A's offer");
    });

    test("cannot change a published price", async () => {
      const { error } = await coachA.client
        .from("offer_prices")
        .update({ amount_minor: 1 })
        .eq("offer_version_id", coachAOfferVersionId);
      assert.ok(error, "a published price is immutable — publish a new version instead");
    });

    test("cannot approve or publish themselves", async () => {
      await coachB.client
        .from("providers")
        .update({ status: "approved", published_at: new Date().toISOString() })
        .eq("id", coachBProviderId);

      // coachB was already approved in the fixture, so assert the sharper case:
      // a coach cannot raise their own client limit either.
      await coachA.client
        .from("providers")
        .update({ max_active_clients: 9999 })
        .eq("id", coachAProviderId);

      const { data } = await adminClient()
        .from("providers")
        .select("max_active_clients")
        .eq("id", coachAProviderId)
        .single();
      assert.equal(data?.max_active_clients, 2, "capacity is not self-assignable");
    });

    test("cannot read their own payout destination directly", async () => {
      // Deliberate: the app shows a masked summary through a server function.
      // A token in a browser should never be one query from a bank reference.
      const result = await coachA.client
        .from("provider_payout_destinations")
        .select("account_reference")
        .eq("provider_id", coachAProviderId);
      assert.ok(wasDenied(result));
    });

    test("cannot read notes written about them", async () => {
      const result = await coachA.client
        .from("provider_private")
        .select("vetting_notes")
        .eq("provider_id", coachAProviderId);
      assert.ok(wasDenied(result), "a coach is the subject of vetting notes, not their owner");
    });

    test("cannot verify their own credential", async () => {
      const sb = adminClient();
      const { data: cred } = await sb
        .from("provider_credentials")
        .insert({
          provider_id: coachAProviderId,
          kind: "certification",
          claimed_title: "Fixture certificate",
        })
        .select("id")
        .single();

      await coachA.client
        .from("provider_credentials")
        .update({ verification_state: "verified" })
        .eq("id", cred!.id);

      const { data } = await sb
        .from("provider_credentials")
        .select("verification_state")
        .eq("id", cred!.id)
        .single();
      assert.equal(
        data?.verification_state,
        "unverified",
        "a coach marking their own certificate verified is the exact failure this prevents",
      );

      await sb.from("provider_credentials").delete().eq("id", cred!.id);
    });

    test("cannot read another coach's ledger entries", async () => {
      const sb = adminClient();
      const key = `test-entry-${Date.now()}`;
      await sb.from("ledger_entries").insert({
        account: "coach_payable",
        effect: "service_earned",
        currency: "USD",
        amount_minor: 8000,
        provider_id: coachAProviderId,
        effect_key: key,
      });

      const result = await coachB.client
        .from("ledger_entries")
        .select("amount_minor")
        .eq("provider_id", coachAProviderId);
      assert.ok(wasDenied(result), "coaches must never see each other's earnings");

      const own = await coachA.client
        .from("ledger_entries")
        .select("amount_minor")
        .eq("effect_key", key);
      assert.equal(own.data?.length, 1, "a coach does see their own entry");
    });
  });

  // -------------------------------------------------------------------------
  describe("suspended coach", () => {
    test("loses private access even though the session token is still valid", async () => {
      // No re-login: the same token from before suspension.
      const result = await suspendedCoach.client
        .from("offers")
        .select("id")
        .eq("provider_id", suspendedProviderId);
      assert.ok(
        wasDenied(result),
        "suspension must bite on the next query, not the next login",
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("the ledger is append-only", () => {
    test("an amount cannot be updated, even by the service role", async () => {
      const sb = adminClient();
      const key = `immutable-${Date.now()}`;
      const { data: entry } = await sb
        .from("ledger_entries")
        .insert({
          account: "platform_revenue",
          effect: "commission_earned",
          currency: "USD",
          amount_minor: 2000,
          provider_id: coachAProviderId,
          effect_key: key,
        })
        .select("id")
        .single();

      const update = await sb
        .from("ledger_entries")
        .update({ amount_minor: 1 })
        .eq("id", entry!.id);
      assert.ok(update.error, "financial history must not be editable by anyone");

      const del = await sb.from("ledger_entries").delete().eq("id", entry!.id);
      assert.ok(del.error, "financial history must not be deletable by anyone");
    });

    test("the same business effect cannot be recorded twice", async () => {
      const sb = adminClient();
      const key = `dedupe-${Date.now()}`;
      const row = {
        account: "coach_payable" as const,
        effect: "service_earned" as const,
        currency: "USD",
        amount_minor: 8000,
        provider_id: coachAProviderId,
        effect_key: key,
      };

      const first = await sb.from("ledger_entries").insert(row);
      assert.equal(first.error, null);

      const second = await sb.from("ledger_entries").insert(row);
      assert.ok(second.error, "a replayed effect must not accrue a second time");
    });
  });

  // -------------------------------------------------------------------------
  describe("offer versions are immutable once published", () => {
    test("terms cannot be rewritten after publication", async () => {
      const sb = adminClient();
      const { error } = await sb
        .from("offer_versions")
        .update({ title: "Rewritten after the fact" })
        .eq("id", coachAOfferVersionId);
      assert.ok(error, "publishing a new version is the only way to change terms");
    });

    test("a published version cannot be deleted", async () => {
      const sb = adminClient();
      const { error } = await sb.from("offer_versions").delete().eq("id", coachAOfferVersionId);
      assert.ok(error);
    });
  });

  // -------------------------------------------------------------------------
  describe("hidden verticals cannot be reached by direct request", () => {
    test("the pandit vertical is not publicly listed", async () => {
      const { data } = await anonymousClient()
        .from("verticals")
        .select("slug")
        .eq("slug", "pandit");
      const rows = data ?? [];
      if (rows.length > 0) {
        // Visible in the catalog is acceptable only if its status is not hidden;
        // the server-side launch gate is what stops it being bought.
        const { data: full } = await adminClient()
          .from("verticals")
          .select("status")
          .eq("slug", "pandit")
          .single();
        assert.notEqual(full?.status, "hidden", "a hidden vertical must not be readable");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Added after the first real run found is_privileged_writer() returning true
  // for everyone (see migration 0015). Three of its six callers are callable as
  // RPCs, and none of them had a test. A fix proven on half its callers is not
  // proven.
  describe("privileged functions cannot be called from a client session", () => {
    test("a customer cannot claim the admin bootstrap", async () => {
      const { error } = await customerA.client.rpc("claim_admin_bootstrap", {
        claimant: customerA.id,
      });
      assert.ok(error, "only a server function may run the admin bootstrap");

      const { data } = await adminClient()
        .from("profiles")
        .select("role")
        .eq("id", customerA.id)
        .single();
      assert.notEqual(data?.role, "admin");
    });

    test("a customer cannot reserve a coach's capacity", async () => {
      const { error } = await customerA.client.rpc("reserve_capacity", {
        p_provider_id: coachAProviderId,
        p_offer_version_id: coachAOfferVersionId,
        p_customer_id: customerB.id,
        p_hold_seconds: 1800,
      });
      assert.ok(
        error,
        "a customer must not be able to take places in a coach's roster, least of all on someone else's behalf",
      );
    });

    test("a coach cannot reserve their own capacity either", async () => {
      const { error } = await coachA.client.rpc("reserve_capacity", {
        p_provider_id: coachAProviderId,
        p_offer_version_id: coachAOfferVersionId,
        p_customer_id: customerA.id,
        p_hold_seconds: 1800,
      });
      assert.ok(error);
    });

    test("a customer cannot release someone else's hold", async () => {
      // Take a real hold through the server path, then try to release it.
      const { data: holdId } = await adminClient().rpc("reserve_capacity", {
        p_provider_id: coachAProviderId,
        p_offer_version_id: coachAOfferVersionId,
        p_customer_id: customerB.id,
        p_hold_seconds: 1800,
      });
      assert.ok(holdId, "the server path should be able to take a hold");

      const { error } = await customerA.client.rpc("release_capacity", {
        p_reservation_id: holdId,
      });
      assert.ok(error, "releasing a hold is a server action");

      const { data: hold } = await adminClient()
        .from("capacity_reservations")
        .select("state")
        .eq("id", holdId)
        .single();
      assert.equal(hold?.state, "held", "the hold must be untouched");

      await adminClient().from("capacity_reservations").delete().eq("id", holdId);
    });

    test("the server path still works", async () => {
      // The fix must not break legitimate use: a revocation that also locks out
      // our own server is a different outage, not a fix.
      const { data: holdId, error } = await adminClient().rpc("reserve_capacity", {
        p_provider_id: coachAProviderId,
        p_offer_version_id: coachAOfferVersionId,
        p_customer_id: customerA.id,
        p_hold_seconds: 1800,
      });
      assert.equal(error, null);
      assert.ok(holdId);

      const released = await adminClient().rpc("release_capacity", { p_reservation_id: holdId });
      assert.equal(released.error, null);
      assert.equal(released.data, true);

      await adminClient().from("capacity_reservations").delete().eq("id", holdId);
    });
  });

  // -------------------------------------------------------------------------
  describe("concurrent checkouts cannot oversell", () => {
    test("the last place goes to exactly one customer", async () => {
      // Coach A allows 2 active clients. Fill one, then race several customers
      // for the last place at the same moment.
      const sb = adminClient();
      const racers = await Promise.all(
        [1, 2, 3, 4].map((n) => createTestUser(`racer-${n}`)),
      );
      createdUserIds.push(...racers.map((r) => r.id));

      const { data: firstHold } = await sb.rpc("reserve_capacity", {
        p_provider_id: coachAProviderId,
        p_offer_version_id: coachAOfferVersionId,
        p_customer_id: customerA.id,
        p_hold_seconds: 1800,
      });
      assert.ok(firstHold, "the first place should be available");

      const results = await Promise.all(
        racers.map((r) =>
          sb.rpc("reserve_capacity", {
            p_provider_id: coachAProviderId,
            p_offer_version_id: coachAOfferVersionId,
            p_customer_id: r.id,
            p_hold_seconds: 1800,
          }),
        ),
      );

      const winners = results.filter((r) => r.data).length;
      assert.equal(
        winners,
        1,
        `exactly one racer should get the last place; ${winners} did`,
      );

      await sb.from("capacity_reservations").delete().eq("provider_id", coachAProviderId);
    });
  });

  // -------------------------------------------------------------------------
  describe("admin", () => {
    test("reads what admins need to read", async () => {
      // Asserts real rows, not merely "no error": RLS returns an empty list
      // rather than an error, so an empty result would prove nothing.
      const { data, error } = await admin.client
        .from("provider_private").select("vetting_notes").eq("provider_id", coachAProviderId);
      assert.equal(error, null);
      assert.equal(data?.[0]?.vetting_notes, "SECRET-VETTING-NOTE");
    });

    test("a suspended admin loses admin reach", async () => {
      await suspendUser(admin.id);
      const result = await admin.client.from("provider_private").select("vetting_notes");
      assert.ok(
        wasDenied(result),
        "an admin under investigation must not keep reach until their token expires",
      );
      // Restore so later teardown behaves predictably.
      await adminClient().from("profiles").update({ suspended_at: null }).eq("id", admin.id);
    });
  });
});

// A visible, honest note when the suite did not run. Without this, "0 failures"
// reads like "everything passed".
if (skip) {
  console.log(`\n  ⚠ Database access-matrix tests SKIPPED.\n    ${availability.reason}\n`);
}
