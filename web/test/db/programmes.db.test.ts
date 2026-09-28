/**
 * M11 programmes, as real signed-in people.
 *
 *   · a template is the coach's own, and a client plan copied from it is
 *     independent of later template edits
 *   · a draft is invisible to the client; a published version never changes
 *   · updates apply forward: scheduled, replaced, cancelled only before they start
 *   · the client is told when a version is published, not when a draft is saved
 *   · moving a session changes the week, never the prescription
 *   · M12 records can point only at real sessions and exercises of a published
 *     version on their own relationship
 *   · the training & food profile reaches the current coach only
 *   · pause, reassignment (with and without shared history) and ending apply
 *     the existing relationship rules
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
let coachC: CoachFixture;
const users: string[] = [];

let enrollment = "";
let otherEnrollment = "";
let templateId = "";
let planA = "";
let otherPlan = "";
let otherVersion = "";
let v1 = "";

const S1 = randomUUID();
const EX1 = randomUUID();
const ALT1 = randomUUID();

function workout(title: string) {
  const core = { sets: 3, target: { type: "reps", min: 8, max: 12 }, restSeconds: 90, load: null, loadNote: "", effort: "RPE 7", notes: "", demoUrl: "" };
  return {
    schedule: "weekly",
    overview: "",
    restNotes: [],
    sessions: [{
      key: S1, title, day: 0, minutes: 45, notes: "",
      exercises: [{ key: EX1, name: "Back squat", ...core, progression: "", alternatives: [{ key: ALT1, name: "Goblet squat", ...core }] }],
    }],
  };
}

async function draftAndPublish(who: TestUser, plan: string, title: string, opts: { effective?: string | null; notify?: boolean; summary?: string | null } = {}) {
  const saved = await who.client.rpc("save_plan_draft", { p_plan: plan, p_title: title, p_content: workout(title) });
  assert.equal(saved.error, null, saved.error?.message);
  return who.client.rpc("publish_plan_draft", {
    p_plan: plan,
    p_effective_from: opts.effective ?? null,
    p_notify: opts.notify ?? true,
    p_summary: opts.summary === undefined ? "Changed the main lift." : opts.summary,
  });
}

const notices = async (versionId: string) =>
  (await adminClient().from("outbox").select("id, payload").eq("topic", "email.plan_updated").eq("payload->>version_id", versionId)).data ?? [];

async function makeEnrollment(who: TestUser, coach: CoachFixture) {
  const sb = adminClient();
  const { data, error } = await sb.from("enrollments").insert({ customer_id: who.id, provider_id: coach.providerId, state: "active" }).select("id").single();
  if (error) throw new Error(`enrollment: ${error.message}`);
  await sb.from("enrollment_assignments").insert({
    enrollment_id: data.id, provider_id: coach.providerId, effective_from: new Date(Date.now() - 30 * DAY).toISOString(),
  });
  return data.id as string;
}

function thisMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

describe("M11 programmes", { skip }, () => {
  before(async () => {
    customer = await createTestUser("prog-customer");
    otherCustomer = await createTestUser("prog-other");
    admin = await createTestUser("prog-admin");
    coachA = await makeCoach("prog-coach-a");
    coachB = await makeCoach("prog-coach-b");
    coachC = await makeCoach("prog-coach-c");
    users.push(customer.id, otherCustomer.id, admin.id, coachA.user.id, coachB.user.id, coachC.user.id);
    await setRole(admin.id, "admin");
    await upgradeToAal2(admin);

    enrollment = await makeEnrollment(customer, coachA);
    otherEnrollment = await makeEnrollment(otherCustomer, coachC);

    // Another coach's client with a published plan, for cross-client checks.
    const { data: p } = await coachC.user.client.rpc("ensure_my_client_plan", { p_enrollment: otherEnrollment, p_kind: "workout" });
    otherPlan = p as string;
    const pub = await draftAndPublish(coachC.user, otherPlan, "Other client's plan");
    assert.equal(pub.error, null, pub.error?.message);
    otherVersion = (pub.data as { version_id: string }).version_id;
  });

  after(async () => {
    const sb = adminClient();
    for (const e of [enrollment, otherEnrollment].filter(Boolean)) {
      await sb.from("outbox").delete().eq("topic", "email.plan_updated").eq("payload->>enrollment_id", e);
      const { data: logs } = await sb.from("workout_logs").select("id").eq("enrollment_id", e);
      for (const l of logs ?? []) await sb.from("set_logs").delete().eq("workout_log_id", l.id);
      await sb.from("workout_logs").delete().eq("enrollment_id", e);
      // Deleting the relationship takes its plans with it — the only way a
      // published version can ever be removed.
      const { error } = await sb.from("enrollments").delete().eq("id", e);
      if (error) console.warn(`cleanup ${e}: ${error.message}`);
    }
    await sb.from("plan_templates").delete().in("provider_id", [coachA, coachB, coachC].filter(Boolean).map((c) => c.providerId));
    await deleteTestUsers(users);
  });

  test("a template is the coach's own: no client, no other coach, no visitor reads it", async () => {
    const { data, error } = await coachA.user.client.from("plan_templates")
      .insert({ provider_id: coachA.providerId, kind: "workout", title: "Beginner full body", content: workout("Template session") })
      .select("id").single();
    assert.equal(error, null, error?.message);
    templateId = data!.id;

    const forged = await coachB.user.client.from("plan_templates").insert({ provider_id: coachA.providerId, kind: "workout", title: "x", content: workout("x") });
    assert.ok(forged.error, "a coach cannot create a template in someone else's name");
    for (const who of [customer.client, coachB.user.client, anonymousClient()]) {
      const r = await who.from("plan_templates").select("id").eq("id", templateId);
      assert.ok(wasDenied(r));
    }
    const bad = await coachA.user.client.from("plan_templates").insert({ provider_id: coachA.providerId, kind: "workout", title: "Bad", content: { sessions: "nope" } });
    assert.ok(bad.error, "malformed content is refused by the database");
  });

  test("a draft copied from a template is visible to its coach only, and independent of the template", async () => {
    const { data: p, error } = await coachA.user.client.rpc("ensure_my_client_plan", { p_enrollment: enrollment, p_kind: "workout" });
    assert.equal(error, null, error?.message);
    planA = p as string;
    const other = await coachB.user.client.rpc("ensure_my_client_plan", { p_enrollment: enrollment, p_kind: "workout" });
    assert.equal(errorCode(other.error), "plan_not_permitted");

    const copy = await coachA.user.client.rpc("start_plan_draft_from", { p_plan: planA, p_template: templateId, p_version: null });
    assert.equal(copy.error, null, copy.error?.message);

    await coachA.user.client.from("plan_templates").update({ title: "Edited later", content: workout("Edited template") }).eq("id", templateId);
    const { data: draft } = await coachA.user.client.from("client_plan_versions").select("title, content, source_template_id, published_at").eq("plan_id", planA).single();
    assert.equal(draft!.published_at, null);
    assert.equal(draft!.title, "Beginner full body");
    assert.equal((draft!.content as ReturnType<typeof workout>).sessions[0].title, "Template session");
    assert.equal(draft!.source_template_id, templateId);

    assert.equal(((await customer.client.from("client_plan_versions").select("id").eq("plan_id", planA)).data ?? []).length, 0, "the client sees no draft");
    assert.ok(wasDenied(await coachC.user.client.from("client_plan_versions").select("id").eq("plan_id", planA)));
    assert.ok(wasDenied(await anonymousClient().from("client_plan_versions").select("id").eq("plan_id", planA)));
    assert.ok(wasDenied(await admin.client.from("client_plan_versions").select("id").eq("plan_id", planA)), "admin has no reach into plans");
    const anyNotice = await adminClient().from("outbox").select("id").eq("topic", "email.plan_updated").eq("payload->>enrollment_id", enrollment);
    assert.equal((anyNotice.data ?? []).length, 0, "saving a draft tells nobody");
  });

  test("publishing announces the first version; the client reads it; nobody can change it", async () => {
    const pub = await coachA.user.client.rpc("publish_plan_draft", { p_plan: planA, p_effective_from: null, p_notify: false, p_summary: null });
    assert.equal(pub.error, null, pub.error?.message);
    const r = pub.data as { version_id: string; version: number; notified: boolean };
    v1 = r.version_id;
    assert.equal(r.version, 1);
    assert.equal(r.notified, true, "a first version is always announced");
    const queued = await notices(v1);
    assert.equal(queued.length, 1);
    assert.equal((queued[0].payload as { event: string }).event, "published");
    assert.ok(!JSON.stringify(queued[0].payload).includes("Back squat"), "the notice never carries plan content");

    const seen = await customer.client.from("client_plan_versions").select("id, title").eq("plan_id", planA);
    assert.deepEqual((seen.data ?? []).map((x) => x.id), [v1]);

    const direct = await coachA.user.client.from("client_plan_versions").update({ title: "Rewritten" }).eq("id", v1).select("id");
    assert.equal((direct.data ?? []).length, 0, "no direct write path");
    const privileged = await adminClient().from("client_plan_versions").update({ content: workout("Rewritten") }).eq("id", v1);
    assert.equal(errorCode(privileged.error), "plan_version_published", "even the service role cannot rewrite a published version");
    const removed = await adminClient().from("client_plan_versions").delete().eq("id", v1);
    assert.equal(errorCode(removed.error), "plan_version_published");
  });

  test("a meaningful change needs a summary; a minor correction publishes without a notice", async () => {
    const noSummary = await draftAndPublish(coachA.user, planA, "Upper v2", { summary: null });
    assert.equal(errorCode(noSummary.error), "plan_summary_required");
    const quiet = await coachA.user.client.rpc("publish_plan_draft", { p_plan: planA, p_effective_from: null, p_notify: false, p_summary: null });
    assert.equal(quiet.error, null, quiet.error?.message);
    const r = quiet.data as { version_id: string; notified: boolean };
    assert.equal(r.notified, false);
    assert.equal((await notices(r.version_id)).length, 0);
    const { data: first } = await customer.client.from("client_plan_versions").select("title").eq("id", v1).single();
    assert.equal(first!.title, "Beginner full body", "the earlier version is untouched");
  });

  test("updates apply forward: scheduled, replaced by a newer earlier one, and cancellable only before they start", async () => {
    const later = await draftAndPublish(coachA.user, planA, "Phase 2", { effective: new Date(Date.now() + 3 * DAY).toISOString() });
    assert.equal(later.error, null, later.error?.message);
    const v3 = (later.data as { version_id: string }).version_id;

    const sooner = await draftAndPublish(coachA.user, planA, "Phase 2, sooner", { effective: new Date(Date.now() + 1 * DAY).toISOString() });
    assert.equal(sooner.error, null, sooner.error?.message);
    const v4 = (sooner.data as { version_id: string; replaced_scheduled: number }).version_id;
    assert.equal((sooner.data as { replaced_scheduled: number }).replaced_scheduled, 1);
    const { data: rows } = await customer.client.from("client_plan_versions").select("id, withdrawn_at, effective_from").in("id", [v3, v4]);
    assert.ok(rows!.find((x) => x.id === v3)!.withdrawn_at, "the older, later-starting update is withdrawn");
    assert.equal(rows!.find((x) => x.id === v4)!.withdrawn_at, null);

    const cancel = await coachA.user.client.rpc("withdraw_scheduled_plan_version", { p_version: v4 });
    assert.equal(cancel.error, null, cancel.error?.message);
    assert.ok((await notices(v4)).some((n) => (n.payload as { event: string }).event === "withdrawn"), "the client is told it was cancelled");

    const inEffect = await coachA.user.client.rpc("withdraw_scheduled_plan_version", { p_version: v1 });
    assert.equal(errorCode(inEffect.error), "plan_version_in_effect");
    const past = await draftAndPublish(coachA.user, planA, "Backdated", { effective: new Date(Date.now() - 10 * DAY).toISOString() });
    assert.equal(past.error, null);
    assert.ok(Date.parse((past.data as { effective_from: string }).effective_from) >= Date.now() - 60_000, "an update never takes effect in the past");
  });

  test("moving a session changes this week only; the prescription is untouched; another client cannot", async () => {
    const before = (await customer.client.from("client_plan_versions").select("content").eq("id", v1).single()).data!.content;
    const moved = await customer.client.rpc("move_plan_session", {
      p_plan: planA, p_version: v1, p_session_key: S1, p_week_start: thisMonday(), p_to_day: 2, p_reason: "Travelling Monday",
    });
    assert.equal(moved.error, null, moved.error?.message);
    const after = (await customer.client.from("client_plan_versions").select("content").eq("id", v1).single()).data!.content;
    assert.deepEqual(after, before);
    const { data: moves } = await coachA.user.client.from("plan_session_moves").select("to_day, moved_by_role").eq("plan_id", planA);
    assert.deepEqual(moves, [{ to_day: 2, moved_by_role: "customer" }]);

    const stranger = await otherCustomer.client.rpc("move_plan_session", {
      p_plan: planA, p_version: v1, p_session_key: S1, p_week_start: thisMonday(), p_to_day: 3, p_reason: null,
    });
    assert.equal(errorCode(stranger.error), "plan_not_permitted");
    const notMonday = await customer.client.rpc("move_plan_session", {
      p_plan: planA, p_version: v1, p_session_key: S1, p_week_start: new Date(Date.parse(thisMonday()) + DAY).toISOString().slice(0, 10), p_to_day: 3, p_reason: null,
    });
    assert.equal(errorCode(notMonday.error), "plan_week_invalid");
  });

  test("M12 records point only at a real session and exercise of a published version on their own relationship", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const ok = await customer.client.from("workout_logs").insert({ enrollment_id: enrollment, plan_version_id: v1, session_key: S1, performed_at: today }).select("id").single();
    assert.equal(ok.error, null, ok.error?.message);

    const foreign = await customer.client.from("workout_logs").insert({ enrollment_id: enrollment, plan_version_id: otherVersion, session_key: S1, performed_at: today });
    assert.equal(errorCode(foreign.error), "workout_log_reference_invalid", "another client's plan version is refused");
    const ghost = await customer.client.from("workout_logs").insert({ enrollment_id: enrollment, plan_version_id: v1, session_key: randomUUID(), performed_at: today });
    assert.equal(errorCode(ghost.error), "workout_log_reference_invalid");

    const main = await customer.client.from("set_logs").insert({ workout_log_id: ok.data!.id, set_index: 1, reps: 10, exercise_key: EX1 });
    assert.equal(main.error, null, main.error?.message);
    const alt = await customer.client.from("set_logs").insert({ workout_log_id: ok.data!.id, set_index: 1, reps: 10, exercise_key: EX1, alternative_key: ALT1 });
    assert.equal(alt.error, null, alt.error?.message);
    const wrong = await customer.client.from("set_logs").insert({ workout_log_id: ok.data!.id, set_index: 2, reps: 10, exercise_key: randomUUID() });
    assert.equal(errorCode(wrong.error), "set_log_reference_invalid");
  });

  test("the training & food profile: the client writes it; their current coach reads it; nobody else", async () => {
    const t = await customer.client.from("client_training_profiles").upsert({ customer_id: customer.id, experience: "some", equipment: ["dumbbells"], session_minutes: 45, days_per_week: 3 });
    const h = await customer.client.from("client_health_profiles").upsert({ customer_id: customer.id, limitations: "Left knee", allergies: "Peanuts" });
    assert.equal(t.error, null, t.error?.message);
    assert.equal(h.error, null, h.error?.message);
    const forged = await otherCustomer.client.from("client_health_profiles").upsert({ customer_id: customer.id, limitations: "x" });
    assert.ok(forged.error);

    assert.equal((await coachA.user.client.from("client_health_profiles").select("limitations").eq("customer_id", customer.id).single()).data?.limitations, "Left knee");
    assert.equal((await coachA.user.client.from("client_training_profiles").select("session_minutes").eq("customer_id", customer.id).single()).data?.session_minutes, 45);
    for (const who of [coachC.user.client, admin.client, otherCustomer.client, anonymousClient()]) {
      assert.ok(wasDenied(await who.from("client_health_profiles").select("customer_id").eq("customer_id", customer.id)));
      assert.ok(wasDenied(await who.from("client_training_profiles").select("customer_id").eq("customer_id", customer.id)));
    }
  });

  test("a paused relationship: the coach can read but not change anything; the client still reads and moves", async () => {
    await adminClient().from("enrollments").update({ state: "paused" }).eq("id", enrollment);
    try {
      const save = await coachA.user.client.rpc("save_plan_draft", { p_plan: planA, p_title: "During pause", p_content: workout("x") });
      assert.equal(errorCode(save.error), "plan_not_permitted");
      assert.ok(((await coachA.user.client.from("client_plan_versions").select("id").eq("plan_id", planA)).data ?? []).length > 0);
      assert.ok(((await customer.client.from("client_plan_versions").select("id").eq("plan_id", planA)).data ?? []).length > 0);
      const move = await customer.client.rpc("move_plan_session", { p_plan: planA, p_version: v1, p_session_key: S1, p_week_start: thisMonday(), p_to_day: null, p_reason: null });
      assert.equal(move.error, null, move.error?.message);
    } finally {
      await adminClient().from("enrollments").update({ state: "active" }).eq("id", enrollment);
    }
  });

  test("a coach change: the former coach loses access; the new coach reads published history within scope, never drafts, and may copy it for this client only", async () => {
    // An unpublished draft the new coach must never see.
    await coachA.user.client.rpc("save_plan_draft", { p_plan: planA, p_title: "Unfinished", p_content: workout("Unfinished") });

    const sb = adminClient();
    const handover = new Date(Date.now() - 1000).toISOString();
    await sb.from("enrollment_assignments").update({ effective_to: handover }).eq("enrollment_id", enrollment).is("effective_to", null);
    const { error } = await sb.from("enrollment_assignments").insert({
      enrollment_id: enrollment, provider_id: coachB.providerId, previous_provider_id: coachA.providerId,
      effective_from: handover, history_scope: "programme_and_logs",
    });
    assert.equal(error, null, error?.message);
    await sb.from("enrollments").update({ provider_id: coachB.providerId }).eq("id", enrollment);

    assert.ok(wasDenied(await coachA.user.client.from("client_plans").select("id").eq("enrollment_id", enrollment)), "the former coach sees nothing");
    assert.ok(wasDenied(await coachA.user.client.from("client_health_profiles").select("customer_id").eq("customer_id", customer.id)));
    const oldWrite = await coachA.user.client.rpc("save_plan_draft", { p_plan: planA, p_title: "x", p_content: workout("x") });
    assert.equal(errorCode(oldWrite.error), "plan_not_permitted");

    const visible = (await coachB.user.client.from("client_plan_versions").select("id, published_at").eq("plan_id", planA)).data ?? [];
    assert.ok(visible.length >= 3);
    assert.ok(visible.every((v) => v.published_at !== null), "never the previous coach's draft");
    const bWrite = await coachB.user.client.rpc("save_plan_draft", { p_plan: planA, p_title: "x", p_content: workout("x") });
    assert.equal(errorCode(bWrite.error), "plan_not_permitted", "the previous coach's plan stays theirs");

    const { data: mine } = await coachB.user.client.rpc("ensure_my_client_plan", { p_enrollment: enrollment, p_kind: "workout" });
    const foreign = await coachB.user.client.rpc("start_plan_draft_from", { p_plan: mine, p_template: null, p_version: otherVersion });
    assert.equal(errorCode(foreign.error), "plan_source_unavailable", "never another client's plan");
    const theirTemplate = await coachB.user.client.rpc("start_plan_draft_from", { p_plan: mine, p_template: templateId, p_version: null });
    assert.equal(errorCode(theirTemplate.error), "plan_source_unavailable", "never the previous coach's template");
    const copy = await coachB.user.client.rpc("start_plan_draft_from", { p_plan: mine, p_template: null, p_version: v1 });
    assert.equal(copy.error, null, copy.error?.message);
    const { data: draft } = await coachB.user.client.from("client_plan_versions").select("source_version_id, content").eq("plan_id", mine as string).single();
    assert.equal(draft!.source_version_id, v1);
    assert.equal((draft!.content as ReturnType<typeof workout>).sessions[0].exercises[0].key, EX1, "exercise identity carries over for progress");

    // The client sees both stints' published plans, and still no drafts.
    const clientView = (await customer.client.from("client_plan_versions").select("plan_id, published_at")).data ?? [];
    assert.ok(clientView.every((v) => v.published_at !== null));
    assert.ok(clientView.some((v) => v.plan_id === planA));
  });

  test("history_scope 'none' hides the previous coach's plans; the new coach keeps their own", async () => {
    await adminClient().from("enrollment_assignments").update({ history_scope: "none" }).eq("enrollment_id", enrollment).is("effective_to", null);
    assert.ok(wasDenied(await coachB.user.client.from("client_plan_versions").select("id").eq("plan_id", planA)));
    const own = (await coachB.user.client.from("client_plans").select("id, provider_id").eq("enrollment_id", enrollment)).data ?? [];
    assert.deepEqual(own.map((p) => p.provider_id), [coachB.providerId]);
  });

  test("when coaching ends the client keeps every published version and the coach reads nothing", async () => {
    await adminClient().from("enrollments").update({ state: "ended", ended_at: new Date().toISOString() }).eq("id", enrollment);
    assert.ok(wasDenied(await coachB.user.client.from("client_plans").select("id").eq("enrollment_id", enrollment)));
    assert.ok(wasDenied(await coachB.user.client.from("client_training_profiles").select("customer_id").eq("customer_id", customer.id)));
    const kept = (await customer.client.from("client_plan_versions").select("id").eq("plan_id", planA)).data ?? [];
    assert.ok(kept.length >= 3);
  });
});
