import type { Metadata } from "next";

/*
 * Reference screens (M02). Sample data only, clearly marked on every screen.
 * Kept out of search: noindex here, disallowed in robots.txt, and never
 * listed in the sitemap. Later modules replace the sample data with real
 * data behind the same components.
 */
export const metadata: Metadata = {
  title: {
    default: "Reference screens",
    template: "%s · Reference · TalentYak",
  },
  robots: { index: false, follow: false },
};

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
