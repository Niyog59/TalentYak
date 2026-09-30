/**
 * M18 coach applications, as real people (visitors, applicants, founders, the
 * server) through real sessions.
 *
 *   · only a signed-in person with a confirmed email can apply; one open
 *     application per account; the public can read nothing
 *   · applicants see only their own application, never another's, and never
 *     the founder's notes, checklist or history
 *   · drafts are invisible to founders; founders need a second factor
 *   · sending twice queues one receipt and one founder alert; a decision
 *     queues one email; repeating it is refused and sends nothing
 *   · approval creates no coach; signing (server only) creates one unpublished
 *     coach in onboarding, keeps an administrator's role, and carries the
 *     founder's qualification checks over exactly
 *   · withdrawal, deletion, and the "Accept coach applications" switch
 *
 * When the project is not confirmed available, every test SKIPS.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { adminClient, anonymousClient, createTestUser, dbAvailability, deleteTestUsers, errorCode, setRole, upgradeToAal2, type TestUser } from "./harness.ts";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;

const fields = {
  full_name: "Asha Test",
  country: "NP",
  timezone: "Asia/Kathmandu",
  languages: ["Nepali", "English"],
  specialties: ["Beginners", "Strength training"],
  experience_years: "3-5",
  experience: "Five years coaching adults in a gym in Kathmandu.",
  availability: "Weekday evenings, about 10 hours a week",
  new_client_capacity: "5",
  consistency_answer: "Start small with three short sessions a week and check in every week.",
  privacy_version: "coach-application-privacy.v1",
};

let applicant: TestUser;
let other: TestUser;
let founder: TestUser;
let founderNoMfa: TestUser;
const users: string[] = [];

async function switchTo(mode: "on" | "off") {
  await adminClient().from("feature_settings").update({ mode }).eq("key", "coach_applications");
}

describe("M18 coach applications", { skip }, () => {
  before(async () => {
    applicant = await createTestUser("applicant");
    other = await createTestUser("applicant-other");
    founder = await createTestUser("app-founder");
    founderNoMfa = await createTestUser("app-founder-nomfa");
    users.push(applicant.id, other.id, founder.id, founderNoMfa.id);
    await setRole(founder.id, "admin");
    await setRole(founderNoMfa.id, "admin");
    await upgradeToAal2(founder);
    await switchTo("on");
  });

  after(async () => {
    await switchTo("on");
    const sb = adminClient();
    await sb.from("coach_applications").delete().in("profile_id", users);
    const { data: provs } = await sb.from("providers").select("id").in("profile_id", users);
    for (const p of provs ?? []) await sb.from("providers").update({ status: "retired", active: false }).eq("id", p.id);
    await deleteTestUsers(users);
  });

  let app = "";
  let cert = "";

  test("the public reads nothing and can call nothing", async () => {
    const anon = anonymousClient();
    const { data } = await anon.from("coach_applications").select("id");
    assert.deepEqual(data ?? [], []);
    const r = await anon.rpc("coach_application_save", { p_application: null, p_fields: fields });
    assert.ok(r.error, "anonymous save refused");
  });

  test("an applicant creates one draft; a second open application is refused", async () => {
    const r = await applicant.client.rpc("coach_application_save", { p_application: null, p_fields: fields });
    assert.equal(r.error, null);
    app = r.data as string;
    const again = await applicant.client.rpc("coach_application_save", { p_application: null, p_fields: fields });
    assert.equal(errorCode(again.error), "application_exists");
    const c = await applicant.client.rpc("coach_application_add_certificate", { p_application: app, p_qualification: "Level 3 PT", p_issuing_body: "Example Institute", p_expires_on: null });
    assert.equal(c.error, null);
    cert = c.data as string;
  });

  test("direct writes and self-approval are refused", async () => {
    const u = await applicant.client.from("coach_applications").update({ status: "approved" }).eq("id", app).select("id");
    assert.ok(u.error || (u.data ?? []).length === 0);
    const s = await applicant.client.rpc("sign_coach_agreement", { p_user: applicant.id, p_application: app, p_version: "v", p_signed_name: "x" });
    assert.ok(s.error, "server-only signing refused");
  });

  test("another applicant can't see or touch it", async () => {
    const { data } = await other.client.from("coach_applications").select("id").eq("id", app);
    assert.deepEqual(data ?? [], []);
    const certs = await other.client.rpc("my_coach_application_certificates", { p_application: app });
    assert.deepEqual(certs.data ?? [], []);
    assert.equal(errorCode((await other.client.rpc("coach_application_remove_certificate", { p_certificate: cert })).error), "not_found");
    assert.equal(errorCode((await other.client.rpc("coach_application_withdraw", { p_application: app })).error), "not_found");
  });

  test("founders can't see a draft; sending twice queues one receipt and one alert", async () => {
    assert.deepEqual((await founder.client.from("coach_applications").select("id").eq("id", app)).data ?? [], []);
    await applicant.client.rpc("coach_application_submit", { p_application: app });
    await applicant.client.rpc("coach_application_submit", { p_application: app });
    const { data: jobs } = await adminClient().from("outbox").select("id").in("dedupe_key", [`coach_application_received:${app}`, `coach_application_submitted:${app}`]);
    assert.equal((jobs ?? []).length, 2);
  });

  test("a founder needs a second factor; with it they review, note and decide — once", async () => {
    assert.deepEqual((await founderNoMfa.client.from("coach_applications").select("id").eq("id", app)).data ?? [], []);
    assert.equal(errorCode((await founderNoMfa.client.rpc("admin_set_coach_application_status", { p_application: app, p_to: "reviewing", p_reason: null })).error), "admin_mfa_required");

    const f = founder.client;
    assert.equal((await f.from("coach_applications").select("id").eq("id", app)).data?.length, 1);
    assert.equal((await f.rpc("admin_add_coach_application_note", { p_application: app, p_body: "Private note" })).error, null);
    assert.equal(errorCode((await f.rpc("admin_check_coach_certificate", { p_certificate: cert, p_state: "verified", p_detail: "" })).error), "reason_required");
    assert.equal((await f.rpc("admin_check_coach_certificate", { p_certificate: cert, p_state: "verified", p_detail: "Confirmed with issuer" })).error, null);
    assert.equal((await f.rpc("admin_set_coach_application_status", { p_application: app, p_to: "approved", p_reason: "Private reason" })).error, null);
    assert.equal(errorCode((await f.rpc("admin_set_coach_application_status", { p_application: app, p_to: "approved", p_reason: null })).error), "no_change");
    const { data: jobs } = await adminClient().from("outbox").select("id, payload").eq("topic", "email.coach_application_decision").contains("payload", { application_id: app });
    assert.equal((jobs ?? []).length, 1, "one decision, one email");
    assert.doesNotMatch(JSON.stringify(jobs), /Private reason/);
  });

  test("the applicant sees the approval but none of the founder's records, and isn't a coach yet", async () => {
    const c = applicant.client;
    assert.equal((await c.from("coach_applications").select("status").eq("id", app).single()).data?.status, "approved");
    for (const t of ["coach_application_notes", "coach_application_events", "coach_application_checklist", "coach_application_certificates"]) {
      assert.deepEqual((await c.from(t).select("*")).data ?? [], [], `${t} hidden from the applicant`);
    }
    assert.equal((await adminClient().from("providers").select("id").eq("profile_id", applicant.id)).data?.length, 0);
  });

  test("signing creates one unpublished onboarding coach and carries the check over", async () => {
    const sb = adminClient();
    const r = await sb.rpc("sign_coach_agreement", { p_user: applicant.id, p_application: app, p_version: "coach-agreement.draft.2026-09", p_signed_name: "Asha Test" });
    assert.equal(r.error, null);
    await sb.rpc("sign_coach_agreement", { p_user: applicant.id, p_application: app, p_version: "coach-agreement.draft.2026-09", p_signed_name: "Asha Test" });
    const { data: provs } = await sb.from("providers").select("id, status, published_at, accepting_new_clients").eq("profile_id", applicant.id);
    assert.equal(provs?.length, 1);
    assert.equal(provs![0].status, "onboarding");
    assert.equal(provs![0].published_at, null);
    assert.equal(provs![0].accepting_new_clients, false);
    const { data: creds } = await sb.from("provider_credentials").select("verification_state").eq("provider_id", provs![0].id);
    assert.deepEqual(creds?.map((c) => c.verification_state), ["verified"]);
    assert.equal(errorCode((await applicant.client.rpc("coach_application_withdraw", { p_application: app })).error), "application_locked");
  });

  test("an administrator who applies keeps the administrator role", async () => {
    const a = await founder.client.rpc("coach_application_save", { p_application: null, p_fields: fields });
    assert.equal(a.error, null);
    await founder.client.rpc("coach_application_submit", { p_application: a.data });
    await founder.client.rpc("admin_set_coach_application_status", { p_application: a.data, p_to: "approved", p_reason: null });
    await adminClient().rpc("sign_coach_agreement", { p_user: founder.id, p_application: a.data, p_version: "coach-agreement.draft.2026-09", p_signed_name: "Founder Test" });
    assert.equal((await adminClient().from("profiles").select("role").eq("id", founder.id).single()).data?.role, "admin");
  });

  test("withdraw, then delete; the switch stops new applications only", async () => {
    const o = other.client;
    const a = (await o.rpc("coach_application_save", { p_application: null, p_fields: fields })).data as string;
    await o.rpc("coach_application_submit", { p_application: a });
    assert.equal((await o.rpc("coach_application_withdraw", { p_application: a })).error, null);

    await switchTo("off");
    assert.equal(errorCode((await o.rpc("coach_application_save", { p_application: null, p_fields: fields })).error), "feature_paused");
    assert.equal((await o.from("coach_applications").select("status").eq("id", a).single()).data?.status, "withdrawn", "status still visible");
    assert.equal((await o.rpc("coach_application_erase", { p_application: a })).error, null);
    assert.equal((await adminClient().from("coach_applications").select("id").eq("id", a)).data?.length, 0);
    await switchTo("on");
  });
});
