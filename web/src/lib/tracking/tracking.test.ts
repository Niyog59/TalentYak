import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { layOutWeek, type WorkoutContent } from "@/lib/programmes/content";
import { consistency, epochMicros, measurementChanges, performanceSeries, resolveRange, weightPoints } from "@/lib/tracking/progress";
import { convertWeight, parseAmount, roundTo } from "@/lib/tracking/units";
import { identityOf, normalizeWorkoutDoc, seriesKey, suggestedStatus, type WorkoutDoc } from "@/lib/tracking/workout";

const K = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function workout(date: string, exercises: WorkoutDoc["exercises"], extra: Partial<WorkoutDoc> = {}): WorkoutDoc {
  return { id: K(900 + Number(date.slice(-2))), enrollmentId: K(1), planVersionId: K(2), sessionKey: K(3), performedOn: date, title: null, status: "completed", notes: "", exercises, ...extra };
}

function entry(n: number, sets: [number | null, "kg" | "lb" | null, number | null][], opts: Partial<WorkoutDoc["exercises"][number]> = {}): WorkoutDoc["exercises"][number] {
  return {
    id: K(100 + n), position: n, exerciseKey: K(10), alternativeKey: null, performedName: null, status: "active", loadKind: "weight", loadBasis: null, notes: "",
    sets: sets.map(([load, unit, reps], i) => ({ id: K(1000 + n * 50 + i), setIndex: i + 1, loadValue: load, loadUnit: unit, reps, seconds: null, rpe: null, extra: false })),
    ...opts,
  };
}

describe("units are exact", () => {
  test("a pound weight survives the round trip through kilograms to one decimal", () => {
    const kg = roundTo(convertWeight(180.4, "lb", "kg"), 2);
    assert.equal(kg, 81.83);
    assert.equal(roundTo(convertWeight(kg, "kg", "lb"), 1), 180.4);
  });
  test("phones type commas; blank and junk are not numbers", () => {
    assert.equal(parseAmount("17,5"), 17.5);
    assert.equal(parseAmount(" "), null);
    assert.equal(parseAmount("12kg"), null);
    assert.equal(parseAmount("-3"), null);
  });
});

describe("the body-entry change token matches the database's, exactly", () => {
  test("microseconds are read as digits, and offsets are applied", () => {
    assert.equal(epochMicros("2026-09-27T10:11:12.123456+00:00"), "1790503872123456");
    assert.equal(epochMicros("2026-09-27T10:11:12.12+00:00"), "1790503872120000", "Postgres trims trailing zeros");
    assert.equal(epochMicros("2026-09-27T10:11:12+00:00"), "1790503872000000");
    assert.equal(epochMicros("2026-09-27T15:56:12.5+05:45"), "1790503872500000", "Kathmandu offset");
    assert.equal(epochMicros(null), "-");
  });
});

describe("a workout is checked before it reaches the database", () => {
  const good = () => ({
    id: K(1), enrollmentId: K(2), planVersionId: K(3), sessionKey: K(4), performedOn: "2026-09-20", status: "in_progress", notes: "",
    exercises: [{ id: K(5), exerciseKey: K(6), loadKind: "weight", sets: [{ id: K(7), loadValue: 20, loadUnit: "lb", reps: 8 }] }],
  });
  test("a clean document passes, keeping the unit entered", () => {
    const { doc, problems } = normalizeWorkoutDoc(good());
    assert.deepEqual(problems, []);
    assert.equal(doc!.exercises[0].sets[0].loadUnit, "lb");
  });
  test("an empty set, a repeated id, or half a plan reference is refused", () => {
    const empty = good();
    empty.exercises[0].sets[0] = { id: K(7), loadValue: null as unknown as number, loadUnit: "kg", reps: null as unknown as number };
    assert.ok(normalizeWorkoutDoc(empty).problems.some((p) => p.includes("nothing recorded")));
    const dup = good();
    dup.exercises[0].sets[0].id = K(5);
    assert.ok(normalizeWorkoutDoc(dup).problems.some((p) => p.includes("twice")));
    const half = { ...good(), sessionKey: null };
    assert.ok(normalizeWorkoutDoc(half).problems.length > 0);
  });
});

describe("what counts as done is the client's confirmed sets, and they decide", () => {
  const session = {
    key: K(3), title: "A", day: 0, minutes: null, notes: "",
    exercises: [{ key: K(10), name: "Squat", sets: 2, target: { type: "reps" as const, min: 8, max: null }, restSeconds: null, load: null, loadNote: "", effort: "", notes: "", demoUrl: "", progression: "", alternatives: [] }],
  };
  test("all prescribed sets → completed; fewer → partial; none → skipped", () => {
    assert.equal(suggestedStatus(workout("2026-09-20", [entry(0, [[60, "kg", 8], [60, "kg", 8]])]), session), "completed");
    assert.equal(suggestedStatus(workout("2026-09-20", [entry(0, [[60, "kg", 8]])]), session), "partial");
    assert.equal(suggestedStatus(workout("2026-09-20", [entry(0, [])]), session), "skipped");
  });
});

describe("only like is compared with like", () => {
  test("an alternative, a substitute and the planned exercise have separate identities", () => {
    const main = entry(0, []);
    assert.notEqual(identityOf(main), identityOf({ ...main, alternativeKey: K(11) }));
    assert.notEqual(identityOf(main), identityOf({ ...main, performedName: "Leg press" }));
    assert.notEqual(seriesKey({ ...main, loadBasis: "per_hand" }), seriesKey({ ...main, loadBasis: "total" }));
  });
  test("per-hand and combined records never share a line; pounds are converted, never mixed", () => {
    const series = performanceSeries(
      [
        workout("2026-09-01", [entry(0, [[20, "kg", 10]], { loadBasis: "per_hand" })]),
        workout("2026-09-08", [entry(0, [[50, "lb", 10]], { loadBasis: "per_hand" })]),
        workout("2026-09-15", [entry(0, [[40, "kg", 10]], { loadBasis: "total" })]),
      ],
      () => "Press",
      "kg",
    );
    assert.equal(series.length, 2);
    const perHand = series.find((s) => s.loadBasis === "per_hand")!;
    assert.deepEqual(perHand.points.map((p) => p.value), [20, 22.7]);
  });
  test("assisted work tracks the least assistance", () => {
    const [s] = performanceSeries([workout("2026-09-01", [entry(0, [[30, "kg", 5], [20, "kg", 5]], { loadKind: "assisted" })])], () => "Pull-up", "kg");
    assert.equal(s.metric, "assistance");
    assert.equal(s.points[0].value, 20);
  });
});

describe("missing is missing, never zero", () => {
  test("weights show exactly what was typed when the unit matches", () => {
    const pts = weightPoints([{ logged_on: "2026-09-02", weight_kg: 81.83, entered_value: 180.4, entered_unit: "lb" }], "lb");
    assert.equal(pts[0].value, 180.4);
  });
  test("a measurement not taken on a date is left out of its change", () => {
    const [waist, hips] = measurementChanges(
      [{ logged_on: "2026-09-01", waist_cm: 90, hip_cm: null }, { logged_on: "2026-09-10", waist_cm: 88, hip_cm: 100 }],
      "cm",
    );
    assert.equal(waist.change, -2);
    assert.equal(hips.readings, 1);
    assert.equal(hips.change, null);
  });
  test("a custom range never runs past today", () => {
    assert.equal(resolveRange({ from: "2026-09-01", to: "2026-12-01" }, "2026-09-27").to, "2026-09-27");
  });
});

describe("consistency comes from the client's own week", () => {
  // Monday session A, Wednesday session B; Wednesday's moved to Thursday.
  const plan: WorkoutContent = {
    schedule: "weekly", overview: "", restNotes: [],
    sessions: [
      { key: K(21), title: "A", day: 0, minutes: null, notes: "", exercises: [] },
      { key: K(22), title: "B", day: 2, minutes: null, notes: "", exercises: [] },
      { key: K(23), title: "C", day: 5, minutes: null, notes: "", exercises: [] },
    ],
  };
  const week = layOutWeek({
    weekStart: "2026-09-21",
    versionForDay: () => ({ id: K(2), content: plan }),
    versionById: () => ({ id: K(2), content: plan }),
    moves: [{ session_key: K(22), week_start: "2026-09-21", to_day: 3, created_at: "2026-09-21T00:00:00Z" }],
    started: [],
  });
  test("a moved session is due on its new day, a late one still counts, rest days and future days don't", () => {
    const r = consistency({
      from: "2026-09-21", to: "2026-09-27", today: "2026-09-25", weeks: [week], titleOf: () => "",
      logs: [
        { id: K(31), sessionKey: K(21), performedOn: "2026-09-22", status: "completed" }, // Monday's, done Tuesday
        { id: K(32), sessionKey: null, performedOn: "2026-09-23", status: "completed" }, // unplanned
      ],
    });
    assert.deepEqual(r.counts, { completed: 1, partial: 0, skipped: 0, unlogged: 1 });
    assert.equal(r.planned.find((p) => p.sessionKey === K(22))!.plannedOn, "2026-09-24", "Wednesday's session sat on Thursday");
    assert.equal(r.planned.find((p) => p.sessionKey === K(23))!.outcome, "upcoming", "Saturday hasn't come");
    assert.equal(r.unplannedWorkouts, 1);
    assert.equal(r.rate, 0.5);
  });
});
