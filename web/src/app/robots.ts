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
      disallow: ["/admin", "/coach", "/account", "/book", "/checkout", "/invite", "/preview", "/api", "/auth"],
    },
    sitemap: `${env.siteUrl}/sitemap.xml`,
  };
}
