import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  EVENT_RULES,
  checkEventContext,
  isHandled,
  minimisePayload,
  ruleFor,
  shouldApply,
} from "@/lib/payments/events";

describe("the event matrix", () => {
  test("a completed checkout grants nothing", () => {
    const rule = ruleFor("checkout.session.completed");
    assert.equal(rule.action, "link_checkout_session");
    assert.equal(
      rule.financial,
      false,
      "finishing the form is not the same as the money moving",
    );
  });

  test("only the invoice earns, so the first subscription month accrues once", () => {
    assert.equal(ruleFor("checkout.session.completed").action, "link_checkout_session");
    assert.equal(ruleFor("invoice.paid").action, "record_cycle_paid");
  });

  test("invoice.paid and invoice.payment_succeeded map to the same action", () => {
    // Two events, one payment. Deduplication happens on the cycle's effect key,
    // not on the event type — which is why both are allowed to map here.
    assert.equal(
      ruleFor("invoice.paid").action,
      ruleFor("invoice.payment_succeeded").action,
    );
  });

  test("a failed renewal does not open a new service period", () => {
    const rule = ruleFor("invoice.payment_failed");
    assert.equal(rule.action, "record_payment_failed");
    assert.equal(rule.financial, false);
  });

  test("every previously missing lifecycle event is now covered", () => {
    // The four the old webhook silently dropped.
    for (const type of [
      "invoice.payment_failed",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "charge.dispute.created",
    ]) {
      assert.ok(isHandled(type), `${type} must be in the matrix`);
      assert.notEqual(ruleFor(type).action, "ignore", `${type} must not be ignored`);
    }
  });

  test("a refund reverses rather than merely relabelling", () => {
    const rule = ruleFor("charge.refunded");
    assert.equal(rule.action, "record_refund");
    assert.equal(rule.financial, true);
  });

  test("a dispute holds rather than reverses", () => {
    assert.equal(ruleFor("charge.dispute.created").action, "record_dispute_opened");
  });

  test("payment_intent.succeeded is deliberately ignored, not overlooked", () => {
    const rule = ruleFor("payment_intent.succeeded");
    assert.equal(rule.action, "ignore");
    assert.ok(rule.reason.length > 20, "an ignored event must say why");
  });

  test("an unknown event type is recorded, not dropped", () => {
    const rule = ruleFor("some.event.we.have.never.seen");
    assert.equal(rule.action, "ignore");
    assert.ok(rule.reason.includes("visible"));
  });

  test("every rule explains itself", () => {
    for (const [type, rule] of Object.entries(EVENT_RULES)) {
      assert.ok(rule.reason.length > 20, `${type} needs a real reason`);
    }
  });

  test("only genuinely financial actions are flagged financial", () => {
    for (const [type, rule] of Object.entries(EVENT_RULES)) {
      if (rule.financial) {
        assert.ok(
          ["record_cycle_paid", "record_refund", "record_dispute_opened", "record_dispute_closed"].includes(
            rule.action,
          ),
          `${type} is flagged financial but its action is ${rule.action}`,
        );
      }
    }
  });
});

describe("event context", () => {
  test("a test-mode event is refused by a live deployment", () => {
    const verdict = checkEventContext(
      { livemode: false },
      { expectLivemode: true },
    );
    assert.equal(verdict.ok, false);
  });

  test("a live event is refused by a sandbox deployment", () => {
    const verdict = checkEventContext({ livemode: true }, { expectLivemode: false });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.ok(verdict.reason.includes("livemode"));
  });

  test("a matching mode is accepted", () => {
    assert.equal(checkEventContext({ livemode: false }, { expectLivemode: false }).ok, true);
  });

  test("an event from another Stripe account is refused", () => {
    const verdict = checkEventContext(
      { livemode: false, accountId: "acct_someone_else" },
      { expectLivemode: false, expectedAccountId: "acct_ours" },
    );
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.ok(verdict.reason.includes("acct_someone_else"));
  });

  test("our own account passes", () => {
    const verdict = checkEventContext(
      { livemode: false, accountId: "acct_ours" },
      { expectLivemode: false, expectedAccountId: "acct_ours" },
    );
    assert.equal(verdict.ok, true);
  });
});

describe("out-of-order delivery", () => {
  const older = new Date("2026-09-01T10:00:00Z");
  const newer = new Date("2026-09-01T12:00:00Z");

  test("a newer event is applied", () => {
    assert.equal(shouldApply(newer, older), true);
  });

  test("a stale event is NOT applied over newer state", () => {
    assert.equal(
      shouldApply(older, newer),
      false,
      "a late 'active' must not overwrite a newer 'canceled'",
    );
  });

  test("a duplicate delivery at the same instant is a no-op", () => {
    assert.equal(shouldApply(newer, newer), false);
  });

  test("the first event for an object is applied", () => {
    assert.equal(shouldApply(newer, null), true);
  });

  test("an event with no timestamp is applied rather than dropped", () => {
    assert.equal(shouldApply(null, newer), true);
  });
});

describe("payload minimisation", () => {
  const event = {
    id: "evt_1",
    type: "invoice.paid",
    created: 1_757_000_000,
    data: {
      object: {
        id: "in_123",
        object: "invoice",
        status: "paid",
        currency: "usd",
        amount_paid: 10_000,
        subscription: "sub_123",
        // Everything below must NOT survive.
        customer_name: "Sita Sharma",
        customer_email: "sita@example.com",
        customer_address: { line1: "12 Real Street", city: "Houston" },
        customer_phone: "+1 555 0100",
        payment_method_details: { card: { last4: "4242", brand: "visa" } },
        metadata: {
          purchase_id: "p_1",
          internal_scratch: "something we did not put here",
        },
      },
    },
  };

  test("keeps what reconciliation needs", () => {
    const minimal = minimisePayload(event);
    assert.equal(minimal.id, "in_123");
    assert.equal(minimal.amount_paid, 10_000);
    assert.equal(minimal.subscription, "sub_123");
    assert.equal(minimal.status, "paid");
  });

  test("drops customer PII", () => {
    const minimal = minimisePayload(event);
    for (const leaked of [
      "customer_name",
      "customer_email",
      "customer_address",
      "customer_phone",
      "payment_method_details",
    ]) {
      assert.equal(minimal[leaked], undefined, `${leaked} must not be stored`);
    }
    assert.ok(!JSON.stringify(minimal).includes("Sita"));
    assert.ok(!JSON.stringify(minimal).includes("4242"));
  });

  test("keeps only our own metadata keys", () => {
    const minimal = minimisePayload(event) as { metadata: Record<string, unknown> };
    assert.equal(minimal.metadata.purchase_id, "p_1");
    assert.equal(
      minimal.metadata.internal_scratch,
      undefined,
      "metadata is free text; only the keys we set are kept",
    );
  });

  test("handles an event with no object at all", () => {
    assert.deepEqual(minimisePayload({ id: "evt_2", type: "x" }), {});
  });
});
