import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEATURES,
  checkChange,
  defaultModes,
  effectiveAvailability,
  featureSpec,
  modeAllows,
  type FeatureModes,
  type Readiness,
} from "@/lib/features/registry";

const BUILT: Readiness = { state: "built", blockers: [] };
const NO_PREREQS = { unresolvedPrerequisites: [] };
const modes = (over: Partial<FeatureModes> = {}): FeatureModes => ({ ...defaultModes(), ...over });

test("launch defaults: everything that exists stays on, changing coach starts off", () => {
  const d = defaultModes();
  assert.equal(d.coach_changing, "off");
  for (const f of FEATURES.filter((x) => x.key !== "coach_changing")) assert.equal(d[f.key], "on", f.key);
});

test("security, sign-in, permissions, payments' live gate and history are not switchable", () => {
  const keys = FEATURES.map((f) => f.key as string);
  for (const forbidden of ["auth", "mfa", "admin", "rls", "live_billing", "audit", "history", "security"]) {
    assert.ok(!keys.some((k) => k.includes(forbidden)), forbidden);
  }
});

test("a mode a feature doesn't support is refused, and nobody gets a meaningless mode", () => {
  assert.ok(checkChange(modes(), "public_profiles", "read_only", BUILT, NO_PREREQS).errors.length);
  assert.ok(checkChange(modes(), "calls", "read_only", BUILT, NO_PREREQS).errors.length);
  assert.deepEqual(featureSpec("waitlist").modes.map((m) => m.mode).sort(), ["off", "on"]);
});

test("an unresolved policy decision blocks the mode it guards, and only that mode", () => {
  const ctx = { unresolvedPrerequisites: [{ feature: "coach_changing" as const, blocksMode: "on" as const, description: "OPEN-08" }] };
  assert.match(checkChange(modes(), "coach_changing", "on", BUILT, ctx).errors.join(" "), /policy decision/);
  assert.deepEqual(checkChange(modes(), "coach_changing", "test_only", BUILT, ctx).errors, []);
});

test("bookings can't be more open than calls, in either direction of change", () => {
  // Turning calls off while bookings are on would book sessions nobody can join.
  assert.match(checkChange(modes(), "calls", "off", BUILT, NO_PREREQS).errors.join(" "), /Session bookings/);
  // Once bookings are paused, calls can go off.
  assert.deepEqual(checkChange(modes({ bookings: "read_only" }), "calls", "off", BUILT, NO_PREREQS).errors, []);
  // And bookings can't be reopened for everyone while calls are test-only.
  assert.ok(checkChange(modes({ bookings: "read_only", calls: "test_only" }), "bookings", "on", BUILT, NO_PREREQS).errors.length);
  assert.deepEqual(checkChange(modes({ bookings: "read_only", calls: "test_only" }), "bookings", "test_only", BUILT, NO_PREREQS).errors, []);
});

test("new purchases rely on public profiles", () => {
  assert.ok(checkChange(modes(), "public_profiles", "off", BUILT, NO_PREREQS).errors.length);
  assert.deepEqual(checkChange(modes({ new_sales: "off" }), "public_profiles", "off", BUILT, NO_PREREQS).errors, []);
});

test("closing the waitlist while nobody can buy is allowed but warned about", () => {
  const c = checkChange(modes({ new_sales: "off" }), "waitlist", "off", BUILT, NO_PREREQS);
  assert.deepEqual(c.errors, []);
  assert.ok(c.warnings.length);
});

test("switching on can't complete setup: it is allowed with a warning, and what people get stays 'setup incomplete'", () => {
  const needs: Readiness = { state: "needs_setup", blockers: ["Daily payment method"] };
  const c = checkChange(modes({ calls: "off", bookings: "read_only" }), "calls", "on", needs, NO_PREREQS);
  assert.deepEqual(c.errors, []);
  assert.ok(c.warnings[0].includes("Daily"));
  assert.match(effectiveAvailability("on", needs).label, /setup incomplete/);
});

test("an unbuilt feature can't be switched on", () => {
  assert.ok(checkChange(modes({ messaging: "off" }), "messaging", "on", { state: "not_built", blockers: [] }, NO_PREREQS).errors.length);
});

test("reducing what people can do needs a confirmation; routine reopening doesn't", () => {
  assert.equal(checkChange(modes(), "messaging", "read_only", BUILT, NO_PREREQS).highImpact, true);
  assert.equal(checkChange(modes({ messaging: "read_only" }), "messaging", "on", BUILT, NO_PREREQS).highImpact, false);
});

test("test-accounts-only lets listed accounts through and nobody else", () => {
  assert.equal(modeAllows("test_only", true), true);
  assert.equal(modeAllows("test_only", false), false);
  assert.equal(modeAllows("read_only", true), false);
  assert.equal(modeAllows("on", false), true);
});

test("every mode says what it does, and emergency modes are marked as such", () => {
  for (const f of FEATURES) {
    for (const m of f.modes) assert.ok(m.explanation.length > 20, `${f.key}:${m.mode}`);
    assert.ok(f.existingWork.length > 10, f.key);
  }
  assert.equal(featureSpec("calls").modes.find((m) => m.mode === "off")?.kind, "emergency");
  assert.equal(featureSpec("new_sales").modes.find((m) => m.mode === "off")?.kind, "normal", "stopping sales never ends paid coaching");
});
