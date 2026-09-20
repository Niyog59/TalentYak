import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "@/lib/redirects";

test("accepts same-site paths, including query and hash", () => {
  assert.equal(safeNextPath("/coach/offers"), "/coach/offers");
  assert.equal(safeNextPath("/checkout/abc?currency=USD#top"), "/checkout/abc?currency=USD#top");
});

test("refuses every shape of off-site redirect", () => {
  const tab = String.fromCharCode(9);
  const backslash = String.fromCharCode(92);
  for (const bad of [
    "https://evil.example",
    "http://evil.example",
    "//evil.example",
    `/${backslash}evil.example`,
    `${backslash}${backslash}evil.example`,
    "javascript:alert(1)",
    "evil.example",
    `/${tab}/evil.example`,
    "",
    "   ",
    "/auth/callback?code=x",
    "x".repeat(600),
  ]) {
    assert.equal(safeNextPath(bad), "/account", JSON.stringify(bad));
  }
});

test("non-strings fall back", () => {
  assert.equal(safeNextPath(null), "/account");
  assert.equal(safeNextPath(undefined, "/coach"), "/coach");
});
