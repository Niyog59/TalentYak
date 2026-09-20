import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/*
 * Only public pages for services open at launch. Inactive services, private
 * areas and reference screens are never listed.
 */
const PUBLIC_PATHS = ["/", "/coaches", "/how-it-works", "/become-a-coach", "/about"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({
    url: new URL(path, env.siteUrl).toString(),
    changeFrequency: "weekly",
    priority: path === "/" ? 1 : 0.7,
  }));
}
