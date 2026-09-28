import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isProductionSite } from "@/lib/launch";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { BROWSER_EVENTS, countEvent, validSubject, type SiteEvent } from "@/lib/site-events";

/**
 * A public page reporting that it was seen (or a plan chosen). Always answers
 * 204 — the browser learns nothing, and a failure never shows. Counted as
 * real only on the production site, for visitors who aren't staff, and not
 * for automated browsers.
 */
export const dynamic = "force-dynamic";

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor/i;

export async function POST(request: Request) {
  const done = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  if (Number(request.headers.get("content-length") ?? 0) > 400) return done;
  let body: { event?: unknown; subject?: unknown; webdriver?: unknown };
  try {
    body = await request.json();
  } catch {
    return done;
  }
  const event = String(body.event ?? "") as SiteEvent;
  const subject = String(body.subject ?? "").toLowerCase();
  if (!BROWSER_EVENTS.includes(event) || !validSubject(event, subject)) return done;
  if (BOT.test(request.headers.get("user-agent") ?? "") || body.webdriver === true) return done;

  const limit = await rateLimit("site_event", await clientIp(), 300, 3600, "allow");
  if (!limit.allowed) return done;

  // Staff looking at their own site is not a visit.
  const session = await getSession();
  const staff = Boolean(session && (session.profile.role === "admin" || session.provider));
  await countEvent(event, subject, isProductionSite() && !staff);
  return done;
}
