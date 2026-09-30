import { test } from "node:test";
import assert from "node:assert/strict";
import { COACH_AGREEMENT_VERSION, coachAgreement, coachTerms } from "@/lib/coach-agreement";
import { commissionBasisPointsFor, currentCommissionPolicy } from "@/lib/policy";

test("the agreement's rates come from the policy register, not typed-in numbers", () => {
  const policy = currentCommissionPolicy();
  const t = coachTerms();
  assert.equal(t.ongoingCommission, `${commissionBasisPointsFor(policy, "recurring_coaching") / 100}%`);
  assert.equal(t.oneOffCoachShare, `${(10_000 - commissionBasisPointsFor(policy, "one_off_consultation")) / 100}%`);
  const text = coachAgreement().sections.flatMap((s) => s.points).join(" ");
  assert.ok(text.includes(t.ongoingCoachShare) && text.includes(t.ongoingCommission));
});

test("the worked example matches the confirmed fixture (USD 100 → coach 80, platform 20)", () => {
  const { example } = coachTerms();
  assert.match(example.price, /100/);
  assert.match(example.coach, /80/);
  assert.match(example.platform, /20/);
});

test("the agreement is honestly a draft, versioned, and lists what isn't decided", () => {
  const a = coachAgreement();
  assert.equal(a.approved, false);
  assert.match(COACH_AGREEMENT_VERSION, /draft/);
  assert.ok(a.stillBeingConfirmed.some((s) => /Nepal/.test(s)));
  assert.ok(a.stillBeingConfirmed.some((s) => /legal/i.test(s)));
});

test("the agreement covers what coaches must do, including healthcare referral and privacy", () => {
  const text = coachAgreement().sections.flatMap((s) => s.points).join(" ");
  assert.match(text, /healthcare professional/);
  assert.match(text, /private/);
  assert.match(text, /independent contractor/);
  assert.match(text, /doesn't guarantee you any clients/);
});
