import { after, NextResponse } from "next/server";
import { completeUpload } from "@/lib/media";
import { mediaSession, UUID } from "@/lib/media/session";

/**
 * The browser says an upload finished. We confirm the file is really there,
 * then process it after responding — the person sees "processing" at once and
 * the page updates when it is done.
 *
 * `maxDuration` covers the processing that runs after the response: a clip at
 * the size cap takes tens of seconds to re-encode on one CPU.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const session = await mediaSession();
  if (!session) return NextResponse.json({ error: "Sign in to upload." }, { status: 401 });

  let id: unknown;
  try {
    ({ id } = await request.json());
  } catch {
    return NextResponse.json({ error: "That request couldn't be read." }, { status: 400 });
  }
  if (typeof id !== "string" || !UUID.test(id)) return NextResponse.json({ error: "Unknown upload." }, { status: 400 });

  const result = await completeUpload(session.userId, id);
  if (result === "not_yours") return NextResponse.json({ error: "Unknown upload." }, { status: 404 });
  if (result === "missing") {
    return NextResponse.json({ error: "The file didn't finish uploading. Try that upload again." }, { status: 409 });
  }

  after(async () => {
    const { processMedia } = await import("@/lib/media/process");
    await processMedia(id as string).catch((err) =>
      console.error("[media] processing crashed:", err instanceof Error ? err.message : err),
    );
  });

  return NextResponse.json({ state: "uploaded" }, { headers: { "Cache-Control": "no-store" } });
}
