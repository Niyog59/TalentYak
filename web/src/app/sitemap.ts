import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { listPublicCoaches } from "@/lib/offers/public";

/*
 * Only approved public pages: the fixed launch pages and each public coach's
 * profile. Private areas, drafts, test and token pages are never listed.
 */
const PUBLIC_PATHS = ["/", "/coaches", "/how-it-works", "/about", "/waitlist", "/become-a-coach"];

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const coaches = (await listPublicCoaches().catch(() => null)) ?? [];
  return [
    ...PUBLIC_PATHS.map((path) => ({
      url: new URL(path, env.siteUrl).toString(),
      changeFrequency: "weekly" as const,
      priority: path === "/" ? 1 : 0.7,
    })),
    ...coaches.map(({ coach }) => ({
      url: new URL(`/coaches/${coach.slug}`, env.siteUrl).toString(),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
