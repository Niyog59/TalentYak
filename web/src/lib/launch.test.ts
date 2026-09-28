import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decidePurchaseMode } from "@/lib/launch";
import { availabilityText, packageAction, renewalText } from "@/lib/offers/presentation";
import { validSubject } from "@/lib/site-events";
import { safeNextPath } from "@/lib/redirects";

const base = { liveFlag: false, development: false, isAdmin: false, email: null, testers: [] as string[] };

describe("who may buy", () => {
  test("test mode is closed to the public and open only to protected testers", () => {
    assert.equal(decidePurchaseMode({ ...base, stripe: "test" }), "closed");
    assert.equal(decidePurchaseMode({ ...base, stripe: "test", development: true }), "test");
    assert.equal(decidePurchaseMode({ ...base, stripe: "test", isAdmin: true }), "test");
    assert.equal(decidePurchaseMode({ ...base, stripe: "test", email: "Tester@Example.com", testers: ["tester@example.com"] }), "test");
    assert.equal(decidePurchaseMode({ ...base, stripe: "test", email: "someone@example.com", testers: ["tester@example.com"] }), "closed");
  });

  test("live keys alone never open buying; the live-billing flag is also needed", () => {
    assert.equal(decidePurchaseMode({ ...base, stripe: "live" }), "closed");
    assert.equal(decidePurchaseMode({ ...base, stripe: "live", isAdmin: true, development: true }), "closed");
    assert.equal(decidePurchaseMode({ ...base, stripe: "live", liveFlag: true }), "live");
    assert.equal(decidePurchaseMode({ ...base, stripe: "unconfigured", development: true }), "closed");
  });
});

describe("the package button", () => {
  const coach = { availability: "available" as const, awayUntil: null, display_name: "Maya" };
  const monthly = { service_type: "recurring_coaching" as const, call_duration_minutes: null, programme_included: true, calls_included_per_month: null, check_in_cadence: "weekly", messaging_channel: "in_app", form_review_included: false };

  test("Choose only when the coach has room, has published expectations, and this person may buy", () => {
    assert.deepEqual(packageAction({ coach, plan: monthly, mode: "test", expectationsPublished: true }), { kind: "choose" });
    assert.equal(packageAction({ coach, plan: monthly, mode: "closed", expectationsPublished: true }).kind, "waitlist");
    assert.equal(packageAction({ coach, plan: monthly, mode: "test", expectationsPublished: false }).kind, "waitlist");
    for (const availability of ["full", "away", "not_accepting"] as const) {
      const r = packageAction({ coach: { ...coach, availability }, plan: monthly, mode: "test", expectationsPublished: true });
      assert.equal(r.kind, "waitlist", availability);
    }
  });

  test("live mode still refuses a package the product can't deliver (the sale locks)", () => {
    // Live billing needs the flag, approved policies and final legal text; none are set in tests.
    assert.equal(packageAction({ coach, plan: monthly, mode: "live", expectationsPublished: true }).kind, "waitlist");
  });

  test("honest words for renewal and availability", () => {
    assert.equal(renewalText({ service_type: "recurring_coaching", billing_interval: "month", billing_interval_count: 1 }), "Renews automatically every month until you cancel.");
    assert.equal(renewalText({ service_type: "one_off_consultation", billing_interval: null, billing_interval_count: null }), "One payment. Nothing renews.");
    assert.equal(availabilityText({ availability: "away", awayUntil: "2026-10-12" }), "Away until 12 October");
    assert.equal(availabilityText({ availability: "full", awayUntil: null }), "Full right now");
  });
});

describe("public counters", () => {
  test("only a page kind, slug or id — never free text, an email or a path", () => {
    assert.equal(validSubject("page_view", "home"), true);
    assert.equal(validSubject("page_view", "account"), false);
    assert.equal(validSubject("coach_profile_view", "maya-gurung"), true);
    assert.equal(validSubject("coach_profile_view", "someone@example.com"), false);
    assert.equal(validSubject("package_selected", "/checkout/x?y=1"), false);
  });
});

describe("keeping a chosen package through sign-up", () => {
  test("checkout → onboarding → confirmation link → back to the same package and currency", () => {
    const checkout = "/checkout/0b6a3c1e-1111-4222-8333-444455556666?currency=USD";
    const onboarding = safeNextPath(`/account/onboarding?next=${encodeURIComponent(checkout)}`);
    const viaEmail = new URL(`https://x/auth/callback?next=${encodeURIComponent(onboarding)}`).searchParams.get("next");
    const back = new URL(`https://x${safeNextPath(viaEmail)}`).searchParams.get("next");
    assert.equal(safeNextPath(back), checkout);
    assert.equal(safeNextPath("https://evil.example/checkout/x"), "/account");
  });
});
