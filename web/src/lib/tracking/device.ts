/*
 * What a device holds until the server has it.
 *
 * Entries are kept in this browser's storage, under keys that name the
 * signed-in account, so one person's drafts are never shown to another who
 * signs in on the same device, and they are cleared on sign-out. Nothing here
 * is ever sent anywhere except our own save route, and nothing is logged.
 *
 * Browser code only. Every storage call is guarded: private browsing or
 * switched-off storage means entries save straight away but are not kept
 * across a refresh — never an error.
 */

import type { WorkoutDoc } from "@/lib/tracking/workout";

const ROOT = "talentyak:";
const PREFIX = "talentyak:track:";
/** A draft nobody has touched for this long is dropped, unless it holds unsaved entries. */
const STALE_MS = 30 * 24 * 3600 * 1000;

export type HeldState = "paused" | "ended" | "suspended" | "unavailable";

export type SaveState =
  | { kind: "saved"; at: number }
  | { kind: "saving" }
  | { kind: "pending" } // unsaved changes, about to save
  | { kind: "offline" } // no connection: kept here, retried when it returns
  | { kind: "held"; reason: HeldState } // coaching isn't live: kept here until it is
  | { kind: "failed"; message: string; retryable: boolean }
  | { kind: "conflict"; duplicate: boolean };

export interface StoredWorkoutDraft {
  v: 1;
  kind: "workout";
  id: string;
  doc: WorkoutDoc;
  /** The server revision this draft was last in step with; 0 = never saved. */
  baseRevision: number;
  /** Set while a save is unconfirmed, so a retry is recognised as the same save. */
  saveId: string | null;
  /** Changes the server hasn't confirmed. */
  dirty: boolean;
  /** Values typed for the next set but not yet confirmed. Never sent. */
  inputs: Record<string, { load: string; reps: string; seconds: string; rpe: string; unit?: "kg" | "lb" }>;
  href: string;
  label: string;
  state: SaveState["kind"];
  message?: string;
  updatedAt: number;
}

export interface StoredOp {
  v: 1;
  kind: "op";
  id: string;
  /** A save-route request body. */
  body: Record<string, unknown>;
  href: string;
  label: string;
  state: SaveState["kind"];
  message?: string;
  updatedAt: number;
}

export type StoredItem = StoredWorkoutDraft | StoredOp;

const keyFor = (userId: string, kind: StoredItem["kind"], id: string) => `${PREFIX}${userId}:${kind}:${id}`;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readItem<T extends StoredItem>(userId: string, kind: T["kind"], id: string): T | null {
  try {
    const raw = storage()?.getItem(keyFor(userId, kind, id));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeItem(userId: string, item: StoredItem) {
  try {
    storage()?.setItem(keyFor(userId, item.kind, item.id), JSON.stringify({ ...item, updatedAt: Date.now() }));
  } catch {
    // Storage full or switched off. The entry still saves when online.
  }
}

export function removeItem(userId: string, kind: StoredItem["kind"], id: string) {
  try {
    storage()?.removeItem(keyFor(userId, kind, id));
  } catch {
    /* nothing to do */
  }
}

/** This account's items on this device, newest first. Stale, fully-saved drafts are dropped. */
export function listItems(userId: string): StoredItem[] {
  const s = storage();
  if (!s) return [];
  const mine = `${PREFIX}${userId}:`;
  const out: StoredItem[] = [];
  const stale: string[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (!k || !k.startsWith(mine)) continue;
      try {
        const item = JSON.parse(s.getItem(k) ?? "") as StoredItem;
        const unsaved = item.kind === "op" || item.dirty;
        if (!unsaved && Date.now() - item.updatedAt > STALE_MS) stale.push(k);
        else out.push(item);
      } catch {
        stale.push(k);
      }
    }
    for (const k of stale) s.removeItem(k);
  } catch {
    return out;
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Entries this account has not got to the server yet. */
export function unsavedItems(userId: string): StoredItem[] {
  return listItems(userId).filter((i) => i.kind === "op" || i.dirty);
}

/**
 * Sign-out: everything TalentYak keeps in this browser — tracking drafts and
 * unsent messages alike, for every account that used it.
 */
export function clearDevice(): number {
  const s = storage();
  if (!s) return 0;
  const keys: string[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && k.startsWith(ROOT)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    return 0;
  }
  return keys.length;
}

/** Unsaved entries of any account on this device, for the sign-out warning. */
export function countUnsavedOnDevice(): number {
  const s = storage();
  if (!s) return 0;
  let n = 0;
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (!k) continue;
      if (k.startsWith("talentyak:unsent:")) {
        n++;
        continue;
      }
      if (!k.startsWith(PREFIX)) continue;
      const item = JSON.parse(s.getItem(k) ?? "{}") as Partial<StoredItem>;
      if (item.kind === "op" || (item.kind === "workout" && item.dirty)) n++;
    }
  } catch {
    return n;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Talking to the save route
// ---------------------------------------------------------------------------

export type SendResult =
  | { status: "saved"; data: Record<string, unknown> }
  | { status: "offline" }
  | { status: "held"; reason: HeldState }
  | { status: "conflict"; data: Record<string, unknown> }
  | { status: "failed"; message: string; retryable: boolean };

export async function send(body: Record<string, unknown>): Promise<SendResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { status: "offline" };
  let res: Response;
  try {
    res = await fetch("/api/tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { status: "offline" };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) return { status: "saved", data };
  if (res.status === 409) return { status: "conflict", data };
  if (res.status === 423) return { status: "held", reason: (data.held as HeldState) ?? "unavailable" };
  if (res.status === 401) return { status: "failed", message: "You've been signed out. Sign in again — your entries are kept on this device.", retryable: false };
  const message = typeof data.error === "string" && data.error !== "retry" ? data.error : "That didn't save. It's kept on this device.";
  return { status: "failed", message, retryable: res.status >= 500 || res.status === 429 };
}

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Sends every queued (non-workout) entry for this account, oldest first.
 * Workouts are saved by their own screen, which holds the full draft.
 */
export async function flushOps(userId: string): Promise<{ saved: number; remaining: number; held: HeldState | null }> {
  const ops = listItems(userId).filter((i): i is StoredOp => i.kind === "op").sort((a, b) => a.updatedAt - b.updatedAt);
  let saved = 0;
  let held: HeldState | null = null;
  for (const op of ops) {
    const r = await send(op.body);
    if (r.status === "saved") {
      removeItem(userId, "op", op.id);
      saved++;
    } else if (r.status === "offline") {
      writeItem(userId, { ...op, state: "offline" });
      break;
    } else if (r.status === "held") {
      held = r.reason;
      writeItem(userId, { ...op, state: "held", message: undefined });
    } else if (r.status === "conflict") {
      writeItem(userId, { ...op, state: "conflict", message: "Changed on another device since you entered this." });
    } else {
      writeItem(userId, { ...op, state: "failed", message: r.message });
    }
  }
  return { saved, remaining: ops.length - saved, held };
}
