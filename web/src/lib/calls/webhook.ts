import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Daily webhook deliveries: participant left, meeting ended.
 *
 * Daily signs each delivery with HMAC-SHA256 over `<X-Webhook-Timestamp>.<body>`
 * using the webhook's base64 secret, and sends the digest base64-encoded in
 * `X-Webhook-Signature`. A delivery whose signature does not verify is refused;
 * a verified one is applied once per event id (see `claim_call_provider_event`).
 *
 * Note: webhooks need a paid Daily plan. On the free plan nothing is ever
 * delivered here and attendance comes from the after-call fetch alone.
 */

export function signDailyWebhook(secretBase64: string, timestamp: string, body: string): string {
  return createHmac("sha256", Buffer.from(secretBase64, "base64")).update(`${timestamp}.${body}`).digest("base64");
}

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyDailyWebhook(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.secret) return { ok: false, reason: "not configured" };
  if (!input.timestamp || !input.signature) return { ok: false, reason: "missing signature headers" };
  if (input.body.length > 64 * 1024) return { ok: false, reason: "body too large" };
  if (equal(signDailyWebhook(input.secret, input.timestamp, input.body), input.signature)) return { ok: true };
  // Daily's reference computes the signature over JSON.stringify(event). For
  // a compact body that is the same bytes; for any other formatting, check the
  // canonical form too.
  try {
    const canonical = JSON.stringify(JSON.parse(input.body));
    if (canonical !== input.body && equal(signDailyWebhook(input.secret, input.timestamp, canonical), input.signature)) {
      return { ok: true };
    }
  } catch {
    // Not JSON: cannot be a genuine event.
  }
  return { ok: false, reason: "signature mismatch" };
}

export interface DailyWebhookEvent {
  id?: string;
  type?: string;
  version?: string;
  event_ts?: number;
  payload?: {
    room?: string;
    user_id?: string | null;
    session_id?: string;
    joined_at?: number;
    duration?: number;
    meeting_id?: string;
  };
  test?: string;
}

/** What to do with a verified event. Pure, so it is tested without a database. */
export type WebhookAction =
  | { kind: "ignore"; reason: string }
  | { kind: "verification" }
  | { kind: "attendance"; eventId: string; type: string; room: string; row: Record<string, unknown> }
  | { kind: "meeting_ended"; eventId: string; type: string; room: string };

const ROOM = /^ty-[0-9a-f]{32}$/;

export function webhookAction(event: DailyWebhookEvent): WebhookAction {
  if (event.test === "test") return { kind: "verification" };
  const room = event.payload?.room ?? "";
  if (!event.id || !event.type) return { kind: "ignore", reason: "no id or type" };
  // Only rooms this app made. Anything else on the account is not ours to record.
  if (!ROOM.test(room)) return { kind: "ignore", reason: "not a session room" };

  if (event.type === "participant.left") {
    const p = event.payload!;
    if (!p.user_id || !p.session_id || typeof p.joined_at !== "number" || typeof p.duration !== "number") {
      return { kind: "ignore", reason: "incomplete participant event" };
    }
    return {
      kind: "attendance",
      eventId: event.id,
      type: event.type,
      room,
      row: { meeting_id: null, participant_id: p.session_id, user_id: p.user_id, joined_at: p.joined_at, duration: p.duration },
    };
  }
  if (event.type === "meeting.ended") return { kind: "meeting_ended", eventId: event.id, type: event.type, room };
  return { kind: "ignore", reason: `unhandled type ${event.type}` };
}
