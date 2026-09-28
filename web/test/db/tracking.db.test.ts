/**
 * M12 client logging and progress, as real signed-in people.
 *
 *   · a workout saves against the exact version and session it followed, and
 *     a later plan update never rewrites it
 *   · saving is safe to repeat: a retried save changes nothing; a stale save
 *     is refused as a conflict; a second device starting the same session on
 *     the same day is pointed at the existing record
 *   · the database refuses exercises the version doesn't contain, rows
 *     belonging to another record, and dates in the future
 *   · body readings keep the unit entered; food days are partial until marked
 *   · clients write only through the functions; coaches only read — the
 *     current coach, within the client's sharing choice; admin nothing
 *   · a payment pause holds new entries and keeps everything readable; paying
 *     restores it but never lifts a suspension
 *
 * When the project is not confirmed available, every test SKIPS.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  adminClient,
  anonymousClient,
  createTestUser,
  dbAvailability,
  deleteTestUsers,
  errorCode,
  makeCoach,
  setRole,
  upgradeToAal2,
  wasDenied,
  type CoachFixture,
  type TestUser,
} from "./harness.ts";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;
const DAY = 86_400_000;

let customer: TestUser;
let otherCustomer: TestUser;
let admin: TestUser;
let coachA: CoachFixture;
let coachB: CoachFixture;
const users: string[] = [];

let enrollment = "";
let otherEnrollment = "";
let plan = "";
let v1 = "";
let v2 = "";
let workoutId = "";
let revision = 0;
let foodId = "";

const S1 = randomUUID();
const EX1 = randomUUID();
const ALT1 = randomUUID();
const EX2 = randomUUID();
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);

function content(title: string, withSecond = true) {
  const core = { sets: 2, target: { type: "reps", min: 8, max: 10 }, restSeconds: 90, load: null, loadNote: "", effort: "", notes: "", demoUrl: "" };
  return {
    schedule: "weekly",
    overview: "",
    restNotes: [],
    sessions: [{
      key: S1, title, day: 0, minutes: 45, notes: "",
      exercises: [
        { key: EX1, name: "Back squat", ...core, progression: "", alternatives: [{ key: ALT1, name: "Goblet squat", ...core }] },
        ...(withSecond ? [{ key: EX2, name: "Dumbbell press", ...core, progression: "", alternatives: [] }] : []),
      ],
    }],
  };
}

async function makeEnrollment(who: TestUser, coach: CoachFixture) {
  const sb = adminClient();
  const { data, error } = await sb.from("enrollments").insert({ customer_id: who.id, provider_id: coach.providerId, state: "active" }).select("id").single();
  if (error) throw new Error(`enrollment: ${error.message}`);
  await sb.from("enrollment_assignments").insert({ enrollment_id: data.id, provider_id: coach.providerId, effective_from: new Date(Date.now() - 30 * DAY).toISOString() });
  return data.id as string;
}

/** A workout document as the device sends it (wire format). */
function doc(opts: { id?: string; date?: string; version?: string; ex1Sets?: number; alt?: boolean; own?: boolean; status?: string } = {}) {
  const e1 = randomUUID();
  const e2 = randomUUID();
  const sets = Array.from({ length: opts.ex1Sets ?? 2 }, (_, i) => ({
    id: randomUUID(), exercise_log_id: e1, set_index: i + 1, load_value: 60, load_unit: "kg", reps: 8, duration_seconds: null, rpe: null, extra: false,
  }));
  return {
    id: opts.id ?? randomUUID(),
    enrollment_id: enrollment,
    plan_version_id: opts.version ?? v1,
    session_key: S1,
    performed_on: opts.date ?? today,
    title: null,
    status: opts.status ?? "in_progress",
    notes: "Felt good",
    exercises: [
      { id: e1, position: 0, exercise_key: EX1, alternative_key: opts.alt ? ALT1 : null, performed_name: null, status: "active", load_kind: "weight", load_basis: null, notes: "" },
      { id: e2, position: 1, exercise_key: EX2, alternative_key: null, performed_name: opts.own ? "Push-up" : null, status: "active", load_kind: opts.own ? "bodyweight" : "weight", load_basis: opts.own ? null : "per_hand", notes: "" },
    ],
    sets: [
      ...sets,
      { id: randomUUID(), exercise_log_id: e2, set_index: 1, load_value: opts.own ? null : 20, load_unit: opts.own ? null : "lb", reps: 10, duration_seconds: null, rpe: 7, extra: false },
    ],
  };
}

const save = (who: TestUser, d: unknown, base: number, saveId = randomUUID()) =>
  who.client.rpc("save_workout_log", { p_doc: d, p_base_revision: base, p_save_id: saveId });

async function mediaRow(owner: string, enrollmentId: string, purpose: "progress_photo" | "food_photo") {
  const { data, error } = await adminClient().from("media_assets").insert({
    owner_profile_id: owner, enrollment_id: enrollmentId, purpose, media_kind: "image", state: "ready", recorded_at: new Date().toISOString(),
  }).select("id").single();
  if (error) throw new Error(`media: ${error.message}`);
  return data.id as string;
}

describe("M12 tracking", { skip }, () => {
  before(async () => {
    customer = await createTestUser("track-customer");
    otherCustomer = await createTestUser("track-other");
    admin = await createTestUser("track-admin");
    coachA = await makeCoach("track-coach-a");
    coachB = await makeCoach("track-coach-b");
    users.push(customer.id, otherCustomer.id, admin.id, coachA.user.id, coachB.user.id);
    await setRole(admin.id, "admin");
    await upgradeToAal2(admin);
    await adminClient().from("profiles").update({ timezone: "UTC" }).in("id", [customer.id, otherCustomer.id]);

    enrollment = await makeEnrollment(customer, coachA);
    otherEnrollment = await makeEnrollment(otherCustomer, coachB);

    const { data: p } = await coachA.user.client.rpc("ensure_my_client_plan", { p_enrollment: enrollment, p_kind: "workout" });
    plan = p as string;
    await coachA.user.client.rpc("save_plan_draft", { p_plan: plan, p_title: "Strength A", p_content: content("Lower body") });
    const pub = await coachA.user.client.rpc("publish_plan_draft", { p_plan: plan, p_effective_from: null, p_notify: true, p_summary: null });
    assert.equal(pub.error, null, pub.error?.message);
    v1 = (pub.data as { version_id: string }).version_id;
  });

  after(async () => {
    const sb = adminClient();
    for (const e of [enrollment, otherEnrollment].filter(Boolean)) {
      await sb.from("outbox").delete().eq("payload->>enrollment_id", e);
      await sb.from("food_entries").delete().eq("enrollment_id", e);
      await sb.from("food_diary_days").delete().eq("enrollment_id", e);
      await sb.from("progress_photos").delete().eq("enrollment_id", e);
      await sb.from("bodyweight_logs").delete().eq("enrollment_id", e);
      await sb.from("measurements").delete().eq("enrollment_id", e);
      await sb.from("tracking_focus").delete().eq("enrollment_id", e);
      await sb.from("workout_logs").delete().eq("enrollment_id", e);
      await sb.from("media_assets").delete().eq("enrollment_id", e);
      const { error } = await sb.from("enrollments").delete().eq("id", e);
      if (error) console.warn(`cleanup ${e}: ${error.message}`);
    }
    await sb.from("tracking_preferences").delete().in("customer_id", users);
    await deleteTestUsers(users);
  });

  test("a planned workout saves against its version, keeping prescribed and actual apart", async () => {
    const d = doc({ alt: true, own: true });
    workoutId = d.id;
    const r = await save(customer, d, 0);
    assert.equal(r.error, null, r.error?.message);
    assert.deepEqual(r.data, { ok: true, revision: 1 });
    revision = 1;

    const { data: w } = await customer.client.from("workout_logs").select("plan_version_id, session_key, status, revision").eq("id", workoutId).single();
    assert.equal(w!.plan_version_id, v1);
    assert.equal(w!.status, "in_progress");
    const { data: sets } = await customer.client.from("set_logs").select("exercise_key, alternative_key, load_value, load_unit, reps").eq("workout_log_id", workoutId).order("set_index");
    assert.equal(sets!.length, 3, "only the confirmed sets exist");
    const alt = sets!.filter((s) => s.alternative_key === ALT1);
    assert.equal(alt.length, 2, "the coach's alternative is recorded as what was done, under its own key");
    const own = sets!.find((s) => s.alternative_key === null && s.exercise_key === null);
    assert.ok(own, "the client's own substitute is never filed under the planned exercise's key");
  });

  test("an exact retry changes nothing; a stale save is a conflict, not an overwrite", async () => {
    const d = doc({ id: workoutId });
    const saveId = randomUUID();
    const first = await save(customer, d, revision, saveId);
    assert.deepEqual(first.data, { ok: true, revision: 2 });
    const again = await save(customer, d, revision, saveId);
    assert.equal((again.data as { replayed?: boolean }).replayed, true, "the same save arriving twice is recognised");
    assert.equal((again.data as { revision: number }).revision, 2);
    revision = 2;
    const { count } = await adminClient().from("set_logs").select("id", { count: "exact", head: true }).eq("workout_log_id", workoutId);
    assert.equal(count, 3, "no duplicate sets");

    const stale = await save(customer, doc({ id: workoutId, ex1Sets: 5 }), 1);
    assert.deepEqual(stale.data, { ok: false, conflict: true, revision: 2 });
    const { count: after } = await adminClient().from("set_logs").select("id", { count: "exact", head: true }).eq("workout_log_id", workoutId);
    assert.equal(after, 3, "the other device's save did not overwrite");
  });

  test("a second device starting the same session on the same day is pointed at the existing record", async () => {
    const r = await save(customer, doc(), 0);
    const data = r.data as { ok: boolean; duplicate?: boolean; existing_id?: string };
    assert.equal(data.ok, false);
    assert.equal(data.duplicate, true);
    assert.equal(data.existing_id, workoutId);
    const { count } = await adminClient().from("workout_logs").select("id", { count: "exact", head: true }).eq("enrollment_id", enrollment);
    assert.equal(count, 1, "one session, one record");
  });

  test("the database refuses what the plan doesn't contain, another record's rows, and future dates", async () => {
    const ghost = doc({ date: yesterday });
    ghost.exercises[0].exercise_key = randomUUID();
    assert.equal(errorCode((await save(customer, ghost, 0)).error), "exercise_log_reference_invalid");

    const stolen = doc({ date: yesterday });
    const { data: theirs } = await adminClient().from("set_logs").select("id").eq("workout_log_id", workoutId).limit(1).single();
    stolen.sets[0].id = theirs!.id;
    assert.equal(errorCode((await save(customer, stolen, 0)).error), "workout_log_invalid");

    const future = doc({ date: new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10) });
    assert.equal(errorCode((await save(customer, future, 0)).error), "tracking_date_invalid");

    const notMine = doc({ date: yesterday });
    notMine.enrollment_id = otherEnrollment;
    assert.equal(errorCode((await save(customer, notMine, 0)).error), "tracking_not_permitted");
  });

  test("direct writes are refused: clients use the functions; coaches can't write at all", async () => {
    for (const [table, row] of [
      ["workout_logs", { enrollment_id: enrollment, performed_at: yesterday }],
      ["bodyweight_logs", { enrollment_id: enrollment, logged_on: yesterday, weight_kg: 70 }],
      ["food_entries", { id: randomUUID(), enrollment_id: enrollment, eaten_on: yesterday, meal: "lunch", description: "x" }],
    ] as const) {
      assert.ok((await customer.client.from(table).insert(row)).error, `client cannot insert into ${table} directly`);
      assert.ok((await coachA.user.client.from(table).insert(row)).error, `coach cannot insert into ${table}`);
    }
    const upd = await coachA.user.client.from("set_logs").update({ reps: 99 }).eq("workout_log_id", workoutId).select("id");
    assert.ok(upd.error || (upd.data ?? []).length === 0, "a coach cannot rewrite a client's result");
    assert.equal(errorCode((await save(coachA.user, doc({ id: workoutId }), revision)).error), "tracking_not_permitted");
  });

  test("a plan update never rewrites a workout started under the earlier version", async () => {
    await coachA.user.client.rpc("save_plan_draft", { p_plan: plan, p_title: "Strength B", p_content: content("Lower body v2", false) });
    const pub = await coachA.user.client.rpc("publish_plan_draft", { p_plan: plan, p_effective_from: null, p_notify: true, p_summary: "Dropped the press." });
    assert.equal(pub.error, null, pub.error?.message);
    v2 = (pub.data as { version_id: string }).version_id;

    const { data: w } = await customer.client.from("workout_logs").select("plan_version_id").eq("id", workoutId).single();
    assert.equal(w!.plan_version_id, v1, "the record still names the version it followed");
    const r = await save(customer, doc({ id: workoutId, status: "completed" }), revision);
    assert.equal((r.data as { ok: boolean }).ok, true, "finishing it later still validates against the version it started under");
    revision = (r.data as { revision: number }).revision;

    const moved = await save(customer, doc({ id: workoutId, version: v2 }), revision);
    assert.equal(errorCode(moved.error), "workout_log_invalid", "a record can't be moved onto another version");
    const press = doc({ date: yesterday, version: v2 });
    assert.equal(errorCode((await save(customer, press, 0)).error), "exercise_log_reference_invalid", "v2 no longer has the press");
  });

  test("the current coach reads the logs; another coach, a visitor and an admin read nothing", async () => {
    const c = await coachA.user.client.from("workout_logs").select("id").eq("id", workoutId);
    assert.equal(c.data?.length, 1);
    assert.equal(((await coachA.user.client.from("workout_exercise_logs").select("id").eq("workout_log_id", workoutId)).data ?? []).length, 2);
    for (const who of [coachB.user.client, anonymousClient(), admin.client, otherCustomer.client]) {
      assert.ok(wasDenied(await who.from("workout_logs").select("id").eq("id", workoutId)));
      assert.ok(wasDenied(await who.from("workout_exercise_logs").select("id").eq("workout_log_id", workoutId)));
      assert.ok(wasDenied(await who.from("set_logs").select("id").eq("workout_log_id", workoutId)));
    }
  });

  test("body readings keep the unit entered; a stale edit is a conflict; blank clears", async () => {
    const first = await customer.client.rpc("save_body_entry", {
      p_enrollment: enrollment, p_date: yesterday, p_weight: 180.4, p_weight_unit: "lb",
      p_waist: 32.5, p_hips: null, p_chest: null, p_arm: null, p_length_unit: "in", p_base: "",
    });
    assert.equal(first.error, null, first.error?.message);
    const token = (first.data as { token: string }).token;
    assert.match(token, /^\d+\|\d+$/);
    const { data: bw } = await customer.client.from("bodyweight_logs").select("weight_kg, entered_value, entered_unit").eq("enrollment_id", enrollment).eq("logged_on", yesterday).single();
    assert.equal(Number(bw!.weight_kg), 81.83);
    assert.equal(Number(bw!.entered_value), 180.4);
    assert.equal(bw!.entered_unit, "lb");
    const { data: m } = await customer.client.from("measurements").select("waist_cm, entered_unit").eq("enrollment_id", enrollment).eq("logged_on", yesterday).single();
    assert.equal(Number(m!.waist_cm), 82.55);

    const stale = await customer.client.rpc("save_body_entry", {
      p_enrollment: enrollment, p_date: yesterday, p_weight: 81, p_weight_unit: "kg",
      p_waist: null, p_hips: null, p_chest: null, p_arm: null, p_length_unit: "cm", p_base: "",
    });
    assert.equal((stale.data as { conflict?: boolean }).conflict, true, "the device thought the date was empty; it isn't");

    const again = await customer.client.rpc("save_body_entry", {
      p_enrollment: enrollment, p_date: yesterday, p_weight: 81, p_weight_unit: "kg",
      p_waist: 32.5, p_hips: null, p_chest: null, p_arm: null, p_length_unit: "in", p_base: token,
    });
    assert.equal((again.data as { ok: boolean }).ok, true, "the token the page was given matches");
    assert.equal(((await coachA.user.client.from("bodyweight_logs").select("id").eq("enrollment_id", enrollment)).data ?? []).length, 1, "the coach reads it");
    assert.ok(wasDenied(await admin.client.from("bodyweight_logs").select("id").eq("enrollment_id", enrollment)));
  });

  test("food: entries with or without numbers; partial until marked complete; photos must be the client's own food photos", async () => {
    foodId = randomUUID();
    const photo = await mediaRow(customer.id, enrollment, "food_photo");
    const r = await customer.client.rpc("save_food_entry", {
      p_entry: { id: foodId, enrollment_id: enrollment, eaten_on: today, meal: "lunch", description: "Dal bhat", media_id: photo, kcal: null, protein_g: 25 },
      p_base_revision: 0,
    });
    assert.deepEqual(r.data, { ok: true, revision: 1 });
    const stale = await customer.client.rpc("save_food_entry", {
      p_entry: { id: foodId, enrollment_id: enrollment, eaten_on: today, meal: "lunch", description: "Changed", media_id: photo }, p_base_revision: 0,
    });
    assert.equal((stale.data as { conflict?: boolean }).conflict, true);

    const progress = await mediaRow(customer.id, enrollment, "progress_photo");
    const wrongKind = await customer.client.rpc("save_food_entry", {
      p_entry: { id: randomUUID(), enrollment_id: enrollment, eaten_on: today, meal: "dinner", media_id: progress }, p_base_revision: 0,
    });
    assert.equal(errorCode(wrongKind.error), "food_entry_invalid", "a progress photo isn't a food photo");
    const theirs = await mediaRow(otherCustomer.id, otherEnrollment, "food_photo");
    const foreign = await customer.client.rpc("save_food_entry", {
      p_entry: { id: randomUUID(), enrollment_id: enrollment, eaten_on: today, meal: "dinner", media_id: theirs }, p_base_revision: 0,
    });
    assert.equal(errorCode(foreign.error), "food_entry_invalid", "someone else's photo can't be attached");

    const { data: before } = await customer.client.from("food_diary_days").select("complete").eq("enrollment_id", enrollment).eq("day", today);
    assert.equal((before ?? []).length, 0, "no day row: a partial record until the client says otherwise");
    assert.equal((await customer.client.rpc("set_food_day", { p_enrollment: enrollment, p_day: today, p_complete: true })).error, null);
    const { data: coachView } = await coachA.user.client.from("food_diary_days").select("complete").eq("enrollment_id", enrollment).eq("day", today).single();
    assert.equal(coachView!.complete, true);
    assert.ok(wasDenied(await coachB.user.client.from("food_entries").select("id").eq("id", foodId)));
  });

  test("progress photos: dated, the client's own, removable; the tracking focus is the current coach's", async () => {
    const media = await mediaRow(customer.id, enrollment, "progress_photo");
    const r = await customer.client.rpc("save_progress_photo", { p_enrollment: enrollment, p_media: media, p_date: yesterday, p_pose: "front" });
    assert.equal(r.error, null, r.error?.message);
    assert.equal(((await coachA.user.client.from("progress_photos").select("id").eq("media_id", media)).data ?? []).length, 1);
    const food = await mediaRow(customer.id, enrollment, "food_photo");
    assert.equal(errorCode((await customer.client.rpc("save_progress_photo", { p_enrollment: enrollment, p_media: food, p_date: yesterday, p_pose: null })).error), "progress_photo_invalid");
    const removed = await customer.client.rpc("remove_progress_photo", { p_media: media });
    assert.equal(removed.data, 1);

    assert.equal((await coachA.user.client.rpc("set_tracking_focus", { p_enrollment: enrollment, p_fields: ["bodyweight", "photos"], p_note: "Weekly is plenty." })).error, null);
    const { data: seen } = await customer.client.from("tracking_focus").select("fields, note").eq("enrollment_id", enrollment).single();
    assert.deepEqual(seen!.fields, ["bodyweight", "photos"]);
    assert.equal(errorCode((await coachB.user.client.rpc("set_tracking_focus", { p_enrollment: enrollment, p_fields: [], p_note: null })).error), "tracking_not_permitted");
    assert.ok((await customer.client.rpc("set_tracking_focus", { p_enrollment: enrollment, p_fields: [], p_note: null })).error, "a client can't set their coach's focus");
  });

  test("a payment pause holds new entries and keeps everything readable; paying restores it; a suspension stays", async () => {
    const sb = adminClient();
    await sb.from("enrollments").update({ state: "paused" }).eq("id", enrollment);
    const { data: state } = await customer.client.rpc("tracking_write_state", { p_enrollment: enrollment });
    assert.equal(state, "paused");
    assert.equal(errorCode((await save(customer, doc({ id: workoutId }), revision)).error), "tracking_paused");
    assert.equal(errorCode((await customer.client.rpc("set_food_day", { p_enrollment: enrollment, p_day: today, p_complete: false })).error), "tracking_paused");
    assert.equal(errorCode((await customer.client.rpc("save_body_entry", {
      p_enrollment: enrollment, p_date: today, p_weight: 80, p_weight_unit: "kg", p_waist: null, p_hips: null, p_chest: null, p_arm: null, p_length_unit: "cm", p_base: null,
    })).error), "tracking_paused");
    assert.equal(((await customer.client.from("workout_logs").select("id").eq("id", workoutId)).data ?? []).length, 1, "the client still reads their records");
    assert.equal(((await coachA.user.client.from("workout_logs").select("id").eq("id", workoutId)).data ?? []).length, 1, "the coach still reads them");
    const { count } = await sb.from("workout_logs").select("id", { count: "exact", head: true }).eq("enrollment_id", enrollment);
    assert.equal(count, 1, "nothing was deleted");

    // Paid again: the held entry saves.
    await sb.from("enrollments").update({ state: "active" }).eq("id", enrollment);
    const resumed = await save(customer, doc({ id: workoutId }), revision);
    assert.equal((resumed.data as { ok: boolean }).ok, true);
    revision = (resumed.data as { revision: number }).revision;

    // Active again, but the client is suspended: still held.
    await sb.from("profiles").update({ suspended_at: new Date().toISOString() }).eq("id", customer.id);
    const { data: suspended } = await customer.client.rpc("tracking_write_state", { p_enrollment: enrollment });
    assert.equal(suspended, "suspended");
    assert.equal(errorCode((await save(customer, doc({ id: workoutId }), revision)).error), "tracking_suspended");
    await sb.from("profiles").update({ suspended_at: null }).eq("id", customer.id);
  });

  test("a coach change: the former coach reads nothing; the new coach sees earlier logs only as the client chose, photos never on the logs-only scope", async () => {
    const sb = adminClient();
    const photo = await mediaRow(customer.id, enrollment, "progress_photo");
    await customer.client.rpc("save_progress_photo", { p_enrollment: enrollment, p_media: photo, p_date: yesterday, p_pose: "side" });
    const handover = new Date(Date.now() - 1000).toISOString();
    const closed = await sb.from("enrollment_assignments").update({ effective_to: handover }).eq("enrollment_id", enrollment).is("effective_to", null);
    assert.equal(closed.error, null, closed.error?.message);
    const opened = await sb.from("enrollment_assignments").insert({
      enrollment_id: enrollment, provider_id: coachB.providerId, previous_provider_id: coachA.providerId, effective_from: handover, history_scope: "programme_and_logs",
    });
    assert.equal(opened.error, null, opened.error?.message);
    await sb.from("enrollments").update({ provider_id: coachB.providerId }).eq("id", enrollment);

    assert.ok(wasDenied(await coachA.user.client.from("workout_logs").select("id").eq("id", workoutId)), "the former coach loses access");
    assert.ok(wasDenied(await coachA.user.client.from("food_entries").select("id").eq("id", foodId)));
    assert.equal(((await coachB.user.client.from("workout_logs").select("id").eq("id", workoutId)).data ?? []).length, 1, "logs are shared on this scope");
    assert.ok(wasDenied(await coachB.user.client.from("progress_photos").select("id").eq("media_id", photo)), "earlier photos are not");
    assert.ok(wasDenied(await coachB.user.client.from("tracking_focus").select("fields").eq("enrollment_id", enrollment)), "the old coach's focus isn't the new coach's");

    await sb.from("enrollment_assignments").update({ history_scope: "none" }).eq("enrollment_id", enrollment).is("effective_to", null);
    assert.ok(wasDenied(await coachB.user.client.from("workout_logs").select("id").eq("id", workoutId)), "scope 'none' hides earlier history");
    assert.ok(wasDenied(await coachB.user.client.from("food_entries").select("id").eq("id", foodId)));

    // The client keeps logging with the new coach, who sees what's new. Records
    // are dated by the client's calendar day, so a record dated the day of the
    // handover counts as earlier history; move the handover back a day to
    // stand for "the next day".
    const dayBefore = new Date(`${yesterday}T00:00:00Z`).toISOString();
    const endOld = await sb.from("enrollment_assignments").update({ effective_to: dayBefore }).eq("enrollment_id", enrollment).eq("provider_id", coachA.providerId);
    assert.equal(endOld.error, null, endOld.error?.message);
    const startNew = await sb.from("enrollment_assignments").update({ effective_from: dayBefore }).eq("enrollment_id", enrollment).is("effective_to", null);
    assert.equal(startNew.error, null, startNew.error?.message);
    const unplanned = { id: randomUUID(), enrollment_id: enrollment, plan_version_id: null, session_key: null, performed_on: today, title: "Evening run", status: "completed", notes: "", exercises: [], sets: [] };
    const r = await save(customer, unplanned, 0);
    assert.equal((r.data as { ok: boolean }).ok, true, (r.error as { message?: string } | null)?.message);
    assert.equal(((await coachB.user.client.from("workout_logs").select("id").eq("id", unplanned.id)).data ?? []).length, 1);
  });
});
