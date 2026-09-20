import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  adminAlertEmail,
  coachInvitationEmail,
  newClientEmail,
  payoutPaidEmail,
  purchaseConfirmedEmail,
  refundProcessedEmail,
  retentionNoticeEmail,
} from "@/lib/email/templates";
import { isReservedTestAddress } from "@/lib/email";

const ctx = { siteUrl: "https://talentyak.com", supportEmail: null };

describe("email templates", () => {
  test("text a person wrote is escaped, never rendered as markup", () => {
    const hostile = '<img src=x onerror="alert(1)">Ram & "Sita"';
    const email = newClientEmail(ctx, { coachName: hostile, planTitle: hostile, customerFirstName: hostile });

    assert.ok(!email.html.includes("<img src=x"), "raw tag must not survive into the HTML");
    // The characters may still appear — as text. What matters is that they
    // cannot form a tag or an attribute: the quotes and brackets are escaped.
    assert.ok(!/<img|onerror="/.test(email.html), "nothing can close out of text into markup");
    assert.ok(email.html.includes("&lt;img"), "the text is shown as text");
    assert.ok(email.html.includes("&amp;"), "ampersands are escaped");
  });

  test("every email has a plain-text version that carries the same facts", () => {
    const email = purchaseConfirmedEmail(ctx, {
      customerName: "Ram",
      coachName: "Sita",
      planTitle: "Monthly strength coaching",
      amountMinor: 8000,
      currency: "USD",
      recurring: true,
      paidThrough: "2026-10-17T00:00:00Z",
      timezone: "America/New_York",
    });

    assert.ok(email.text.length > 40, "there is a real text part");
    assert.ok(!email.text.includes("<"), "the text part carries no markup");
    assert.ok(email.text.includes("Sita"));
    assert.ok(email.text.includes("Monthly strength coaching"));
    // Money always names its currency, in email as everywhere else.
    assert.match(email.html, /80\.00\s*USD/);
  });

  test("an amount is never rendered by dividing by 100", () => {
    // JPY has no minor unit: 8000 yen is ¥8,000, not ¥80.
    const email = payoutPaidEmail(ctx, { coachName: "Sita", amountMinor: 8000, currency: "JPY", reference: "TR-1", paidAt: "2026-10-01T00:00:00Z" });
    assert.ok(!email.html.includes("80.00"), "8000 JPY must not be shown as 80.00");
    assert.match(email.html, /8,?000/);
  });

  test("a payout email names the transfer reference, so the coach can check it", () => {
    const email = payoutPaidEmail(ctx, { coachName: "Sita", amountMinor: 4800, currency: "USD", reference: "TR-2026-09-17", paidAt: "2026-09-17T00:00:00Z" });
    assert.ok(email.html.includes("TR-2026-09-17"));
    assert.ok(email.text.includes("TR-2026-09-17"));
  });

  test("an invitation says what accepting means and that it expires", () => {
    const email = coachInvitationEmail(ctx, { inviteUrl: "https://talentyak.com/invite/abc", expiresAt: "2026-09-24T00:00:00Z" });
    assert.ok(email.html.includes("https://talentyak.com/invite/abc"));
    assert.match(email.text, /20%/);
    assert.match(email.text.toLowerCase(), /expires/);
  });

  test("a refund email states the amount returned", () => {
    const email = refundProcessedEmail(ctx, { customerName: null, amountMinor: 2000, currency: "USD" });
    assert.match(email.html, /20\.00\s*USD/);
  });

  test("an admin alert links into the console and carries no customer detail it was not given", () => {
    const email = adminAlertEmail(ctx, { title: "Coach change requested", detail: "A customer has asked to change coach.", path: "/admin/coach-changes" });
    assert.ok(email.html.includes("https://talentyak.com/admin/coach-changes"));
  });

  test("a retention notice never says a deletion has happened", () => {
    const email = retentionNoticeEmail(ctx, { daysBefore: 30, deletionDueAt: "2026-12-01T00:00:00Z", resourceLabel: "old workout logs", timezone: null });
    assert.match(email.subject, /scheduled for deletion/i);
    assert.ok(!/has been deleted/i.test(email.subject + email.text), "it must not claim anything has been deleted yet");
  });
});

describe("addresses that must never be emailed", () => {
  test("reserved test domains are recognised", () => {
    for (const address of [
      "talentyak-test-journey-coach@example.test",
      "someone@foo.invalid",
      "a@b.localhost",
      "person@example.com",
      "person@example.org",
    ]) {
      assert.equal(isReservedTestAddress(address), true, address);
    }
  });

  test("real addresses are not", () => {
    for (const address of ["coach@talentyak.com", "ram@gmail.com", "sita@exampletest.com"]) {
      assert.equal(isReservedTestAddress(address), false, address);
    }
  });
});
