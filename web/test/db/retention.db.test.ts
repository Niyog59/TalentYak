/**
 * Retention operations, exercised against the real database — with the
 * destructive step still switched off.
 *
 * What these prove:
 *
 *   · a dry run shows who a proposed rule would catch and CREATES NOTHING
 *   · only a two-factor administrator can see those figures
 *   · a hold needs a reason, outranks the clock, and cancels pending notices
 *   · an item whose reason for deletion has gone away is let off
 *   · a notice that did not arrive stops the clock
 *   · the execution guard refuses while the switch is off, whatever else is true
 *   · a person's own deletion request is theirs alone and is not duplicated
 *
 * When the project is not confirmed available, every test SKIPS.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  adminClient,
  createTestUser,
  dbAvailability,
  deleteTestUsers,
  projectRef,
  setRole,
  upgradeToAal2,
  wasDenied,
  type TestUser,
} from "./harness.ts";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;

const DAY = 24 * 3600 * 1000;

let owner: TestUser;
let founder: TestUser;
let stranger: TestUser;
let ids: string[] = [];
const candidates: string[] = [];

/** A ready photo recorded `daysAgo` days back. */
async function photo(daysAgo: number): Promise<string> {
  const sb = adminClient();
  const { data: id, error } = await sb.rpc("reserve_media", {
    p_owner: owner.id,
    p_enrollment: null,
    p_purpose: "progress_photo",
    p_media_kind: "image",
    p_recorded_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
  });
  if (error) throw new Error(`reserve_media: ${error.message}`);
  await sb.rpc("finalize_media", {
    p_id: id,
    p_storage_path: `${owner.id}/${id}/original.webp`,
    p_preview_path: null,
    p_content_type: "image/webp",
    p_byte_size: 10,
    p_width: 10,
    p_height: 10,
    p_duration: null,
    p_compression_skipped: false,
  });
  return id as string;
}

/** A synthetic candidate — the only kind that may carry notices under a proposed policy. */
async function candidateFor(mediaId: string, dueInDays: number): Promise<string> {
  const { data, error } = await adminClient()
    .from("retention_candidates")
    .insert({
      policy_id: "retention.media.v1",
      resource_type: "progress_media",
      resource_id: mediaId,
      profile_id: owner.id,
      eligible_at: new Date(Date.now() - DAY).toISOString(),
      deletion_due_at: new Date(Date.now() + dueInDays * DAY).toISOString(),
      is_synthetic: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(`candidate: ${error.message}`);
  candidates.push(data.id as string);
  return data.id as string;
}

describe("retention operations", { skip }, () => {
  before(async () => {
    console.log(`Database tests running against project ${projectRef()}`);
    owner = await createTestUser("ret-owner");
    stranger = await createTestUser("ret-stranger");
    founder = await createTestUser("ret-founder");
    ids = [owner.id, stranger.id, founder.id];
    await setRole(founder.id, "admin");
    await upgradeToAal2(founder);
  });

  after(async () => {
    const sb = adminClient();
    if (candidates.length) {
      const { data: notices } = await sb.from("retention_notices").select("outbox_id").in("candidate_id", candidates);
      const outboxIds = (notices ?? []).map((n) => n.outbox_id).filter(Boolean);
      await sb.from("retention_candidates").delete().in("id", candidates);
      if (outboxIds.length) await sb.from("outbox").delete().in("id", outboxIds);
    }
    await sb.from("deletion_requests").delete().in("profile_id", ids);
    await sb.from("media_assets").delete().eq("owner_profile_id", owner.id);
    await deleteTestUsers(ids);
  });

  test("automatic deletion is still switched off", async () => {
    const { data } = await adminClient().from("retention_settings").select("destructive_execution_enabled").single();
    assert.equal(data?.destructive_execution_enabled, false);
  });

  test("a dry run shows who would be caught, and creates nothing", async () => {
    const old = await photo(400); // past the proposed 365 days
    await photo(10); // not past it

    const before = await adminClient().from("retention_candidates").select("id", { count: "exact", head: true });
    const { data, error } = await founder.client.rpc("retention_dry_run", { p_policy_id: "retention.media.v1" });
    const afterCount = await adminClient().from("retention_candidates").select("id", { count: "exact", head: true });

    assert.equal(error, null);
    const caught = ((data ?? []) as { resource_id: string }[]).map((r) => r.resource_id);
    assert.ok(caught.includes(old), "the old photo was not identified");
    assert.equal(afterCount.count, before.count, "a DRY run created candidates");
  });

  test("an ordinary person cannot run the dry run", async () => {
    const result = await owner.client.rpc("retention_dry_run", { p_policy_id: "retention.media.v1" });
    assert.ok(result.error, "a customer could see who the retention rule would catch");
  });

  test("a dry run refuses a rule with no implemented eligibility, rather than guessing", async () => {
    const { error } = await founder.client.rpc("retention_dry_run", { p_policy_id: "retention.programmes.v1" });
    assert.ok(error);
    assert.match(error!.message, /no_eligibility_rule/);
  });

  test("a hold needs a reason, and cancels the notices already queued", async () => {
    const media = await photo(400);
    const candidate = await candidateFor(media, 40);
    const { data: scheduled } = await adminClient().rpc("schedule_retention_notices", { p_candidate_id: candidate });
    assert.ok(Number(scheduled) >= 1, "no notices were scheduled for the synthetic candidate");

    const noReason = await founder.client.rpc("place_retention_hold", { p_candidate_id: candidate, p_reason: "  " });
    assert.ok(noReason.error, "a hold was placed without a reason");

    const { data: held, error } = await founder.client.rpc("place_retention_hold", {
      p_candidate_id: candidate,
      p_reason: "Open support conversation",
    });
    assert.equal(error, null);
    assert.equal(held, true);

    const { data: notices } = await adminClient().from("retention_notices").select("state, outbox_id").eq("candidate_id", candidate);
    assert.ok((notices ?? []).every((n) => n.state === "cancelled"), "a notice survived the hold");

    const outboxIds = (notices ?? []).map((n) => n.outbox_id);
    const { data: jobs } = await adminClient().from("outbox").select("state").in("id", outboxIds);
    assert.ok((jobs ?? []).every((j) => j.state === "cancelled"), "a queued notice email would still have gone out");
  });

  test("a customer cannot place or release a hold", async () => {
    const media = await photo(400);
    const candidate = await candidateFor(media, 40);
    const place = await owner.client.rpc("place_retention_hold", { p_candidate_id: candidate, p_reason: "mine" });
    assert.ok(place.error);
    const release = await owner.client.rpc("release_retention_hold", { p_candidate_id: candidate });
    assert.ok(release.error);
  });

  test("an item whose file the owner already deleted is let off by the recheck", async () => {
    const media = await photo(400);
    const candidate = await candidateFor(media, 40);
    await owner.client.rpc("delete_own_media", { p_id: media });

    const { data } = await adminClient().rpc("recheck_retention_candidates");
    const mine = ((data ?? []) as { candidate_id: string; outcome: string }[]).find((r) => r.candidate_id === candidate);
    assert.match(mine?.outcome ?? "", /cancelled: already deleted/);

    const { data: row } = await adminClient().from("retention_candidates").select("state, cancelled_reason").eq("id", candidate).single();
    assert.equal(row?.state, "cancelled");
  });

  test("an item no longer past its period is let off", async () => {
    // A recent photo tracked by mistake — or a policy whose period was lengthened.
    const media = await photo(10);
    const candidate = await candidateFor(media, 40);

    await adminClient().rpc("recheck_retention_candidates");
    const { data: row } = await adminClient().from("retention_candidates").select("state, cancelled_reason").eq("id", candidate).single();
    assert.equal(row?.state, "cancelled");
    assert.match(row?.cancelled_reason ?? "", /no longer past its retention period/);
  });

  test("a notice that did not arrive stops the clock", async () => {
    const media = await photo(400);
    const candidate = await candidateFor(media, 40);
    await adminClient().rpc("schedule_retention_notices", { p_candidate_id: candidate });
    const { data: notice } = await adminClient()
      .from("retention_notices")
      .select("outbox_id")
      .eq("candidate_id", candidate)
      .limit(1)
      .single();

    await adminClient().rpc("record_notice_outcome", { p_outbox_id: notice?.outbox_id, p_delivered: false, p_error: "bounced" });

    const { data: row } = await adminClient().from("retention_candidates").select("state").eq("id", candidate).single();
    assert.equal(row?.state, "notice_failed");
  });

  test("the execution guard refuses while the switch is off, even for an otherwise eligible item", async () => {
    const media = await photo(400);
    const candidate = await candidateFor(media, 40);
    const { data } = await adminClient().rpc("retention_execution_allowed", { p_candidate_id: candidate });
    const verdict = ((data ?? []) as { allowed: boolean; reason: string }[])[0];
    assert.equal(verdict.allowed, false);
    assert.match(verdict.reason, /switched off/);
  });

  test("a person's deletion request is theirs alone, and asking twice is one request", async () => {
    const first = await owner.client.rpc("request_own_deletion", { p_note: "Please remove my photos" });
    const second = await owner.client.rpc("request_own_deletion", { p_note: null });
    assert.equal(first.error, null);
    assert.equal(first.data, second.data, "a second request was created");

    const mine = await owner.client.from("deletion_requests").select("id");
    assert.equal(mine.data?.length, 1);

    const theirs = await stranger.client.from("deletion_requests").select("id");
    assert.ok(wasDenied(theirs), "one person could see another's deletion request");
  });
});
