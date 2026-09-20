import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { money } from "@/lib/money/money";
import {
  coachBalance,
  dedupeByEffectKey,
  effectKeys,
  entriesForCycleEarning,
  entriesForDisputeLost,
  entriesForDisputeOpened,
  entriesForDisputeWon,
  entriesForPayout,
  entriesForRefund,
  entriesForReturnedPayout,
  summarise,
  type LedgerEntryDraft,
} from "@/lib/ledger/effects";

const USD = "USD";
const POLICY = "commission.coaching.v3";
const usd = (n: number) => money(n, USD);

const baseCycle = {
  billingCycleId: "cycle-1",
  purchaseId: "purchase-1",
  providerId: "coach-1",
  customerId: "customer-1",
  serviceAmount: usd(10_000),
  serviceType: "recurring_coaching" as const,
  commissionPolicyId: POLICY,
  delivered: false,
};

describe("earning a billing cycle", () => {
  test("splits 80/20 and records both sides", () => {
    const entries = entriesForCycleEarning(baseCycle);

    const coach = entries.find((e) => e.account === "coach_payable");
    const platform = entries.find((e) => e.account === "platform_revenue");

    assert.equal(coach?.amountMinor, 8000);
    assert.equal(platform?.amountMinor, 2000);
    assert.equal(coach?.commissionPolicyId, POLICY);
  });

  test("a payment arriving does not make the money earned", () => {
    const entries = entriesForCycleEarning({ ...baseCycle, delivered: false });
    for (const entry of entries) {
      assert.equal(
        entry.initialState,
        "pending",
        "an undelivered cycle must not produce an eligible balance",
      );
    }
  });

  test("delivery is what makes it eligible", () => {
    const entries = entriesForCycleEarning({ ...baseCycle, delivered: true });
    const coach = entries.find((e) => e.account === "coach_payable");
    assert.equal(coach?.initialState, "eligible");
  });

  test("a one-off consultation still sits pending after a successful checkout", () => {
    // There is no appointment lifecycle yet, so `delivered` can only be false.
    // Nothing in this codebase may fabricate the completion that releases it.
    const entries = entriesForCycleEarning({
      ...baseCycle,
      serviceType: "one_off_consultation",
      delivered: false,
    });
    assert.ok(entries.every((e) => e.initialState === "pending"));
  });

  test("a platform-funded promotion leaves the coach's entitlement alone", () => {
    const entries = entriesForCycleEarning({
      ...baseCycle,
      platformFundedDiscount: usd(1000),
    });

    const coach = entries.find((e) => e.account === "coach_payable");
    const subsidy = entries.find((e) => e.account === "platform_subsidy");

    assert.equal(coach?.amountMinor, 8000, "the coach's 80% is untouched by our promotion");
    assert.equal(subsidy?.amountMinor, -1000, "the subsidy is its own negative entry");

    const totals = summarise(entries);
    assert.equal(totals.get("platform_revenue:USD")?.minor, 2000);
    assert.equal(totals.get("platform_subsidy:USD")?.minor, -1000);
  });

  test("no subsidy entry when there is no subsidy", () => {
    const entries = entriesForCycleEarning(baseCycle);
    assert.ok(!entries.some((e) => e.account === "platform_subsidy"));
  });

  test("an old purchase earns at its own historical rate", () => {
    const entries = entriesForCycleEarning({
      ...baseCycle,
      commissionPolicyId: "commission.coaching.v2",
    });
    const coach = entries.find((e) => e.account === "coach_payable");
    assert.equal(coach?.amountMinor, 7000, "70/30 was the rate this contract was sold under");
  });
});

describe("effect keys", () => {
  test("are derived from business identity, not from the event", () => {
    const first = entriesForCycleEarning(baseCycle);
    const second = entriesForCycleEarning(baseCycle);
    assert.deepEqual(
      first.map((e) => e.effectKey),
      second.map((e) => e.effectKey),
    );
  });

  test("two different events describing one cycle produce the same keys", () => {
    // checkout.session.completed and invoice.paid both arrive for the first
    // month of a subscription. Keyed on the event id, that is two accruals.
    const fromCheckout = entriesForCycleEarning(baseCycle);
    const fromInvoice = entriesForCycleEarning(baseCycle);

    const existing = new Set(fromCheckout.map((e) => e.effectKey));
    const admitted = dedupeByEffectKey(existing, fromInvoice);

    assert.equal(admitted.length, 0, "the second event must add nothing");
  });

  test("a replayed delivery accrues exactly once", () => {
    const existing = new Set<string>();
    let admittedTotal = 0;
    for (let i = 0; i < 5; i++) {
      const admitted = dedupeByEffectKey(existing, entriesForCycleEarning(baseCycle));
      for (const entry of admitted) existing.add(entry.effectKey);
      admittedTotal += admitted.length;
    }
    assert.equal(admittedTotal, 2, "five deliveries, one coach entry and one commission entry");
  });

  test("different cycles do not collide", () => {
    const a = entriesForCycleEarning(baseCycle);
    const b = entriesForCycleEarning({ ...baseCycle, billingCycleId: "cycle-2" });
    const keys = new Set([...a, ...b].map((e) => e.effectKey));
    assert.equal(keys.size, 4);
  });

  test("are stable strings, so a restart cannot change them", () => {
    assert.equal(effectKeys.coachEarnedForCycle("x"), "cycle:x:coach_earned");
    assert.equal(effectKeys.commissionForCycle("x"), "cycle:x:commission");
    assert.equal(effectKeys.coachReversalForRefund("r"), "refund:r:coach_reversal");
  });
});

describe("refunds", () => {
  const refundBase = {
    refundId: "refund-1",
    billingCycleId: "cycle-1",
    purchaseId: "purchase-1",
    providerId: "coach-1",
    customerId: "customer-1",
    serviceAmount: usd(10_000),
    serviceType: "recurring_coaching" as const,
    commissionPolicyId: POLICY,
    previouslyRefunded: usd(0),
  };

  test("reverses BOTH sides, not just the payment status", () => {
    const entries = entriesForRefund({ ...refundBase, refundAmount: usd(2500) });

    const coach = entries.find((e) => e.account === "coach_payable");
    const platform = entries.find((e) => e.account === "platform_revenue");

    assert.equal(coach?.amountMinor, -2000, "the coach's share reverses");
    assert.equal(platform?.amountMinor, -500, "the commission reverses too");
  });

  test("names what it reverses", () => {
    const entries = entriesForRefund({ ...refundBase, refundAmount: usd(2500) });
    const coach = entries.find((e) => e.account === "coach_payable");
    assert.equal(coach?.reversesEffectKey, effectKeys.coachEarnedForCycle("cycle-1"));
  });

  test("a refunded cycle leaves the coach with nothing outstanding", () => {
    const earned = entriesForCycleEarning({ ...baseCycle, delivered: true });
    const reversed = entriesForRefund({ ...refundBase, refundAmount: usd(10_000) });

    assert.equal(coachBalance([...earned, ...reversed], USD).minor, 0);
  });

  test("a replayed refund does not reverse twice", () => {
    const first = entriesForRefund({ ...refundBase, refundAmount: usd(2500) });
    const existing = new Set(first.map((e) => e.effectKey));
    const replay = dedupeByEffectKey(
      existing,
      entriesForRefund({ ...refundBase, refundAmount: usd(2500) }),
    );
    assert.equal(replay.length, 0);
  });

  test("sequential partial refunds reconcile exactly to the original split", () => {
    const earned = entriesForCycleEarning({ ...baseCycle, delivered: true });
    const all: LedgerEntryDraft[] = [...earned];

    let refunded = usd(0);
    let n = 0;
    for (const amount of [2500, 2500, 1000, 4000]) {
      const step = entriesForRefund({
        ...refundBase,
        refundId: `refund-${n++}`,
        previouslyRefunded: refunded,
        refundAmount: usd(amount),
      });
      all.push(...step);
      refunded = money(refunded.minor + amount, USD);
    }

    assert.equal(refunded.minor, 10_000);
    assert.equal(coachBalance(all, USD).minor, 0);
    assert.equal(summarise(all).get("platform_revenue:USD")?.minor, 0);
  });

  test("an awkward amount refunded a cent at a time still lands on zero", () => {
    const earned = entriesForCycleEarning({
      ...baseCycle,
      serviceAmount: usd(1001),
      delivered: true,
    });
    const all: LedgerEntryDraft[] = [...earned];

    let refunded = usd(0);
    for (let i = 0; i < 1001; i++) {
      all.push(
        ...entriesForRefund({
          ...refundBase,
          refundId: `cent-${i}`,
          serviceAmount: usd(1001),
          previouslyRefunded: refunded,
          refundAmount: usd(1),
        }),
      );
      refunded = money(refunded.minor + 1, USD);
    }

    assert.equal(coachBalance(all, USD).minor, 0);
    assert.equal(summarise(all).get("platform_revenue:USD")?.minor, 0);
  });
});

describe("disputes", () => {
  const disputeBase = {
    disputeId: "dispute-1",
    purchaseId: "purchase-1",
    providerId: "coach-1",
    customerId: "customer-1",
    disputedAmount: usd(10_000),
    commissionPolicyId: POLICY,
    serviceType: "recurring_coaching" as const,
  };

  test("opening a dispute holds the balance rather than reversing it", () => {
    const entries = entriesForDisputeOpened(disputeBase);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].account, "dispute_holdback");
    assert.equal(entries[0].initialState, "held");
    // Crucially, the coach's balance has not moved.
    assert.equal(coachBalance(entries, USD).minor, 0);
  });

  test("winning releases the hold and changes nothing else", () => {
    const all = [...entriesForDisputeOpened(disputeBase), ...entriesForDisputeWon(disputeBase)];
    assert.equal(summarise(all).get("dispute_holdback:USD")?.minor, 0);
    assert.equal(coachBalance(all, USD).minor, 0, "a coach who wins keeps their earnings");
  });

  test("losing releases the hold AND reverses, without subtracting twice", () => {
    const earned = entriesForCycleEarning({ ...baseCycle, delivered: true });
    const all = [
      ...earned,
      ...entriesForDisputeOpened(disputeBase),
      ...entriesForDisputeLost(disputeBase),
    ];

    assert.equal(
      summarise(all).get("dispute_holdback:USD")?.minor,
      0,
      "the hold is released, not left sitting alongside the reversal",
    );
    assert.equal(coachBalance(all, USD).minor, 0);
    assert.equal(summarise(all).get("platform_revenue:USD")?.minor, 0);
  });

  test("a lost dispute is not processed as a second refund", () => {
    const lost = entriesForDisputeLost(disputeBase);
    const coachEntries = lost.filter((e) => e.account === "coach_payable");
    assert.equal(coachEntries.length, 1, "exactly one reversal of the coach's share");
    assert.equal(coachEntries[0].amountMinor, -8000);
  });
});

describe("payouts", () => {
  test("paying a coach reduces what they are owed", () => {
    const earned = entriesForCycleEarning({ ...baseCycle, delivered: true });
    const paid = entriesForPayout({
      batchItemId: "item-1",
      providerId: "coach-1",
      amount: usd(8000),
    });
    assert.equal(coachBalance([...earned, ...paid], USD).minor, 0);
  });

  test("a returned transfer puts it back", () => {
    const earned = entriesForCycleEarning({ ...baseCycle, delivered: true });
    const paid = entriesForPayout({
      batchItemId: "item-1",
      providerId: "coach-1",
      amount: usd(8000),
    });
    const returned = entriesForReturnedPayout({
      batchItemId: "item-1",
      providerId: "coach-1",
      amount: usd(8000),
    });

    assert.equal(coachBalance([...earned, ...paid, ...returned], USD).minor, 8000);
    assert.equal(returned[0].reversesEffectKey, effectKeys.payout("item-1"));
  });

  test("a retried batch does not pay twice", () => {
    const paid = entriesForPayout({
      batchItemId: "item-1",
      providerId: "coach-1",
      amount: usd(8000),
    });
    const existing = new Set(paid.map((e) => e.effectKey));
    const retry = dedupeByEffectKey(
      existing,
      entriesForPayout({ batchItemId: "item-1", providerId: "coach-1", amount: usd(8000) }),
    );
    assert.equal(retry.length, 0);
  });
});

describe("currencies are never mixed", () => {
  test("a balance in one currency ignores entries in another", () => {
    const usdEarned = entriesForCycleEarning({ ...baseCycle, delivered: true });
    const nprEarned = entriesForCycleEarning({
      ...baseCycle,
      billingCycleId: "cycle-npr",
      serviceAmount: money(500_000, "NPR"),
      delivered: true,
    });

    const all = [...usdEarned, ...nprEarned];
    assert.equal(coachBalance(all, "USD").minor, 8000);
    assert.equal(coachBalance(all, "NPR").minor, 400_000);
  });

  test("the summary keys by account AND currency", () => {
    const all = [
      ...entriesForCycleEarning({ ...baseCycle, delivered: true }),
      ...entriesForCycleEarning({
        ...baseCycle,
        billingCycleId: "cycle-npr",
        serviceAmount: money(500_000, "NPR"),
        delivered: true,
      }),
    ];
    const totals = summarise(all);
    assert.equal(totals.get("coach_payable:USD")?.minor, 8000);
    assert.equal(totals.get("coach_payable:NPR")?.minor, 400_000);
  });
});
