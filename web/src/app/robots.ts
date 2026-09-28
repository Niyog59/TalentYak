import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/*
 * Search crawlers see only the public fitness pages. This is a request to
 * well-behaved crawlers, not access control: private areas are protected on
 * the server, and the reference screens also carry a noindex tag.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // "/coach" alone would also match "/coaches" (rules are prefixes), which
      // hid every public coach profile from search. The coach area is matched
      // exactly and by its sub-paths instead.
      disallow: ["/admin", "/coach$", "/coach/", "/account", "/book", "/checkout", "/invite", "/preview", "/api", "/auth", "/waitlist/confirm", "/waitlist/leave"],
    },
    sitemap: `${env.siteUrl}/sitemap.xml`,
  };
}
