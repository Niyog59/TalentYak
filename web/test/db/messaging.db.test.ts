/**
 * Private messaging (0037), as real signed-in people.
 *
 * Every assertion about who may read or write goes through a real session —
 * the same thing a hand-crafted request would use — never through the service
 * key. The questions:
 *
 *   · can an outsider read, send, subscribe or attach anything     — no
 *   · do both participants see one ordered, gapless history        — yes
 *   · does a retried send create a second message                  — no
 *   · is "read" only what the reader marked, and only forwards     — yes
 *   · does a coach see only their own current clients              — yes
 *   · after a reassignment, does either coach reach the old thread — no;
 *     the client keeps reading it
 *   · does suspension stop an existing session at once             — yes
 *   · after paid time runs out, can anyone still send              — no
 *   · can support read a conversation without a case grant         — no
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
  lit,
  makeCoach,
  setRole,
  sql,
  suspendUser,
  upgradeToAal2,
  wasDenied,
  type CoachFixture,
  type TestUser,
} from "./harness.ts";
import { currentMessagingPolicy } from "../../src/lib/policy/registry.ts";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;

let customer: TestUser;
let outsider: TestUser;
let admin: TestUser;
let otherAdmin: TestUser;
let coachA: CoachFixture;
let coachB: CoachFixture;
let coachC: CoachFixture;
const users: string[] = [];

let enrollmentA = "";
let enrollmentC = "";
let convA = "";
let convC = "";
let convB = "";
const conversations: string[] = [];

async function conversationFor(enrollment: string, provider: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("conversations").select("id").eq("enrollment_id", enrollment).eq("provider_id", provider).single();
  if (error) throw new Error(`conversation: ${error.message}`);
  conversations.push(data.id as string);
  return data.id as string;
}

async function enrol(customerId: string, provider: string): Promise<string> {
  const sb = adminClient();
  const { data, error } = await sb.from("enrollments")
    .insert({ customer_id: customerId, provider_id: provider, state: "active" }).select("id").single();
  if (error) throw new Error(`enrollment: ${error.message}`);
  const { error: aErr } = await sb.from("enrollment_assignments").insert({
    enrollment_id: data.id, provider_id: provider,
    effective_from: new Date(Date.now() - 86_400_000).toISOString(),
  });
  if (aErr) throw new Error(`assignment: ${aErr.message}`);
  return data.id as string;
}

const send = (who: TestUser, conversation: string, body: string | null, clientId = randomUUID(), media: string | null = null) =>
  who.client.rpc("send_message", { p_conversation: conversation, p_client_id: clientId, p_body: body, p_media: media });

const code = (error: { message?: string } | null) => error?.message ?? "";

async function clearOutboxFor(conversation: string) {
  await sql(`delete from outbox where topic = 'email.unread_messages' and payload->>'conversation_id' = ${lit(conversation)}`);
}

describe("private messaging", { skip }, () => {
  before(async () => {
    customer = await createTestUser("msg-customer");
    outsider = await createTestUser("msg-outsider");
    admin = await createTestUser("msg-admin");
    otherAdmin = await createTestUser("msg-admin-2");
    coachA = await makeCoach("msg-coach-a");
    coachB = await makeCoach("msg-coach-b");
    coachC = await makeCoach("msg-coach-c");
    users.push(customer.id, outsider.id, admin.id, otherAdmin.id, coachA.user.id, coachB.user.id, coachC.user.id);
    await setRole(admin.id, "admin");
    await setRole(otherAdmin.id, "admin");
    await upgradeToAal2(admin);
    await upgradeToAal2(otherAdmin);

    // Two relationships for one customer, with two different coaches.
    enrollmentA = await enrol(customer.id, coachA.providerId);
    enrollmentC = await enrol(customer.id, coachC.providerId);
    convA = await conversationFor(enrollmentA, coachA.providerId);
    convC = await conversationFor(enrollmentC, coachC.providerId);
  });

  after(async () => {
    const sb = adminClient();
    for (const c of conversations) await clearOutboxFor(c);
    await sql(`delete from outbox where topic = 'email.support_case_opened' and payload->>'reporter_role' is not null and dedupe_key in (select 'support_case:' || id from support_cases where reporter_profile_id in (${users.map(lit).join(",")}))`);
    await sb.from("support_cases").delete().in("reporter_profile_id", users);
    await sb.from("media_assets").delete().in("owner_profile_id", users);
    for (const e of [enrollmentA, enrollmentC].filter(Boolean)) {
      await sb.from("enrollment_assignments").delete().eq("enrollment_id", e);
      await sb.from("enrollments").delete().eq("id", e);
    }
    await deleteTestUsers(users);
  });

  test("the database copy of the messaging policy matches the policy register", async () => {
    const { data } = await adminClient().from("messaging_settings").select("*").single();
    const p = currentMessagingPolicy();
    assert.equal(data!.policy_id, p.id);
    assert.equal(data!.policy_status, p.status);
    assert.equal(data!.send_while_paused, p.sendWhilePaused);
    assert.equal(data!.client_reads_after_end, p.clientReadsAfterEnd);
    assert.equal(data!.pre_purchase_inquiries, p.prePurchaseInquiries);
    assert.equal(data!.pre_purchase_inquiries, false, "pre-purchase messaging must stay off until approved");
    assert.equal(data!.max_body_chars, p.maxBodyChars);
    assert.equal(data!.sends_per_minute, p.sendsPerMinute);
    assert.equal(data!.sends_per_day, p.sendsPerDay);
    assert.equal(data!.unread_email_delay_minutes, p.unreadEmailDelayMinutes);
    assert.equal(data!.support_access_hours, p.supportAccessHours);
    assert.equal(data!.support_cases_per_day, p.supportCasesPerDay);
  });

  test("every coach assignment gets its own conversation", () => {
    assert.ok(convA && convC && convA !== convC);
  });

  describe("sending and reading", () => {
    test("both participants send, and see one history in a stable order", async () => {
      const r1 = await send(customer, convA, "Hello coach");
      const r2 = await send(coachA.user, convA, "Welcome — let's start Monday.");
      const r3 = await send(customer, convA, "Great");
      assert.equal(r1.error, null, code(r1.error));
      assert.equal(r2.error, null, code(r2.error));
      assert.equal(r3.error, null, code(r3.error));

      for (const who of [customer, coachA.user]) {
        const { data } = await who.client.from("messages").select("seq, body").eq("conversation_id", convA).order("seq");
        assert.deepEqual((data ?? []).map((m) => m.seq), [1, 2, 3], "sequence numbers are not gapless and ordered");
        assert.equal(data![1].body, "Welcome — let's start Monday.");
      }
    });

    test("a retried send returns the original message instead of a duplicate", async () => {
      const clientId = randomUUID();
      const first = await send(customer, convA, "Sent twice?", clientId);
      const again = await send(customer, convA, "Sent twice?", clientId);
      assert.equal(first.error, null);
      assert.equal(again.data![0].id, first.data![0].id);
      assert.equal(again.data![0].duplicate, true);

      // Two identical requests racing each other still make one message.
      const raceId = randomUUID();
      const results = await Promise.all([send(customer, convA, "race", raceId), send(customer, convA, "race", raceId)]);
      assert.equal(new Set(results.map((r) => r.data?.[0]?.id)).size, 1, "a raced retry produced two messages");
      const { count } = await adminClient().from("messages").select("id", { count: "exact", head: true }).eq("client_message_id", raceId);
      assert.equal(count, 1);
    });

    test("messages cannot be written, edited or deleted directly", async () => {
      const insert = await customer.client.from("messages").insert({
        conversation_id: convA, seq: 999, sender_profile_id: customer.id, sender_role: "customer", kind: "text", body: "forged", client_message_id: randomUUID(),
      });
      assert.ok(insert.error, "a message was inserted around send_message");
      await customer.client.from("messages").update({ body: "rewritten" }).eq("conversation_id", convA).eq("seq", 2);
      await coachA.user.client.from("messages").delete().eq("conversation_id", convA);
      const { data } = await adminClient().from("messages").select("body").eq("conversation_id", convA).eq("seq", 2).single();
      assert.equal(data!.body, "Welcome — let's start Monday.", "a message was rewritten");
      const convUpdate = await customer.client.from("conversations").update({ last_seq: 0 }).eq("id", convA).select("id");
      assert.equal((convUpdate.data ?? []).length, 0, "a participant rewrote the conversation counter");
    });

    test("empty, oversized and structured messages are refused", async () => {
      assert.match(code((await send(customer, convA, "   ")).error), /empty/);
      assert.match(code((await send(customer, convA, "x".repeat(4001))).error), /too_long/);
      // A structured kind has no renderer yet; the table refuses it outright.
      const { error } = await adminClient().from("messages").insert({
        conversation_id: convA, seq: 1000, sender_role: "system", kind: "appointment_proposal", client_message_id: randomUUID(),
      });
      assert.ok(error, "a structured message kind was accepted before its batch exists");
    });

    test("read markers move only forwards, never past the last message, and both participants see them", async () => {
      const { data: last } = await adminClient().from("conversations").select("last_seq").eq("id", convA).single();
      const lastSeq = Number(last!.last_seq);

      const { data: two } = await coachA.user.client.rpc("mark_conversation_read", { p_conversation: convA, p_seq: 2 });
      assert.equal(Number(two), 2);
      const { data: back } = await coachA.user.client.rpc("mark_conversation_read", { p_conversation: convA, p_seq: 1 });
      assert.equal(Number(back), 2, "a read marker moved backwards");
      const { data: beyond } = await coachA.user.client.rpc("mark_conversation_read", { p_conversation: convA, p_seq: 10_000 });
      assert.equal(Number(beyond), lastSeq, "a read marker passed the last message");

      const { data: status } = await customer.client.rpc("conversation_status", { p_conversation: convA });
      assert.equal(Number((status as { their_last_read_seq: number }).their_last_read_seq), lastSeq, "the sender cannot see their message was read");
    });

    test("the other person's messages count as unread until marked, on every device", async () => {
      await coachA.user.client.rpc("mark_conversation_read", { p_conversation: convA, p_seq: 10_000 });
      await send(customer, convA, "one more");
      const unread = async () => {
        const { data } = await coachA.user.client.rpc("my_conversations");
        return Number((data as { conversation_id: string; unread_count: number }[]).find((c) => c.conversation_id === convA)?.unread_count);
      };
      assert.equal(await unread(), 1);
      // A second session of the same person — another device — marks it read.
      const { createClient } = await import("@supabase/supabase-js");
      const device2 = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
      await device2.auth.signInWithPassword({ email: coachA.user.email, password: coachA.user.password });
      await device2.rpc("mark_conversation_read", { p_conversation: convA, p_seq: 10_000 });
      assert.equal(await unread(), 0, "reading on one device did not clear unread on the other");
    });

    test("one grouped email job per unread run, rechecked against the live read state", async () => {
      await clearOutboxFor(convA);
      await customer.client.rpc("mark_conversation_read", { p_conversation: convA, p_seq: 10_000 });
      await send(coachA.user, convA, "First");
      await send(coachA.user, convA, "Second");
      const jobs = async () => sql<{ scheduled_for: string; payload: Record<string, unknown> }>(
        `select scheduled_for, payload from outbox where topic = 'email.unread_messages' and payload->>'conversation_id' = ${lit(convA)} and payload->>'profile_id' = ${lit(customer.id)}`,
      );
      const queued = await jobs();
      assert.equal(queued.length, 1, "two messages before reading queued two emails");
      assert.ok(new Date(queued[0].scheduled_for).getTime() > Date.now() + 10 * 60_000, "the email is not delayed for grouping");
      assert.equal(JSON.stringify(queued[0].payload).includes("First"), false, "message text was put in the email job");

      const since = Number(queued[0].payload.since_seq);
      const { data: before } = await adminClient().rpc("unread_message_count", { p_profile: customer.id, p_conversation: convA, p_since_seq: since });
      assert.equal(Number(before), 2);
      await customer.client.rpc("mark_conversation_read", { p_conversation: convA, p_seq: 10_000 });
      const { data: afterRead } = await adminClient().rpc("unread_message_count", { p_profile: customer.id, p_conversation: convA, p_since_seq: since });
      assert.equal(Number(afterRead), 0, "the worker would email about messages already read");

      await send(coachA.user, convA, "After reading");
      assert.equal((await jobs()).length, 2, "reading did not start a fresh unread run");

      const refused = await customer.client.rpc("unread_message_count", { p_profile: customer.id, p_conversation: convA, p_since_seq: 0 });
      assert.ok(refused.error, "a signed-in person called the worker's unread check");
    });
  });

  describe("outsiders", () => {
    test("a visitor, another customer and an unrelated coach see nothing", async () => {
      for (const client of [anonymousClient(), outsider.client, coachB.user.client]) {
        for (const table of ["conversations", "messages", "conversation_reads", "conversation_signals"]) {
          const result = await client.from(table).select("*").in(table === "conversations" ? "id" : "conversation_id", [convA, convC]);
          assert.ok(wasDenied(result), `${table} was readable by an outsider`);
        }
      }
    });

    test("an outsider cannot send, mark read, or read the conversation's state", async () => {
      assert.match(code((await send(outsider, convA, "hi")).error), /not_found/);
      assert.match(code((await send(coachB.user, convA, "hi")).error), /not_found/);
      const mark = await outsider.client.rpc("mark_conversation_read", { p_conversation: convA, p_seq: 1 });
      assert.match(code(mark.error), /not_found/);
      const { data: status } = await outsider.client.rpc("conversation_status", { p_conversation: convA });
      assert.equal(status, null);
      const anon = await anonymousClient().rpc("send_message", { p_conversation: convA, p_client_id: randomUUID(), p_body: "x", p_media: null });
      assert.ok(anon.error, "a signed-out visitor could call send_message");
    });

    test("the access decision itself is not callable with someone else's id", async () => {
      const result = await outsider.client.rpc("conversation_access", { p_id: convA, p_uid: customer.id });
      assert.ok(result.error, "conversation_access could be asked about another person");
    });
  });

  describe("several relationships", () => {
    test("each coach's inbox holds only their own client conversations", async () => {
      await send(coachC.user, convC, "Hi from coach C");
      const inbox = async (c: CoachFixture) =>
        ((await c.user.client.rpc("my_conversations")).data as { conversation_id: string }[]).map((r) => r.conversation_id);
      assert.deepEqual(await inbox(coachA), [convA]);
      assert.deepEqual(await inbox(coachC), [convC]);
      assert.deepEqual(await inbox(coachB), []);
      const mine = ((await customer.client.rpc("my_conversations")).data as { conversation_id: string }[]).map((r) => r.conversation_id);
      assert.deepEqual(new Set(mine), new Set([convA, convC]));
    });

    test("messages never cross between one customer's conversations", async () => {
      const { data } = await coachC.user.client.from("messages").select("conversation_id");
      assert.ok((data ?? []).every((m) => m.conversation_id === convC));
    });
  });

  describe("attachments", () => {
    let coachFile = "";

    async function ready(id: string) {
      const { error } = await adminClient().rpc("finalize_media", {
        p_id: id, p_storage_path: `x/${id}/o.webp`, p_preview_path: `x/${id}/p.webp`, p_content_type: "image/webp",
        p_byte_size: 10, p_width: 1, p_height: 1, p_duration: null, p_compression_skipped: false,
      });
      if (error) throw new Error(error.message);
    }

    test("the current coach may upload into the relationship; an unrelated coach may not", async () => {
      const ok = await adminClient().rpc("reserve_media_upload", {
        p_owner: coachA.user.id, p_enrollment: enrollmentA, p_purpose: "chat_attachment", p_media_kind: "image", p_declared_bytes: 10,
      });
      assert.equal(ok.error, null, code(ok.error));
      coachFile = (ok.data as { id: string }[])[0].id;

      const bad = await adminClient().rpc("reserve_media_upload", {
        p_owner: coachB.user.id, p_enrollment: enrollmentA, p_purpose: "chat_attachment", p_media_kind: "image", p_declared_bytes: 10,
      });
      assert.match(code(bad.error), /enrollment_not_owned/);
      const progress = await adminClient().rpc("reserve_media_upload", {
        p_owner: coachA.user.id, p_enrollment: enrollmentA, p_purpose: "progress_photo", p_media_kind: "image", p_declared_bytes: 10,
      });
      assert.match(code(progress.error), /enrollment_not_owned/, "a coach filed a progress photo into a client's history");
    });

    test("an unprocessed file cannot be sent, so a failed upload never appears sent", async () => {
      assert.match(code((await send(coachA.user, convA, null, randomUUID(), coachFile)).error), /attachment_not_ready/);
      const { count } = await adminClient().from("messages").select("id", { count: "exact", head: true }).eq("media_asset_id", coachFile);
      assert.equal(count, 0);
    });

    test("once processed it sends once, and both participants — only — can see it", async () => {
      await ready(coachFile);
      const sent = await send(coachA.user, convA, "Form check", randomUUID(), coachFile);
      assert.equal(sent.error, null, code(sent.error));
      assert.match(code((await send(coachA.user, convA, null, randomUUID(), coachFile)).error), /attachment_used/);

      const { data: seen } = await customer.client.from("media_assets").select("id").eq("id", coachFile);
      assert.equal((seen ?? []).length, 1, "the client cannot see an attachment sent to them");
      for (const who of [outsider, coachB.user, coachC.user]) {
        const result = await who.client.from("media_assets").select("id").eq("id", coachFile);
        assert.ok(wasDenied(result), "an attachment was visible outside its conversation");
      }
    });

    test("someone else's file cannot be attached", async () => {
      const { data } = await adminClient().rpc("reserve_media_upload", {
        p_owner: customer.id, p_enrollment: enrollmentA, p_purpose: "chat_attachment", p_media_kind: "image", p_declared_bytes: 10,
      });
      const clientFile = (data as { id: string }[])[0].id;
      await ready(clientFile);
      assert.match(code((await send(coachA.user, convA, null, randomUUID(), clientFile)).error), /attachment_not_ready/);
    });
  });

  describe("support", () => {
    let caseId = "";

    test("a participant opens a case about their conversation; the other participant never sees it", async () => {
      const { data, error } = await customer.client.rpc("open_support_case", {
        p_category: "conduct", p_description: "Test case opened by the automated suite.", p_conversation: convA,
      });
      assert.equal(error, null, code(error));
      caseId = data as string;
      await sql(`delete from outbox where dedupe_key = ${lit(`support_case:${caseId}`)}`);

      const own = await customer.client.from("support_cases").select("id").eq("id", caseId);
      assert.equal((own.data ?? []).length, 1);
      const theirs = await coachA.user.client.from("support_cases").select("id").eq("id", caseId);
      assert.ok(wasDenied(theirs), "the coach could see a case the client opened about them");

      const stranger = await outsider.client.rpc("open_support_case", {
        p_category: "conduct", p_description: "Trying to attach a stranger's conversation.", p_conversation: convA,
      });
      assert.match(code(stranger.error), /not_found/, "a case was attached to someone else's conversation");
    });

    test("no admin can read messages without a grant for the case", async () => {
      const direct = await admin.client.from("messages").select("id").eq("conversation_id", convA);
      assert.ok(wasDenied(direct), "an admin browsed a conversation with no case grant");
      const viaCase = await admin.client.rpc("admin_case_messages", { p_case: caseId, p_before_seq: null, p_limit: 10 });
      assert.match(code(viaCase.error), /no_access/);
      const participant = await customer.client.rpc("admin_grant_case_message_access", { p_case: caseId, p_reason: "I would like to read it" });
      assert.match(code(participant.error), /admin_only/);
      const noReason = await admin.client.rpc("admin_grant_case_message_access", { p_case: caseId, p_reason: "short" });
      assert.match(code(noReason.error), /reason_required/);
    });

    test("a grant is personal, limited to the case's conversation, recorded, and expires", async () => {
      const { data: grantId, error } = await admin.client.rpc("admin_grant_case_message_access", {
        p_case: caseId, p_reason: "Reviewing the reported conduct for this case.",
      });
      assert.equal(error, null, code(error));

      const { data: msgs, error: readError } = await admin.client.rpc("admin_case_messages", { p_case: caseId, p_before_seq: null, p_limit: 100 });
      assert.equal(readError, null, code(readError));
      assert.ok((msgs as unknown[]).length > 0);

      const colleague = await otherAdmin.client.rpc("admin_case_messages", { p_case: caseId, p_before_seq: null, p_limit: 10 });
      assert.match(code(colleague.error), /no_access/, "a grant to one admin let another read");

      const { data: log } = await admin.client.from("support_access_log").select("action").eq("case_id", caseId);
      assert.deepEqual((log ?? []).map((l) => l.action).sort(), ["granted", "viewed"]);
      const reporterLog = await customer.client.from("support_access_log").select("id").eq("case_id", caseId);
      assert.ok(wasDenied(reporterLog));

      await sql(`update support_message_access set expires_at = now() - interval '1 minute' where id = ${lit(grantId as string)}`);
      const expired = await admin.client.rpc("admin_case_messages", { p_case: caseId, p_before_seq: null, p_limit: 10 });
      assert.match(code(expired.error), /no_access/, "an expired grant still worked");
    });

    test("resolving a case needs a note and ends any live grant", async () => {
      await admin.client.rpc("admin_grant_case_message_access", { p_case: caseId, p_reason: "Second look before resolving it." });
      const noNote = await admin.client.rpc("admin_update_support_case", { p_case: caseId, p_state: "resolved", p_note: null });
      assert.match(code(noNote.error), /note_required/);
      const done = await admin.client.rpc("admin_update_support_case", { p_case: caseId, p_state: "resolved", p_note: "Spoke to both; resolved." });
      assert.equal(done.error, null, code(done.error));
      const after = await admin.client.rpc("admin_case_messages", { p_case: caseId, p_before_seq: null, p_limit: 10 });
      assert.match(code(after.error), /no_access/);
      const { data } = await customer.client.from("support_cases").select("state, resolution_note").eq("id", caseId).single();
      assert.equal(data!.state, "resolved");
      assert.equal(data!.resolution_note, "Spoke to both; resolved.");
    });
  });

  describe("relationship lifecycle", () => {
    test("paid time running out: both still read, nobody sends", async () => {
      await adminClient().from("enrollments").update({ state: "paused" }).eq("id", enrollmentC);
      assert.match(code((await send(customer, convC, "still there?")).error), /conversation_closed/);
      assert.match(code((await send(coachC.user, convC, "yes")).error), /conversation_closed/);
      const { data } = await customer.client.rpc("conversation_status", { p_conversation: convC });
      assert.equal((data as { state: string }).state, "paused");
      const { data: coachView } = await coachC.user.client.from("messages").select("id").eq("conversation_id", convC);
      assert.ok((coachView ?? []).length > 0, "the coach lost the history while payment is being fixed");
      await adminClient().from("enrollments").update({ state: "active" }).eq("id", enrollmentC);
    });

    test("suspension stops an existing session at once, reads and writes", async () => {
      await suspendUser(coachC.user.id);
      try {
        // Same client, same token as before the suspension.
        const reads = await coachC.user.client.from("messages").select("id").eq("conversation_id", convC);
        assert.ok(wasDenied(reads), "a suspended coach's open session still read messages");
        assert.match(code((await send(coachC.user, convC, "hello")).error), /conversation_closed/);
        const signals = await coachC.user.client.from("conversation_signals").select("id").eq("conversation_id", convC);
        assert.ok(wasDenied(signals), "a suspended coach could still receive realtime signals");
        // The client keeps their history but cannot send to a suspended coach.
        const { data } = await customer.client.rpc("conversation_status", { p_conversation: convC });
        assert.equal((data as { state: string; can_send: boolean }).can_send, false);
      } finally {
        await adminClient().from("profiles").update({ suspended_at: null }).eq("id", coachC.user.id);
      }
    });

    test("a reassignment opens a new thread; neither coach reaches the old one; the client keeps it", async () => {
      const sb = adminClient();
      await sb.from("enrollment_assignments").update({ effective_to: new Date().toISOString() })
        .eq("enrollment_id", enrollmentA).is("effective_to", null);
      // 'full' history on purpose: it covers the training record, never the
      // previous coach's private conversation.
      await sb.from("enrollment_assignments").insert({
        enrollment_id: enrollmentA, provider_id: coachB.providerId, previous_provider_id: coachA.providerId,
        effective_from: new Date(Date.now() + 1000).toISOString(), history_scope: "full",
      });
      await sb.from("enrollments").update({ provider_id: coachB.providerId }).eq("id", enrollmentA);
      await new Promise((r) => setTimeout(r, 1500));
      convB = await conversationFor(enrollmentA, coachB.providerId);
      assert.notEqual(convB, convA);

      for (const coach of [coachA, coachB]) {
        const reads = await coach.user.client.from("messages").select("id").eq("conversation_id", convA);
        assert.ok(wasDenied(reads), "a coach read the old private thread after the reassignment");
        // The former coach was a participant, so being told it is closed
        // reveals nothing; the incoming coach is told nothing at all.
        assert.match(code((await send(coach.user, convA, "hi")).error), coach === coachA ? /conversation_closed|not_found/ : /not_found/);
      }
      const { data: files } = await coachB.user.client.from("media_assets").select("id").eq("purpose", "chat_attachment");
      assert.deepEqual(files ?? [], [], "the new coach saw attachments from the old thread");
      const { data: oldFiles } = await coachA.user.client.from("media_assets").select("id").neq("owner_profile_id", coachA.user.id);
      assert.deepEqual(oldFiles ?? [], [], "the former coach still sees the client's attachments");

      const { data: kept } = await customer.client.from("messages").select("id").eq("conversation_id", convA);
      assert.ok((kept ?? []).length > 3, "the client lost their own history");
      const { data: status } = await customer.client.rpc("conversation_status", { p_conversation: convA });
      assert.equal((status as { state: string }).state, "reassigned");
      assert.match(code((await send(customer, convA, "hello?")).error), /conversation_closed/);

      assert.equal((await send(customer, convB, "Hi new coach")).error, null);
      assert.equal((await send(coachB.user, convB, "Welcome")).error, null);
      const { data: newThread } = await coachB.user.client.from("messages").select("seq").eq("conversation_id", convB);
      assert.deepEqual((newThread ?? []).map((m) => m.seq).sort(), [1, 2], "the new thread started with old messages in it");
    });

    test("after the relationship ends the client still reads; nobody sends; the coach loses access", async () => {
      const sb = adminClient();
      await sb.from("enrollments").update({ state: "ended", ended_at: new Date().toISOString() }).eq("id", enrollmentC);
      await sb.from("enrollment_assignments").update({ effective_to: new Date().toISOString() })
        .eq("enrollment_id", enrollmentC).is("effective_to", null);
      const { data: kept } = await customer.client.from("messages").select("id").eq("conversation_id", convC);
      assert.ok((kept ?? []).length > 0);
      assert.match(code((await send(customer, convC, "thanks")).error), /conversation_closed/);
      const coach = await coachC.user.client.from("messages").select("id").eq("conversation_id", convC);
      assert.ok(wasDenied(coach), "the coach kept reading after the relationship ended");
      const { data } = await customer.client.rpc("conversation_status", { p_conversation: convC });
      assert.equal((data as { state: string }).state, "ended");
    });
  });
});

describe("realtime delivery", { skip }, () => {
  let c: TestUser;
  let coach: CoachFixture;
  let enrollment = "";
  let conv = "";

  before(async () => {
    c = await createTestUser("rt-customer");
    coach = await makeCoach("rt-coach");
    enrollment = await enrol(c.id, coach.providerId);
    conv = await conversationFor(enrollment, coach.providerId);
  });

  after(async () => {
    c.client.realtime.disconnect();
    coach.user.client.realtime.disconnect();
    await clearOutboxFor(conv);
    await adminClient().from("enrollment_assignments").delete().eq("enrollment_id", enrollment);
    await adminClient().from("enrollments").delete().eq("id", enrollment);
    await deleteTestUsers([c.id, coach.user.id]);
  });

  interface Listener {
    got: string[];
    /** Resolves once a signal of `kind` has arrived, or rejects at the deadline. */
    arrival: (kind: string, deadlineMs: number) => Promise<number>;
    stop: () => Promise<void>;
  }

  /** Subscribes as `who` to this conversation's signals, as the screen does. */
  async function subscribe(who: TestUser): Promise<Listener> {
    const got: string[] = [];
    const waiters: { kind: string; resolve: (at: number) => void }[] = [];
    const { data } = await who.client.auth.getSession();
    who.client.realtime.setAuth(data.session!.access_token);
    const channel = who.client
      .channel(`t-${randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_signals", filter: `conversation_id=eq.${conv}` },
        (p) => {
          const kind = String((p.new as { kind: string }).kind);
          got.push(kind);
          for (const w of waiters.filter((x) => x.kind === kind)) w.resolve(Date.now());
        });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("realtime did not subscribe")), 10_000);
      channel.subscribe((st) => { if (st === "SUBSCRIBED") { clearTimeout(t); resolve(); } });
    });
    // A moment for the server to start delivering to the new subscription.
    await new Promise((r) => setTimeout(r, 1000));
    return {
      got,
      arrival: (kind, deadlineMs) =>
        got.includes(kind)
          ? Promise.resolve(Date.now())
          : new Promise((resolve, reject) => {
              const t = setTimeout(() => reject(new Error(`no "${kind}" signal within ${deadlineMs} ms (got ${JSON.stringify(got)})`)), deadlineMs);
              waiters.push({ kind, resolve: (at) => { clearTimeout(t); resolve(at); } });
            }),
      // An open channel keeps the test process alive after the suite.
      stop: async () => { await who.client.removeChannel(channel); },
    };
  }

  /** Live means seconds, not minutes: past this, the screen's fallback polling is doing the work. */
  const LIVE_DEADLINE_MS = 10_000;

  test("a participant receives a content-free signal when a message arrives", async () => {
    const coachListens = await subscribe(coach.user);
    try {
      const sent = await send(c, conv, "realtime check");
      // The control action must succeed, or a missing signal proves nothing.
      assert.equal(sent.error, null, `the message was not sent: ${sent.error?.message}`);
      const sentAt = Date.now();
      const at = await coachListens.arrival("message", LIVE_DEADLINE_MS);
      assert.ok(at - sentAt < LIVE_DEADLINE_MS);
    } finally {
      await coachListens.stop();
    }
  });

  test("a suspended participant's open subscription stops receiving, while delivery itself still works", async () => {
    // The coach writes while active; the client then reads it while the coach
    // is suspended, which emits a signal on this conversation. (A client
    // cannot SEND to a suspended coach — that is refused — so reading is the
    // control event here.) The client listens too: if THEY receive it and the
    // suspended coach does not, the silence is the suspension — not a
    // realtime outage, which would otherwise make this test pass for nothing.
    assert.equal((await send(coach.user, conv, "before suspension")).error, null);
    await suspendUser(coach.user.id);
    const coachListens = await subscribe(coach.user);
    const clientListens = await subscribe(c);
    try {
      const r = await c.client.rpc("mark_conversation_read", { p_conversation: conv, p_seq: 10_000 });
      assert.equal(r.error, null, "the control event failed, so the silence would prove nothing");
      await clientListens.arrival("read", LIVE_DEADLINE_MS);
      // The same change has now been delivered to an active participant; give
      // the suspended one the same chance before judging.
      await new Promise((res) => setTimeout(res, 2000));
      assert.deepEqual(coachListens.got, [], "a suspended coach still received realtime signals");
    } finally {
      await coachListens.stop();
      await clientListens.stop();
      await adminClient().from("profiles").update({ suspended_at: null }).eq("id", coach.user.id);
    }
  });

  test("sending is rate limited per person", async () => {
    const perMinute = currentMessagingPolicy().sendsPerMinute;
    const { count: already } = await adminClient().from("messages").select("id", { count: "exact", head: true })
      .eq("sender_profile_id", c.id).gte("created_at", new Date(Date.now() - 60_000).toISOString());
    for (let i = (already ?? 0); i < perMinute; i++) {
      const r = await send(c, conv, `burst ${i}`);
      assert.equal(r.error, null, code(r.error));
    }
    assert.match(code((await send(c, conv, "one too many")).error), /rate_limited/);
  });
});
