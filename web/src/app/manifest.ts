import type { MetadataRoute } from "next";

/*
 * Web app manifest — what makes TalentYak installable to a home screen.
 *
 * Installable is not offline. There is no service worker: an installed
 * TalentYak still needs the internet for everything it does. Safe caching
 * belongs to a later module, and offline workout drafts to M12. Nothing here
 * claims otherwise.
 *
 * Every icon is `purpose: "any"`. The brand pack states plainly that it does
 * not contain a tested maskable icon — one would need a padded export, checked
 * against the aggressive circular crops some launchers apply. Declaring these
 * maskable without that check would get the yak's horns clipped off.
 *
 * start_url is the homepage. Once customer accounts are real it can point a
 * signed-in customer straight at their own screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "TalentYak",
    short_name: "TalentYak",
    description:
      "Online fitness coaching with independent coaches based in Nepal.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fcfcfa",
    theme_color: "#124f43",
    lang: "en",
    categories: ["health", "fitness"],
    icons: [
      {
        src: "/brand/talentyak/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/talentyak/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
