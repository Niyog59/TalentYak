import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { money } from "@/lib/money/money";
import {
  CURRENT_COMMISSION_POLICY_ID,
  PAUSED_FOR_PAYMENT_NOTICE,
  currentMessagingPolicy,
  LiveBillingNotPermittedError,
  UnknownPolicyError,
  assertLiveBillingPermitted,
  commissionBasisPointsFor,
  currentCommissionPolicy,
  currentPolicySnapshot,
  evaluateLiveReadiness,
  getCommissionPolicy,
  getPolicy,
  listPolicies,
  previewEarnings,
  reverseUnderPolicy,
  splitUnderPolicy,
} from "@/lib/policy";

describe("the register", () => {
  test("every policy id is unique", () => {
    const ids = listPolicies().map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("a superseded policy names a successor that exists", () => {
    for (const policy of listPolicies()) {
      if (policy.supersededBy) {
        assert.doesNotThrow(
          () => getPolicy(policy.supersededBy as string),
          `${policy.id} names a successor that is not registered`,
        );
      }
    }
  });

  test("an unknown id throws instead of returning undefined", () => {
    assert.throws(() => getPolicy("commission.coaching.v999"), UnknownPolicyError);
  });

  test("every policy in the current snapshot resolves", () => {
    for (const id of Object.values(currentPolicySnapshot())) {
      assert.doesNotThrow(() => getPolicy(id));
    }
  });

  test("the current commission policy is not itself superseded", () => {
    assert.equal(currentCommissionPolicy().supersededBy, undefined);
    assert.equal(currentCommissionPolicy().id, CURRENT_COMMISSION_POLICY_ID);
  });
});

describe("the current commission rate", () => {
  test("is 20% for both recurring coaching and one-off consultations", () => {
    const policy = currentCommissionPolicy();
    assert.equal(commissionBasisPointsFor(policy, "recurring_coaching"), 2000);
    assert.equal(commissionBasisPointsFor(policy, "one_off_consultation"), 2000);
  });

  test("charges commission on the service amount, never on tax", () => {
    assert.equal(
      currentCommissionPolicy().baseRule,
      "service_amount_excluding_tax_after_coach_funded_discount",
    );
  });

  test("puts ordinary processing costs on the platform, not on the coach's 80%", () => {
    assert.equal(currentCommissionPolicy().processingCostsBorneBy, "platform");
  });

  test("classifies by service type, so a prepaid term is still coaching", () => {
    const policy = currentCommissionPolicy();
    // A six-month package paid once is recurring coaching, not a consultation.
    assert.equal(
      commissionBasisPointsFor(policy, "recurring_coaching"),
      commissionBasisPointsFor(policy, "one_off_consultation"),
    );
  });
});

describe("historical policies stay interpretable", () => {
  test("the Aafnai-era rates are preserved, not overwritten", () => {
    const v2 = getCommissionPolicy("commission.coaching.v2");
    assert.equal(v2.recurringBasisPoints, 3000);
    assert.equal(v2.oneOffBasisPoints, 4000);
    assert.equal(v2.supersededBy, CURRENT_COMMISSION_POLICY_ID);
  });

  test("the Ghartira-era 60/40 rate is preserved", () => {
    const v1 = getCommissionPolicy("commission.coaching.v1");
    assert.equal(v1.recurringBasisPoints, 4000);
  });

  test("the pandit post-cost rule is separate and not superseded", () => {
    const pandit = getCommissionPolicy("commission.pandit.v1");
    assert.equal(pandit.deductsDirectCostsFirst, true);
    assert.equal(pandit.supersededBy, undefined);
  });

  test("an old purchase keeps its old economics", () => {
    // A purchase snapshotted under v2 is still split at 70/30, not at today's 80/20.
    const old = splitUnderPolicy({
      serviceAmount: money(10_000, "USD"),
      serviceType: "recurring_coaching",
      commissionPolicyId: "commission.coaching.v2",
    });
    assert.equal(old.coachEntitlement.minor, 7000);

    const current = splitUnderPolicy({
      serviceAmount: money(10_000, "USD"),
      serviceType: "recurring_coaching",
      commissionPolicyId: CURRENT_COMMISSION_POLICY_ID,
    });
    assert.equal(current.coachEntitlement.minor, 8000);
  });

  test("a refund against an old purchase reverses at the old rate", () => {
    const reversal = reverseUnderPolicy({
      serviceAmount: money(10_000, "USD"),
      serviceType: "recurring_coaching",
      commissionPolicyId: "commission.coaching.v2",
      previouslyRefunded: money(0, "USD"),
      refundAmount: money(10_000, "USD"),
    });
    assert.equal(reversal.coachEntitlementReversal.minor, 7000);
    assert.equal(reversal.platformCommissionReversal.minor, 3000);
  });
});

describe("the coach's earnings preview", () => {
  test("shows customer pays, platform 20%, and the coach's share", () => {
    const preview = previewEarnings({
      price: money(10_000, "USD"),
      serviceType: "recurring_coaching",
    });

    assert.equal(preview.customerPays.minor, 10_000);
    assert.equal(preview.platformCommission.minor, 2000);
    assert.equal(preview.coachShare.minor, 8000);
    assert.equal(preview.commissionBasisPoints, 2000);
  });

  test("adds no customer service fee and no hidden markup", () => {
    const price = money(4999, "USD");
    const preview = previewEarnings({ price, serviceType: "recurring_coaching" });
    assert.equal(preview.customerPays.minor, price.minor);
  });

  test("does not present transfer costs as known", () => {
    const preview = previewEarnings({
      price: money(10_000, "USD"),
      serviceType: "one_off_consultation",
    });
    assert.equal(preview.transferCostsUnknown, true);
  });

  test("records which policy version produced it", () => {
    const preview = previewEarnings({
      price: money(10_000, "USD"),
      serviceType: "recurring_coaching",
    });
    assert.equal(preview.commissionPolicyId, CURRENT_COMMISSION_POLICY_ID);
  });
});

describe("the approved paid-access rules (2026-09-22)", () => {
  const cancellation = getPolicy(currentPolicySnapshot().cancellationPolicyId);
  const paymentFailure = getPolicy(currentPolicySnapshot().paymentFailurePolicyId);

  test("cancelling keeps access until the paid period ends, and that rule is approved", () => {
    assert.equal(cancellation.id, "cancellation.v2");
    assert.equal(cancellation.status, "confirmed");
    assert.equal(cancellation.kind === "cancellation" && cancellation.retainsAccessUntilPaidThrough, true);
    assert.equal(cancellation.kind === "cancellation" && cancellation.retainsReadOnlyHistoryAfterEnd, true);
  });

  test("a failed renewal pauses new service without a grace period and without erasing anything", () => {
    assert.equal(paymentFailure.id, "payment_failure.v2");
    assert.equal(paymentFailure.status, "confirmed");
    if (paymentFailure.kind !== "payment_failure") throw new Error("wrong kind");
    assert.equal(paymentFailure.graceDays, 0, "the grace period IS the time already paid for");
    assert.equal(paymentFailure.pausesNewServiceWhenUnpaid, true);
    assert.equal(paymentFailure.failedRenewalErasesHistory, false, "payment failure must never delete anything");
    assert.equal(paymentFailure.retainsReadableRecords, true);
    assert.equal(paymentFailure.paymentRestoresPausedAccess, true);
  });

  test("messaging follows the same approved rules: no new messages while paused, history stays readable", () => {
    const messaging = currentMessagingPolicy();
    assert.equal(messaging.id, "messaging.v2");
    assert.equal(messaging.status, "confirmed");
    assert.equal(messaging.sendWhilePaused, false);
    assert.equal(messaging.clientReadsAfterEnd, true);
  });

  test("the customer wording exists once and is shared by both policies", () => {
    assert.equal(PAUSED_FOR_PAYMENT_NOTICE, "Your payment didn\u2019t go through. Renew to continue coaching. Your progress is saved.");
    if (paymentFailure.kind !== "payment_failure") throw new Error("wrong kind");
    assert.equal(paymentFailure.customerNotice, PAUSED_FOR_PAYMENT_NOTICE);
    assert.equal(currentMessagingPolicy().pausedNotice, PAUSED_FOR_PAYMENT_NOTICE);
  });

  test("the versions they replace are kept, superseded rather than edited", () => {
    for (const [oldId, newId] of [["cancellation.v1", "cancellation.v2"], ["payment_failure.v1", "payment_failure.v2"], ["messaging.v1", "messaging.v2"]]) {
      const previous = getPolicy(oldId);
      assert.equal(previous.supersededBy, newId);
      assert.equal(previous.status, "sandbox_default", "a superseded version keeps the status it had");
    }
  });

  test("approving these two does not open live billing on its own", () => {
    const readiness = evaluateLiveReadiness();
    assert.equal(readiness.ready, false);
    assert.ok(
      !readiness.blockers.some((b) => b.includes("cancellationPolicyId") || b.includes("paymentFailurePolicyId")),
      "the approved policies must no longer be listed as blockers",
    );
    assert.ok(
      readiness.blockers.some((b) => b.includes("eligibilityPolicyId")),
      "the policies still awaiting approval must still block",
    );
  });
});

describe("the live-billing gate", () => {
  let savedFlag: string | undefined;

  beforeEach(() => {
    savedFlag = process.env.LIVE_BILLING;
  });

  afterEach(() => {
    if (savedFlag === undefined) delete process.env.LIVE_BILLING;
    else process.env.LIVE_BILLING = savedFlag;
  });

  test("is closed by default", () => {
    delete process.env.LIVE_BILLING;
    const readiness = evaluateLiveReadiness();
    assert.equal(readiness.ready, false);
    assert.ok(readiness.blockers.some((b) => b.includes("LIVE_BILLING")));
  });

  test("stays closed even when the environment flag is set, while policies are unapproved", () => {
    process.env.LIVE_BILLING = "true";
    const readiness = evaluateLiveReadiness();
    assert.equal(
      readiness.ready,
      false,
      "an environment variable alone must not open live billing",
    );
    assert.ok(
      readiness.blockers.some((b) => b.includes("sandbox default")),
      "the blockers must name the unapproved policies",
    );
  });

  test("names every unapproved policy rather than failing with one message", () => {
    process.env.LIVE_BILLING = "true";
    const { blockers } = evaluateLiveReadiness();
    // Cancellation and payment failure were approved on 2026-09-22 and are
    // deliberately absent: the gate must name what is STILL unapproved.
    for (const kind of [
      "discountPolicyId",
      "billingTermsPolicyId",
      "recognitionPolicyId",
      "payoutPolicyId",
      "eligibilityPolicyId",
    ]) {
      assert.ok(
        blockers.some((b) => b.startsWith(kind)),
        `${kind} should be listed as a blocker`,
      );
    }
  });

  test("the guard throws, so a caller cannot ignore it", () => {
    delete process.env.LIVE_BILLING;
    assert.throws(
      () => assertLiveBillingPermitted("create a live Checkout Session"),
      LiveBillingNotPermittedError,
    );
  });

  test("the thrown error explains what is blocking", () => {
    delete process.env.LIVE_BILLING;
    try {
      assertLiveBillingPermitted("charge a card");
      assert.fail("expected the guard to throw");
    } catch (error) {
      assert.ok(error instanceof LiveBillingNotPermittedError);
      assert.ok(error.blockers.length > 0);
      assert.ok(error.message.includes("charge a card"));
    }
  });
});

describe("policies that are not yet approved stay switched off", () => {
  test("prepaid terms are modelled but disabled", () => {
    const terms = getPolicy(currentPolicySnapshot().billingTermsPolicyId);
    assert.equal(terms.kind, "billing_terms");
    if (terms.kind !== "billing_terms") return;
    assert.equal(terms.prepaidTermEnabled, false);
    assert.equal(terms.monthlyRecurringEnabled, true);
  });

  test("platform-funded campaigns are disabled", () => {
    const discount = getPolicy(currentPolicySnapshot().discountPolicyId);
    assert.equal(discount.kind, "discount");
    if (discount.kind !== "discount") return;
    assert.equal(discount.platformFundedCampaignsEnabled, false);
    assert.equal(discount.platformFundedProtectsCoachShare, true);
  });

  test("no market and no payout corridor is activated by default", () => {
    const eligibility = getPolicy(currentPolicySnapshot().eligibilityPolicyId);
    assert.equal(eligibility.kind, "eligibility");
    if (eligibility.kind !== "eligibility") return;
    assert.deepEqual(eligibility.enabledCustomerCountries, []);
    assert.deepEqual(eligibility.approvedPayoutCorridors, []);
    assert.equal(eligibility.minimumCustomerAge, 18);
  });

  test("automated coach transfers are disabled and evidence is required", () => {
    const payout = getPolicy(currentPolicySnapshot().payoutPolicyId);
    assert.equal(payout.kind, "payout");
    if (payout.kind !== "payout") return;
    assert.equal(payout.automatedTransfersEnabled, false);
    assert.equal(payout.settlementEvidenceRequired, true);
    assert.equal(payout.schedule, "monthly_in_arrears");
  });

  test("cancelling is not a refund", () => {
    const cancellation = getPolicy(currentPolicySnapshot().cancellationPolicyId);
    assert.equal(cancellation.kind, "cancellation");
    if (cancellation.kind !== "cancellation") return;
    assert.equal(cancellation.cancellationImpliesRefund, false);
    assert.equal(cancellation.retainsAccessUntilPaidThrough, true);
  });

  test("a failed renewal grants no new service period and erases no history", () => {
    const failure = getPolicy(currentPolicySnapshot().paymentFailurePolicyId);
    assert.equal(failure.kind, "payment_failure");
    if (failure.kind !== "payment_failure") return;
    assert.equal(failure.graceDays, 0);
    assert.equal(failure.failedRenewalErasesHistory, false);
  });

  test("a one-off earning needs a completion event, not a successful checkout", () => {
    const recognition = getPolicy(currentPolicySnapshot().recognitionPolicyId);
    assert.equal(recognition.kind, "recognition");
    if (recognition.kind !== "recognition") return;
    assert.equal(recognition.oneOffRequiresCompletionEvent, true);
    assert.equal(recognition.recurringRecognisedOverServicePeriod, true);
  });

  test("an existing subscriber is not repriced by a new version", () => {
    const priceChange = getPolicy(currentPolicySnapshot().priceChangePolicyId);
    assert.equal(priceChange.kind, "price_change");
    if (priceChange.kind !== "price_change") return;
    assert.equal(priceChange.existingSubscribersKeepContractedPrice, true);
    assert.equal(priceChange.migrationOfExistingSubscribersEnabled, false);
  });
});

describe("selling a specific offer for real money", () => {
  test("stays blocked even with every policy approved, because legal terms are drafts and fulfilment is unbuilt", async () => {
    const { evaluateSaleReadiness } = await import("@/lib/policy");
    const saved = process.env.LIVE_BILLING;
    process.env.LIVE_BILLING = "true";
    try {
      const readiness = evaluateSaleReadiness({ programme_included: true, calls_included_per_month: 4 });
      assert.equal(readiness.ready, false);
      assert.ok(readiness.blockers.some((b) => b.includes("drafts")), "legal drafts block live sales");
      assert.ok(readiness.blockers.some((b) => b.includes("Scheduled video and audio calls")), "an offer with calls is blocked until calls exist");
      assert.ok(readiness.blockers.some((b) => b.includes("training programmes")));
    } finally {
      if (saved === undefined) delete process.env.LIVE_BILLING;
      else process.env.LIVE_BILLING = saved;
    }
  });

  test("even an offer promising nothing extra is blocked while tracking is unbuilt", async () => {
    const { evaluateSaleReadiness } = await import("@/lib/policy");
    const readiness = evaluateSaleReadiness({});
    assert.ok(readiness.blockers.some((b) => b.includes("tracking")));
  });
});
