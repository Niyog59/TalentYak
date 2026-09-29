import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isProductionSite } from "@/lib/launch";
import { captureProductEvent, type ProductEvent } from "@/lib/analytics/posthog";

/*
 * Public-site counts (M16). No analytics service is configured, so TalentYak
 * keeps its own daily counters: an event name, a page kind or a public
 * slug/id, and whether it was real production activity. No cookies, no
 * identifiers, no IP addresses, no emails, no query strings — nothing that
 * could say who did it. Purchases are not counted here: they come from the
 * payment records themselves.
 */

export type SiteEvent = "page_view" | "coach_profile_view" | "package_selected" | "checkout_started" | "waitlist_registered";

/** Events a browser may report. The rest are recorded by the server itself. */
export const BROWSER_EVENTS: SiteEvent[] = ["page_view", "coach_profile_view", "package_selected"];

export const PAGE_KINDS = ["home", "start", "coach", "how-it-works", "about", "faq", "waitlist", "become-a-coach", "legal"] as const;

const SUBJECT = /^[a-z0-9-]{0,64}$/;

export function validSubject(event: SiteEvent, subject: string): boolean {
  if (!SUBJECT.test(subject)) return false;
  if (event === "page_view") return (PAGE_KINDS as readonly string[]).includes(subject);
  return true;
}

/** The same moment, as the PostHog event it is forwarded as (when real). */
function forPostHog(event: SiteEvent, subject: string): { name: ProductEvent; props: Record<string, string> } {
  switch (event) {
    case "page_view":
      return { name: "public_visit", props: { page_kind: subject } };
    case "coach_profile_view":
      return { name: "coach_profile_view", props: { coach_slug: subject } };
    case "package_selected":
      return { name: "package_selected", props: { offer_ref: subject } };
    case "checkout_started":
      return { name: "checkout_started", props: { offer_version_ref: subject } };
    case "waitlist_registered":
      return { name: "waitlist_registered", props: {} };
  }
}

/**
 * Never throws: a counter must not break a page, a checkout or a sign-up.
 * This is the single place a public event is recorded, so it is counted once
 * here and, when it is real production activity, sent once to PostHog.
 */
export async function countEvent(event: SiteEvent, subject: string, live = isProductionSite()): Promise<void> {
  const s = subject.toLowerCase();
  if (!validSubject(event, s)) return;
  const admin = createAdminClient();
  if (!admin) return;
  try {
    await admin.rpc("bump_site_event", { p_event: event, p_subject: s, p_live: live });
  } catch {
    /* counting is best effort */
  }
  const ph = forPostHog(event, s);
  await captureProductEvent(ph.name, ph.props, { live });
}
