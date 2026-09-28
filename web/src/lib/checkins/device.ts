/*
 * A check-in's answers, kept on this device until the server has them.
 *
 * Same discipline as tracking (lib/tracking/device.ts): keys name the
 * signed-in account, everything under "talentyak:" is cleared on sign-out,
 * nothing is sent anywhere except our own route, and every storage call is
 * guarded so private browsing just means "not kept across a refresh".
 *
 * Browser code only.
 */

import type { Answers } from "@/lib/checkins/questions";

export const CHECKIN_PREFIX = "talentyak:checkin:";

export interface DeviceCheckin {
  v: 1;
  answers: Answers;
  /** The server draft revision this copy was last in step with; 0 = none. */
  baseRevision: number;
  /** Unconfirmed draft save, so a retry is recognised as the same save. */
  saveId: string | null;
  /** A send in flight: retried with the same id, so it is never sent twice. */
  submitId: string | null;
  changeNote: string;
  dirty: boolean;
  updatedAt: number;
}

const keyFor = (userId: string, checkinId: string) => `${CHECKIN_PREFIX}${userId}:${checkinId}`;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDevice(userId: string, checkinId: string): DeviceCheckin | null {
  try {
    const raw = storage()?.getItem(keyFor(userId, checkinId));
    return raw ? (JSON.parse(raw) as DeviceCheckin) : null;
  } catch {
    return null;
  }
}

export function writeDevice(userId: string, checkinId: string, item: Omit<DeviceCheckin, "v" | "updatedAt">): void {
  try {
    storage()?.setItem(keyFor(userId, checkinId), JSON.stringify({ ...item, v: 1, updatedAt: Date.now() }));
  } catch {
    // Storage full or switched off: answers still save while online.
  }
}

export function clearDeviceCheckin(userId: string, checkinId: string): void {
  try {
    storage()?.removeItem(keyFor(userId, checkinId));
  } catch {
    /* nothing to do */
  }
}

/** Check-ins on this device with answers the server hasn't confirmed. */
export function unsavedCheckinsOnDevice(): number {
  const s = storage();
  if (!s) return 0;
  let n = 0;
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (!k || !k.startsWith(CHECKIN_PREFIX)) continue;
      const item = JSON.parse(s.getItem(k) ?? "{}") as Partial<DeviceCheckin>;
      if (item.dirty || item.submitId) n++;
    }
  } catch {
    return n;
  }
  return n;
}

export type SendOutcome =
  | { status: "ok"; data: Record<string, unknown> }
  | { status: "offline" }
  | { status: "held"; reason: string }
  | { status: "conflict"; data: Record<string, unknown> }
  | { status: "refused"; message: string; missing?: string[] }
  | { status: "failed"; message: string };

export async function sendCheckin(body: Record<string, unknown>): Promise<SendOutcome> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { status: "offline" };
  let res: Response;
  try {
    res = await fetch("/api/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { status: "offline" };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { status: "ok", data };
  if (res.status === 409) return { status: "conflict", data };
  if (res.status === 423) return { status: "held", reason: String(data.held ?? "unavailable") };
  if (res.status === 401) return { status: "failed", message: "You've been signed out. Sign in again — your answers are kept on this device." };
  if (res.status === 422) return { status: "refused", message: String(data.error ?? "That couldn't be saved."), missing: Array.isArray(data.missing) ? (data.missing as string[]) : undefined };
  return { status: "failed", message: typeof data.error === "string" ? data.error : "That didn't save. It's kept on this device." };
}
