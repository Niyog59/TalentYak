import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What happened to an email after the provider accepted it.
 *
 * "Accepted" is all the worker can ever know at send time. Whether the message
 * was then DELIVERED, BOUNCED, or reported as SPAM arrives later from Resend as
 * a signed event, and this is where it is recorded — against the delivery row
 * the worker wrote, matched by Resend's message id.
 *
 * SIGNATURES. Resend signs events the Svix way: an HMAC-SHA256, keyed with the
 * base64 part of a `whsec_…` secret, over `${id}.${timestamp}.${rawBody}`. An
 * event is accepted only if one of the listed signatures matches in constant
 * time AND the timestamp is within five minutes, so a captured event cannot be
 * replayed tomorrow. With no secret configured the endpoint refuses everything
 * — it does not become an open door for anyone to mark our mail "delivered".
 *
 * NEVER BACKWARDS. Events can arrive out of order. A later "delivered" must not
 * overwrite an earlier "bounced", and nothing moves a row back to "accepted".
 */

const TOLERANCE_SECONDS = 5 * 60;

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifySvixSignature(args: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  body: string;
  nowSeconds?: number;
}): VerifyResult {
  const { secret, id, timestamp, signatureHeader, body } = args;
  if (!secret) return { ok: false, reason: "not configured" };
  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: "missing signature headers" };

  const ts = Number(timestamp);
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_SECONDS) return { ok: false, reason: "timestamp outside tolerance" };

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();

  // The header can carry several space-separated signatures, e.g. during key
  // rotation: "v1,abc= v1,def=". Any one matching is enough.
  for (const part of signatureHeader.split(" ")) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    const given = Buffer.from(value, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "signature mismatch" };
}

const STATE_FOR_EVENT: Record<string, "delivered" | "bounced" | "complained" | "failed"> = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

/** Which outcomes a later event may replace. Bounce, complaint and failure are final. */
const REPLACEABLE: Record<string, string[]> = {
  delivered: ["accepted", "uncertain"],
  bounced: ["accepted", "uncertain", "delivered"],
  complained: ["accepted", "uncertain", "delivered"],
  failed: ["accepted", "uncertain"],
};

export interface ResendEvent {
  type?: string;
  data?: { email_id?: string; bounce?: { message?: string; type?: string } };
}

/**
 * Applies one verified event. Returns what happened, for the response and the
 * tests; never throws on an event it does not care about.
 */
export async function applyResendEvent(event: ResendEvent): Promise<{ applied: boolean; reason: string }> {
  const state = event.type ? STATE_FOR_EVENT[event.type] : undefined;
  if (!state) return { applied: false, reason: `ignored ${event.type ?? "untyped"} event` };
  const messageId = event.data?.email_id;
  if (!messageId) return { applied: false, reason: "no message id" };

  const admin = createAdminClient();
  if (!admin) return { applied: false, reason: "database not configured" };

  // A bounce reason is useful to a person investigating; the recipient's
  // address is already on the row and is not copied from the event.
  const detail = state === "bounced" ? `${event.data?.bounce?.type ?? "bounce"}: ${event.data?.bounce?.message ?? ""}`.slice(0, 500) : null;

  const { data, error } = await admin
    .from("notification_deliveries")
    .update({ state, ...(detail ? { error: detail } : {}) })
    .eq("provider_message_id", messageId)
    .in("state", REPLACEABLE[state])
    .select("id");
  if (error) throw new Error(`delivery update failed: ${error.message}`);

  return data?.length ? { applied: true, reason: state } : { applied: false, reason: "no row in a state this event may replace" };
}
