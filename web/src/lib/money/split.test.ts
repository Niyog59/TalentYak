/**
 * Commission arithmetic, tested against the founder's worked examples.
 *
 * The five fixtures in §5 of the TalentYak M03–M07 brief are reproduced here
 * verbatim, with the brief's own wording quoted above each one. They are the
 * specification: if one of these fails, the code is wrong, not the fixture.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MoneyError, money, sumMoney } from "@/lib/money/money";
import {
  allocateAcrossServicePeriods,
  refundReversal,
  splitCommission,
} from "@/lib/money/split";

const USD = "USD";
const TWENTY_PERCENT = 2000;

/** Reads a decimal amount as USD minor units, for legibility in fixtures. */
const usd = (decimal: string) => {
  const [whole, fraction = "00"] = decimal.split(".");
  return money(Number(whole) * 100 + Number(fraction.padEnd(2, "0")), USD);
};

describe("founder fixture 1 — plain service", () => {
  // "USD service 100.00, no tax/discount: coach 80.00, platform commission
  //  20.00, processing expense separately recorded against platform economics."
  test("100.00 at 20% is 80.00 coach and 20.00 commission", () => {
    const split = splitCommission({
      serviceAmount: usd("100.00"),
      commissionBasisPoints: TWENTY_PERCENT,
    });

    assert.equal(split.coachEntitlement.minor, 8000);
    assert.equal(split.platformCommission.minor, 2000);
    assert.equal(split.customerPays.minor, 10000);
    assert.equal(split.platformNetBeforeProcessing.minor, 2000);
  });

  test("the two shares sum exactly to the service amount", () => {
    const split = splitCommission({
      serviceAmount: usd("100.00"),
      commissionBasisPoints: TWENTY_PERCENT,
    });
    assert.equal(
      sumMoney([split.coachEntitlement, split.platformCommission], USD).minor,
      split.serviceAmount.minor,
    );
  });
});

describe("founder fixture 2 — coach-funded discount", () => {
  // "Coach discounts a USD 600.00 package to 540.00: coach 432.00,
  //  commission 108.00. Do not invent a compulsory discount percentage."
  test("540.00 at 20% is 432.00 coach and 108.00 commission", () => {
    const split = splitCommission({
      serviceAmount: usd("540.00"),
      commissionBasisPoints: TWENTY_PERCENT,
    });

    assert.equal(split.coachEntitlement.minor, 43_200);
    assert.equal(split.platformCommission.minor, 10_800);
    assert.equal(split.customerPays.minor, 54_000);
  });

  test("a coach-funded discount moves both parties' amounts together", () => {
    const undiscounted = splitCommission({
      serviceAmount: usd("600.00"),
      commissionBasisPoints: TWENTY_PERCENT,
    });
    const discounted = splitCommission({
      serviceAmount: usd("540.00"),
      commissionBasisPoints: TWENTY_PERCENT,
    });

    assert.ok(discounted.coachEntitlement.minor < undiscounted.coachEntitlement.minor);
    assert.ok(
      discounted.platformCommission.minor < undiscounted.platformCommission.minor,
    );
    // Both fall by the same proportion — the split itself is unchanged.
    assert.equal(discounted.platformCommission.minor * 5, discounted.serviceAmount.minor);
  });
});

describe("founder fixture 3 — platform-funded promotion", () => {
  // "Platform funds a USD 10.00 promotion on a USD 100.00 service while
  //  protecting the agreed coach share: customer service payment 90.00, coach
  //  entitlement 80.00, platform net before processing 10.00. Model the subsidy
  //  explicitly, not as unexplained imbalance."
  test("customer pays 90.00, coach still receives 80.00, platform nets 10.00", () => {
    const split = splitCommission({
      serviceAmount: usd("100.00"),
      commissionBasisPoints: TWENTY_PERCENT,
      platformFundedDiscount: usd("10.00"),
    });

    assert.equal(split.customerPays.minor, 9000);
    assert.equal(split.coachEntitlement.minor, 8000);
    assert.equal(split.platformNetBeforeProcessing.minor, 1000);
    assert.equal(split.platformFundedDiscount.minor, 1000);
  });

  test("the subsidy is recorded, not hidden inside another number", () => {
    const split = splitCommission({
      serviceAmount: usd("100.00"),
      commissionBasisPoints: TWENTY_PERCENT,
      platformFundedDiscount: usd("10.00"),
    });
    // Commission is unchanged; the subsidy is what reduces the platform's net.
    assert.equal(split.platformCommission.minor, 2000);
    assert.equal(
      split.platformCommission.minor - split.platformFundedDiscount.minor,
      split.platformNetBeforeProcessing.minor,
    );
  });

  test("a subsidy larger than the service amount is refused", () => {
    assert.throws(
      () =>
        splitCommission({
          serviceAmount: usd("100.00"),
          commissionBasisPoints: TWENTY_PERCENT,
          platformFundedDiscount: usd("100.01"),
        }),
      MoneyError,
    );
  });
});

describe("founder fixture 4 — refund", () => {
  // "Refund 25.00 from the first example: cumulative coach reversal 20.00,
  //  commission reversal 5.00, before separately treated nonreturned fees.
  //  Replaying the refund does not reverse again."
  test("refunding 25.00 reverses 20.00 coach and 5.00 commission", () => {
    const reversal = refundReversal({
      serviceAmount: usd("100.00"),
      commissionBasisPoints: TWENTY_PERCENT,
      previouslyRefunded: usd("0.00"),
      refundAmount: usd("25.00"),
    });

    assert.equal(reversal.coachEntitlementReversal.minor, 2000);
    assert.equal(reversal.platformCommissionReversal.minor, 500);
    assert.equal(reversal.cumulativeRefunded.minor, 2500);
  });

  test("replaying the same refund position returns the same position, not a second reversal", () => {
    const args = {
      serviceAmount: usd("100.00"),
      commissionBasisPoints: TWENTY_PERCENT,
      previouslyRefunded: usd("0.00"),
      refundAmount: usd("25.00"),
    };
    const first = refundReversal(args);
    const replay = refundReversal(args);

    assert.deepEqual(replay, first);
    assert.equal(replay.cumulativeRefunded.minor, 2500);
  });

  test("sequential partial refunds reconcile exactly to the original split", () => {
    const serviceAmount = usd("100.00");
    let refunded = usd("0.00");
    let commissionReversed = 0;
    let coachReversed = 0;

    for (const amount of ["25.00", "25.00", "10.00", "40.00"]) {
      const step = refundReversal({
        serviceAmount,
        commissionBasisPoints: TWENTY_PERCENT,
        previouslyRefunded: refunded,
        refundAmount: usd(amount),
      });
      commissionReversed += step.platformCommissionReversal.minor;
      coachReversed += step.coachEntitlementReversal.minor;
      refunded = step.cumulativeRefunded;
    }

    const original = splitCommission({
      serviceAmount,
      commissionBasisPoints: TWENTY_PERCENT,
    });

    assert.equal(refunded.minor, serviceAmount.minor);
    assert.equal(commissionReversed, original.platformCommission.minor);
    assert.equal(coachReversed, original.coachEntitlement.minor);
  });

  test("awkward amounts still reconcile after many partial refunds", () => {
    // 10.01 refunded one cent at a time must end at exactly 2.00 / 8.01.
    const serviceAmount = usd("10.01");
    let refunded = usd("0.00");
    let commissionReversed = 0;
    let coachReversed = 0;

    for (let i = 0; i < 1001; i++) {
      const step = refundReversal({
        serviceAmount,
        commissionBasisPoints: TWENTY_PERCENT,
        previouslyRefunded: refunded,
        refundAmount: money(1, USD),
      });
      commissionReversed += step.platformCommissionReversal.minor;
      coachReversed += step.coachEntitlementReversal.minor;
      refunded = step.cumulativeRefunded;
    }

    assert.equal(refunded.minor, 1001);
    assert.equal(commissionReversed, 200);
    assert.equal(coachReversed, 801);
  });

  test("refunding more than was charged is refused", () => {
    assert.throws(
      () =>
        refundReversal({
          serviceAmount: usd("100.00"),
          commissionBasisPoints: TWENTY_PERCENT,
          previouslyRefunded: usd("80.00"),
          refundAmount: usd("25.00"),
        }),
      MoneyError,
    );
  });
});

describe("founder fixture 5 — rounding", () => {
  // "USD 10.01 at 20%: under documented nearest-minor-unit rounding the
  //  commission is 2.00 and coach share is the remainder 8.01. All allocations
  //  and cumulative refund rounding must reconcile exactly."
  test("10.01 at 20% is 2.00 commission and 8.01 coach", () => {
    const split = splitCommission({
      serviceAmount: usd("10.01"),
      commissionBasisPoints: TWENTY_PERCENT,
    });

    assert.equal(split.platformCommission.minor, 200);
    assert.equal(split.coachEntitlement.minor, 801);
  });

  test("commission is rounded first and the coach takes the exact remainder", () => {
    // Across a wide sweep the two shares always sum to the whole, with no
    // lost or invented minor unit anywhere.
    for (let amount = 1; amount <= 2000; amount++) {
      const split = splitCommission({
        serviceAmount: money(amount, USD),
        commissionBasisPoints: TWENTY_PERCENT,
      });
      assert.equal(
        split.platformCommission.minor + split.coachEntitlement.minor,
        amount,
        `${amount} minor units must split exactly`,
      );
      assert.ok(split.coachEntitlement.minor >= 0);
      assert.ok(split.platformCommission.minor >= 0);
    }
  });

  test("a negative service amount is refused rather than silently reversed", () => {
    assert.throws(
      () =>
        splitCommission({
          serviceAmount: money(-100, USD),
          commissionBasisPoints: TWENTY_PERCENT,
        }),
      MoneyError,
    );
  });
});

describe("prepaid term allocation", () => {
  // "For six-month prepayments, payment received, revenue earned, coach
  //  payable, and cash available are not interchangeable."
  test("510.00 over six months allocates 85.00 per month at 68.00 / 17.00", () => {
    const periods = allocateAcrossServicePeriods({
      total: usd("510.00"),
      periods: 6,
      commissionBasisPoints: TWENTY_PERCENT,
    });

    assert.equal(periods.length, 6);
    for (const period of periods) {
      assert.equal(period.serviceAmount.minor, 8500);
      assert.equal(period.coachEntitlement.minor, 6800);
      assert.equal(period.platformCommission.minor, 1700);
    }
  });

  test("period amounts sum exactly to the amount paid", () => {
    for (const total of ["510.00", "500.00", "499.99", "100.01", "0.05"]) {
      const periods = allocateAcrossServicePeriods({
        total: usd(total),
        periods: 6,
        commissionBasisPoints: TWENTY_PERCENT,
      });
      assert.equal(
        sumMoney(
          periods.map((p) => p.serviceAmount),
          USD,
        ).minor,
        usd(total).minor,
        `${total} must allocate exactly`,
      );
      for (const period of periods) {
        assert.equal(
          period.coachEntitlement.minor + period.platformCommission.minor,
          period.serviceAmount.minor,
        );
      }
    }
  });

  test("one delivered month of a 510.00 term leaves 425.00 undelivered", () => {
    const periods = allocateAcrossServicePeriods({
      total: usd("510.00"),
      periods: 6,
      commissionBasisPoints: TWENTY_PERCENT,
    });
    const undelivered = sumMoney(
      periods.slice(1).map((p) => p.serviceAmount),
      USD,
    );
    assert.equal(undelivered.minor, 42_500);
  });

  test("a term must cover a positive whole number of periods", () => {
    for (const periods of [0, -1, 2.5]) {
      assert.throws(
        () =>
          allocateAcrossServicePeriods({
            total: usd("510.00"),
            periods,
            commissionBasisPoints: TWENTY_PERCENT,
          }),
        MoneyError,
      );
    }
  });
});

describe("historical rates still compute correctly", () => {
  // Superseded rates are retained so an old ledger row stays interpretable.
  test("the Aafnai-era 70/30 recurring split is unchanged", () => {
    const split = splitCommission({
      serviceAmount: usd("100.00"),
      commissionBasisPoints: 3000,
    });
    assert.equal(split.coachEntitlement.minor, 7000);
    assert.equal(split.platformCommission.minor, 3000);
  });

  test("the Aafnai-era 60/40 one-off split is unchanged", () => {
    const split = splitCommission({
      serviceAmount: usd("20.00"),
      commissionBasisPoints: 4000,
    });
    assert.equal(split.coachEntitlement.minor, 1200);
    assert.equal(split.platformCommission.minor, 800);
  });
});
