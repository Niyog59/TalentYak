/**
 * Time-based one-time passwords (RFC 6238), for tests only.
 *
 * Admin access now requires a completed second factor (migration 0017). Test
 * admins therefore enrol a real TOTP factor with Supabase and answer its
 * challenge with a code computed here — exactly what an authenticator app does.
 * No MFA check is bypassed to make a test pass.
 */

import { createHmac } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

/** The 6-digit code for `secret` at time `at`. */
export function totp(secret: string, at: number = Date.now(), stepSeconds = 30, digits = 6): string {
  const counter = Math.floor(at / 1000 / stepSeconds);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];

  return String(binary % 10 ** digits).padStart(digits, "0");
}
