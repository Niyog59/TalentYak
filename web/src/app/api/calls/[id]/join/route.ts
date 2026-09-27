import { NextResponse } from "next/server";
import { getSession, isOnboarded } from "@/lib/auth";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { requestCallJoin } from "@/lib/calls/join";

/**
 * A join pass for one session's private call, for the signed-in person.
 *
 * The body may say `{ "audioOnly": true }` and nothing else is read from it:
 * the room, the identity, the display name and every privilege are decided on
 * the server. The pass is returned only in this response, never stored, never
 * logged, and it expires within minutes.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const o = new URL(origin);
    const self = new URL(request.url);
    return o.host === self.host || o.origin === new URL(env.siteUrl).origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const refuse = (status: number, reason: string, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ ok: false, reason, ...extra }, { status, headers: NO_STORE });

  if (!UUID.test(id)) return refuse(404, "not_found");
  if (!sameOrigin(request)) return refuse(403, "not_found");

  const session = await getSession();
  if (!session || !isOnboarded(session)) return refuse(401, "sign_in_required");
  if (session.profile.suspended_at) return refuse(403, "suspended");

  // Belt and braces with the per-session limit in the database: this one
  // covers a person hammering many sessions.
  const limit = await rateLimit("call_join", session.userId, 60, 600);
  if (!limit.allowed) return refuse(429, "rate_limited", { retryAfterSeconds: limit.retryAfterSeconds });

  let audioOnly = false;
  try {
    const body = (await request.json()) as { audioOnly?: unknown };
    audioOnly = body?.audioOnly === true;
  } catch {
    audioOnly = false;
  }

  const result = await requestCallJoin(id, audioOnly);
  if (!result.ok) {
    const { status, ...rest } = result;
    return NextResponse.json(rest, { status, headers: NO_STORE });
  }
  return NextResponse.json(result, { headers: NO_STORE });
}
