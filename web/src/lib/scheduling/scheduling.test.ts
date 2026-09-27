import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { bothZones, durationLabel, scheduleError, whenIn, SCHEDULE_ERRORS } from "@/lib/scheduling/types";
import { currentSchedulingPolicy } from "@/lib/policy/registry";
import { FULFILLMENT } from "@/lib/fulfillment";

describe("showing a session time to two people", () => {
  const at = "2026-10-20T22:00:00.000Z";

  test("Kathmandu's quarter-hour offset and a different local day are both shown", () => {
    assert.match(whenIn(at, "Asia/Kathmandu"), /Wed 21 Oct, 03:45/);
    assert.match(whenIn(at, "America/New_York"), /Tue 20 Oct, 18:00/);
    const both = bothZones(at, "America/New_York", "Asia/Kathmandu", "Anjali");
    assert.match(both, /Tue 20 Oct, 18:00.*Wed 21 Oct, 03:45.*for Anjali/);
  });

  test("the same local time moves in UTC across New York's clock change, and is named", () => {
    assert.match(whenIn("2026-10-27T22:00:00.000Z", "America/New_York"), /18:00 (EDT|GMT-4)/);
    assert.match(whenIn("2026-11-03T23:00:00.000Z", "America/New_York"), /18:00 (EST|GMT-5)/);
  });

  test("one zone only when both people share it", () => {
    assert.equal(bothZones(at, "Asia/Kathmandu", "Asia/Kathmandu", "x"), whenIn(at, "Asia/Kathmandu"));
  });

  test("lengths read naturally", () => {
    assert.equal(durationLabel(45), "45 minutes");
    assert.equal(durationLabel(60), "1 hour");
    assert.equal(durationLabel(90), "1 h 30 min");
  });

  test("database refusal codes become words, and unknown text never leaks", () => {
    assert.equal(scheduleError("coach_busy"), SCHEDULE_ERRORS.coach_busy);
    assert.equal(scheduleError("ERROR: duplicate key value violates unique constraint \"appointments_pkey\""), "That didn't work. Please try again.");
  });
});

describe("scheduling policy", () => {
  test("every timing is a development default, and outcomes carry no consequences", () => {
    const p = currentSchedulingPolicy();
    assert.equal(p.status, "sandbox_default");
    assert.equal(p.outcomesHaveConsequences, false);
    assert.equal(p.clientRequestsNeedCoachConfirmation, true);
    assert.equal(p.confirmBeyondPaidThrough, false);
  });

  test("calls are still not sellable for real money: scheduling is not the call itself (Batch 5)", () => {
    assert.equal(FULFILLMENT.calls.ready, false);
  });
});
