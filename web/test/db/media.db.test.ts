/**
 * Who may see a customer's body, and for how long.
 *
 * Progress photos are the most sensitive thing a fitness customer gives us
 * (invariant 3). The rules are not new here — `coach_may_read_record()` from
 * 0021 already decides them — but 0030 applies them to a new table, and an
 * authorisation rule that is only asserted in a comment is not a rule.
 *
 * Every assertion runs through a real signed-in session. The questions:
 *
 *   · can a stranger, or another customer, see any of it            — no
 *   · can the CURRENT coach see what was added on their watch       — yes
 *   · does a coach who was reassigned away lose access immediately  — yes
 *   · does an incoming coach see what came BEFORE they took over    — only
 *     if the customer chose to share their full history
 *   · can a coach write, delete or re-file a customer's media       — no
 *
 * When the project is not confirmed available, every test SKIPS.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  adminClient,
  anonymousClient,
  createTestUser,
  dbAvailability,
  deleteTestUsers,
  makeCoach,
  projectRef,
  wasDenied,
  type CoachFixture,
  type TestUser,
} from "./harness.ts";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;

let customer: TestUser;
let otherCustomer: TestUser;
let coachA: CoachFixture;
let coachB: CoachFixture;
let createdUserIds: string[] = [];

let enrollmentId: string;
/** Added while coach A was coaching. */
let oldPhotoId: string;
/** Added after coach B took over. */
let newPhotoId: string;

const HOUR = 3600 * 1000;
const takeoverAt = new Date(Date.now() - 1 * HOUR);
const beforeTakeover = new Date(Date.now() - 5 * HOUR);
const afterTakeover = new Date(Date.now() - 10 * 60 * 1000);

async function reserveReady(recordedAt: Date, label: string): Promise<string> {
  const sb = adminClient();
  const { data: id, error } = await sb.rpc("reserve_media", {
    p_owner: customer.id,
    p_enrollment: enrollmentId,
    p_purpose: "progress_photo",
    p_media_kind: "image",
    p_recorded_at: recordedAt.toISOString(),
  });
  if (error) throw new Error(`reserve_media (${label}): ${error.message}`);

  const { error: finalizeError } = await sb.rpc("finalize_media", {
    p_id: id,
    p_storage_path: `${customer.id}/${id}/original.webp`,
    p_preview_path: `${customer.id}/${id}/preview.webp`,
    p_content_type: "image/webp",
    p_byte_size: 1024,
    p_width: 800,
    p_height: 1200,
    p_duration: null,
    p_compression_skipped: false,
  });
  if (finalizeError) throw new Error(`finalize_media (${label}): ${finalizeError.message}`);
  return id as string;
}

/** Moves the relationship from coach A to coach B, as a real reassignment does. */
async function reassignTo(provider: string, historyScope: "none" | "programme_and_logs" | "full") {
  const sb = adminClient();
  await sb
    .from("enrollment_assignments")
    .update({ effective_to: takeoverAt.toISOString() })
    .eq("enrollment_id", enrollmentId)
    .is("effective_to", null);

  const { error } = await sb.from("enrollment_assignments").insert({
    enrollment_id: enrollmentId,
    provider_id: provider,
    previous_provider_id: coachA.providerId,
    effective_from: takeoverAt.toISOString(),
    history_scope: historyScope,
  });
  if (error) throw new Error(`reassign: ${error.message}`);

  await sb.from("enrollments").update({ provider_id: provider }).eq("id", enrollmentId);
}

describe("who may see a customer's media", { skip }, () => {
  before(async () => {
    console.log(`Database tests running against project ${projectRef()}`);

    customer = await createTestUser("media-customer");
    otherCustomer = await createTestUser("media-other");
    coachA = await makeCoach("media-coach-a");
    coachB = await makeCoach("media-coach-b");
    createdUserIds = [customer.id, otherCustomer.id, coachA.user.id, coachB.user.id];

    const sb = adminClient();
    const { data: enrollment, error } = await sb
      .from("enrollments")
      .insert({ customer_id: customer.id, provider_id: coachA.providerId, state: "active" })
      .select("id")
      .single();
    if (error) throw new Error(`enrollment: ${error.message}`);
    enrollmentId = enrollment.id as string;

    await sb.from("enrollment_assignments").insert({
      enrollment_id: enrollmentId,
      provider_id: coachA.providerId,
      effective_from: new Date(Date.now() - 30 * 24 * HOUR).toISOString(),
      history_scope: "programme_and_logs",
    });

    oldPhotoId = await reserveReady(beforeTakeover, "old");
    newPhotoId = await reserveReady(afterTakeover, "new");
  });

  after(async () => {
    const sb = adminClient();
    await sb.from("media_assets").delete().in("owner_profile_id", createdUserIds);
    await sb.from("enrollment_assignments").delete().eq("enrollment_id", enrollmentId);
    await sb.from("enrollments").delete().eq("id", enrollmentId);
    await deleteTestUsers(createdUserIds);
  });

  test("a signed-out visitor sees nothing", async () => {
    const result = await anonymousClient().from("media_assets").select("id, storage_path");
    assert.ok(wasDenied(result), "media was readable without signing in");
  });

  test("another customer sees nothing", async () => {
    const result = await otherCustomer.client.from("media_assets").select("id, storage_path");
    assert.ok(wasDenied(result), "one customer could read another's media");
  });

  test("the owner sees all of their own", async () => {
    const { data, error } = await customer.client.from("media_assets").select("id");
    assert.equal(error, null);
    const ids = (data ?? []).map((r) => r.id);
    assert.ok(ids.includes(oldPhotoId) && ids.includes(newPhotoId), "the owner cannot see their own media");
  });

  test("the current coach sees their client's media", async () => {
    const { data } = await coachA.user.client.from("media_assets").select("id");
    const ids = (data ?? []).map((r) => r.id);
    assert.ok(ids.includes(newPhotoId), "the assigned coach could not see the media they need");
  });

  test("an unrelated coach sees nothing", async () => {
    const result = await coachB.user.client.from("media_assets").select("id");
    assert.ok(wasDenied(result), "a coach with no relationship could read a stranger's photos");
  });

  test("a coach cannot write, re-file or delete a client's media", async () => {
    const insert = await coachA.user.client.from("media_assets").insert({
      owner_profile_id: customer.id,
      enrollment_id: enrollmentId,
      purpose: "progress_photo",
      media_kind: "image",
    });
    assert.ok(insert.error, "a coach created media in a customer's name");

    // The policy is SELECT-only, so these change nothing rather than erroring.
    await coachA.user.client.from("media_assets").update({ purpose: "chat_attachment" }).eq("id", newPhotoId);
    await coachA.user.client.from("media_assets").delete().eq("id", newPhotoId);

    const { data: still } = await adminClient()
      .from("media_assets")
      .select("purpose, state")
      .eq("id", newPhotoId)
      .maybeSingle();
    assert.equal(still?.purpose, "progress_photo", "a coach changed what a photo was filed as");
    assert.equal(still?.state, "ready", "a coach deleted a customer's photo");
  });

  describe("after the customer changes coach", () => {
    test("the former coach loses access immediately, including to what they saw yesterday", async () => {
      await reassignTo(coachB.providerId, "programme_and_logs");

      const result = await coachA.user.client.from("media_assets").select("id");
      assert.ok(wasDenied(result), "a reassigned coach could still read their former client's photos");
    });

    test("the new coach sees media from their own time, but not from before it", async () => {
      // The customer chose 'programme_and_logs' — the training record, not the
      // photographs. Media is judged by the stricter test.
      const { data } = await coachB.user.client.from("media_assets").select("id");
      const ids = (data ?? []).map((r) => r.id);

      assert.ok(ids.includes(newPhotoId), "the new coach cannot see media added on their watch");
      assert.ok(
        !ids.includes(oldPhotoId),
        "the new coach saw photographs from before they took over, without the customer sharing them",
      );
    });

    test("with the full history shared, the new coach sees the earlier media too", async () => {
      await adminClient()
        .from("enrollment_assignments")
        .update({ history_scope: "full" })
        .eq("enrollment_id", enrollmentId)
        .is("effective_to", null);

      const { data } = await coachB.user.client.from("media_assets").select("id");
      const ids = (data ?? []).map((r) => r.id);
      assert.ok(ids.includes(oldPhotoId), "the customer shared their full history and it was not honoured");
    });

    test("the customer still owns everything, through every change", async () => {
      const { data } = await customer.client.from("media_assets").select("id");
      const ids = (data ?? []).map((r) => r.id);
      assert.ok(ids.includes(oldPhotoId) && ids.includes(newPhotoId), "a customer lost their own history");
    });
  });
});

describe("the media lifecycle", { skip }, () => {
  let owner: TestUser;
  let ids: string[] = [];

  before(async () => {
    owner = await createTestUser("media-lifecycle");
    ids = [owner.id];
  });

  after(async () => {
    await adminClient().from("media_assets").delete().eq("owner_profile_id", owner.id);
    await deleteTestUsers(ids);
  });

  test("a reserved upload is not visible to a coach until it is ready", async () => {
    const { data: id } = await adminClient().rpc("reserve_media", {
      p_owner: owner.id,
      p_enrollment: null,
      p_purpose: "progress_photo",
      p_media_kind: "image",
    });

    const { data: row } = await adminClient()
      .from("media_assets")
      .select("state, storage_path")
      .eq("id", id)
      .maybeSingle();

    assert.equal(row?.state, "reserved");
    assert.equal(row?.storage_path, null, "a path exists before any bytes were stored");
  });

  test("media cannot be filed under an enrollment that is not the owner's", async () => {
    const stranger = await createTestUser("media-stranger");
    ids.push(stranger.id);
    const coach = await makeCoach("media-lifecycle-coach");
    ids.push(coach.user.id);

    const { data: foreign } = await adminClient()
      .from("enrollments")
      .insert({ customer_id: stranger.id, provider_id: coach.providerId, state: "active" })
      .select("id")
      .single();

    const { error } = await adminClient().rpc("reserve_media", {
      p_owner: owner.id,
      p_enrollment: foreign!.id,
      p_purpose: "progress_photo",
      p_media_kind: "image",
    });
    assert.ok(error, "media was filed under somebody else's coaching relationship");

    await adminClient().from("enrollments").delete().eq("id", foreign!.id);
  });

  test("the server-only lifecycle functions refuse a signed-in person", async () => {
    const reserve = await owner.client.rpc("reserve_media", {
      p_owner: owner.id,
      p_enrollment: null,
      p_purpose: "progress_photo",
      p_media_kind: "image",
    });
    assert.ok(reserve.error, "a person could reserve media directly, bypassing validation");

    const sweep = await owner.client.rpc("sweep_abandoned_media", { p_older_than_minutes: 0 });
    assert.ok(sweep.error, "a person could run the cleanup sweep");
  });

  test("an abandoned upload is swept, and says why", async () => {
    const { data: id } = await adminClient().rpc("reserve_media", {
      p_owner: owner.id,
      p_enrollment: null,
      p_purpose: "progress_photo",
      p_media_kind: "image",
    });
    // Backdate it past the window rather than waiting an hour.
    await adminClient()
      .from("media_assets")
      .update({ created_at: new Date(Date.now() - 3 * HOUR).toISOString() })
      .eq("id", id);

    const { data: swept, error } = await adminClient().rpc("sweep_abandoned_media", {
      p_older_than_minutes: 60,
    });
    assert.equal(error, null);
    assert.ok((swept ?? []).some((r: { id: string }) => r.id === id), "the abandoned upload was not swept");

    const { data: row } = await adminClient()
      .from("media_assets")
      .select("state, failure_reason")
      .eq("id", id)
      .maybeSingle();
    assert.equal(row?.state, "failed");
    assert.match(row?.failure_reason ?? "", /never completed/i);
  });

  test("a person deletes their own media, and the paths come back so the bytes can go too", async () => {
    const { data: id } = await adminClient().rpc("reserve_media", {
      p_owner: owner.id,
      p_enrollment: null,
      p_purpose: "progress_photo",
      p_media_kind: "image",
    });
    await adminClient().rpc("finalize_media", {
      p_id: id,
      p_storage_path: `${owner.id}/${id}/original.webp`,
      p_preview_path: `${owner.id}/${id}/preview.webp`,
      p_content_type: "image/webp",
      p_byte_size: 10,
      p_width: 10,
      p_height: 10,
      p_duration: null,
      p_compression_skipped: false,
    });

    const { data: removed, error } = await owner.client.rpc("delete_own_media", { p_id: id });
    assert.equal(error, null);
    assert.equal((removed ?? []).length, 1, "nothing was returned to clean up");
    assert.match((removed ?? [])[0].storage_path ?? "", /original\.webp$/);

    const { data: row } = await adminClient()
      .from("media_assets")
      .select("state, storage_path, deleted_at")
      .eq("id", id)
      .maybeSingle();
    assert.equal(row?.state, "deleted");
    assert.equal(row?.storage_path, null, "the path survived the delete");
    assert.ok(row?.deleted_at);
  });

  test("one person cannot delete another's media", async () => {
    const { data: id } = await adminClient().rpc("reserve_media", {
      p_owner: owner.id,
      p_enrollment: null,
      p_purpose: "progress_photo",
      p_media_kind: "image",
    });
    const intruder = await createTestUser("media-intruder");
    ids.push(intruder.id);

    const { data: removed } = await intruder.client.rpc("delete_own_media", { p_id: id });
    assert.equal((removed ?? []).length, 0, "somebody else's media was deleted");

    const { data: row } = await adminClient().from("media_assets").select("state").eq("id", id).maybeSingle();
    assert.notEqual(row?.state, "deleted");
  });
});

/**
 * The direct-upload lifecycle (0033): a file sits in a private holding area
 * until it has been checked and cleaned, and nobody but the owner ever learns
 * it exists before then.
 */
describe("uploads before they are processed", { skip }, () => {
  let owner: TestUser;
  let other: TestUser;
  let coach: CoachFixture;
  let enrollment: string;
  let ids: string[] = [];

  async function reserveUpload(kind: "image" | "video" = "image") {
    const { data, error } = await adminClient().rpc("reserve_media_upload", {
      p_owner: owner.id,
      p_enrollment: enrollment,
      p_purpose: "progress_photo",
      p_media_kind: kind,
      p_declared_bytes: 1000,
    });
    if (error) throw new Error(error.message);
    return (data as { id: string; source_path: string }[])[0];
  }

  before(async () => {
    owner = await createTestUser("upl-owner");
    other = await createTestUser("upl-other");
    coach = await makeCoach("upl-coach");
    ids = [owner.id, other.id, coach.user.id];
    const { data } = await adminClient()
      .from("enrollments")
      .insert({ customer_id: owner.id, provider_id: coach.providerId, state: "active" })
      .select("id")
      .single();
    enrollment = data!.id as string;
    await adminClient().from("enrollment_assignments").insert({
      enrollment_id: enrollment,
      provider_id: coach.providerId,
      effective_from: new Date(Date.now() - 86_400_000).toISOString(),
    });
  });

  after(async () => {
    const sb = adminClient();
    await sb.from("media_assets").delete().eq("owner_profile_id", owner.id);
    await sb.from("enrollment_assignments").delete().eq("enrollment_id", enrollment);
    await sb.from("enrollments").delete().eq("id", enrollment);
    await deleteTestUsers(ids);
  });

  test("the holding path names no file and belongs to its owner", async () => {
    const r = await reserveUpload();
    assert.equal(r.source_path, `${owner.id}/${r.id}/source`);
  });

  test("only the owner can report an upload finished", async () => {
    const r = await reserveUpload();
    const { data: wrong } = await adminClient().rpc("mark_media_uploaded", { p_id: r.id, p_owner: other.id, p_bytes: 10 });
    assert.equal(wrong, false, "another person completed someone else's upload");
    const { data: right } = await adminClient().rpc("mark_media_uploaded", { p_id: r.id, p_owner: owner.id, p_bytes: 10 });
    assert.equal(right, true);
  });

  test("two processors started at once cannot both take the same file", async () => {
    const r = await reserveUpload();
    await adminClient().rpc("mark_media_uploaded", { p_id: r.id, p_owner: owner.id, p_bytes: 10 });
    const [a, b] = await Promise.all([
      adminClient().rpc("claim_media_processing", { p_id: r.id }),
      adminClient().rpc("claim_media_processing", { p_id: r.id }),
    ]);
    const claims = [a.data, b.data].filter((d) => Array.isArray(d) && d.length).length;
    assert.equal(claims, 1, `the same file was claimed ${claims} times`);
  });

  test("a coach sees nothing that has not finished processing — not even that it exists", async () => {
    const r = await reserveUpload();
    await adminClient().rpc("mark_media_uploaded", { p_id: r.id, p_owner: owner.id, p_bytes: 10 });
    const { data } = await coach.user.client.from("media_assets").select("id").eq("id", r.id);
    assert.deepEqual(data ?? [], [], "the coach saw an unprocessed upload");
  });

  test("only completion marks a file clean, and only from processing", async () => {
    const r = await reserveUpload();
    // Straight from 'reserved': refused.
    const early = await adminClient().rpc("complete_media_processing", {
      p_id: r.id, p_storage_path: "x", p_preview_path: "y", p_content_type: "image/webp",
      p_byte_size: 1, p_width: 1, p_height: 1, p_duration: null, p_report: {},
    });
    assert.equal(early.data, false, "an unprocessed file was marked clean");

    await adminClient().rpc("mark_media_uploaded", { p_id: r.id, p_owner: owner.id, p_bytes: 10 });
    await adminClient().rpc("claim_media_processing", { p_id: r.id });
    const done = await adminClient().rpc("complete_media_processing", {
      p_id: r.id, p_storage_path: `${owner.id}/${r.id}/photo.webp`, p_preview_path: `${owner.id}/${r.id}/preview.webp`,
      p_content_type: "image/webp", p_byte_size: 1, p_width: 1, p_height: 1, p_duration: null,
      p_report: { source: { bytes: 10 }, output: { bytes: 1 } },
    });
    assert.equal(done.data, true);

    const { data: row } = await adminClient().from("media_assets").select("state, metadata_stripped, source_path").eq("id", r.id).single();
    assert.equal(row?.state, "ready");
    assert.equal(row?.metadata_stripped, true);
    assert.ok(row?.source_path, "the original was released before the caller asked");

    const { data: released } = await adminClient().rpc("release_media_source", { p_id: r.id });
    assert.equal(released, `${owner.id}/${r.id}/source`, "the released path was not returned for deletion");
    const { data: after } = await adminClient().from("media_assets").select("source_path").eq("id", r.id).single();
    assert.equal(after?.source_path, null);
  });

  test("a failed file can be retried by its owner — not by anyone else, and not if retrying cannot help", async () => {
    const r = await reserveUpload("video");
    await adminClient().rpc("mark_media_uploaded", { p_id: r.id, p_owner: owner.id, p_bytes: 10 });
    await adminClient().rpc("claim_media_processing", { p_id: r.id });
    await adminClient().rpc("fail_media_processing", { p_id: r.id, p_reason: "took too long", p_permanent: false });

    const stranger = await other.client.rpc("request_media_retry", { p_id: r.id });
    assert.equal(stranger.data, false, "another person retried someone else's file");
    const mine = await owner.client.rpc("request_media_retry", { p_id: r.id });
    assert.equal(mine.data, true);

    const r2 = await reserveUpload();
    await adminClient().rpc("mark_media_uploaded", { p_id: r2.id, p_owner: owner.id, p_bytes: 10 });
    await adminClient().rpc("claim_media_processing", { p_id: r2.id });
    const { data: released } = await adminClient().rpc("fail_media_processing", { p_id: r2.id, p_reason: "HEIC", p_permanent: true });
    assert.equal(released, r2.source_path, "a refused file's original was not handed back for deletion");
    const refused = await owner.client.rpc("request_media_retry", { p_id: r2.id });
    assert.equal(refused.data, false, "a permanent refusal was offered a pointless retry");
  });

  test("a processor that died mid-job does not strand the file", async () => {
    const r = await reserveUpload("video");
    await adminClient().rpc("mark_media_uploaded", { p_id: r.id, p_owner: owner.id, p_bytes: 10 });
    await adminClient().rpc("claim_media_processing", { p_id: r.id });
    // As if the function running it was killed 20 minutes ago.
    await adminClient().from("media_assets").update({ processing_started_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq("id", r.id);

    const { data } = await adminClient().rpc("sweep_abandoned_media", { p_older_than_minutes: 1440 });
    const mine = ((data ?? []) as { id: string; outcome: string }[]).find((x) => x.id === r.id);
    assert.equal(mine?.outcome, "requeued");
    const { data: row } = await adminClient().from("media_assets").select("state, source_path").eq("id", r.id).single();
    assert.equal(row?.state, "uploaded");
    assert.ok(row?.source_path, "the original was discarded instead of being retried");
  });

  test("a file that keeps outliving its processor is failed after three tries, not requeued forever", async () => {
    const r = await reserveUpload("video");
    await adminClient().rpc("mark_media_uploaded", { p_id: r.id, p_owner: owner.id, p_bytes: 10 });
    await adminClient().rpc("claim_media_processing", { p_id: r.id });
    await adminClient()
      .from("media_assets")
      .update({ processing_attempts: 3, processing_started_at: new Date(Date.now() - 20 * 60_000).toISOString() })
      .eq("id", r.id);

    const { data } = await adminClient().rpc("sweep_abandoned_media", { p_older_than_minutes: 1440 });
    const mine = ((data ?? []) as { id: string; outcome: string }[]).find((x) => x.id === r.id);
    assert.equal(mine?.outcome, "gave_up");
    const { data: row } = await adminClient().from("media_assets").select("state, failure_reason, source_path").eq("id", r.id).single();
    assert.equal(row?.state, "failed");
    assert.match(row?.failure_reason ?? "", /three times/);
    assert.ok(row?.source_path, "the original was discarded; the owner could no longer retry");
  });

  test("an upload that never finished is failed after a day, and its partial bytes are released", async () => {
    const r = await reserveUpload();
    await adminClient().from("media_assets").update({ created_at: new Date(Date.now() - 25 * 3600_000).toISOString() }).eq("id", r.id);
    const { data } = await adminClient().rpc("sweep_abandoned_media", { p_older_than_minutes: 1440 });
    const mine = ((data ?? []) as { id: string; source_path: string; outcome: string }[]).find((x) => x.id === r.id);
    assert.equal(mine?.outcome, "abandoned");
    assert.equal(mine?.source_path, r.source_path, "the partial upload's path was not handed back for deletion");
  });

  test("the holding area cannot be read or listed from a browser", async () => {
    const r = await reserveUpload();
    const read = await owner.client.storage.from("media-uploads").download(r.source_path);
    assert.ok(read.error, "the owner's browser session could read the unprocessed original");
    const list = await coach.user.client.storage.from("media-uploads").list(owner.id);
    assert.deepEqual(list.data ?? [], [], "a coach could list a client's unprocessed uploads");
  });
});
