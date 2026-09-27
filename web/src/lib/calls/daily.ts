/**
 * The call provider boundary (Daily's REST API). Server only: it holds the
 * API key. Everything the rest of the app needs from the provider goes
 * through these five calls, so a second provider would replace this file and
 * nothing else.
 *
 * Every call returns a result rather than throwing, and says whether trying
 * again later could help — the join route turns that into an honest "the call
 * service isn't responding", the worker into a retry.
 *
 * `fetchImpl` is injectable so tests use a clearly isolated stand-in and never
 * reach the real service.
 */

export const DAILY_API = "https://api.daily.co/v1";

export type DailyResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; retryable: boolean };

export interface DailyRoom {
  name: string;
  url: string;
}

export interface DailyMeetingParticipant {
  user_id: string | null;
  participant_id: string;
  join_time: number;
  duration: number;
}

export interface DailyMeeting {
  id: string;
  room: string;
  start_time: number;
  duration: number;
  ongoing: boolean;
  participants: DailyMeetingParticipant[];
}

export interface DailyClient {
  createRoom(input: { name: string; opensAt: string; closesAt: string }): Promise<DailyResult<DailyRoom>>;
  createToken(input: TokenInput): Promise<DailyResult<string>>;
  eject(roomName: string, userIds: string[]): Promise<DailyResult<{ ejected: number }>>;
  deleteRoom(roomName: string): Promise<DailyResult<{ deleted: boolean }>>;
  listMeetings(roomName: string, sinceEpoch: number): Promise<DailyResult<DailyMeeting[]>>;
}

export interface TokenInput {
  roomName: string;
  userId: string;
  userName: string;
  expiresAt: string;
  audioOnly: boolean;
}

const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/**
 * A private two-person room that exists only for its window. Screen sharing,
 * chat and knocking are off, and recording is never enabled (it is off unless
 * a room asks for it); `eject_at_room_exp` empties the room when the window
 * ends, so it can never become an open-ended meeting room.
 */
export function roomProperties(input: { opensAt: string; closesAt: string }) {
  return {
    privacy: "private",
    properties: {
      nbf: epoch(input.opensAt),
      exp: epoch(input.closesAt),
      eject_at_room_exp: true,
      max_participants: 2,
      // One presence per person. Rejoining (a refresh, a second tab, a
      // reconnect) replaces the earlier presence instead of leaving a ghost
      // that would fill the two places — and a pass cannot be shared.
      enforce_unique_user_ids: true,
      enable_screenshare: false,
      enable_chat: false,
      enable_knocking: false,
      enable_prejoin_ui: false,
      enable_people_ui: false,
      enable_pip_ui: false,
      enable_emoji_reactions: false,
      enable_hand_raising: false,
      enable_live_captions_ui: false,
      lang: "en",
    },
  } as const;
}

/**
 * A pass for ONE person to enter ONE room, briefly. Never an owner, never an
 * administrator of the call, only camera and microphone — whatever the browser
 * asked for. The identity is the TalentYak account id, so the provider's
 * attendance record maps back to a person without storing their name.
 */
export function tokenProperties(input: TokenInput) {
  return {
    properties: {
      room_name: input.roomName,
      user_id: input.userId,
      user_name: input.userName.slice(0, 60),
      is_owner: false,
      exp: epoch(input.expiresAt),
      // The pass only has to last until they are in; the ROOM's window decides
      // how long they may stay.
      eject_at_token_exp: false,
      enable_screenshare: false,
      start_video_off: input.audioOnly,
      start_audio_off: false,
      permissions: {
        hasPresence: true,
        canSend: ["video", "audio"],
        canAdmin: false,
      },
    },
  } as const;
}

function retryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export function dailyClient(opts: { apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }): DailyClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;

  async function call<T>(method: string, path: string, body?: unknown): Promise<DailyResult<T> & { raw?: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${DAILY_API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (!res.ok) {
        const j = (json ?? {}) as { error?: string; info?: string };
        // The provider's own words, trimmed. Never a request body: it would
        // carry a pass.
        const error = `${res.status} ${[j.error, j.info].filter(Boolean).join(": ")}`.trim().slice(0, 300);
        return { ok: false, status: res.status, error, retryable: retryableStatus(res.status), raw: json };
      }
      return { ok: true, value: json as T };
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return { ok: false, status: 0, error: aborted ? "timed out" : "network error", retryable: true };
    } finally {
      clearTimeout(timer);
    }
  }

  const isNotFound = (r: { ok: false; status: number; error: string }) =>
    r.status === 404 || /not[- ]found|does not exist/i.test(r.error);

  return {
    async createRoom(input) {
      const created = await call<{ name: string; url: string }>("POST", "/rooms", { name: input.name, ...roomProperties(input) });
      if (created.ok) return { ok: true, value: { name: created.value.name, url: created.value.url } };
      // A repeated or simultaneous request already created it: that is success.
      if (created.status === 400 && /already exists/i.test(created.error)) {
        const existing = await call<{ name: string; url: string }>("GET", `/rooms/${encodeURIComponent(input.name)}`);
        if (existing.ok) return { ok: true, value: { name: existing.value.name, url: existing.value.url } };
        return existing;
      }
      return created;
    },

    async createToken(input) {
      const r = await call<{ token: string }>("POST", "/meeting-tokens", tokenProperties(input));
      if (!r.ok) return r;
      if (typeof r.value?.token !== "string") return { ok: false, status: 502, error: "no token in response", retryable: true };
      return { ok: true, value: r.value.token };
    },

    async eject(roomName, userIds) {
      const r = await call<{ ejectedIds?: string[] }>("POST", `/rooms/${encodeURIComponent(roomName)}/eject`, { user_ids: userIds });
      if (r.ok) return { ok: true, value: { ejected: r.value?.ejectedIds?.length ?? 0 } };
      if (isNotFound(r)) return { ok: true, value: { ejected: 0 } };
      return r;
    },

    async deleteRoom(roomName) {
      const r = await call<{ deleted?: boolean }>("DELETE", `/rooms/${encodeURIComponent(roomName)}`);
      if (r.ok) return { ok: true, value: { deleted: Boolean(r.value?.deleted) } };
      // Already gone (never created, deleted earlier, expired and removed).
      if (isNotFound(r)) return { ok: true, value: { deleted: false } };
      return r;
    },

    async listMeetings(roomName, sinceEpoch) {
      const q = new URLSearchParams({ room: roomName, timeframe_start: String(Math.max(0, Math.floor(sinceEpoch))), limit: "100" });
      const r = await call<{ data?: DailyMeeting[] }>("GET", `/meetings?${q}`);
      if (!r.ok) return r;
      const data = Array.isArray(r.value?.data) ? r.value.data : [];
      // Only this room, whatever the provider's filter did.
      return { ok: true, value: data.filter((m) => m.room === roomName) };
    },
  };
}

/** Attendance rows for the database, from finished meetings only. */
export function attendanceRows(meetings: DailyMeeting[]): { rows: Record<string, unknown>[]; ongoing: boolean } {
  const rows: Record<string, unknown>[] = [];
  let ongoing = false;
  for (const m of meetings) {
    if (m.ongoing) {
      ongoing = true;
      continue;
    }
    for (const p of m.participants ?? []) {
      if (!p.user_id || !p.participant_id) continue;
      rows.push({ meeting_id: m.id, participant_id: p.participant_id, user_id: p.user_id, joined_at: p.join_time, duration: p.duration });
    }
  }
  return { rows, ongoing };
}
