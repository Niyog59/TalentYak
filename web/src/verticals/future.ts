import type { Vertical } from "@/lib/catalog/types";

/**
 * Future vertical nodes. Catalog-only entries — they appear as
 * "coming soon" on the site with no services or code behind them.
 * When one is built, it becomes its own folder with a registry entry.
 */
export const tutoringVertical: Vertical = {
  slug: "tutoring",
  name: "Tutoring",
  nameNe: "शिक्षण",
  tagline: "One-on-one tutoring from Nepali educators, in your timezone.",
  description:
    "Math, science, and Nepali language tutoring for diaspora kids, taught remotely by experienced Nepali teachers.",
  status: "coming_soon",
  sort: 3,
};

export const bookkeepingVertical: Vertical = {
  slug: "bookkeeping",
  name: "Bookkeeping",
  nameNe: "लेखा",
  tagline: "Monthly books for small businesses, kept by Nepali accountants.",
  description:
    "Reliable monthly bookkeeping for diaspora-owned small businesses — gas stations, restaurants, shops — at a price that makes sense.",
  status: "coming_soon",
  sort: 4,
};
