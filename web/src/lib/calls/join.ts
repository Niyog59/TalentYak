import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env, isDailyConfigured } from "@/lib/env";
import { dailyClient, type DailyClient } from "@/lib/calls/daily";

/**
 * Asking to join a session's call.
 *
 * The database decides (as the signed-in person, in `call_join_request`):
 * are they one of the two people on it, is it still confirmed and eligible,
 * is the room open, have they asked too often. Only then does the server go to
 * the provider — to create the room the first time, and to sign a pass for this
 * person that expires in a couple of minutes. The browser never names a room,
 * an identity or a privilege; it may only say whether it wants audio only.
 */

export type JoinResult =
  | {
      ok: true;
      roomUrl: string;
      token: string;
      role: "customer" | "coach";
      userName: string;
      audioOnly: boolean;
      startsAt: string;
      endsAt: string;
      opensAt: string;
      closesAt: string;
    }
  | {
      ok: false;
      status: number;
      reason: string;
      startsAt?: string;
      endsAt?: string;
      opensAt?: string;
      closesAt?: string;
    };

interface JoinGrant {
  ok: boolean;
  reason?: string;
  role: "customer" | "coach";
  room_id: string;
  room_name: string;
  room_state: "pending" | "ready";
  room_url: string | null;
  opens_at: string;
  closes_at: string;
  starts_at: string;
  ends_at: string;
  pass_expires_at: string;
  user_id: string;
  user_name: string;
  audio_only: boolean;
}

const ROOM_URL = /^https:\/\/[a-z0-9-]+\.daily\.co\/ty-[0-9a-f]{32}$/;

export async function requestCallJoin(
  appointmentId: string,
  audioOnly: boolean,
  deps: { daily?: DailyClient } = {},
): Promise<JoinResult> {
  const supabase = await createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) return { ok: false, status: 503, reason: "provider_unavailable" };

  const { data, error } = await supabase.rpc("call_join_request", { p_appointment: appointmentId, p_audio_only: audioOnly });
  if (error) {
    if (error.message.includes("rate_limited")) return { ok: false, status: 429, reason: "rate_limited" };
    if (error.message.includes("sign_in_required")) return { ok: false, status: 401, reason: "sign_in_required" };
    // not_found and anything unexpected read the same: nothing to see here.
    return { ok: false, status: 404, reason: "not_found" };
  }
  const g = data as JoinGrant;
  const times = { startsAt: g.starts_at, endsAt: g.ends_at, opensAt: g.opens_at, closesAt: g.closes_at };
  if (!g.ok) return { ok: false, status: 409, reason: g.reason ?? "not_booked", ...times };

  if (!isDailyConfigured() && !deps.daily) return { ok: false, status: 503, reason: "provider_unconfigured", ...times };
  const daily = deps.daily ?? dailyClient({ apiKey: env.dailyApiKey });

  // The first person in creates the room at the provider. Repeated and
  // simultaneous requests are safe: the provider answers "already exists" and
  // that counts as success.
  let roomUrl = g.room_url;
  if (g.room_state === "pending" || !roomUrl) {
    const created = await daily.createRoom({ name: g.room_name, opensAt: g.opens_at, closesAt: g.closes_at });
    if (!created.ok) {
      console.error("[calls] room could not be created:", created.error);
      return { ok: false, status: 503, reason: "provider_unavailable", ...times };
    }
    if (!ROOM_URL.test(created.value.url)) {
      console.error("[calls] provider returned an unexpected room address");
      return { ok: false, status: 503, reason: "provider_unavailable", ...times };
    }
    const { data: stillOpen, error: markError } = await admin.rpc("mark_call_room_ready", { p_room: g.room_id, p_url: created.value.url });
    if (markError) return { ok: false, status: 503, reason: "provider_unavailable", ...times };
    if (!stillOpen) {
      // Closed (cancelled, suspended) while it was being created. Remove what
      // was just made rather than leave a room nobody will close.
      await daily.deleteRoom(g.room_name);
      return { ok: false, status: 409, reason: "not_booked", ...times };
    }
    roomUrl = created.value.url;
  }

  const token = await daily.createToken({
    roomName: g.room_name,
    userId: g.user_id,
    userName: g.user_name,
    expiresAt: g.pass_expires_at,
    audioOnly: g.audio_only,
  });
  if (!token.ok) {
    console.error("[calls] pass could not be issued:", token.error);
    return { ok: false, status: 503, reason: "provider_unavailable", ...times };
  }

  return {
    ok: true,
    roomUrl: roomUrl!,
    token: token.value,
    role: g.role,
    userName: g.user_name,
    audioOnly: g.audio_only,
    ...times,
  };
}
