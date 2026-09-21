import { NextResponse } from "next/server";
import { applyResendEvent, verifySvixSignature, type ResendEvent } from "@/lib/email/events";

/**
 * Resend delivery events: delivered, bounced, complained, failed.
 *
 * FAILS CLOSED. Without RESEND_WEBHOOK_SECRET it refuses every request, rather
 * than letting anyone on the internet mark our mail as delivered. The body is
 * read raw, because the signature covers the exact bytes sent.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET ?? "";
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const body = await req.text();
  const verdict = verifySvixSignature({
    secret,
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signatureHeader: req.headers.get("svix-signature"),
    body,
  });
  if (!verdict.ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let event: ResendEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const result = await applyResendEvent(event);
    return NextResponse.json(result);
  } catch (err) {
    // A 5xx asks Resend to deliver the event again later.
    console.error("[resend-events] could not record:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Try again" }, { status: 500 });
  }
}
