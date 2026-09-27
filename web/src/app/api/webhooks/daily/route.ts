import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyDailyWebhook, webhookAction, type DailyWebhookEvent } from "@/lib/calls/webhook";

/**
 * Daily call events: who left a session room and when, and when a meeting
 * ended. Used only to record attendance — never to decide that a session was
 * delivered, and never to move money.
 *
 * FAILS CLOSED. Without DAILY_WEBHOOK_SECRET it refuses every request (503).
 * Each event is applied once per event id, so a redelivery changes nothing.
 * Webhooks need a paid Daily plan; on the free plan attendance comes from the
 * after-call fetch instead.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = env.dailyWebhookSecret;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const body = await req.text();
  const verdict = verifyDailyWebhook({
    secret,
    timestamp: req.headers.get("x-webhook-timestamp"),
    signature: req.headers.get("x-webhook-signature"),
    body,
  });
  if (!verdict.ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let event: DailyWebhookEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const action = webhookAction(event);
  if (action.kind === "verification") return NextResponse.json({ ok: true });
  if (action.kind === "ignore") return NextResponse.json({ ok: true, ignored: action.reason });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Try again" }, { status: 500 });

  const { data: room } = await admin.from("call_rooms").select("id").eq("room_name", action.room).maybeSingle();
  if (!room) return NextResponse.json({ ok: true, ignored: "unknown room" });

  // The work first — it is idempotent on its own (attendance is unique per
  // provider participant session; the fetch job has a dedupe key) — and the
  // event is marked as handled only once it succeeded. A failure answers 500,
  // so Daily delivers it again.
  if (action.kind === "attendance") {
    const { error } = await admin.rpc("record_call_attendance", {
      p_room: room.id, p_rows: [action.row], p_source: "provider_webhook", p_complete: false,
    });
    if (error) {
      console.error("[daily-events] attendance not recorded:", error.message);
      return NextResponse.json({ error: "Try again" }, { status: 500 });
    }
  } else {
    // The full record, fetched from the provider shortly after the meeting ends.
    const { error } = await admin.rpc("enqueue_outbox", {
      p_topic: "call.fetch_attendance",
      p_payload: { room_id: room.id },
      p_dedupe_key: `call_attendance:${room.id}:${action.eventId}`,
      p_scheduled_for: new Date(Date.now() + 60_000).toISOString(),
      p_expires_at: null,
    });
    if (error) {
      console.error("[daily-events] attendance fetch not queued:", error.message);
      return NextResponse.json({ error: "Try again" }, { status: 500 });
    }
  }

  const { data: claim } = await admin.rpc("claim_call_provider_event", {
    p_event_id: action.eventId, p_type: action.type, p_room_name: action.room,
  });
  if (claim && (claim as { new: boolean }).new === false) return NextResponse.json({ ok: true, duplicate: true });
  return NextResponse.json({ ok: true });
}
