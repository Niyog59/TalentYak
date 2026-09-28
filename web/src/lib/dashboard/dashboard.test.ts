import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ago,
  buildQueue,
  earningsByCurrency,
  timing,
  visibleNotices,
  type ClientNotice,
  type CoachTask,
  type Mark,
} from "@/lib/dashboard/tasks";

const NOW = Date.parse("2026-09-28T12:00:00Z");
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function task(key: string, over: Partial<CoachTask> = {}): CoachTask {
  return {
    key,
    kind: "checkin",
    enrollmentId: "e1",
    clientName: "Asha",
    title: key,
    detail: null,
    href: "/coach/check-ins/x",
    dueAt: null,
    dueLabel: null,
    since: iso(NOW - 2 * H),
    snoozable: true,
    ...over,
  };
}

const snooze = (key: string, untilMs: number): Mark => ({ item_key: key, action: "snoozed", snoozed_until: iso(untilMs), through_seq: null });

describe("coach queue", () => {
  test("snoozing hides an item until the snooze ends — and never past its deadline", () => {
    const later = task("checkin:a", { dueAt: iso(NOW + 48 * H), dueLabel: "reply_by" });
    const soon = task("checkin:b", { dueAt: iso(NOW + 5 * H), dueLabel: "reply_by" });
    const q = buildQueue([later, soon], [snooze("checkin:a", NOW + 24 * H), snooze("checkin:b", NOW + 24 * H)], NOW);
    assert.equal(q.open.length, 0);
    // Comes back when it falls due, not when the snooze would have ended; the deadline itself is untouched.
    assert.equal(q.snoozed.find((s) => s.task.key === "checkin:b")!.until, soon.dueAt);
    assert.equal(q.snoozed.find((s) => s.task.key === "checkin:b")!.task.dueAt, iso(NOW + 5 * H));
    assert.equal(q.snoozed.find((s) => s.task.key === "checkin:a")!.until, iso(NOW + 24 * H));
  });

  test("an overdue item is shown whatever its snooze says", () => {
    const overdue = task("checkin:c", { dueAt: iso(NOW - H), dueLabel: "reply_by" });
    const q = buildQueue([overdue], [snooze("checkin:c", NOW + 72 * H)], NOW);
    assert.deepEqual(q.open.map((t) => t.key), ["checkin:c"]);
    assert.equal(timing(overdue, NOW).overdue, true);
  });

  test("an expired snooze is ignored", () => {
    const q = buildQueue([task("plan:e1", { kind: "plan" })], [snooze("plan:e1", NOW - H)], NOW);
    assert.equal(q.open.length, 1);
  });

  test("'no reply needed' covers the messages seen so far; a new client message brings it back", () => {
    const handled: Mark = { item_key: "msg:m", action: "handled", snoozed_until: null, through_seq: 7 };
    const before = buildQueue([task("msg:m", { kind: "message", lastClientSeq: 7 })], [handled], NOW);
    assert.equal(before.open.length, 0);
    assert.equal(before.handled.length, 1);
    const after = buildQueue([task("msg:m", { kind: "message", lastClientSeq: 9 })], [handled], NOW);
    assert.equal(after.open.length, 1);
    // "Handled" means nothing on anything but a conversation.
    const checkin = buildQueue([task("checkin:z")], [{ item_key: "checkin:z", action: "handled", snoozed_until: null, through_seq: 99 }], NOW);
    assert.equal(checkin.open.length, 1);
  });

  test("counts match exactly what each filter lists, and one check-in can match several filters", () => {
    const tasks = [
      task("checkin:1", { rereview: true, formReview: true }),
      task("checkin:2"),
      task("msg:1", { kind: "message" }),
      task("proposal:1", { kind: "booking", dueAt: iso(NOW + 10 * H), dueLabel: "expires" }),
      task("plan:1", { kind: "plan" }),
    ];
    const q = buildQueue(tasks, [snooze("plan:1", NOW + 4 * H)], NOW);
    assert.deepEqual(q.counts, { all: 4, checkins: 2, rereview: 1, form: 1, messages: 1, bookings: 1, plans: 0 });
  });

  test("overdue first, then nearest deadline, then longest waiting", () => {
    const q = buildQueue(
      [
        task("msg:new", { kind: "message", since: iso(NOW - H) }),
        task("proposal:x", { kind: "booking", dueAt: iso(NOW + 3 * H), dueLabel: "expires" }),
        task("checkin:late", { dueAt: iso(NOW - 2 * H), dueLabel: "reply_by" }),
        task("msg:old", { kind: "message", since: iso(NOW - 30 * H) }),
      ],
      [],
      NOW,
    );
    assert.deepEqual(q.open.map((t) => t.key), ["checkin:late", "proposal:x", "msg:old", "msg:new"]);
  });

  test("waiting and deadline wording", () => {
    assert.equal(timing(task("a", { since: iso(NOW - 50 * H) }), NOW).text, "Waiting 2 days");
    assert.equal(timing(task("a", { dueAt: iso(NOW + 5 * H), dueLabel: "reply_by" }), NOW).text, "Your reply time ends in 5 hours");
    assert.equal(timing(task("a", { dueAt: iso(NOW - 5 * H), dueLabel: "expires" }), NOW).text, "This request has expired");
    assert.equal(ago("2026-09-26", NOW), "2 days ago");
    assert.equal(ago(null, NOW), null);
  });
});

describe("client notices", () => {
  const n = (key: string, actionNeeded: boolean): ClientNotice => ({ key, enrollmentId: "e1", coachName: "Coach", title: key, detail: null, href: "/", at: "2026-09-20T00:00:00Z", actionNeeded });

  test("dismissing hides a notice but never a step the client still needs to take", () => {
    const marks: Mark[] = [
      { item_key: "planver:a", action: "dismissed", snoozed_until: null, through_seq: null },
      { item_key: "exp:b", action: "dismissed", snoozed_until: null, through_seq: null },
    ];
    const shown = visibleNotices([n("planver:a", false), n("exp:b", true), n("planver:c", false)], marks).map((x) => x.key);
    assert.deepEqual(shown.sort(), ["exp:b", "planver:c"]);
  });
});

describe("earnings", () => {
  test("one row per currency, never added across currencies; paid and pending kept apart", () => {
    const out = earningsByCurrency([
      { currency: "USD", pending_minor: 8000, held_minor: 0, eligible_minor: 1600, batched_minor: 400, paid_minor: 5000 },
      { currency: "AUD", pending_minor: "0", held_minor: null, eligible_minor: "2400", batched_minor: "0", paid_minor: "0" },
    ]);
    assert.deepEqual(out.map((r) => r.currency), ["AUD", "USD"]);
    const usd = out.find((r) => r.currency === "USD")!;
    assert.equal(usd.earnedUnpaid, 2000);
    assert.equal(usd.paid, 5000);
    assert.equal(usd.pending, 8000);
    assert.equal(out.find((r) => r.currency === "AUD")!.earnedUnpaid, 2400);
  });
});
