import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayload, captureProductEvent, posthogConfig, sanitizeProperties, analyticsAppUrl } from "@/lib/analytics/posthog";

const ENV = { POSTHOG_PROJECT_KEY: "phc_abcdefghijklmnop", POSTHOG_HOST: "https://eu.i.posthog.com" };

test("nothing is sent without a project key, or for activity that isn't real production activity", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response(null, { status: 200 }); }) as typeof fetch;
  assert.equal(await captureProductEvent("public_visit", { page_kind: "home" }, { live: true, fetcher, env: {} }), "skipped");
  assert.equal(await captureProductEvent("public_visit", { page_kind: "home" }, { live: false, fetcher, env: ENV }), "skipped");
  assert.equal(calls, 0);
  assert.equal(await captureProductEvent("public_visit", { page_kind: "home" }, { live: true, fetcher, env: ENV }), "sent");
  assert.equal(calls, 1);
});

test("only the allowed public reference survives: no emails, names, query strings, health or message text", () => {
  const out = sanitizeProperties("coach_profile_view", {
    coach_slug: "anjali-rai",
    email: "someone@example.com",
    name: "Someone",
    url: "https://talentyak.com/coaches/x?email=a@b.c",
    injury: "left knee",
  });
  assert.deepEqual(out, { coach_slug: "anjali-rai" });
  assert.deepEqual(sanitizeProperties("coach_profile_view", { coach_slug: "a@b.com" }), {});
  assert.deepEqual(sanitizeProperties("signed_in", { email: "x@y.z" }), {});
});

test("events are anonymous: no person profile, no location lookup, a throwaway id", async () => {
  const config = posthogConfig(ENV)!;
  const a = await buildPayload(config, "signed_up", { email: "x@y.z" });
  const b = await buildPayload(config, "signed_up", {});
  assert.notEqual(a.distinct_id, b.distinct_id);
  const props = a.properties as Record<string, unknown>;
  assert.equal(props.$process_person_profile, false);
  assert.equal(props.$geoip_disable, true);
  assert.equal(JSON.stringify(a).includes("x@y.z"), false);
});

test("a purchase is one event however often its job runs (stable event id)", async () => {
  const config = posthogConfig(ENV)!;
  const a = await buildPayload(config, "purchase_confirmed", { service_type: "recurring_coaching" }, { dedupeKey: "purchase:1" });
  const b = await buildPayload(config, "purchase_confirmed", { service_type: "recurring_coaching" }, { dedupeKey: "purchase:1" });
  assert.equal(a.uuid, b.uuid);
  assert.equal(a.distinct_id, b.distinct_id);
  assert.equal(JSON.stringify(a).includes("amount"), false, "amounts are never sent");
});

test("a failed send never throws into the page, and a bad key or link is ignored", async () => {
  const boom = (async () => { throw new Error("down"); }) as typeof fetch;
  assert.equal(await captureProductEvent("public_visit", { page_kind: "home" }, { live: true, fetcher: boom, env: ENV }), "failed");
  assert.equal(posthogConfig({ POSTHOG_PROJECT_KEY: "not-a-key" }), null);
  assert.equal(analyticsAppUrl({ POSTHOG_APP_URL: "https://evil.example.com/project/1" }), null);
  assert.equal(analyticsAppUrl({ POSTHOG_APP_URL: "https://us.posthog.com/project/123" }), "https://us.posthog.com/project/123");
});
