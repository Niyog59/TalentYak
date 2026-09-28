import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  layOutWeek,
  missingForPublish,
  normalizeNutrition,
  normalizeWorkout,
  startOfLocalDay,
  versionInForce,
  versionStatus,
  type WorkoutContent,
} from "@/lib/programmes/content";

const K = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function exercise(n: number, extra: Record<string, unknown> = {}) {
  return { key: K(n), name: `Exercise ${n}`, sets: 3, target: { type: "reps", min: 8, max: 12 }, alternatives: [], ...extra };
}

const plan = (sessions: { key: string; title: string; day: number | null }[]): WorkoutContent => ({
  schedule: "weekly",
  overview: "",
  restNotes: [{ day: 2, note: "Walk 30 minutes" }],
  sessions: sessions.map((s) => ({ ...s, minutes: 45, notes: "", exercises: [] })),
});

describe("a coach's plan is cleaned before it is stored", () => {
  test("a demonstration link must be http(s); anything else is refused, never rendered", () => {
    const bad = normalizeWorkout({ schedule: "weekly", sessions: [{ key: K(1), title: "A", day: 0, exercises: [exercise(2, { demoUrl: "javascript:alert(1)" })] }] });
    assert.ok(bad.problems.some((p) => p.includes("demonstration link")));
    assert.equal(bad.content.sessions[0].exercises[0].demoUrl, "");
    const good = normalizeWorkout({ schedule: "weekly", sessions: [{ key: K(1), title: "A", day: 0, exercises: [exercise(2, { demoUrl: "https://example.com/squat" })] }] });
    assert.deepEqual(good.problems, []);
    assert.equal(good.content.sessions[0].exercises[0].demoUrl, "https://example.com/squat");
  });

  test("keys identify exercises and alternatives: missing or repeated keys are refused", () => {
    const dup = normalizeWorkout({
      schedule: "weekly",
      sessions: [{ key: K(1), title: "A", day: 0, exercises: [exercise(2, { alternatives: [exercise(2)] })] }],
    });
    assert.ok(dup.problems.some((p) => p.includes("appears twice")));
    const missing = normalizeWorkout({ schedule: "weekly", sessions: [{ key: "x", title: "A", day: 0, exercises: [] }] });
    assert.ok(missing.problems.some((p) => p.includes("identifier")));
  });

  test("a weekly session needs a day; a reversed rep range is refused; invisible characters are removed", () => {
    const r = normalizeWorkout({
      schedule: "weekly",
      sessions: [{ key: K(1), title: "Leg‮s", day: null, exercises: [exercise(2, { target: { type: "reps", min: 12, max: 8 } })] }],
    });
    assert.ok(r.problems.some((p) => p.includes("day of the week")));
    assert.ok(r.problems.some((p) => p.includes("rep range")));
    assert.equal(r.content.sessions[0].title, "Legs");
  });

  test("nutrition: any one mode is enough to publish, none is not", () => {
    const empty = normalizeNutrition({ guidance: "", meals: [] }).content;
    assert.equal(missingForPublish("nutrition", empty).length, 1);
    assert.deepEqual(missingForPublish("nutrition", normalizeNutrition({ guidance: "More vegetables" }).content), []);
    assert.deepEqual(missingForPublish("nutrition", normalizeNutrition({ targets: { proteinG: 120 } }).content), []);
    const meals = normalizeNutrition({ meals: [{ key: K(1), name: "Lunch", items: [{ key: K(2), food: "Rice", quantity: 1, unit: "mana", prepared: "cooked", substitutions: ["2 roti"] }] }] });
    assert.deepEqual(meals.problems, []);
    assert.deepEqual(missingForPublish("nutrition", meals.content), []);
    assert.equal(meals.content.meals[0].items[0].unit, "mana");
  });
});

describe("which version a client follows", () => {
  const v = (id: string, version: number, effective: string, extra: Partial<{ withdrawn_at: string; published_at: string | null }> = {}) => ({
    id, version, published_at: "2026-09-01T00:00:00Z", effective_from: effective, withdrawn_at: null as string | null, ...extra,
  });

  test("a scheduled update is not in force until it starts; a cancelled one never is; drafts never are", () => {
    const all = [
      v("v1", 1, "2026-09-01T00:00:00Z"),
      v("v2", 2, "2026-10-05T00:00:00Z"),
      v("v3", 3, "2026-10-12T00:00:00Z", { withdrawn_at: "2026-10-02T00:00:00Z" }),
      { id: "d4", version: 4, published_at: null, effective_from: null, withdrawn_at: null },
    ];
    assert.equal(versionInForce(all, new Date("2026-10-04T23:59:00Z"))?.id, "v1");
    assert.equal(versionInForce(all, new Date("2026-10-05T00:00:00Z"))?.id, "v2");
    assert.equal(versionInForce(all, new Date("2026-11-01T00:00:00Z"))?.id, "v2");
    const now = new Date("2026-10-01T00:00:00Z");
    assert.equal(versionStatus(all[0], all, now), "current");
    assert.equal(versionStatus(all[1], all, now), "scheduled");
    assert.equal(versionStatus(all[2], all, now), "cancelled");
    assert.equal(versionStatus(all[3], all, now), "draft");
  });

  test("an update starts at the beginning of the chosen day in the client's timezone", () => {
    assert.equal(startOfLocalDay("2026-10-05", "Asia/Kathmandu").toISOString(), "2026-10-04T18:15:00.000Z");
    // The day US clocks go back: midnight is still CDT.
    assert.equal(startOfLocalDay("2026-11-01", "America/Chicago").toISOString(), "2026-11-01T05:00:00.000Z");
    assert.equal(startOfLocalDay("2026-11-02", "America/Chicago").toISOString(), "2026-11-02T06:00:00.000Z");
  });
});

describe("a client's week, Monday to Sunday", () => {
  const A = { key: K(10), title: "Upper", day: 0 };
  const B = { key: K(11), title: "Lower", day: 3 };
  const v1 = { id: "v1", content: plan([A, B]) };
  const v2 = { id: "v2", content: plan([{ ...A, title: "Upper (new)" }, B]) };

  test("sessions sit on their days, other days are rest days with the coach's note", () => {
    const week = layOutWeek({ weekStart: "2026-09-28", versionForDay: () => v1, versionById: () => v1, moves: [], started: [] });
    assert.equal(week.length, 7);
    assert.equal(week[0].date, "2026-09-28");
    assert.deepEqual(week.map((d) => d.sessions.map((s) => s.session.title)), [["Upper"], [], [], ["Lower"], [], [], []]);
    assert.equal(week[2].restNote, "Walk 30 minutes");
  });

  test("a move changes one week only, the latest move wins, and putting it back restores the plan", () => {
    const moves = [
      { session_key: A.key, week_start: "2026-09-28", to_day: 1, created_at: "2026-09-28T08:00:00Z" },
      { session_key: A.key, week_start: "2026-09-28", to_day: 4, created_at: "2026-09-28T09:00:00Z" },
    ];
    const moved = layOutWeek({ weekStart: "2026-09-28", versionForDay: () => v1, versionById: () => v1, moves, started: [] });
    assert.equal(moved[0].sessions.length, 0);
    assert.equal(moved[4].sessions[0].session.title, "Upper");
    assert.equal(moved[4].sessions[0].movedFrom, 0);
    // The prescription itself is untouched.
    assert.equal(moved[4].sessions[0].session, v1.content.sessions[0]);

    const nextWeek = layOutWeek({ weekStart: "2026-10-05", versionForDay: () => v1, versionById: () => v1, moves, started: [] });
    assert.equal(nextWeek[0].sessions[0].session.title, "Upper");

    const back = layOutWeek({
      weekStart: "2026-09-28", versionForDay: () => v1, versionById: () => v1, started: [],
      moves: [...moves, { session_key: A.key, week_start: "2026-09-28", to_day: null, created_at: "2026-09-28T10:00:00Z" }],
    });
    assert.equal(back[0].sessions[0].session.title, "Upper");
    assert.equal(back[0].sessions[0].movedFrom, null);
  });

  test("an update mid-week applies from its day; a workout already started keeps its original instructions", () => {
    const byDay = (date: string) => (date >= "2026-10-01" ? v2 : v1);
    const byId = (id: string) => (id === "v1" ? v1 : v2);
    const week = layOutWeek({
      weekStart: "2026-09-28",
      versionForDay: byDay,
      versionById: byId,
      // Moved to Thursday, when v2 is in force — and started there under v1.
      moves: [{ session_key: A.key, week_start: "2026-09-28", to_day: 3, created_at: "2026-09-28T08:00:00Z" }],
      started: [{ performed_on: "2026-10-01", session_key: A.key, version_id: "v1" }],
    });
    const thursday = week[3].sessions.map((s) => ({ title: s.session.title, version: s.versionId, started: s.fromStartedRecord }));
    assert.deepEqual(thursday, [
      { title: "Upper", version: "v1", started: true },
      { title: "Lower", version: "v2", started: false },
    ]);
    assert.equal(week[0].versionId, "v1");
    assert.equal(week[4].versionId, "v2");
  });
});
