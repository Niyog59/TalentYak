"use client";

import { useEffect, useRef, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";

/*
 * Keeping a dashboard current without hammering the server.
 *
 *   · back online, or back to the tab after a minute away → read it again
 *   · while it stays open and visible → read it again every two minutes
 *   · offline → say so, and say how old what's on screen is. Nothing on the
 *     screen is cleared or shown as zero because the connection dropped.
 */
function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function LiveRefresh({ loadedAt }: { loadedAt: string }) {
  const router = useRouter();
  const offline = !useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const last = useRef(0);

  useEffect(() => {
    last.current = Date.now();
    const refresh = () => {
      if (!navigator.onLine) return;
      last.current = Date.now();
      router.refresh();
    };
    const onOnline = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current > 60_000) refresh();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 120_000);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  if (!offline) return null;
  return (
    <p role="status" className="mt-4 rounded-lg border border-line-strong bg-paper-raised p-3 text-sm">
      You&rsquo;re offline. This is what was loaded at {loadedAt}; it updates when you&rsquo;re back online.
    </p>
  );
}

/** A section that couldn't be read: says so, and offers a retry. Never shown as "nothing". */
export function SectionFailed({ what }: { what: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="alert" className="rounded-lg border border-line-strong bg-paper-raised p-4">
      <p>{what} couldn&rsquo;t be loaded just now. This isn&rsquo;t the same as having nothing here.</p>
      <button
        type="button"
        onClick={() => start(() => router.refresh())}
        disabled={pending}
        className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 font-semibold hover:border-ink disabled:opacity-60"
      >
        {pending ? "Trying again…" : "Try again"}
      </button>
    </div>
  );
}
