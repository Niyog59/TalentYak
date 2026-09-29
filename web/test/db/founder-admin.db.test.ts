/**
 * M17 founder administration, as real people with real sessions.
 *
 *   · only an administrator who completed two-step sign-in reaches any admin
 *     function or table; clients, coaches, anonymous visitors and an admin
 *     without the second step are refused
 *   · the change history is append-only
 *   · a switch change needs a reason and a fresh screen, can't pick an
 *     unsupported mode or approve a policy, is recorded, and can be restored
 *   · switches are enforced in the database, so a session that was already
 *     signed in (an old tab, a direct call) is refused the moment it changes;
 *     history stays readable
 *   · the coach-change flow end to end: off, test accounts only, eligible
 *     replacements, consent to sharing, no duplicates, capacity at
 *     confirmation, requests finishing after the switch goes off, the former
 *     coach losing access, and a separate new conversation
 *   · support notes and owners are administrator-only; suspension goes
 *     through its recorded path; reports read only authoritative records
 *
 * The switches live in the shared TEST project. Each test that changes one
 * restores it in `finally`, and every change is recorded as made by the test
 * administrator with the reason "automated test".
 *
 * When the project is not confirmed available, every test SKIPS.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  adminClient, anonymousClient, createTestUser, dbAvailability, deleteTestUsers, errorCode, makeCoach, makeDraftOffer,
  setRole, sql, lit, upgradeToAal2, wasDenied, type CoachFixture, type TestUser,
} from "./harness.ts";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;

let admin: TestUser;
let adminNoMfa: TestUser;
let customer: TestUser;
let other: TestUser;
let coachA: CoachFixture;
let coachB: CoachFixture;
let coachFull: CoachFixture;
let coachClosed: CoachFixture;
let enrollment = "";
let enrollmentOther = "";
const users: string[] = [];
const enrollments: string[] = [];

async function enrol(customerId: string, provider: string): Promise<string> {
  const sb = adminClient();
  const { data, error } = await sb.from("enrollments").insert({ customer_id: customerId, provider_id: provider, state: "active" }).select("id").single();
  if (error) throw new Error(`enrollment: ${error.message}`);
  const { error: aErr } = await sb.from("enrollment_assignments").insert({
    enrollment_id: data.id, provider_id: provider, effective_from: new Date(Date.now() - 86_400_000).toISOString(), history_scope: "none",
  });
  if (aErr) throw new Error(`assignment: ${aErr.message}`);
  enrollments.push(data.id as string);
  return data.id as string;
}

async function modeOf(key: string): Promise<{ mode: string; version: number }> {
  const { data, error } = await admin.client.from("feature_settings").select("mode, version").eq("key", key).single();
  if (error) throw new Error(error.message);
  return data as { mode: string; version: number };
}

async function setMode(key: string, mode: string) {
  const s = await modeOf(key);
  if (s.mode === mode) return;
  const { error } = await admin.client.rpc("admin_set_feature_mode", { p_key: key, p_mode: mode, p_reason: "automated test", p_expected_version: s.version, p_impact: null, p_restores: null });
  if (error) throw new Error(`set ${key} ${mode}: ${error.message}`);
}

/** Runs `fn` with a switch set, and always puts it back. */
async function withMode(key: string, mode: string, fn: () => Promise<void>) {
  const before = (await modeOf(key)).mode;
  await setMode(key, mode);
  try {
    await fn();
  } finally {
    await setMode(key, before);
  }
}

async function publishOffer(coach: CoachFixture) {
  const offer = await makeDraftOffer(coach);
  await sql(`update offer_versions set published_at = now() where id = ${lit(offer.versionId)}`);
  await sql(`update offers set status = 'published' where id = ${lit(offer.offerId)}`);
}

const conversationFor = async (enrollmentId: string, provider: string) =>
  ((await adminClient().from("conversations").select("id").eq("enrollment_id", enrollmentId).eq("provider_id", provider).maybeSingle()).data?.id as string | undefined) ?? null;

describe("M17 founder administration", { skip }, () => {
  before(async () => {
    admin = await createTestUser("m17-admin");
    adminNoMfa = await createTestUser("m17-admin-aal1");
    customer = await createTestUser("m17-client");
    other = await createTestUser("m17-other");
    coachA = await makeCoach("m17-coach-a");
    coachB = await makeCoach("m17-coach-b", { max: 5 });
    coachFull = await makeCoach("m17-coach-full", { max: 1 });
    coachClosed = await makeCoach("m17-coach-closed", { accepting: false });
    users.push(admin.id, adminNoMfa.id, customer.id, other.id, coachA.user.id, coachB.user.id, coachFull.user.id, coachClosed.user.id);
    await setRole(admin.id, "admin");
    await setRole(adminNoMfa.id, "admin");
    await upgradeToAal2(admin);
    for (const c of [coachB, coachFull, coachClosed]) await publishOffer(c);
    enrollment = await enrol(customer.id, coachA.providerId);
    enrollmentOther = await enrol(other.id, coachFull.providerId); // fills coachFull's only place
  });

  after(async () => {
    const sb = adminClient();
    await sql(`delete from outbox where dedupe_key like 'coach_change%' and payload->>'customer_id' in (${[customer.id, other.id].map(lit).join(",")})`);
    await sb.from("coach_change_requests").delete().in("customer_id", [customer.id, other.id]);
    await sb.from("support_cases").delete().in("reporter_profile_id", users);
    await sql(`delete from bodyweight_logs where enrollment_id in (${enrollments.map(lit).join(",")})`);
    for (const e of enrollments) {
      await sql(`delete from earning_states where ledger_entry_id in (select id from ledger_entries where purchase_id is null and provider_id is null and false)`);
      await sb.from("enrollment_assignments").delete().eq("enrollment_id", e);
      await sb.from("enrollments").delete().eq("id", e);
    }
    for (const c of [coachA, coachB, coachFull, coachClosed]) await sb.from("providers").update({ status: "retired", active: false, published_at: null, accepting_new_clients: false }).eq("id", c.providerId);
    await deleteTestUsers(users);
  });

  // =========================================================================
  test("only an administrator with two-step sign-in reaches admin functions and tables", async () => {
    const calls = (c: TestUser["client"]) => [
      c.rpc("admin_set_feature_mode", { p_key: "waitlist", p_mode: "off", p_reason: "x-attack", p_expected_version: 1, p_impact: null, p_restores: null }),
      c.rpc("admin_overview_metrics", { p_from: new Date(Date.now() - 86_400_000).toISOString(), p_to: new Date().toISOString(), p_tz: "UTC", p_include_test: true }),
      c.rpc("admin_search", { p_q: "talentyak" }),
      c.rpc("admin_accounts", { p_q: "", p_role: "", p_status: "", p_limit: 5, p_offset: 0 }),
      c.rpc("admin_set_account_suspension", { p_profile: other.id, p_suspend: true, p_reason: "attack" }),
      c.rpc("admin_set_test_account", { p_profile: other.id, p_member: true, p_reason: "attack" }),
    ];
    for (const who of [customer.client, coachA.user.client, adminNoMfa.client, anonymousClient()]) {
      for (const r of await Promise.all(calls(who))) assert.ok(r.error, "a non-admin (or admin without two-step) reached an admin function");
      for (const table of ["feature_settings", "feature_setting_changes", "feature_test_accounts", "admin_audit_log", "support_case_notes", "support_case_events", "platform_environment"]) {
        assert.ok(wasDenied(await who.from(table).select("*").limit(1)), `${table} readable by a non-admin`);
      }
    }
    // Nobody writes settings directly, not even the founder: only through the recorded function.
    const direct = await admin.client.from("feature_settings").update({ mode: "off" }).eq("key", "waitlist").select("key");
    assert.equal((direct.data ?? []).length, 0);
    assert.equal((await modeOf("waitlist")).mode, "on");
    // The founder does reach them.
    const ok = await admin.client.rpc("admin_accounts", { p_q: "m17-client", p_role: "", p_status: "", p_limit: 5, p_offset: 0 });
    assert.equal(ok.error, null);
    assert.equal((ok.data as { total: number }).total, 1);
    // Sign-ins are recorded by the server only.
    assert.ok((await customer.client.rpc("record_sign_in", { p_profile: customer.id })).error);
  });

  test("the change history can't be edited or deleted, even by the founder or the database owner", async () => {
    await admin.client.rpc("admin_record_audit", { p_action: "test.entry", p_subject_type: "test", p_subject_id: RUN(), p_reason: "automated test", p_before: null, p_after: null });
    const [row] = await sql<{ id: string }>(`select id from admin_audit_log where action = 'test.entry' and actor_id = ${lit(admin.id)} order by created_at desc limit 1`);
    assert.ok(row);
    const upd = await admin.client.from("admin_audit_log").update({ reason: "rewritten" }).eq("id", row.id).select("id");
    assert.equal((upd.data ?? []).length, 0);
    await assert.rejects(sql(`update admin_audit_log set reason = 'rewritten' where id = ${lit(row.id)}`), /append_only/);
    await assert.rejects(sql(`delete from admin_audit_log where id = ${lit(row.id)}`), /append_only/);
  });

  test("a switch change needs a reason and a current screen, refuses unsupported modes and unapproved policy, and is recorded", async () => {
    const s = await modeOf("waitlist");
    const call = (over: Record<string, unknown>) => admin.client.rpc("admin_set_feature_mode", { p_key: "waitlist", p_mode: "off", p_reason: "automated test", p_expected_version: s.version, p_impact: null, p_restores: null, ...over });
    assert.equal(errorCode((await call({ p_reason: "" })).error), "reason_required");
    assert.equal(errorCode((await call({ p_expected_version: s.version - 1 })).error), "stale_setting");
    assert.equal(errorCode((await call({ p_mode: "read_only" })).error), "invalid_mode");
    const cc = await modeOf("coach_changing");
    const policy = await admin.client.rpc("admin_set_feature_mode", { p_key: "coach_changing", p_mode: "on", p_reason: "automated test", p_expected_version: cc.version, p_impact: null, p_restores: null });
    assert.equal(errorCode(policy.error), "feature_policy_unresolved", "a switch can't approve the coach-change money policy");

    // Off, then restored; both recorded with who and why.
    const off = await call({});
    assert.equal(off.error, null, off.error?.message);
    const changeId = (off.data as { change_id: string }).change_id;
    const now = await modeOf("waitlist");
    const back = await admin.client.rpc("admin_set_feature_mode", { p_key: "waitlist", p_mode: "on", p_reason: "automated test restore", p_expected_version: now.version, p_impact: null, p_restores: changeId });
    assert.equal(back.error, null, back.error?.message);
    const { data: hist } = await admin.client.from("feature_setting_changes").select("from_mode, to_mode, actor_id, restores_change_id").eq("key", "waitlist").order("created_at", { ascending: false }).limit(2);
    assert.deepEqual(hist!.map((h) => [h.from_mode, h.to_mode]), [["off", "on"], ["on", "off"]]);
    assert.equal(hist![0].restores_change_id, changeId);
    assert.equal(hist![0].actor_id, admin.id);
  });

  test("messaging paused is refused in the database for a session already signed in; history stays readable; test accounts only works", async () => {
    const conv = await conversationFor(enrollment, coachA.providerId);
    assert.ok(conv, "a conversation exists for the relationship");
    const send = (who: TestUser) => who.client.rpc("send_message", { p_conversation: conv, p_client_id: randomUUID(), p_body: "hello", p_media: null });
    assert.equal((await send(customer)).error, null, "baseline: sending works");

    await withMode("messaging", "read_only", async () => {
      assert.equal(errorCode((await send(customer)).error), "feature_paused", "the old session is refused on its next send");
      assert.equal(errorCode((await send(coachA.user)).error), "feature_paused");
      const read = await customer.client.from("messages").select("id").eq("conversation_id", conv);
      assert.ok((read.data ?? []).length >= 1, "history stays readable");
    });

    await withMode("messaging", "test_only", async () => {
      assert.equal(errorCode((await send(customer)).error), "feature_paused", "not on the test list yet");
      await admin.client.rpc("admin_set_test_account", { p_profile: customer.id, p_member: true, p_reason: "automated test" });
      try {
        assert.equal((await send(customer)).error, null, "a listed test account can send");
      } finally {
        await admin.client.rpc("admin_set_test_account", { p_profile: customer.id, p_member: false, p_reason: "automated test" });
      }
    });
    assert.equal((await send(customer)).error, null, "back on: sending works again");
  });

  test("logging paused holds new entries (the device keeps them) and keeps saved ones readable; the waitlist switch refuses sign-ups", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const save = () => customer.client.rpc("save_body_entry", {
      p_enrollment: enrollment, p_date: today, p_weight: 70, p_weight_unit: "kg", p_waist: null, p_hips: null, p_chest: null, p_arm: null, p_length_unit: "cm", p_base: null,
    });
    assert.equal((await save()).error, null, "baseline save");
    await withMode("logging", "read_only", async () => {
      const r = await save();
      assert.match(r.error?.message ?? "", /tracking_logging_paused/);
      assert.equal((await customer.client.rpc("tracking_write_state", { p_enrollment: enrollment })).data, "logging_paused");
      assert.equal(((await customer.client.from("bodyweight_logs").select("id").eq("enrollment_id", enrollment)).data ?? []).length, 1, "saved entries stay readable");
    });

    await withMode("waitlist", "off", async () => {
      const r = await adminClient().rpc("waitlist_register", {
        p_email: `talentyak-test-${RUN()}@example.test`, p_first_name: null, p_provider: null, p_offer: null,
        p_confirm_hash: "a".repeat(64), p_link_hash: "b".repeat(64), p_consent: "waitlist.v1",
      });
      assert.equal(errorCode(r.error), "feature_paused");
    });
  });

  test("coach change, end to end: off, test accounts only, eligible choices, consent, no duplicates, capacity at confirmation, and a clean hand-over", async () => {
    // Off (the launch default): refused, whoever asks.
    assert.equal((await modeOf("coach_changing")).mode, "off");
    const off = await customer.client.rpc("request_coach_change", { p_enrollment_id: enrollment, p_reason: "want a change", p_preferred_provider_id: null, p_history_scope: "none" });
    assert.equal(errorCode(off.error), "feature_paused");

    await admin.client.rpc("admin_set_test_account", { p_profile: customer.id, p_member: true, p_reason: "automated test" });
    let requestId = "";
    try {
      await withMode("coach_changing", "test_only", async () => {
        // Only coaches who can take the client now, in the same service.
        const { data: cands, error } = await customer.client.rpc("coach_change_candidates", { p_enrollment: enrollment });
        assert.equal(error, null, error?.message);
        const ids = (cands as { provider_id: string }[]).map((c) => c.provider_id);
        assert.ok(ids.includes(coachB.providerId), "an accepting coach with room is offered");
        assert.ok(!ids.includes(coachFull.providerId), "a full coach is not offered");
        assert.ok(!ids.includes(coachClosed.providerId), "a coach not accepting clients is not offered");
        assert.ok(!ids.includes(coachA.providerId), "the current coach is not offered");
        assert.deepEqual(Object.keys((cands as object[])[0]).sort(), ["display_name", "provider_id", "slug"], "public facts only");

        // Someone else's relationship: nothing.
        assert.deepEqual((await other.client.rpc("coach_change_candidates", { p_enrollment: enrollment })).data, []);
        assert.equal(errorCode((await other.client.rpc("request_coach_change", { p_enrollment_id: enrollment, p_reason: "not mine", p_preferred_provider_id: null, p_history_scope: "none" })).error), "not_found",
          "someone else's relationship: refused without revealing anything");

        const bad = await customer.client.rpc("request_coach_change", { p_enrollment_id: enrollment, p_reason: "want a change", p_preferred_provider_id: coachFull.providerId, p_history_scope: "none" });
        assert.equal(errorCode(bad.error), "coach_not_eligible");

        // Two at once: exactly one survives.
        const [r1, r2] = await Promise.all([
          customer.client.rpc("request_coach_change", { p_enrollment_id: enrollment, p_reason: "want a change", p_preferred_provider_id: coachB.providerId, p_history_scope: "programme_and_logs" }),
          customer.client.rpc("request_coach_change", { p_enrollment_id: enrollment, p_reason: "want a change", p_preferred_provider_id: coachB.providerId, p_history_scope: "programme_and_logs" }),
        ]);
        const oks = [r1, r2].filter((r) => !r.error);
        assert.equal(oks.length, 1, "simultaneous duplicate requests");
        assert.equal(errorCode([r1, r2].find((r) => r.error)!.error), "request_already_open");

        // Withdraw, then ask again.
        assert.equal((await customer.client.rpc("withdraw_coach_change", { p_request: oks[0].data })).data, true);
        const again = await customer.client.rpc("request_coach_change", { p_enrollment_id: enrollment, p_reason: "want a change", p_preferred_provider_id: coachB.providerId, p_history_scope: "programme_and_logs" });
        assert.equal(again.error, null, again.error?.message);
        requestId = again.data as string;
      });

      // Switched off again: the request already made still finishes.
      assert.equal((await modeOf("coach_changing")).mode, "off");
      const preview = await admin.client.rpc("admin_coach_change_preview", { p_request: requestId, p_new_provider: coachB.providerId });
      assert.equal(preview.error, null, preview.error?.message);
      assert.equal((preview.data as { new_coach_eligible: boolean }).new_coach_eligible, true);

      // Nothing has moved yet.
      const log = await customer.client.from("bodyweight_logs").select("id").eq("enrollment_id", enrollment).single();
      assert.equal(((await coachA.user.client.from("bodyweight_logs").select("id").eq("id", log.data!.id)).data ?? []).length, 1, "current coach keeps access until confirmed");

      const tooMuch = await admin.client.rpc("admin_apply_coach_change", { p_request_id: requestId, p_new_provider_id: coachB.providerId, p_effective_at: new Date().toISOString(), p_history_scope: "full", p_note: "automated test" });
      assert.equal(errorCode(tooMuch.error), "history_scope_exceeds_consent", "never more than the client agreed to share");
      const full = await admin.client.rpc("admin_apply_coach_change", { p_request_id: requestId, p_new_provider_id: coachFull.providerId, p_effective_at: new Date().toISOString(), p_history_scope: "none", p_note: "automated test" });
      assert.equal(errorCode(full.error), "coach_not_eligible", "capacity is rechecked at confirmation");
      assert.equal((await customer.client.from("enrollments").select("provider_id").eq("id", enrollment).single()).data!.provider_id, coachA.providerId, "a refused confirmation moves nothing");

      const applied = await admin.client.rpc("admin_apply_coach_change", { p_request_id: requestId, p_new_provider_id: coachB.providerId, p_effective_at: new Date().toISOString(), p_history_scope: "programme_and_logs", p_note: "automated test" });
      assert.equal(applied.error, null, applied.error?.message);

      assert.ok(wasDenied(await coachA.user.client.from("bodyweight_logs").select("id").eq("id", log.data!.id)), "the former coach loses access");
      assert.equal(((await coachB.user.client.from("bodyweight_logs").select("id").eq("id", log.data!.id)).data ?? []).length, 1, "the new coach sees logs within the agreed scope");

      const oldConv = await conversationFor(enrollment, coachA.providerId);
      const newConv = await conversationFor(enrollment, coachB.providerId);
      assert.ok(newConv && newConv !== oldConv, "a new, separate conversation");
      assert.ok(wasDenied(await coachB.user.client.from("messages").select("id").eq("conversation_id", oldConv!)), "the new coach never reads the old conversation");

      const [audit] = await sql<{ n: number }>(`select count(*)::int as n from admin_audit_log where action = 'coach_change.apply' and subject_id = ${lit(requestId)}`);
      assert.equal(audit.n, 1, "recorded in the change history");
    } finally {
      await admin.client.rpc("admin_set_test_account", { p_profile: customer.id, p_member: false, p_reason: "automated test" });
    }
  });

  test("support owners and internal notes are administrator-only, and each change is in the case history", async () => {
    const { data: caseId, error } = await customer.client.rpc("open_support_case", { p_conversation: null, p_category: "billing", p_description: "A question about my plan, from the test suite." });
    assert.equal(error, null, error?.message);
    assert.equal((await admin.client.rpc("admin_assign_support_case", { p_case: caseId, p_owner: admin.id })).error, null);
    assert.equal(errorCode((await admin.client.rpc("admin_assign_support_case", { p_case: caseId, p_owner: customer.id })).error), "invalid_owner");
    assert.equal((await admin.client.rpc("admin_add_support_note", { p_case: caseId, p_body: "Called them back." })).error, null);
    assert.ok((await customer.client.rpc("admin_add_support_note", { p_case: caseId, p_body: "x" })).error);
    assert.equal(((await customer.client.from("support_case_notes").select("id").eq("case_id", caseId)).data ?? []).length, 0, "the reporter never sees internal notes");
    const { data: events } = await admin.client.from("support_case_events").select("kind").eq("case_id", caseId);
    assert.deepEqual((events ?? []).map((e) => e.kind).sort(), ["note_added", "opened", "owner_changed"]);
    const links = await admin.client.rpc("admin_support_case_links", { p_case: caseId });
    assert.equal((links.data as { reporter_profile_id: string }).reporter_profile_id, customer.id);
  });

  test("suspension goes through its recorded path: clients yes, coaches through their workflow, administrators never", async () => {
    assert.equal(errorCode((await admin.client.rpc("admin_set_account_suspension", { p_profile: coachA.user.id, p_suspend: true, p_reason: "automated test" })).error), "use_coach_workflow");
    assert.equal(errorCode((await admin.client.rpc("admin_set_account_suspension", { p_profile: adminNoMfa.id, p_suspend: true, p_reason: "automated test" })).error), "use_trusted_process");
    assert.equal((await admin.client.rpc("admin_set_account_suspension", { p_profile: other.id, p_suspend: true, p_reason: "automated test" })).data, true);
    assert.ok((await adminClient().from("profiles").select("suspended_at").eq("id", other.id).single()).data!.suspended_at);
    assert.equal((await admin.client.rpc("admin_set_account_suspension", { p_profile: other.id, p_suspend: false, p_reason: "automated test" })).data, true);
    const [a] = await sql<{ n: number }>(`select count(*)::int as n from admin_audit_log where subject_id = ${lit(other.id)} and action in ('account.suspend', 'account.reinstate')`);
    assert.equal(a.n, 2);
  });

  test("the overview reads authoritative records, keeps currencies apart and leaves test activity out unless asked", async () => {
    const range = { p_from: new Date(Date.now() - 3_600_000).toISOString(), p_to: new Date(Date.now() + 60_000).toISOString(), p_tz: "America/Chicago" };
    const real = await admin.client.rpc("admin_overview_metrics", { ...range, p_include_test: false });
    const all = await admin.client.rpc("admin_overview_metrics", { ...range, p_include_test: true });
    assert.equal(real.error, null, real.error?.message);
    const r = real.data as Record<string, unknown>;
    const t = all.data as Record<string, number>;
    assert.ok(t.accounts_new >= 8, "this suite's accounts are counted when test activity is included");
    assert.ok((r.accounts_new as number) < t.accounts_new, "…and left out by default");
    for (const k of ["collected", "refunds", "commission", "coach_earnings", "fees", "payouts_recorded", "coach_owed_now"]) {
      for (const row of r[k] as { currency: string }[]) assert.match(row.currency, /^[A-Z]{3}$/, `${k} is per currency`);
    }
    const bad = await admin.client.rpc("admin_overview_metrics", { p_from: range.p_to, p_to: range.p_from, p_tz: "UTC", p_include_test: false });
    assert.equal(errorCode(bad.error), "invalid_range");
    // Search finds people and never private content.
    const found = await admin.client.rpc("admin_search", { p_q: "m17-client" });
    assert.ok((found.data as { kind: string }[]).some((x) => x.kind === "account"));
    assert.equal((await admin.client.rpc("admin_search", { p_q: "Called them back" })).data!.length, 0, "internal notes aren't searchable");
  });
});

function RUN() {
  return randomUUID().slice(0, 8);
}
