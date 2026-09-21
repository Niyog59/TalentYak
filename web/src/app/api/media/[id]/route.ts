import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { linkFor } from "@/lib/media";
import { mediaSession, UUID } from "@/lib/media/session";

/**
 * Viewing a file: an authorisation check, then a redirect to a two-minute link.
 *
 * Pages point <img> and <video> here rather than at storage, so no signed link
 * is ever written into HTML, a cache, or anything that saves the page. Each
 * view mints its own link at the moment it is needed, for the person asking.
 *
 * Refusal is a 404 whatever the reason — not signed in, not yours, not your
 * client, not ready yet — so the response does not confirm a file exists.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!UUID.test(id)) return notFound();

  const session = await mediaSession();
  if (!session) return notFound();

  const url = new URL(request.url);
  const which = url.searchParams.get("variant") === "preview" ? "preview" : "original";
  const supabase = (await createClient())!;
  const link = await linkFor(supabase, id, which, { download: url.searchParams.get("download") === "1" });
  if (!link) return notFound();

  return NextResponse.redirect(link.url, { status: 302, headers: { "Cache-Control": "no-store, private" } });
}
