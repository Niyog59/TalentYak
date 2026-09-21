import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { mediaSession, UUID } from "@/lib/media/session";

/**
 * The owner asking for processing to be tried again. The database decides
 * whether that is allowed — only their own file, only a failure that retrying
 * could fix, only while the original is still held, only five times.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await mediaSession();
  if (!session) return NextResponse.json({ error: "Sign in again." }, { status: 401 });

  const limit = await rateLimit("media_retry", session.userId, 20, 3600);
  if (!limit.allowed) return NextResponse.json({ error: "Too many retries. Try again later." }, { status: 429 });

  let id: unknown;
  try {
    ({ id } = await request.json());
  } catch {
    return NextResponse.json({ error: "That request couldn't be read." }, { status: 400 });
  }
  if (typeof id !== "string" || !UUID.test(id)) return NextResponse.json({ error: "Unknown file." }, { status: 400 });

  // As the person, so request_media_retry checks it is theirs.
  const supabase = (await createClient())!;
  const { data: queued, error } = await supabase.rpc("request_media_retry", { p_id: id });
  if (error || !queued) {
    return NextResponse.json({ error: "That file can't be retried. Delete it and upload it again." }, { status: 409 });
  }

  after(async () => {
    const { processMedia } = await import("@/lib/media/process");
    await processMedia(id as string).catch((err) =>
      console.error("[media] processing crashed:", err instanceof Error ? err.message : err),
    );
  });

  return NextResponse.json({ state: "uploaded" }, { headers: { "Cache-Control": "no-store" } });
}
