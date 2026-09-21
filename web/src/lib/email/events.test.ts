import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { verifySvixSignature } from "@/lib/email/events";

/**
 * The delivery-event endpoint decides whether an email is recorded as
 * delivered or bounced. If its signature check were wrong in either direction,
 * the founder console would either miss every bounce or believe a forger.
 */

const secretBytes = Buffer.from("a-test-signing-key-not-a-real-one");
const SECRET = `whsec_${secretBytes.toString("base64")}`;
const NOW = 1_790_000_000;

function sign(id: string, ts: number, body: string, key = secretBytes) {
  return `v1,${createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")}`;
}

const body = JSON.stringify({ type: "email.delivered", data: { email_id: "msg_1" } });

describe("delivery events from the email provider", () => {
  test("a correctly signed, current event is accepted", () => {
    const r = verifySvixSignature({ secret: SECRET, id: "evt_1", timestamp: String(NOW), signatureHeader: sign("evt_1", NOW, body), body, nowSeconds: NOW });
    assert.deepEqual(r, { ok: true });
  });

  test("any one of several signatures (key rotation) is enough", () => {
    const header = `v1,${Buffer.alloc(32).toString("base64")} ${sign("evt_1", NOW, body)}`;
    assert.equal(verifySvixSignature({ secret: SECRET, id: "evt_1", timestamp: String(NOW), signatureHeader: header, body, nowSeconds: NOW }).ok, true);
  });

  test("a body changed after signing is refused", () => {
    const forged = body.replace("delivered", "bounced");
    const r = verifySvixSignature({ secret: SECRET, id: "evt_1", timestamp: String(NOW), signatureHeader: sign("evt_1", NOW, body), body: forged, nowSeconds: NOW });
    assert.equal(r.ok, false);
  });

  test("an event signed with another key is refused", () => {
    const r = verifySvixSignature({ secret: SECRET, id: "evt_1", timestamp: String(NOW), signatureHeader: sign("evt_1", NOW, body, Buffer.from("someone else")), body, nowSeconds: NOW });
    assert.equal(r.ok, false);
  });

  test("a captured event replayed later is refused", () => {
    const r = verifySvixSignature({ secret: SECRET, id: "evt_1", timestamp: String(NOW), signatureHeader: sign("evt_1", NOW, body), body, nowSeconds: NOW + 3600 });
    assert.deepEqual(r, { ok: false, reason: "timestamp outside tolerance" });
  });

  test("with no secret configured, nothing is accepted", () => {
    const r = verifySvixSignature({ secret: "", id: "evt_1", timestamp: String(NOW), signatureHeader: sign("evt_1", NOW, body), body, nowSeconds: NOW });
    assert.equal(r.ok, false);
  });

  test("missing headers are refused rather than assumed", () => {
    assert.equal(verifySvixSignature({ secret: SECRET, id: null, timestamp: String(NOW), signatureHeader: "v1,x", body, nowSeconds: NOW }).ok, false);
  });
});
