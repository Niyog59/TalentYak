import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { endOfDayInZone, parseWorkingHours } from "@/lib/messaging/availability";

const form = (values: Record<string, string>) => (name: string) => values[name] ?? "";

describe("coach availability settings", () => {
  test("working days become hours; unticked days are left out", () => {
    const { hours, error } = parseWorkingHours(form({ "day-1": "on", "start-1": "09:00", "end-1": "17:00", "start-2": "09:00", "end-2": "17:00" }));
    assert.equal(error, null);
    assert.deepEqual(hours, [{ day: 1, start: "09:00", end: "17:00" }]);
  });

  test("an end before its start, or a missing time, is refused in words", () => {
    assert.match(parseWorkingHours(form({ "day-3": "on", "start-3": "17:00", "end-3": "09:00" })).error ?? "", /after its start/);
    assert.match(parseWorkingHours(form({ "day-3": "on", "start-3": "9am", "end-3": "" })).error ?? "", /start and end time/);
  });

  test("away until a date means back at the start of the next day, in the coach's own zone", () => {
    // Kathmandu is UTC+5:45: midnight starting 4 October there is 18:15 UTC on the 3rd.
    assert.equal(endOfDayInZone("2026-10-03", "Asia/Kathmandu")?.toISOString(), "2026-10-03T18:15:00.000Z");
    // Across the US daylight-saving change on 1 November: midnight starting 2 Nov is UTC-6.
    assert.equal(endOfDayInZone("2026-11-01", "America/Chicago")?.toISOString(), "2026-11-02T06:00:00.000Z");
    assert.equal(endOfDayInZone("soon", "UTC"), null);
  });
});
