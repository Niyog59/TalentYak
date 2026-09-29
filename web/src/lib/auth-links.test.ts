import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESET_PASSWORD_PATH,
  classifyVerifyError,
  failureMessage,
  isPlausibleTokenHash,
  nextFromRedirectTo,
  parseLinkType,
} from "@/lib/auth-links";

const SITE = "https://www.talentyak.com";

test("only the link kinds TalentYak sends are accepted", () => {
  assert.equal(parseLinkType("email"), "email");
  assert.equal(parseLinkType("recovery"), "recovery");
  for (const other of ["invite", "email_change", "signup", "magiclink", "RECOVERY", "", null, undefined, ["recovery"]]) {
    assert.equal(parseLinkType(other), null);
  }
});

test("token hashes are shape-checked before reaching the auth server", () => {
  assert.equal(isPlausibleTokenHash("pkce_" + "a".repeat(56)), true);
  assert.equal(isPlausibleTokenHash("0123456789abcdef0123456789abcdef"), true);
  for (const bad of ["", "short", "a".repeat(129), "abc def ghi jkl mno pqr", "a/b".repeat(10), 42, null]) {
    assert.equal(isPlausibleTokenHash(bad), false);
  }
});

test("a reset link always lands on the new-password page, whatever it says", () => {
  assert.equal(nextFromRedirectTo("recovery", `${SITE}/auth/callback?next=%2Fadmin`, SITE), RESET_PASSWORD_PATH);
  assert.equal(nextFromRedirectTo("recovery", "https://evil.example/", SITE), RESET_PASSWORD_PATH);
});

test("a confirmation link keeps the person's same-site destination", () => {
  const next = encodeURIComponent("/account/onboarding?next=%2Fcheckout%2Fabc");
  assert.equal(nextFromRedirectTo("email", `${SITE}/auth/callback?next=${next}`, SITE), "/account/onboarding?next=%2Fcheckout%2Fabc");
  // Supabase may pass it back decoded once, depending on template escaping.
  assert.equal(nextFromRedirectTo("email", `${SITE}/auth/callback?next=/account/onboarding`, SITE), "/account/onboarding");
});

test("a confirmation link never redirects off-site or into an auth route", () => {
  for (const redirectTo of [
    "https://evil.example/auth/callback?next=%2Faccount",
    `${SITE}/auth/callback?next=https%3A%2F%2Fevil.example`,
    `${SITE}/auth/callback?next=%2F%2Fevil.example`,
    `${SITE}/auth/callback?next=%2Fauth%2Fconfirm`,
    `${SITE}/auth/callback`,
    "not a url",
    "",
    undefined,
    "x".repeat(3000),
  ]) {
    assert.equal(nextFromRedirectTo("email", redirectTo, SITE), "/account", String(redirectTo).slice(0, 60));
  }
});

test("failures are told apart only where it helps the person", () => {
  assert.equal(classifyVerifyError({ code: "otp_expired", status: 403 }), "used_or_expired");
  assert.equal(classifyVerifyError({ status: 403 }), "used_or_expired");
  assert.equal(classifyVerifyError({ code: "over_request_rate_limit", status: 429 }), "rate_limited");
  assert.equal(classifyVerifyError({ code: "validation_failed", status: 400 }), "incomplete");
  assert.equal(classifyVerifyError({ status: 502 }), "unavailable");
  assert.equal(classifyVerifyError({ name: "AuthRetryableFetchError", status: 0 }), "unavailable");
  assert.equal(classifyVerifyError(null), "unavailable");
});

test("messages don't call every failure 'expired' or mention an account's existence", () => {
  assert.match(failureMessage("recovery", "used_or_expired"), /new one/);
  assert.match(failureMessage("email", "used_or_expired"), /sign in/);
  assert.doesNotMatch(failureMessage("email", "incomplete"), /expired|too old/);
  assert.doesNotMatch(failureMessage("email", "unavailable"), /expired|too old/);
  assert.match(failureMessage("email", "unavailable"), /hasn't been used/);
  for (const type of ["email", "recovery"] as const) {
    for (const f of ["used_or_expired", "incomplete", "rate_limited", "unavailable"] as const) {
      assert.doesNotMatch(failureMessage(type, f), /no account|not registered|doesn't exist/i);
    }
  }
});
