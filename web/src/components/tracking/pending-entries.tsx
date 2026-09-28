"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { flushOps, removeItem, unsavedItems, type HeldState, type StoredItem } from "@/lib/tracking/device";
import { heldMessage } from "@/components/tracking/save-badge";

/*
 * Entries this device is still holding for the signed-in client: a workout
 * with unsaved sets, a weight or a food entry made offline or while coaching
 * was paused. Shown wherever the client tracks, so nothing waits unseen.
 *
 * Queued entries are sent again when this appears, when the connection
 * returns, and when asked. A workout is saved from its own screen, which has
 * the full draft — this links to it.
 */
export function PendingEntries({ viewerId, live, pausedNotice }: { viewerId: string; live: boolean; pausedNotice: string }) {
  const router = useRouter();
  const [items, setItems] = useState<StoredItem[]>([]);
  const [held, setHeld] = useState<HeldState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => setItems(unsavedItems(viewerId)), [viewerId]);

  const flush = useCallback(async () => {
    const before = unsavedItems(viewerId).filter((i) => i.kind === "op").length;
    if (!before) {
      refresh();
      return;
    }
    setBusy(true);
    const r = await flushOps(viewerId);
    setBusy(false);
    setHeld(r.held);
    refresh();
    if (r.saved) router.refresh();
  }, [viewerId, refresh, router]);

  useEffect(() => {
    // Read after render: this device's storage doesn't exist on the server.
    const timer = window.setTimeout(() => {
      refresh();
      if (live) void flush();
    }, 0);
    const onOnline = () => live && void flush();
    const onChange = () => refresh();
    window.addEventListener("online", onOnline);
    window.addEventListener("talentyak:tracking-changed", onChange);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("talentyak:tracking-changed", onChange);
    };
  }, [live, flush, refresh]);

  if (!items.length) return null;

  return (
    <section aria-labelledby="pending-heading" className="mt-6 rounded-2xl border border-danger bg-danger-tint p-4 sm:p-5">
      <h2 id="pending-heading" className="text-lg font-semibold">
        {items.length === 1 ? "1 entry is waiting on this device" : `${items.length} entries are waiting on this device`}
      </h2>
      <p className="mt-1">
        {held === "paused" || (!live && !held)
          ? `${pausedNotice} These will be saved when coaching resumes.`
          : held
            ? heldMessage(held)
            : "They haven't reached your records yet. They're safe here and will save when you're connected."}
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((i) => (
          <li key={`${i.kind}:${i.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3">
            <span>
              <span className="font-semibold">{i.label}</span>
              <span className="block text-sm text-ink-muted">
                {i.state === "offline" ? "Waiting for a connection" : i.state === "held" ? "Waiting — coaching isn't active" : i.state === "conflict" ? "Changed on another device — open it to choose" : i.state === "failed" ? `Not saved: ${i.message ?? "try again"}` : "Not saved yet"}
              </span>
            </span>
            <span className="flex flex-wrap gap-2">
              {i.kind === "workout" || i.state === "conflict" ? (
                <Link href={i.href} className="inline-flex min-h-9 items-center rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold">Open</Link>
              ) : null}
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  if (!window.confirm("Remove this unsaved entry from this device? It won't reach your records.")) return;
                  removeItem(viewerId, i.kind, i.id);
                  refresh();
                }}
              >
                Discard
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {live ? (
        <Button size="sm" variant="secondary" className="mt-3" disabled={busy} onClick={() => void flush()}>
          {busy ? "Saving…" : "Try saving now"}
        </Button>
      ) : null}
    </section>
  );
}
