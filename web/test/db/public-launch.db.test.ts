/**
 * M16 public launch, as real people (anonymous visitors, coaches, the server).
 *
 *   · availability is a state word for public coaches only — never a count —
 *     and "full" matches the checkout's own capacity rule
 *   · only qualifications TalentYak checked are public; a coach can't insert
 *     one already marked checked; expired ones drop off
 *   · the waitlist and the page counters can't be read or written by the
 *     public or by signed-in people; only the server registers
 *   · registering twice doesn't duplicate or re-send within ten minutes;
 *     interest in a hidden coach is dropped; confirming needs the token;
 *     withdrawing deletes the entry
 *
 * When the project is not confirmed available, every test SKIPS.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

import { adminClient, anonymousClient, createTestUser, dbAvailability, deleteTestUsers, makeCoach, type CoachFixture, type TestUser } from "./harness.ts";

const availability = dbAvailability();
const skip = availability.ready ? false : `database unavailable — ${availability.reason}`;

let open: CoachFixture;
let closed: CoachFixture;
let hidden: CoachFixture;
let visitor: TestUser;
const users: string[] = [];
const emails: string[] = [];

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const tok = () => randomBytes(24).toString("base64url");

async function stateOf(providerId: string, who = anonymousClient()) {
  const { data, error } = await who.rpc("coach_public_availability");
  assert.equal(error, null);
  return ((data ?? []) as { provider_id: string; state: string; away_until: string | null }[]).find((r) => r.provider_id === providerId);
}

const register = (email: string, extra: { provider?: string | null; confirm?: string; link?: string } = {}) =>
  adminClient().rpc("waitlist_register", {
    p_email: email,
    p_first_name: "Sita",
    p_provider: extra.provider ?? null,
    p_offer: null,
    p_confirm_hash: hash(extra.confirm ?? tok()),
    p_link_hash: hash(extra.link ?? tok()),
    p_consent: "waitlist.v1",
  });

describe("M16 public launch", { skip }, () => {
  before(async () => {
    open = await makeCoach("launch-open", { max: 1 });
    closed = await makeCoach("launch-closed", { accepting: false });
    hidden = await makeCoach("launch-hidden", { published: false });
    visitor = await createTestUser("launch-visitor");
    users.push(open.user.id, closed.user.id, hidden.user.id, visitor.id);
  });

  after(async () => {
    const sb = adminClient();
    for (const e of emails) await sb.from("waitlist_entries").delete().eq("email", e);
    await sb.from("enrollments").delete().eq("provider_id", open.providerId);
    await sb.from("coach_messaging_profiles").delete().in("provider_id", [open.providerId, closed.providerId]);
    for (const c of [open, closed, hidden]) await sb.from("providers").update({ status: "retired", active: false, published_at: null }).eq("id", c.providerId);
    await deleteTestUsers(users);
  });

  test("availability is a state for public coaches only, never a count, and 'full' follows the checkout's rule", async () => {
    const row = await stateOf(open.providerId);
    assert.deepEqual(Object.keys(row!).sort(), ["away_until", "provider_id", "state"]);
    assert.equal(row!.state, "available");
    assert.equal((await stateOf(closed.providerId))!.state, "not_accepting");
    assert.equal(await stateOf(hidden.providerId), undefined, "an unpublished coach isn't listed");

    // One active client fills a limit of one.
    const sb = adminClient();
    const e = await sb.from("enrollments").insert({ customer_id: visitor.id, provider_id: open.providerId, state: "active" }).select("id").single();
    assert.equal(e.error, null);
    assert.equal((await stateOf(open.providerId))!.state, "full");
    await sb.from("enrollments").delete().eq("id", e.data!.id);

    const away = new Date(Date.now() + 5 * 86_400_000).toISOString();
    await sb.from("coach_messaging_profiles").upsert({ provider_id: open.providerId, away_until: away });
    const a = await stateOf(open.providerId);
    assert.equal(a!.state, "away");
    assert.ok(a!.away_until);
    await sb.from("coach_messaging_profiles").update({ away_until: null }).eq("provider_id", open.providerId);
  });

  test("only checked qualifications are public; a coach can't insert one already checked", async () => {
    const mine = await open.user.client.from("provider_credentials").insert({
      provider_id: open.providerId, kind: "qualification", claimed_title: "Level 3 Personal Trainer", issuing_body: "Fixture Board",
      verification_state: "verified", verified_detail: "self-declared",
    }).select("id, verification_state, verified_detail").single();
    assert.equal(mine.error, null);
    assert.equal(mine.data!.verification_state, "unverified", "a new claim always starts unchecked");
    assert.equal(mine.data!.verified_detail, null);

    const pub = async () => ((await anonymousClient().rpc("public_coach_credentials")).data ?? []) as { provider_id: string; title: string }[];
    assert.equal((await pub()).filter((c) => c.provider_id === open.providerId).length, 0);

    await adminClient().from("provider_credentials").update({ verification_state: "verified", verified_detail: "Certificate seen" }).eq("id", mine.data!.id);
    assert.deepEqual((await pub()).filter((c) => c.provider_id === open.providerId).map((c) => c.title), ["Level 3 Personal Trainer"]);

    await adminClient().from("provider_credentials").update({ expires_on: "2020-01-01" }).eq("id", mine.data!.id);
    assert.equal((await pub()).filter((c) => c.provider_id === open.providerId).length, 0, "an expired qualification drops off");

    // Nobody else reads the claims table.
    const { data } = await anonymousClient().from("provider_credentials").select("id");
    assert.equal((data ?? []).length, 0);
  });

  test("the waitlist and counters are closed to the public and to signed-in people", async () => {
    for (const who of [anonymousClient(), visitor.client]) {
      assert.equal(((await who.from("waitlist_entries").select("id")).data ?? []).length, 0);
      assert.ok((await who.from("waitlist_entries").insert({ email: "x@example.test", consent_version: "waitlist.v1" })).error);
      assert.ok((await who.rpc("waitlist_register", { p_email: "x@example.test", p_first_name: null, p_provider: null, p_offer: null, p_confirm_hash: "a", p_link_hash: "b", p_consent: "v" })).error);
      assert.ok((await who.rpc("waitlist_withdraw", { p_hash: "a" })).error);
      assert.ok((await who.rpc("bump_site_event", { p_event: "page_view", p_subject: "home", p_live: true })).error);
      assert.equal(((await who.from("site_event_counts").select("day")).data ?? []).length, 0);
    }
    // Even the server can't store anything but a page kind, slug or id.
    assert.ok((await adminClient().rpc("bump_site_event", { p_event: "page_view", p_subject: "someone@example.com", p_live: false })).error);
    assert.ok((await adminClient().rpc("bump_site_event", { p_event: "purchase", p_subject: "", p_live: false })).error);
  });

  test("registering: no duplicates, no repeat email within ten minutes, hidden coaches dropped, confirm and withdraw", async () => {
    const email = `talentyak-test-waitlist-${tok().slice(0, 8).toLowerCase()}@example.test`;
    emails.push(email);
    const confirm = tok();
    const link = tok();
    const first = await register(email, { provider: hidden.providerId, confirm, link });
    assert.equal(first.error, null);
    assert.equal(first.data.new, true);
    assert.equal(first.data.send_confirmation, true);
    assert.equal(first.data.provider_id, null, "interest in a coach the public can't see is dropped");

    const again = await register(email.toUpperCase(), { provider: open.providerId });
    assert.equal(again.data.new, false);
    assert.equal(again.data.send_confirmation, false, "no second email within ten minutes");
    assert.equal(again.data.provider_id, open.providerId);
    const { count } = await adminClient().from("waitlist_entries").select("id", { count: "exact", head: true }).eq("email", email);
    assert.equal(count, 1);

    assert.equal((await adminClient().rpc("waitlist_confirm", { p_hash: hash("wrong") })).data, null);
    const ok = await adminClient().rpc("waitlist_confirm", { p_hash: hash(confirm) });
    assert.ok(ok.data);
    const { data: row } = await adminClient().from("waitlist_entries").select("state, confirm_token_hash").eq("email", email).single();
    assert.equal(row!.state, "confirmed");
    assert.equal(row!.confirm_token_hash, null, "a confirm link works once");

    assert.equal((await adminClient().rpc("waitlist_withdraw", { p_hash: hash("wrong") })).data, false);
    assert.equal((await adminClient().rpc("waitlist_withdraw", { p_hash: hash(link) })).data, true);
    const { count: left } = await adminClient().from("waitlist_entries").select("id", { count: "exact", head: true }).eq("email", email);
    assert.equal(left, 0, "withdrawing deletes the entry");
  });
});
