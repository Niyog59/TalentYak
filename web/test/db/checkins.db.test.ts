/**
 * M13 check-ins and coach feedback, as real signed-in people.
 *
 *   · a schedule makes one request for the period running now, in the
 *     client's own timezone; repeating makes nothing more, and a change
 *     applies forward without making anything late or duplicated
 *   · pausing withdraws an unstarted request, keeps a started one, and
 *     resuming asks nothing for the paused weeks
 *   · drafts and sending are safe to repeat; coaches never see drafts and
 *     can never write answers
 *   · opening never completes; completion needs published feedback; a
 *     substantive correction reopens it and keeps the original and the
 *     feedback it answered; a typo does not
 *   · a payment pause holds new requests, drafts and corrections and keeps
 *     the draft; the approved exception lets the coach finish a review sent
 *     in paid time — never across a suspension, and after a cancelled renewal
 *     ends, never after a refund
 *   · a coach change hands a review on only when the client's sharing choice
 *     covers it; otherwise it is flagged and nobody new sees it; private chat
 *     stays private
 *   · notices are queued once and re-checked before sending
 *
 * When the project is not confirmed available, every test SKIPS.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  adminClient,
  createTestUser,
  dbAvailability,
  deleteTestUsers,
  errorCode,
  makeCoach,
  makeDraftOffer,
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
let customer2: TestUser;
let customer3: TestUser;
let stranger: TestUser;
let admin: TestUser;
let coachA: CoachFixture;
let coachB: CoachFixture;
let coachC: CoachFixture;
const users: string[] = [];
const enrollments: string[] = [];
const purchases: string[] = [];
const templates: string[] = [];

let E = ""; // customer + coach A, Kathmandu
let E3 = ""; // customer2 + coach A, Chicago; carries a photo
let E4 = ""; // customer3 + coach C, with a purchase
let templateA = "";
let templateC = "";
let C1 = "";
let C3 = "";
let C4 = "";

const Q = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const QUESTIONS = [
  { key: Q(1), kind: "rating", label: "Energy", required: true },
  { key: Q(2), kind: "long_text", label: "Hardest" },
  { key: Q(3), kind: "photo", label: "Photos", sensitive: true },
];

function localDay(tz: string, offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * DAY));
}
function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

async function makeEnrollment(who: TestUser, coach: CoachFixture, purchaseId: string | null = null) {
  const sb = adminClient();
  const { data, error } = await sb.from("enrollments").insert({ customer_id: who.id, provider_id: coach.providerId, state: "active", purchase_id: purchaseId }).select("id").single();
  if (error) throw new Error(`enrollment: ${error.message}`);
  const a = await sb.from("enrollment_assignments").insert({ enrollment_id: data.id, provider_id: coach.providerId, effective_from: new Date(Date.now() - 30 * DAY).toISOString() });
  if (a.error) throw new Error(`assignment: ${a.error.message}`);
  enrollments.push(data.id);
  return data.id as string;
}

async function checkinsOf(who: TestUser, enrollmentId: string) {
  const { data } = await who.client.from("checkins").select("id, status, period_start, period_end, due_at, current_revision, review_revision, needs_resolution, responsible_provider_id").eq("enrollment_id", enrollmentId).order("period_start");
  return data ?? [];
}

const submit = (actor: string, checkin: string, answers: Record<string, unknown>, base: number, opts: { submitId?: string; substantive?: boolean; media?: string[] } = {}) =>
  adminClient().rpc("submit_checkin", {
    p_actor: actor,
    p_checkin: checkin,
    p_answers: answers,
    p_media: opts.media ?? [],
    p_submit_id: opts.submitId ?? randomUUID(),
    p_base_revision: base,
    p_substantive: opts.substantive ?? true,
    p_change_note: null,
    p_snapshot: { v: 1, capturedAt: new Date().toISOString(), period: { from: "2026-01-01", to: "2026-01-07" } },
  });

async function outboxFor(checkinId: string) {
  const { data } = await adminClient().from("outbox").select("dedupe_key, payload").eq("topic", "email.checkin_notice").eq("payload->>checkin_id", checkinId);
  return (data ?? []) as { dedupe_key: string; payload: Record<string, unknown> }[];
}

async function publish(coach: CoachFixture, checkin: string, body: string, steps: unknown[] = []) {
  const saved = await coach.user.client.rpc("save_checkin_feedback", { p_checkin: checkin, p_body: body, p_next_steps: steps, p_plan: null, p_link_conversation: true });
  if (saved.error) return saved;
  return coach.user.client.rpc("publish_checkin_feedback", { p_feedback: saved.data });
}

describe("M13 check-ins", { skip }, () => {
  before(async () => {
    customer = await createTestUser("ci-customer");
    customer2 = await createTestUser("ci-customer2");
    customer3 = await createTestUser("ci-customer3");
    stranger = await createTestUser("ci-stranger");
    admin = await createTestUser("ci-admin");
    coachA = await makeCoach("ci-coach-a");
    coachB = await makeCoach("ci-coach-b");
    coachC = await makeCoach("ci-coach-c");
    users.push(customer.id, customer2.id, customer3.id, stranger.id, admin.id, coachA.user.id, coachB.user.id, coachC.user.id);
    await setRole(admin.id, "admin");
    await upgradeToAal2(admin);
    const sb = adminClient();
    await sb.from("profiles").update({ timezone: "Asia/Kathmandu" }).eq("id", customer.id);
    await sb.from("profiles").update({ timezone: "America/Chicago" }).eq("id", customer2.id);

    E = await makeEnrollment(customer, coachA);
    E3 = await makeEnrollment(customer2, coachA);

    const t = await coachA.user.client.rpc("save_checkin_template", { p_template: null, p_title: "Weekly", p_questions: QUESTIONS });
    assert.equal(t.error, null, t.error?.message);
    templateA = t.data as string;
    templates.push(templateA);
  });

  after(async () => {
    const sb = adminClient();
    for (const e of enrollments) {
      const { data: cs } = await sb.from("checkins").select("id").eq("enrollment_id", e);
      for (const c of cs ?? []) await sb.from("outbox").delete().eq("payload->>checkin_id", c.id);
      await sb.from("checkins").delete().eq("enrollment_id", e);
      await sb.from("checkin_schedules").delete().eq("enrollment_id", e);
      await sb.from("media_assets").delete().eq("enrollment_id", e);
      const { error } = await sb.from("enrollments").delete().eq("id", e);
      if (error) console.warn(`cleanup ${e}: ${error.message}`);
    }
    for (const t of templates) await sb.from("checkin_templates").delete().eq("id", t);
    for (const p of purchases) {
      const { error } = await sb.from("purchases").delete().eq("id", p);
      if (error) console.warn(`cleanup purchase ${p}: ${error.message}`);
    }
    await deleteTestUsers(users);
  });

  test("a template can't make a photo or a sensitive question required, and editing adds a version", async () => {
    const bad = await coachA.user.client.rpc("save_checkin_template", {
      p_template: null, p_title: "Bad", p_questions: [{ key: Q(9), kind: "photo", label: "Photo", required: true }],
    });
    assert.equal(errorCode(bad.error), "checkin_template_invalid");
    const edited = await coachA.user.client.rpc("save_checkin_template", { p_template: templateA, p_title: "Weekly", p_questions: [...QUESTIONS, { key: Q(4), kind: "text", label: "Anything else?" }] });
    assert.equal(edited.error, null, edited.error?.message);
    const { data: versions } = await coachA.user.client.from("checkin_template_versions").select("version").eq("template_id", templateA);
    assert.deepEqual((versions ?? []).map((v) => v.version).sort(), [1, 2]);
    assert.ok(wasDenied(await coachB.user.client.from("checkin_templates").select("id").eq("id", templateA)), "another coach can't see it");
    assert.ok(wasDenied(await coachA.user.client.from("checkin_template_versions").update({ questions: [] }).eq("template_id", templateA).select("id")), "versions are never edited");
  });

  test("a schedule makes one request for the period running now, in the client's timezone; repeating makes nothing more", async () => {
    const tomorrow = localDay("Asia/Kathmandu", 1);
    const r = await coachA.user.client.rpc("set_checkin_schedule", {
      p_enrollment: E, p_template: templateA, p_interval_weeks: 1, p_due_weekday: isoWeekday(tomorrow), p_due_time: "18:00", p_timezone: "Asia/Kathmandu", p_response_days: 2,
    });
    assert.equal(r.error, null, r.error?.message);
    let list = await checkinsOf(customer, E);
    assert.equal(list.length, 1);
    C1 = list[0].id;
    assert.equal(list[0].period_end, tomorrow);
    assert.equal(list[0].period_start, localDay("Asia/Kathmandu"), "the first period starts when the schedule did, not a week back");
    // 18:00 in Kathmandu (UTC+05:45) is 12:15 UTC.
    assert.equal(new Date(list[0].due_at).toISOString(), `${tomorrow}T12:15:00.000Z`);

    await customer.client.rpc("refresh_checkins", { p_enrollment: E });
    await coachA.user.client.rpc("refresh_checkins", { p_enrollment: E });
    assert.equal((await adminClient().rpc("materialize_checkins")).error, null);
    assert.equal((await checkinsOf(customer, E)).length, 1, "no duplicates");
    assert.equal(Number((await stranger.client.rpc("refresh_checkins", { p_enrollment: E })).data), 0, "a stranger can't trigger anything");

    // A change applies forward: the open request keeps its due time and questions.
    const r2 = await coachA.user.client.rpc("set_checkin_schedule", {
      p_enrollment: E, p_template: templateA, p_interval_weeks: 2, p_due_weekday: isoWeekday(localDay("Asia/Kathmandu", 2)), p_due_time: "09:00", p_timezone: "Asia/Kathmandu", p_response_days: null,
    });
    assert.equal(r2.error, null, r2.error?.message);
    list = await checkinsOf(customer, E);
    assert.equal(list.length, 1, "no overlapping request");
    assert.equal(new Date(list[0].due_at).toISOString(), `${tomorrow}T12:15:00.000Z`, "never made late retroactively");
  });

  test("the client's own timezone decides the due time", async () => {
    const tomorrow = localDay("America/Chicago", 1);
    const r = await coachA.user.client.rpc("set_checkin_schedule", {
      p_enrollment: E3, p_template: templateA, p_interval_weeks: 1, p_due_weekday: isoWeekday(tomorrow), p_due_time: "18:00", p_timezone: "America/Chicago", p_response_days: 1,
    });
    assert.equal(r.error, null, r.error?.message);
    const [c] = await checkinsOf(customer2, E3);
    C3 = c.id;
    assert.equal(c.period_end, tomorrow);
    const inChicago = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(c.due_at));
    assert.equal(inChicago, `${tomorrow}, 18:00`, "18:00 on the due day, in Chicago");
    assert.equal(errorCode((await coachA.user.client.rpc("set_checkin_schedule", {
      p_enrollment: E3, p_template: templateA, p_interval_weeks: 1, p_due_weekday: 3, p_due_time: "18:00", p_timezone: "Mars/Olympus", p_response_days: null,
    })).error), "checkin_timezone_invalid");
  });

  test("pausing withdraws an unstarted request, keeps a started one, and resuming asks nothing for the paused weeks", async () => {
    const sb = adminClient();
    assert.equal((await coachA.user.client.rpc("pause_checkin_schedule", { p_enrollment: E3, p_note: "Travelling" })).error, null);
    let [c] = await checkinsOf(customer2, E3);
    assert.equal(c.status, "cancelled");
    assert.equal((await coachA.user.client.rpc("resume_checkin_schedule", { p_enrollment: E3 })).error, null);
    const after = await checkinsOf(customer2, E3);
    assert.equal(after.length, 1, "no backlog");
    assert.equal(after.filter((x) => x.status === "open").length, 0);

    // Fixture reset: remove the withdrawn request so the current period can be asked again.
    await sb.from("checkins").delete().eq("id", C3);
    await customer2.client.rpc("refresh_checkins", { p_enrollment: E3 });
    [c] = await checkinsOf(customer2, E3);
    C3 = c.id;
    assert.equal(c.status, "open");
    const d = await customer2.client.rpc("save_checkin_draft", { p_checkin: C3, p_answers: { [Q(2)]: "started" }, p_base_revision: 0, p_save_id: randomUUID() });
    assert.equal((d.data as { ok: boolean }).ok, true, d.error?.message);
    await coachA.user.client.rpc("pause_checkin_schedule", { p_enrollment: E3, p_note: null });
    [c] = await checkinsOf(customer2, E3);
    assert.equal(c.status, "open", "a started check-in stays the client's to send");
    await coachA.user.client.rpc("resume_checkin_schedule", { p_enrollment: E3 });
  });

  test("drafts save safely, and a coach never sees one", async () => {
    const sid = randomUUID();
    const first = await customer.client.rpc("save_checkin_draft", { p_checkin: C1, p_answers: { [Q(1)]: 3 }, p_base_revision: 0, p_save_id: sid });
    assert.deepEqual(first.data, { ok: true, revision: 1 });
    const replay = await customer.client.rpc("save_checkin_draft", { p_checkin: C1, p_answers: { [Q(1)]: 3 }, p_base_revision: 0, p_save_id: sid });
    assert.equal((replay.data as { replayed?: boolean }).replayed, true, "the same save twice is one save");
    const stale = await customer.client.rpc("save_checkin_draft", { p_checkin: C1, p_answers: { [Q(1)]: 5 }, p_base_revision: 0, p_save_id: randomUUID() });
    assert.equal((stale.data as { conflict?: boolean }).conflict, true, "another device's older copy never overwrites");
    assert.deepEqual((stale.data as { answers: unknown }).answers, { [Q(1)]: 3 });
    assert.equal(((await coachA.user.client.from("checkin_drafts").select("checkin_id").eq("checkin_id", C1)).data ?? []).length, 0);
    assert.equal(errorCode((await stranger.client.rpc("save_checkin_draft", { p_checkin: C1, p_answers: {}, p_base_revision: 0, p_save_id: null })).error), "checkin_not_permitted");
  });

  test("sending is one submission however often it's retried; nobody else can write or read the answers", async () => {
    const submitId = randomUUID();
    const r = await submit(customer.id, C1, { [Q(1)]: 3, [Q(2)]: "Sleep was poor because of night shifts" }, 0, { submitId });
    assert.equal(r.error, null, r.error?.message);
    assert.equal((r.data as { status: string }).status, "submitted");
    const again = await submit(customer.id, C1, { [Q(1)]: 3 }, 0, { submitId });
    assert.equal((again.data as { replayed?: boolean }).replayed, true);
    const other = await submit(customer.id, C1, { [Q(1)]: 3 }, 0);
    assert.equal((other.data as { conflict?: boolean }).conflict, true, "a second send from a stale device is refused");
    const { data: subs } = await customer.client.from("checkin_submissions").select("revision").eq("checkin_id", C1);
    assert.equal(subs?.length, 1);
    assert.equal(((await customer.client.from("checkin_drafts").select("checkin_id").eq("checkin_id", C1)).data ?? []).length, 0, "the draft is gone once sent");

    assert.ok(wasDenied(await customer.client.rpc("submit_checkin", { p_actor: customer.id, p_checkin: C1, p_answers: {}, p_media: [], p_submit_id: randomUUID(), p_base_revision: 1, p_substantive: true, p_change_note: null, p_snapshot: null })), "only our server sends, with a summary it built");
    assert.ok(wasDenied(await coachA.user.client.from("checkin_submissions").insert({ checkin_id: C1, revision: 2, answers: {}, submit_id: randomUUID() })), "a coach can't add answers");
    assert.ok(wasDenied(await coachA.user.client.from("checkin_submissions").update({ answers: {} }).eq("checkin_id", C1).select("id")), "or rewrite them");
    assert.equal(((await coachA.user.client.from("checkin_submissions").select("id").eq("checkin_id", C1)).data ?? []).length, 1, "the current coach reads it");
    for (const who of [coachB.user, stranger, admin, customer2]) {
      assert.ok(wasDenied(await who.client.from("checkin_submissions").select("id").eq("checkin_id", C1)), "nobody else does");
    }
    const notices = await outboxFor(C1);
    assert.deepEqual(notices.map((n) => n.dedupe_key), [`checkin:${C1}:submitted`]);
    assert.equal(notices[0].payload.recipient_id, coachA.user.id);
    assert.equal(JSON.stringify(notices[0].payload).includes("night shifts"), false, "no answer in a notice");
  });

  test("opening never completes; completion needs published feedback; publishing tells the client once", async () => {
    assert.equal(errorCode((await coachA.user.client.rpc("complete_checkin_review", { p_checkin: C1 })).error), "checkin_feedback_required");
    const saved = await coachA.user.client.rpc("save_checkin_feedback", { p_checkin: C1, p_body: "Good week.", p_next_steps: [{ key: Q(5), text: "Swap squats for goblet squats", kind: "plan_change" }], p_plan: null, p_link_conversation: true });
    assert.equal(saved.error, null, saved.error?.message);
    assert.equal(((await customer.client.from("checkin_feedback").select("id").eq("checkin_id", C1)).data ?? []).length, 0, "a draft is invisible to the client");
    assert.equal(errorCode((await coachA.user.client.rpc("complete_checkin_review", { p_checkin: C1 })).error), "checkin_feedback_required");
    assert.equal((await coachA.user.client.rpc("publish_checkin_feedback", { p_feedback: saved.data })).error, null);
    const { data: fb } = await customer.client.from("checkin_feedback").select("id, conversation_id, refers_to_revision").eq("checkin_id", C1);
    assert.equal(fb?.length, 1);
    assert.ok(fb![0].conversation_id, "linked to the conversation for follow-up");
    assert.ok(wasDenied(await coachA.user.client.from("checkin_feedback").update({ body: "rewritten" }).eq("id", saved.data).select("id")), "published feedback is never rewritten");

    // A promise is not a delivery: only a version published after the check-in can be linked.
    assert.equal(errorCode((await coachA.user.client.rpc("link_checkin_step", { p_feedback: saved.data, p_step: Q(5), p_version: randomUUID() })).error), "checkin_step_version_invalid");

    assert.equal((await coachA.user.client.rpc("complete_checkin_review", { p_checkin: C1 })).error, null);
    assert.equal((await checkinsOf(customer, E))[0].status, "reviewed");
    assert.equal((await outboxFor(C1)).filter((n) => n.dedupe_key.includes(":feedback:")).length, 1);
  });

  test("a typo doesn't reopen a review; a substantive correction does, keeping the original and the feedback it answered", async () => {
    const minor = await submit(customer.id, C1, { [Q(1)]: 3, [Q(2)]: "Sleep was poor becuase of night shifts" }, 1, { substantive: false });
    assert.equal((minor.data as { status: string }).status, "reviewed");
    const major = await submit(customer.id, C1, { [Q(1)]: 2, [Q(2)]: "Knee pain all week" }, 2, { substantive: true });
    assert.equal((major.data as { status: string }).status, "reopened");
    const { data: subs } = await customer.client.from("checkin_submissions").select("revision, answers").eq("checkin_id", C1).order("revision");
    assert.equal(subs?.length, 3);
    assert.equal((subs![0].answers as Record<string, unknown>)[Q(2)], "Sleep was poor because of night shifts", "the original is kept");
    const { data: fb } = await customer.client.from("checkin_feedback").select("refers_to_revision").eq("checkin_id", C1);
    assert.equal(fb![0].refers_to_revision, 1, "earlier feedback still says what it answered");
    assert.ok((await adminClient().from("checkin_submissions").update({ answers: {} }).eq("checkin_id", C1)).error, "not even the server can edit a submission");
    assert.equal(errorCode((await coachA.user.client.rpc("complete_checkin_review", { p_checkin: C1 })).error), "checkin_feedback_required");
    assert.ok((await outboxFor(C1)).some((n) => n.dedupe_key === `checkin:${C1}:corrected:3`), "the coach is told about the substantive change");
    assert.ok(!(await outboxFor(C1)).some((n) => n.dedupe_key === `checkin:${C1}:corrected:2`), "but not about the typo");
  });

  test("a payment pause holds drafts, corrections and new requests and keeps the draft; the coach may finish the review — never across a suspension", async () => {
    const sb = adminClient();
    // A correction draft started before the pause.
    const d = await customer.client.rpc("save_checkin_draft", { p_checkin: C1, p_answers: { [Q(1)]: 4 }, p_base_revision: 0, p_save_id: randomUUID() });
    assert.equal((d.data as { ok: boolean }).ok, true, d.error?.message);
    await sb.from("enrollments").update({ state: "paused" }).eq("id", E);

    assert.equal(errorCode((await customer.client.rpc("save_checkin_draft", { p_checkin: C1, p_answers: { [Q(1)]: 5 }, p_base_revision: 1, p_save_id: randomUUID() })).error), "checkin_paused");
    assert.equal(errorCode((await submit(customer.id, C1, { [Q(1)]: 5 }, 3)).error), "checkin_paused");
    assert.equal(Number((await customer.client.rpc("refresh_checkins", { p_enrollment: E })).data), 0);
    assert.equal(errorCode((await coachA.user.client.rpc("pause_checkin_schedule", { p_enrollment: E, p_note: null })).error), "checkin_not_permitted", "no new coaching work");
    const { data: kept } = await customer.client.from("checkin_drafts").select("answers").eq("checkin_id", C1).single();
    assert.deepEqual(kept?.answers, { [Q(1)]: 4 }, "the draft is kept");

    await sb.from("profiles").update({ suspended_at: new Date().toISOString() }).eq("id", customer.id);
    assert.equal(errorCode((await publish(coachA, C1, "Rest the knee")).error), "checkin_not_permitted", "the exception never overrides a suspension");
    await sb.from("profiles").update({ suspended_at: null }).eq("id", customer.id);

    assert.equal((await publish(coachA, C1, "Rest the knee this week.")).error, null, "sent in paid time: the review may be finished");
    assert.equal((await coachA.user.client.rpc("complete_checkin_review", { p_checkin: C1 })).error, null);
    const { data: fb } = await customer.client.from("checkin_feedback").select("id").eq("checkin_id", C1);
    assert.equal(fb?.length, 2, "the client reads it");
    assert.equal(errorCode((await publish(coachA, C1, "More")).error), "checkin_not_permitted", "a finished review isn't reopened by the exception");

    await sb.from("enrollments").update({ state: "active" }).eq("id", E);
    const resumed = await customer.client.rpc("save_checkin_draft", { p_checkin: C1, p_answers: { [Q(1)]: 5 }, p_base_revision: 1, p_save_id: randomUUID() });
    assert.equal((resumed.data as { ok: boolean }).ok, true, "the draft carries on after renewal");
  });

  test("a check-in not sent in paid time gets no exception", async () => {
    const sb = adminClient();
    const r = await submit(customer.id, C1, { [Q(1)]: 1, [Q(2)]: "Much worse, stopping squats" }, 3);
    assert.equal((r.data as { status: string }).status, "reopened");
    await sb.from("checkins").update({ review_in_paid_time: false }).eq("id", C1);
    await sb.from("enrollments").update({ state: "paused" }).eq("id", E);
    assert.equal(errorCode((await publish(coachA, C1, "x")).error), "checkin_not_permitted");
    await sb.from("enrollments").update({ state: "active" }).eq("id", E);
    await sb.from("checkins").update({ review_in_paid_time: true }).eq("id", C1);
  });

  test("notices are queued once and re-checked before sending", async () => {
    const sb = adminClient();
    await sb.from("checkins").update({ due_at: new Date(Date.now() + 3600_000).toISOString() }).eq("id", C3);
    for (let i = 0; i < 2; i++) assert.equal((await sb.rpc("queue_checkin_reminders", { p_due_soon_hours: 24, p_late_after_hours: 24, p_late_window_hours: 72, p_review_default_hours: 72 })).error, null);
    const dueSoon = (await outboxFor(C3)).filter((n) => n.dedupe_key.endsWith(":due_soon"));
    assert.equal(dueSoon.length, 1);
    assert.equal((await sb.rpc("checkin_notice_still_true", { p_job: dueSoon[0].payload })).data, null, "still true now");
  });

  test("a coach change hands a review on only within the client's sharing choice; private chat stays private", async () => {
    const sb = adminClient();
    // E3: a check-in with a photo, sent to coach A.
    const { data: photo } = await sb.from("media_assets").insert({ owner_profile_id: customer2.id, enrollment_id: E3, purpose: "checkin_attachment", media_kind: "image", state: "ready", recorded_at: new Date().toISOString() }).select("id").single();
    const sent = await submit(customer2.id, C3, { [Q(1)]: 4, [Q(3)]: [photo!.id] }, 0, { media: [photo!.id] });
    assert.equal(sent.error, null, sent.error?.message);
    const [dueSoon] = (await outboxFor(C3)).filter((n) => n.dedupe_key.endsWith(":due_soon"));
    assert.equal((await sb.rpc("checkin_notice_still_true", { p_job: dueSoon.payload })).data, "already sent or closed", "a reminder for a sent check-in is not sent");
    assert.equal(((await coachA.user.client.from("media_assets").select("id").eq("id", photo!.id)).data ?? []).length, 1, "coach A sees the sent photo");

    const handover = new Date(Date.now() - 1000).toISOString();
    for (const e of [E, E3]) {
      await sb.from("enrollment_assignments").update({ effective_to: handover }).eq("enrollment_id", e).is("effective_to", null);
      const opened = await sb.from("enrollment_assignments").insert({ enrollment_id: e, provider_id: coachB.providerId, previous_provider_id: coachA.providerId, effective_from: handover, history_scope: "programme_and_logs" });
      assert.equal(opened.error, null, opened.error?.message);
      await sb.from("enrollments").update({ provider_id: coachB.providerId }).eq("id", e);
    }

    // E: no attachments, logs scope → handed to coach B.
    const [c1] = await checkinsOf(customer, E);
    assert.equal(c1.responsible_provider_id, coachB.providerId);
    assert.equal(c1.needs_resolution, null);
    assert.equal(((await coachB.user.client.from("checkin_submissions").select("id").eq("checkin_id", C1)).data ?? []).length, 4);
    assert.ok(wasDenied(await coachA.user.client.from("checkins").select("id").eq("id", C1)), "the former coach sees nothing");
    const { data: fb } = await coachB.user.client.from("checkin_feedback").select("conversation_id").eq("checkin_id", C1).not("conversation_id", "is", null).limit(1);
    assert.ok(fb?.[0]?.conversation_id);
    assert.ok(wasDenied(await coachB.user.client.from("conversations").select("id").eq("id", fb![0].conversation_id)), "a check-in link never opens the previous coach's chat");
    assert.ok(wasDenied(await coachB.user.client.from("messages").select("id").eq("conversation_id", fb![0].conversation_id)));
    assert.equal((await publish(coachB, C1, "Picking this up.")).error, null, "the new coach can review it");
    assert.ok((await outboxFor(C1)).some((n) => n.dedupe_key.startsWith(`checkin:${C1}:transferred:`) && n.payload.recipient_id === coachB.user.id));

    // E3: a photo, logs scope → flagged; nobody new sees anything.
    const [c3] = await checkinsOf(customer2, E3);
    assert.equal(c3.needs_resolution, "coach_change_scope");
    assert.equal(c3.responsible_provider_id, coachA.providerId);
    for (const who of [coachA.user, coachB.user]) {
      assert.ok(wasDenied(await who.client.from("checkins").select("id").eq("id", C3)));
      assert.ok(wasDenied(await who.client.from("checkin_submissions").select("id").eq("checkin_id", C3)));
      assert.ok(wasDenied(await who.client.from("media_assets").select("id").eq("id", photo!.id)));
    }
    const attention = await admin.client.rpc("admin_checkin_attention");
    assert.equal(attention.error, null, attention.error?.message);
    const row = ((attention.data ?? []) as Record<string, unknown>[]).find((r) => r.checkin_id === C3);
    assert.equal(row?.reason, "coach_change_scope");
    assert.ok(!JSON.stringify(row).includes(photo!.id) && !("answers" in (row ?? {})), "TalentYak sees that it needs a person, not what it says");
    assert.ok(wasDenied(await admin.client.from("checkin_submissions").select("id").eq("checkin_id", C3)));

    // The client widens what they share: handed on, photo included.
    await sb.from("enrollment_assignments").update({ history_scope: "full" }).eq("enrollment_id", E3).is("effective_to", null);
    const [c3b] = await checkinsOf(customer2, E3);
    assert.equal(c3b.needs_resolution, null);
    assert.equal(c3b.responsible_provider_id, coachB.providerId);
    assert.equal(((await coachB.user.client.from("media_assets").select("id").eq("id", photo!.id)).data ?? []).length, 1);
  });

  test("after a cancelled renewal ends, the coach may finish a review sent in paid time — never after a refund", async (t) => {
    const sb = adminClient();
    const offer = await makeDraftOffer(coachC);
    const { data: p, error } = await sb.from("purchases").insert({
      customer_id: customer3.id, provider_id: coachC.providerId, offer_version_id: offer.versionId,
      service_type: "recurring_coaching", billing_structure: "monthly_recurring", charge_currency: "USD", charge_amount_minor: 10000,
      commission_policy_id: "commission.coaching.v3", cancellation_policy_id: "cancellation.v2", payment_failure_policy_id: "payment_failure.v2",
      recognition_policy_id: "recognition.v1", billing_terms_policy_id: "billing_terms.v1",
      state: "active", paid_through_at: new Date(Date.now() + 10 * DAY).toISOString(),
    }).select("id").single();
    if (error) {
      t.skip(`purchase fixture unavailable: ${error.message}`);
      return;
    }
    purchases.push(p.id);
    E4 = await makeEnrollment(customer3, coachC, p.id);
    const tc = await coachC.user.client.rpc("save_checkin_template", { p_template: null, p_title: "Weekly", p_questions: QUESTIONS });
    templateC = tc.data as string;
    templates.push(templateC);
    const s = await coachC.user.client.rpc("set_checkin_schedule", { p_enrollment: E4, p_template: templateC, p_interval_weeks: 1, p_due_weekday: isoWeekday(localDay("UTC", 1)), p_due_time: "18:00", p_timezone: "UTC", p_response_days: null });
    assert.equal(s.error, null, s.error?.message);
    [{ id: C4 }] = await checkinsOf(customer3, E4);
    assert.equal((await submit(customer3.id, C4, { [Q(1)]: 3 }, 0)).error, null);

    // The cancelled renewal runs out.
    const ended = new Date().toISOString();
    await sb.from("purchases").update({ state: "refunded", paid_through_at: new Date(Date.now() - DAY).toISOString() }).eq("id", p.id);
    await sb.from("enrollments").update({ state: "ended", ended_at: ended }).eq("id", E4);
    await sb.from("enrollment_assignments").update({ effective_to: ended }).eq("enrollment_id", E4).is("effective_to", null);
    assert.equal(errorCode((await publish(coachC, C4, "x")).error), "checkin_not_permitted", "a refund ends it");
    await sb.from("purchases").update({ state: "ended" }).eq("id", p.id);
    assert.equal((await publish(coachC, C4, "Well done this month.")).error, null, "a cancelled renewal that ran out does not");
    assert.equal((await coachC.user.client.rpc("complete_checkin_review", { p_checkin: C4 })).error, null);
    assert.equal(((await customer3.client.from("checkin_feedback").select("id").eq("checkin_id", C4)).data ?? []).length, 1, "the client reads it");
    assert.ok(wasDenied(await coachC.user.client.from("checkins").select("id").eq("id", C4)), "once finished, the ended coach's access ends too");
    assert.equal(errorCode((await customer3.client.rpc("save_checkin_draft", { p_checkin: C4, p_answers: {}, p_base_revision: 0, p_save_id: null })).error), "checkin_ended", "no client revisions");
  });
});
