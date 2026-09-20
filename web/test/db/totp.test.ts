// Verifies the TOTP helper against the RFC 6238 SHA-1 test vectors, so a
// failing MFA test can never be caused by a wrong code generator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { totp } from "./totp.ts";

// "12345678901234567890" in base32
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("matches RFC 6238 SHA-1 vectors (8 digits)", () => {
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ];
  for (const [seconds, expected] of vectors) {
    assert.equal(totp(SECRET, seconds * 1000, 30, 8), expected, `t=${seconds}`);
  }
});
