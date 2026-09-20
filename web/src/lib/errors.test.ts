import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyError, errorCodeOf } from "@/lib/errors";

test("a known code shows the hint we wrote", () => {
  assert.equal(
    friendlyError({ message: "coach_full", hint: "This coach has no free places right now." }),
    "This coach has no free places right now.",
  );
  assert.equal(errorCodeOf({ message: "coach_full" }), "coach_full");
});

test("an unknown database error never leaks its text", () => {
  const leaky = { message: 'duplicate key value violates unique constraint "providers_slug_key"', hint: "internal" };
  const shown = friendlyError(leaky);
  assert.ok(!shown.includes("providers_slug_key"));
  assert.equal(errorCodeOf(leaky), null);
});
