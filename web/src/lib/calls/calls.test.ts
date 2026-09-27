import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { attendanceRows, dailyClient, roomProperties, tokenProperties, type DailyMeeting } from "@/lib/calls/daily";
import { signDailyWebhook, verifyDailyWebhook, webhookAction } from "@/lib/calls/webhook";
import { callClock, countdown, joinRefusal } from "@/lib/calls/window";
import { currentCallsPolicy } from "@/lib/policy/registry";

/**
 * Private calls (M10), without the call provider. Every provider response here
 * comes from a stand-in `fetch`; nothing in this file reaches Daily.
 */

const ROOM = `ty-${"a".repeat(32)}`;
const at = (iso: string) => Date.parse(iso);

describe("the room's window and the call clock", () => {
  const t = {
    startsAt: "2026-10-01T12:00:00Z",
    endsAt: "2026-10-01T12:45:00Z",
    opensAt: "2026-10-01T11:50:00Z",
    closesAt: "2026-10-01T13:15:00Z",
  };

  test("before the room opens nobody can join", () => {
    const c = callClock(at("2026-10-01T11:00:00Z"), t);
    assert.equal(c.phase, "before");
    assert.equal(c.canJoin, false);
    assert.equal(c.msToNext, 50 * 60_000);
  });

  test("early arrival: the room is open before the start", () => {
    const c = callClock(at("2026-10-01T11:55:00Z"), t);
    assert.equal(c.phase, "open_early");
    assert.equal(c.canJoin, true);
  });

  test("inside the booked time, the time left counts to the booked end", () => {
    const c = callClock(at("2026-10-01T12:30:00Z"), t);
    assert.equal(c.phase, "in_session");
    assert.equal(c.msToNext, 15 * 60_000);
    assert.equal(c.warningMinutes, null);
  });

  test("late arrival and running over: the booked end is NOT a cut-off", () => {
    const c = callClock(at("2026-10-01T12:50:00Z"), t);
    assert.equal(c.phase, "overtime");
    assert.equal(c.canJoin, true, "still joinable after the booked end");
  });

  test("warnings tighten as the room's closing approaches", () => {
    assert.equal(callClock(at("2026-10-01T13:04:00Z"), t, [10, 2]).warningMinutes, null);
    assert.equal(callClock(at("2026-10-01T13:06:00Z"), t, [10, 2]).warningMinutes, 10);
    assert.equal(callClock(at("2026-10-01T13:14:00Z"), t, [10, 2]).warningMinutes, 2);
  });

  test("after the room closes nobody can join", () => {
    const c = callClock(at("2026-10-01T13:15:00Z"), t);
    assert.equal(c.phase, "closed");
    assert.equal(c.canJoin, false);
  });

  test("countdowns never say zero minutes", () => {
    assert.equal(countdown(30_000), "less than a minute");
    assert.equal(countdown(61_000), "2 min");
    assert.equal(countdown(125 * 60_000), "2 h 5 min");
    assert.equal(countdown(60 * 60_000), "1 h");
  });

  test("every refusal the server can give has words, with a safe fallback", () => {
    for (const reason of ["too_early", "closed", "not_booked", "relationship_paused", "suspended", "coach_changed", "provider_unavailable", "rate_limited"]) {
      assert.notEqual(joinRefusal(reason), joinRefusal("something_new"), reason);
    }
    assert.match(joinRefusal(undefined), /couldn't be joined/);
  });

  test("the calls policy is an unapproved development default with humane bounds", () => {
    const p = currentCallsPolicy();
    assert.equal(p.status, "sandbox_default");
    assert.ok(p.graceAfterEndMinutes >= 5, "never cut off at the booked minute");
    assert.equal(p.maxParticipants, 2);
    assert.equal(p.attendanceHasConsequences, false);
    assert.equal(p.automaticNoShow, false);
  });
});

describe("what the provider is asked for", () => {
  test("a room is private, for two, and exists only for its window", () => {
    const r = roomProperties({ opensAt: "2026-10-01T11:50:00Z", closesAt: "2026-10-01T13:15:00Z" });
    assert.equal(r.privacy, "private");
    assert.equal(r.properties.max_participants, 2);
    assert.equal(r.properties.nbf, at("2026-10-01T11:50:00Z") / 1000);
    assert.equal(r.properties.exp, at("2026-10-01T13:15:00Z") / 1000);
    assert.equal(r.properties.eject_at_room_exp, true);
    assert.equal(r.properties.enforce_unique_user_ids, true);
    assert.equal(r.properties.enable_screenshare, false);
    assert.equal(r.properties.enable_chat, false);
    assert.equal("enable_recording" in r.properties, false, "recording is never switched on");
  });

  test("a pass never carries elevated privileges, whatever was asked", () => {
    const p = tokenProperties({ roomName: ROOM, userId: "u1", userName: "x".repeat(100), expiresAt: "2026-10-01T12:02:00Z", audioOnly: true });
    assert.equal(p.properties.is_owner, false);
    assert.equal(p.properties.permissions.canAdmin, false);
    assert.deepEqual([...p.properties.permissions.canSend], ["video", "audio"], "no screen sharing");
    assert.equal(p.properties.enable_screenshare, false);
    assert.equal(p.properties.room_name, ROOM, "one room only");
    assert.equal(p.properties.exp, at("2026-10-01T12:02:00Z") / 1000);
    assert.equal(p.properties.eject_at_token_exp, false, "the pass gets you in; the room's window decides how long");
    assert.equal(p.properties.start_video_off, true, "audio-only starts with the camera off");
    assert.equal(p.properties.user_name.length, 60);
  });
});

/** A stand-in for the provider: canned responses by method and path. */
function fakeFetch(routes: Record<string, (body: unknown) => { status: number; json: unknown } | Error>) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const path = `${u.pathname.replace(/^\/v1/, "")}${u.search}`;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, auth: new Headers(init?.headers).get("authorization") });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === method && path.startsWith(p);
    });
    const r = key ? routes[key](body) : { status: 404, json: { error: "not-found" } };
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

describe("the provider client (stand-in, never the real service)", () => {
  const url = `https://talentyak.daily.co/${ROOM}`;

  test("creates a room with the key server-side", async () => {
    const f = fakeFetch({ "POST /rooms": () => ({ status: 200, json: { name: ROOM, url } }) });
    const r = await dailyClient({ apiKey: "k_test", fetchImpl: f.impl }).createRoom({ name: ROOM, opensAt: "2026-10-01T11:50:00Z", closesAt: "2026-10-01T13:15:00Z" });
    assert.deepEqual(r, { ok: true, value: { name: ROOM, url } });
    assert.equal(f.calls[0].auth, "Bearer k_test");
    assert.equal((f.calls[0].body as { privacy: string }).privacy, "private");
  });

  test("a repeated creation is success: the existing room is returned", async () => {
    const f = fakeFetch({
      "POST /rooms": () => ({ status: 400, json: { error: "invalid-request-error", info: `a room named ${ROOM} already exists` } }),
      "GET /rooms/": () => ({ status: 200, json: { name: ROOM, url } }),
    });
    const r = await dailyClient({ apiKey: "k", fetchImpl: f.impl }).createRoom({ name: ROOM, opensAt: "2026-10-01T11:50:00Z", closesAt: "2026-10-01T13:15:00Z" });
    assert.equal(r.ok, true);
    assert.equal(f.calls.length, 2);
  });

  test("an outage is retryable; a refused key is not", async () => {
    const down = fakeFetch({ "POST /meeting-tokens": () => ({ status: 503, json: { error: "unavailable" } }) });
    const r1 = await dailyClient({ apiKey: "k", fetchImpl: down.impl }).createToken({ roomName: ROOM, userId: "u", userName: "n", expiresAt: "2026-10-01T12:02:00Z", audioOnly: false });
    assert.equal(r1.ok, false);
    assert.equal(!r1.ok && r1.retryable, true);

    const denied = fakeFetch({ "POST /meeting-tokens": () => ({ status: 401, json: { error: "authorization-header-error" } }) });
    const r2 = await dailyClient({ apiKey: "k", fetchImpl: denied.impl }).createToken({ roomName: ROOM, userId: "u", userName: "n", expiresAt: "2026-10-01T12:02:00Z", audioOnly: false });
    assert.equal(!r2.ok && r2.retryable, false);
  });

  test("a network failure is reported as such, and retryable", async () => {
    const f = fakeFetch({ "DELETE /rooms/": () => new TypeError("fetch failed") });
    const r = await dailyClient({ apiKey: "k", fetchImpl: f.impl }).deleteRoom(ROOM);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.retryable, true);
  });

  test("deleting or emptying a room that's already gone is success", async () => {
    const f = fakeFetch({
      "DELETE /rooms/": () => ({ status: 404, json: { error: "not-found" } }),
      "POST /rooms/": () => ({ status: 404, json: { error: "not-found" } }),
    });
    const c = dailyClient({ apiKey: "k", fetchImpl: f.impl });
    assert.equal((await c.deleteRoom(ROOM)).ok, true);
    assert.equal((await c.eject(ROOM, ["u1"])).ok, true);
  });

  test("attendance is read for this room only, and only from finished meetings", async () => {
    const meetings: DailyMeeting[] = [
      { id: "m1", room: ROOM, start_time: 1, duration: 600, ongoing: false, participants: [
        { user_id: "11111111-1111-4111-8111-111111111111", participant_id: "p1", join_time: 100, duration: 590 },
        { user_id: null, participant_id: "p2", join_time: 100, duration: 5 },
      ] },
      { id: "m2", room: ROOM, start_time: 2, duration: 10, ongoing: true, participants: [
        { user_id: "11111111-1111-4111-8111-111111111111", participant_id: "p3", join_time: 900, duration: 10 },
      ] },
      { id: "m3", room: "someone-elses-room", start_time: 3, duration: 10, ongoing: false, participants: [
        { user_id: "x", participant_id: "p4", join_time: 1, duration: 1 },
      ] },
    ];
    const f = fakeFetch({ "GET /meetings": () => ({ status: 200, json: { data: meetings } }) });
    const r = await dailyClient({ apiKey: "k", fetchImpl: f.impl }).listMeetings(ROOM, 0);
    assert.equal(r.ok && r.value.length, 2);
    const { rows, ongoing } = attendanceRows(r.ok ? r.value : []);
    assert.equal(ongoing, true);
    assert.deepEqual(rows.map((x) => x.participant_id), ["p1"], "anonymous and still-running presences are not recorded");
  });
});

describe("provider webhook deliveries", () => {
  const secret = Buffer.from("a shared test secret, not a real one").toString("base64");
  const body = JSON.stringify({ version: "1.0.0", type: "participant.left", id: "evt-1", payload: { room: ROOM, user_id: "u1", session_id: "s1", joined_at: 1700000000.5, duration: 42.2 }, event_ts: 1700000043 });

  test("a correctly signed delivery verifies", () => {
    const signature = signDailyWebhook(secret, "1700000043", body);
    assert.deepEqual(verifyDailyWebhook({ secret, timestamp: "1700000043", signature, body }), { ok: true });
  });

  test("a changed body, a changed timestamp or a different secret does not", () => {
    const signature = signDailyWebhook(secret, "1700000043", body);
    assert.equal(verifyDailyWebhook({ secret, timestamp: "1700000043", signature, body: body.replace("42.2", "4200") }).ok, false);
    assert.equal(verifyDailyWebhook({ secret, timestamp: "1700000044", signature, body }).ok, false);
    assert.equal(verifyDailyWebhook({ secret: Buffer.from("other").toString("base64"), timestamp: "1700000043", signature, body }).ok, false);
    assert.equal(verifyDailyWebhook({ secret, timestamp: null, signature: null, body }).ok, false);
    assert.equal(verifyDailyWebhook({ secret: "", timestamp: "1", signature, body }).ok, false);
  });

  test("the signature over the canonical JSON is accepted too", () => {
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    const signature = signDailyWebhook(secret, "1700000043", body);
    assert.equal(verifyDailyWebhook({ secret, timestamp: "1700000043", signature, body: pretty }).ok, true);
  });

  test("events become attendance only for this app's rooms", () => {
    assert.deepEqual(webhookAction({ test: "test" }), { kind: "verification" });
    const left = webhookAction(JSON.parse(body));
    assert.equal(left.kind, "attendance");
    assert.equal(left.kind === "attendance" && left.row.participant_id, "s1");
    assert.equal(webhookAction({ id: "e", type: "participant.left", payload: { room: "other", user_id: "u", session_id: "s", joined_at: 1, duration: 1 } }).kind, "ignore");
    assert.equal(webhookAction({ id: "e", type: "participant.left", payload: { room: ROOM } }).kind, "ignore");
    assert.equal(webhookAction({ id: "e", type: "meeting.ended", payload: { room: ROOM } }).kind, "meeting_ended");
    assert.equal(webhookAction({ id: "e", type: "recording.ready-to-download", payload: { room: ROOM } }).kind, "ignore");
  });
});
