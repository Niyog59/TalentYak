import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { redactText, redactUrl, scrubBreadcrumb, scrubEvent } from "./scrub.ts";

describe("error report text never carries secrets or personal details", () => {
  test("emails, tokens, keys, card and phone numbers are redacted", () => {
    const out = redactText(
      "sita@example.com failed with Bearer abcdefgh12345678 using sk_test_51Habcdefghijkl, " +
        "whsec_abcdefghij, sbp_0123456789abcdef, card 4242 4242 4242 4242, phone +977 9841234567, " +
        "session eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl",
    );
    for (const leak of ["sita@example.com", "abcdefgh12345678", "sk_test_51H", "whsec_", "sbp_", "4242 4242", "9841234567", "eyJhbGci"]) {
      assert.ok(!out.includes(leak), `leaked ${leak}: ${out}`);
    }
  });

  test("private media links are removed whole, query strings everywhere", () => {
    const out = redactText(
      "fetch https://abc.supabase.co/storage/v1/object/sign/progress-photos/u1/p.jpg?token=xyz failed; " +
        "see https://www.talentyak.com/account?code=secret123#frag",
    );
    assert.ok(!out.includes("progress-photos"));
    assert.ok(!out.includes("xyz"));
    assert.ok(!out.includes("secret123"));
    assert.match(out, /\[private-media-url\]/);
    assert.match(out, /https:\/\/www\.talentyak\.com\/account/);
  });

  test("token routes are masked, ordinary identifiers and dates are kept for debugging", () => {
    assert.equal(redactUrl("/invite/abc123def?x=1"), "/invite/[token]");
    assert.equal(redactUrl("/waitlist/leave/tok_9"), "/waitlist/leave/[token]");
    const id = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
    assert.equal(redactText(`asset ${id} at 2026-10-01T09:00:00Z`), `asset ${id} at 2026-10-01T09:00:00Z`);
  });

  test("password-like fields inside a message are redacted", () => {
    const out = redactText(`{"password":"hunter2","note":"ok"} password=abc token: xyz`);
    assert.ok(!out.includes("hunter2"));
    assert.ok(!out.includes("abc"));
    assert.ok(!out.includes("xyz"));
  });
});

describe("events are reduced to an allowlist before they are sent", () => {
  const event = {
    message: "Failed for ravi@example.com",
    transaction: "/waitlist/confirm/tok123",
    user: { id: "u1", email: "ravi@example.com", ip_address: "1.2.3.4" },
    extra: { body: "my injury notes" },
    request: {
      method: "POST",
      url: "https://www.talentyak.com/api/tracking?entry=chicken%20rice",
      headers: { cookie: "sb-access-token=abc", authorization: "Bearer xyz" },
      cookies: { sb: "abc" },
      data: { message: "I hurt my knee" },
      query_string: "entry=chicken rice",
    },
    contexts: { runtime: { name: "node" }, response: { status_code: 500 }, state: { form: "secret" } },
    tags: { area: "jobs", url: "https://x.test/?token=1", "user.email": "ravi@example.com" },
    exception: {
      values: [{ type: "Error", value: "insert failed for ravi@example.com", stacktrace: { frames: [{ filename: "a.ts", vars: { body: "message text" } }] } }],
    },
    breadcrumbs: [
      { category: "console", message: "draft: I feel dizzy" },
      { category: "ui.input", message: "input[name=weight]" },
      { category: "fetch", data: { method: "POST", url: "/api/messages/1?x=2", status_code: 500, request_body: "hello coach" } },
      { category: "navigation", data: { from: "/invite/abc", to: "/account?code=1" } },
    ],
  };

  const out = scrubEvent(structuredClone(event));
  const sent = JSON.stringify(out);

  test("no person, body, header, cookie, query or local variable survives", () => {
    for (const leak of ["ravi@example.com", "1.2.3.4", "injury", "knee", "chicken", "sb-access-token", "Bearer xyz", "message text", "dizzy", "hello coach", "tok123", "abc", "secret"]) {
      assert.ok(!sent.includes(leak), `leaked ${leak}: ${sent}`);
    }
    assert.equal(out.user, undefined);
    assert.equal(out.extra, undefined);
    assert.deepEqual(out.request, { method: "POST", url: "https://www.talentyak.com/api/tracking" });
  });

  test("what remains is still useful for debugging", () => {
    assert.equal(out.transaction, "/waitlist/confirm/[token]");
    assert.deepEqual(out.contexts, { runtime: { name: "node" } });
    assert.deepEqual(out.tags, { area: "jobs" });
    assert.equal(out.exception?.values?.[0].stacktrace?.frames?.[0].filename, "a.ts");
    assert.equal(out.breadcrumbs?.length, 2, "console and typing breadcrumbs dropped");
    assert.deepEqual(out.breadcrumbs?.[0].data, { method: "POST", url: "/api/messages/1", status_code: 500 });
    assert.deepEqual(out.breadcrumbs?.[1].data, { from: "/invite/[token]", to: "/account" });
  });

  test("the original event object is not mutated", () => {
    assert.equal(event.user.email, "ravi@example.com");
  });

  test("a dropped breadcrumb category returns null", () => {
    assert.equal(scrubBreadcrumb({ category: "console", message: "x" }), null);
  });
});
