import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRange, validTimeZone } from "@/lib/admin/range";

const NOW = new Date("2026-09-28T15:30:00Z"); // 10:30 in Chicago (CDT, UTC-5)

test("Today starts at local midnight in the reporting timezone and ends now", () => {
  const r = resolveRange({ range: "today" }, "America/Chicago", NOW);
  assert.equal(r.from.toISOString(), "2026-09-28T05:00:00.000Z");
  assert.equal(r.to.toISOString(), NOW.toISOString());
  assert.equal(r.timeZone, "America/Chicago");
});

test("7 days includes today and the six days before it", () => {
  const r = resolveRange({}, "Asia/Kathmandu", NOW);
  assert.equal(r.key, "7d");
  assert.equal(r.fromDay, "2026-09-22");
  assert.equal(r.toDay, "2026-09-28");
  assert.equal(r.from.toISOString(), "2026-09-21T18:15:00.000Z", "Kathmandu is UTC+5:45");
});

test("a past custom range ends at the end of its last day, not now", () => {
  const r = resolveRange({ range: "custom", from: "2026-09-01", to: "2026-09-10" }, "UTC", NOW);
  assert.equal(r.from.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(r.to.toISOString(), "2026-09-11T00:00:00.000Z");
});

test("an unusable custom range falls back to 7 days and says why", () => {
  for (const bad of [{ from: "2026-09-10", to: "2026-09-01" }, { from: "2027-01-01", to: "2027-01-02" }, { from: "x", to: "2026-09-01" }, { from: "2024-01-01", to: "2026-09-01" }]) {
    const r = resolveRange({ range: "custom", ...bad }, "UTC", NOW);
    assert.equal(r.key, "7d");
    assert.ok(r.corrected, JSON.stringify(bad));
  }
});

test("an unknown timezone is reported in UTC rather than guessed", () => {
  assert.equal(validTimeZone("Not/AZone"), "UTC");
  assert.equal(validTimeZone(null), "UTC");
});
