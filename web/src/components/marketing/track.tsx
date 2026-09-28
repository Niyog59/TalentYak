"use client";

import Link from "next/link";
import { useEffect, type ComponentProps } from "react";

/*
 * Reports one public event per page per browser tab session — a refresh or
 * going back doesn't count twice. Sends only the event name and a page kind or
 * public slug/id; the server decides whether it counts as real. No cookies,
 * and nothing is stored beyond this tab's session.
 */

function report(event: string, subject: string) {
  const key = `talentyak:seen:${event}:${subject}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch {
    /* storage blocked: report anyway, the server still de-duplicates nothing personal */
  }
  const body = JSON.stringify({ event, subject, webdriver: navigator.webdriver === true });
  try {
    if (!navigator.sendBeacon?.("/api/events", new Blob([body], { type: "application/json" }))) {
      void fetch("/api/events", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
    }
  } catch {
    /* never affects the page */
  }
}

export function TrackView({ event = "page_view", subject }: { event?: "page_view" | "coach_profile_view"; subject: string }) {
  useEffect(() => {
    report(event, subject);
  }, [event, subject]);
  return null;
}

/** A link that also records that a plan was chosen. */
export function TrackedLink({ planVersionId, ...props }: ComponentProps<typeof Link> & { planVersionId: string }) {
  return <Link {...props} onClick={(e) => { report("package_selected", planVersionId); props.onClick?.(e); }} />;
}
