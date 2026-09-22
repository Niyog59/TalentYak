import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";

/**
 * A plain-text copy of a conversation, for a participant who may read it.
 *
 * Read with the requester's own session, so the export shows exactly what the
 * conversation screen would — and nothing to anyone else. Refusal is a 404
 * whatever the reason. Attachments are listed, not included: they stay behind
 * their own short-lived links.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!UUID.test(id)) return notFound();

  const session = await getSession();
  if (!session || session.profile.suspended_at) return notFound();

  const limit = await rateLimit("message_export", session.userId, 10, 3600);
  if (!limit.allowed) {
    return new NextResponse("Too many downloads. Try again later.", { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }

  const supabase = (await createClient())!;
  const { data: status } = await supabase.rpc("conversation_status", { p_conversation: id });
  if (!status) return notFound();
  const s = status as { role: string; coach_name: string; client_name: string };
  const tz = session.profile.timezone ?? "UTC";
  const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  const lines: string[] = [
    `TalentYak conversation between ${s.client_name} (client) and ${s.coach_name} (coach)`,
    `Exported ${when(new Date().toISOString())}, times in ${tz}`,
    "",
  ];
  let after = 0;
  for (let page = 0; page < 100; page++) {
    const { data, error } = await supabase
      .from("messages")
      .select("seq, sender_profile_id, sender_role, body, media_asset_id, created_at")
      .eq("conversation_id", id)
      .gt("seq", after)
      .order("seq", { ascending: true })
      .limit(500);
    if (error) return new NextResponse("The copy couldn't be made. Try again.", { status: 500 });
    for (const m of data ?? []) {
      const who = m.sender_profile_id === session.userId ? "You" : m.sender_role === "coach" ? s.coach_name : s.client_name;
      lines.push(`[${when(m.created_at)}] ${who}:${m.media_asset_id ? " [photo or clip]" : ""}${m.body ? ` ${m.body}` : ""}`);
      after = Number(m.seq);
    }
    if ((data ?? []).length < 500) break;
  }

  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="talentyak-conversation-${id.slice(0, 8)}.txt"`,
      "Cache-Control": "no-store, private",
    },
  });
}
