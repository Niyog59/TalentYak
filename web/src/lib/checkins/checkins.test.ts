import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  correctionChanges,
  normalizeAnswers,
  normalizeQuestions,
  starterQuestions,
  type Question,
} from "@/lib/checkins/questions";
import { describeSnapshot, snapshotChanges, type ProgressSnapshot } from "@/lib/checkins/snapshot";
import { clientStage, coachGroup, periodLabel } from "@/lib/checkins/status";
import { currentCheckinAccessPolicy, currentCheckinReminderPolicy, currentPolicySnapshot } from "@/lib/policy";

const K = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const Q: Question[] = [
  { key: K(1), kind: "rating", label: "Energy", required: true },
  { key: K(2), kind: "long_text", label: "Hardest", required: false },
  { key: K(3), kind: "photo", label: "Photos", sensitive: true },
  { key: K(4), kind: "text", label: "Injury?", sensitive: true },
];

describe("questions", () => {
  test("photos, clips and sensitive questions can never be required", () => {
    const { questions } = normalizeQuestions([
      { key: K(1), kind: "photo", label: "Photo", required: true },
      { key: K(2), kind: "video", label: "Clip", required: true },
      { key: K(3), kind: "text", label: "Private", required: true, sensitive: true },
      { key: K(4), kind: "rating", label: "Sleep", required: true },
    ]);
    assert.deepEqual(questions.map((q) => Boolean(q.required)), [false, false, false, true]);
  });

  test("the weekly starter is short, covers the brief, and keeps photos and sensitive topics optional", () => {
    const qs = starterQuestions();
    assert.ok(qs.length <= 8);
    const text = qs.map((q) => q.label.toLowerCase()).join(" ");
    for (const topic of ["energy", "sleep", "hunger", "recover", "hardest", "help"]) assert.ok(text.includes(topic), topic);
    assert.ok(qs.some((q) => q.kind === "photo") && qs.some((q) => q.kind === "video"));
    for (const q of qs) if (q.kind === "photo" || q.kind === "video" || q.sensitive) assert.notEqual(q.required, true, q.label);
    assert.equal(normalizeQuestions(qs).problems.length, 0);
  });

  test("a duplicate or missing key is replaced, so answers can never collide", () => {
    const { questions } = normalizeQuestions([{ key: K(1), kind: "text", label: "A" }, { key: K(1), kind: "text", label: "B" }, { kind: "text", label: "C" }]);
    assert.equal(new Set(questions.map((q) => q.key)).size, 3);
  });
});

describe("answers", () => {
  test("a blank answer is absent, never zero; required questions are only enforced on sending", () => {
    const draft = normalizeAnswers(Q, { [K(1)]: "", [K(2)]: "  " }, false);
    assert.deepEqual(draft.answers, {});
    assert.deepEqual(draft.missing, []);
    const send = normalizeAnswers(Q, {}, true);
    assert.deepEqual(send.missing, ["Energy"]);
  });

  test("sensitive questions and photos can be skipped when sending", () => {
    const r = normalizeAnswers(Q, { [K(1)]: 4 }, true);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(r.answers, { [K(1)]: 4 });
  });

  test("ratings outside 1-5 are refused; unknown keys and foreign ids are dropped", () => {
    assert.ok(normalizeAnswers(Q, { [K(1)]: 9 }, false).problems.length > 0);
    const r = normalizeAnswers(Q, { [K(1)]: "3", nope: "x", [K(3)]: ["not-an-id", K(7)] }, false);
    assert.deepEqual(r.answers, { [K(1)]: 3, [K(3)]: [K(7)] });
    assert.deepEqual(r.mediaIds, [K(7)]);
  });
});

describe("corrections", () => {
  const before = { [K(1)]: 3, [K(2)]: "Sleep was poor because of night shifts", [K(3)]: [K(7)] };

  test("a typo, spacing or capitals is a small correction", () => {
    assert.equal(correctionChanges(Q, before, { ...before, [K(2)]: "sleep was poor because of night  shifts." }).substantive, false);
    assert.equal(correctionChanges(Q, before, { ...before, [K(2)]: "Sleep was poor becuase of night shifts" }).substantive, false);
  });

  test("a changed rating, a changed attachment, or new meaning is substantive", () => {
    assert.equal(correctionChanges(Q, before, { ...before, [K(1)]: 4 }).substantive, true);
    assert.equal(correctionChanges(Q, before, { ...before, [K(3)]: [K(8)] }).substantive, true);
    const { [K(3)]: _removed, ...noPhoto } = before;
    assert.equal(correctionChanges(Q, before, noPhoto).substantive, true);
    assert.equal(correctionChanges(Q, before, { ...before, [K(2)]: "Sleep was fine, my knee hurts" }).substantive, true);
  });

  test("identical answers are not a correction at all", () => {
    assert.deepEqual(correctionChanges(Q, before, { ...before }).changed, []);
  });
});

describe("states", () => {
  test("the client's four steps, and reopened", () => {
    assert.equal(clientStage({ status: "open" }, false, false, false), "awaiting_submission");
    assert.equal(clientStage({ status: "open" }, true, false, false), "draft");
    assert.equal(clientStage({ status: "submitted" }, false, false, false), "awaiting_feedback");
    assert.equal(clientStage({ status: "submitted" }, false, true, true), "feedback_received");
    assert.equal(clientStage({ status: "reopened" }, false, false, true), "reopened");
    assert.equal(clientStage({ status: "missed" }, false, false, false), "missed");
  });

  test("a coach's queue: published feedback is not completion; overdue only against the coach's own time", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    assert.equal(coachGroup({ status: "submitted", feedback_published: false, review_due: null }, now), "awaiting");
    assert.equal(coachGroup({ status: "submitted", feedback_published: false, review_due: "2026-10-04T12:00:00Z" }, now), "overdue");
    assert.equal(coachGroup({ status: "submitted", feedback_published: true, review_due: "2026-10-04T12:00:00Z" }, now), "feedback_sent");
    assert.equal(coachGroup({ status: "reopened", feedback_published: false, review_due: null }, now), "reopened");
    assert.equal(coachGroup({ status: "reviewed", feedback_published: true, review_due: null }, now), "reviewed");
  });

  test("the reporting period is labelled on its own, separate from when it was sent", () => {
    assert.match(periodLabel("2026-09-22", "2026-09-28"), /^22–28 .+ 2026$/);
    assert.match(periodLabel("2026-09-29", "2026-10-05"), /^29 .+ – 5 .+ 2026$/);
  });
});

function snap(over: Partial<ProgressSnapshot> = {}): ProgressSnapshot {
  return {
    v: 1,
    capturedAt: "2026-09-28T10:00:00Z",
    period: { from: "2026-09-22", to: "2026-09-28" },
    workouts: { hasPlan: true, inOrder: false, due: 3, completed: 2, partial: 0, skipped: 0, notLogged: 1, upcoming: 0, unplanned: 0, logged: [{ date: "2026-09-22", label: "A", status: "completed", planned: true }, { date: "2026-09-24", label: "B", status: "completed", planned: true }] },
    weight: { unit: "kg", readings: 0, first: null, latest: null },
    measurements: [],
    food: { days: 7, daysWithEntries: 3, daysMarkedComplete: 1, entries: 5, entriesWithCalories: 2, entriesWithProtein: 0 },
    ...over,
  };
}

describe("progress summary", () => {
  test("missing records are named as missing, never as zero or failure", () => {
    const text = describeSnapshot(snap()).map((l) => l.text).join(" ");
    assert.match(text, /not logged — that means no record/);
    assert.match(text, /No weight recorded/);
    assert.match(text, /4 days not recorded/);
    assert.match(text, /aren't calculated from partial records/);
    assert.doesNotMatch(text, /0 kg|0 kcal|failed/i);
  });

  test("later additions are reported separately and never rewrite what was sent", () => {
    const sent = snap();
    const now = snap({ weight: { unit: "kg", readings: 1, first: { date: "2026-09-27", value: 70 }, latest: { date: "2026-09-27", value: 70 } } });
    assert.deepEqual(snapshotChanges(sent, sent), []);
    // The same summary with its keys in another order (as the database returns it) is unchanged.
    const reordered = JSON.parse(JSON.stringify({ ...sent, measurements: [{ latest: 80, first: 81, readings: 2, label: "Waist", unit: "cm" }] }));
    assert.deepEqual(snapshotChanges({ ...sent, measurements: [{ unit: "cm", label: "Waist", readings: 2, first: 81, latest: 80 }] }, reordered), []);
    assert.deepEqual(snapshotChanges(sent, now), ["Weight readings for this period changed since it was sent."]);
    assert.equal(sent.weight.readings, 0);
  });
});

describe("policy", () => {
  test("the approved check-in access policy and exception are recorded as confirmed", () => {
    const p = currentCheckinAccessPolicy();
    assert.equal(p.status, "confirmed");
    assert.equal(p.reviewSubmittedInPaidTimeMayBeFinished, true);
    assert.equal(p.exceptionReopensOtherActivity, false);
    assert.equal(p.exceptionOverridesSuspensionOrReassignment, false);
    assert.equal(p.paymentFailureDeletes, false);
  });

  test("reminder timings are a sandbox default and are not part of what a purchase is written under", () => {
    assert.equal(currentCheckinReminderPolicy().status, "sandbox_default");
    assert.ok(!Object.values(currentPolicySnapshot()).some((id) => String(id).startsWith("checkin")));
  });
});
