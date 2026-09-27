import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { advanceWatermark, dayKey, dayLabel, describeWorkingHours, groupByDay, liveUpdatesLookSilent, mergeMessages } from "@/lib/messaging/display";
import type { Message } from "@/lib/messaging/types";

const msg = (seq: number, created_at: string): Message => ({
  id: `m${seq}`, seq, sender_profile_id: "p", sender_role: "customer", kind: "text", body: `m${seq}`,
  client_message_id: `c${seq}`, created_at, attachment: null, has_attachment: false,
});

describe("conversation display", () => {
  test("a day is the reader's own calendar day, not the server's", () => {
    // 03:30 UTC on the 22nd is still the evening of the 21st in Chicago, and
    // already mid-morning of the 22nd in Kathmandu.
    const at = "2026-09-22T03:30:00Z";
    assert.equal(dayKey(at, "America/Chicago"), "2026-09-21");
    assert.equal(dayKey(at, "Asia/Kathmandu"), "2026-09-22");
  });

  test("today and yesterday are named; older days get a date", () => {
    const now = new Date("2026-09-22T12:00:00Z");
    assert.equal(dayLabel("2026-09-22T08:00:00Z", "UTC", now), "Today");
    assert.equal(dayLabel("2026-09-21T08:00:00Z", "UTC", now), "Yesterday");
    assert.match(dayLabel("2026-09-15T08:00:00Z", "UTC", now), /15 Sept?/);
  });

  test("messages are grouped by day and ordered by sequence, whatever order they arrived in", () => {
    const groups = groupByDay(
      [msg(3, "2026-09-22T10:00:00Z"), msg(1, "2026-09-21T10:00:00Z"), msg(2, "2026-09-22T09:00:00Z")],
      "UTC", new Date("2026-09-22T12:00:00Z"),
    );
    assert.deepEqual(groups.map((g) => g.label), ["Yesterday", "Today"]);
    assert.deepEqual(groups[1].messages.map((m) => m.seq), [2, 3]);
  });

  test("a page fetched twice after a reconnect never shows a message twice", () => {
    const merged = mergeMessages([msg(1, "2026-09-22T10:00:00Z"), msg(2, "2026-09-22T10:01:00Z")],
      [msg(2, "2026-09-22T10:01:00Z"), msg(3, "2026-09-22T10:02:00Z")]);
    assert.deepEqual(merged.map((m) => m.seq), [1, 2, 3]);
  });

  test("the read watermark moves only across messages actually seen", () => {
    // Read up to 4. Messages 5–9 arrived; 8 and 9 are on screen, 5–7 are not.
    assert.equal(advanceWatermark(4, 9, new Set([8, 9]), new Set()), 4, "unseen older messages were marked read");
    // Scrolling up shows 5 and 6; 7 is the reader's own.
    assert.equal(advanceWatermark(4, 9, new Set([5, 6, 8, 9]), new Set([7])), 9);
    // Never beyond the last message that exists.
    assert.equal(advanceWatermark(9, 9, new Set([10]), new Set()), 9);
  });

  test("working hours read as a short sentence", () => {
    const weekdays = [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "17:00" }));
    assert.equal(describeWorkingHours([...weekdays, { day: 6, start: "10:00", end: "12:00" }]), "Mon–Fri 09:00–17:00; Sat 10:00–12:00");
    assert.equal(describeWorkingHours([]), null);
    assert.equal(describeWorkingHours([{ day: 9, start: "x", end: "y" }]), null);
  });

  test("a subscribed channel that never echoes an expected prompt is treated as silent", () => {
    // Sent at t=1000; no prompt since — silent.
    assert.equal(liveUpdatesLookSilent({ subscribed: true, lastPromptAt: 500, expectedSince: 1000 }), true);
    // A prompt arrived after the send — healthy.
    assert.equal(liveUpdatesLookSilent({ subscribed: true, lastPromptAt: 1200, expectedSince: 1000 }), false);
    // Not subscribed at all: already shown as paused by the connection state, not by this rule.
    assert.equal(liveUpdatesLookSilent({ subscribed: false, lastPromptAt: 0, expectedSince: 1000 }), false);
  });
});
