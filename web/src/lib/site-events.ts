import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isProductionSite } from "@/lib/launch";

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

/** Never throws: a counter must not break a page, a checkout or a sign-up. */
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
}
