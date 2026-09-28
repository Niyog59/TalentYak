import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { createUpload, UploadRefused } from "@/lib/media";
import { mediaSession, UUID } from "@/lib/media/session";

/**
 * Starts an upload: reserves a row and returns a single-use token for one path
 * in the private holding area. No file passes through this route — the
 * browser sends the bytes straight to storage afterwards.
 */
export const dynamic = "force-dynamic";

const PURPOSES = new Set(["progress_photo", "form_review_clip", "chat_attachment", "food_photo", "checkin_attachment"]);

export async function POST(request: Request) {
  const session = await mediaSession();
  if (!session) return NextResponse.json({ error: "Sign in to upload." }, { status: 401 });

  const limit = await rateLimit("media_upload", session.userId, 30, 3600);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "That's a lot of uploads in one go. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: { purpose?: unknown; enrollmentId?: unknown; kind?: unknown; bytes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That request couldn't be read." }, { status: 400 });
  }

  const purpose = String(body.purpose ?? "progress_photo");
  const kind = body.kind === "image" || body.kind === "video" ? body.kind : null;
  const enrollmentId = typeof body.enrollmentId === "string" && UUID.test(body.enrollmentId) ? body.enrollmentId : null;
  if (!PURPOSES.has(purpose) || !kind) {
    return NextResponse.json({ error: "Upload a photo or a video." }, { status: 400 });
  }

  try {
    const ticket = await createUpload({
      // The owner is the SESSION. A client that could name the owner could
      // file media into somebody else's history.
      ownerProfileId: session.userId,
      enrollmentId,
      purpose: purpose as "progress_photo" | "form_review_clip" | "chat_attachment" | "food_photo" | "checkin_attachment",
      kind,
      bytes: Number(body.bytes),
    });
    return NextResponse.json(ticket, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof UploadRefused) return NextResponse.json({ error: err.message }, { status: 422 });
    console.error("[media] upload could not start:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "That upload couldn't be started. Please try again." }, { status: 500 });
  }
}
