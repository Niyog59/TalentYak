"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the server-rendered page on an interval, for a bounded time. */
export function AutoRefresh({ everySeconds, forSeconds }: { everySeconds: number; forSeconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > forSeconds * 1000) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, everySeconds * 1000);
    return () => clearInterval(timer);
  }, [router, everySeconds, forSeconds]);
  return null;
}
