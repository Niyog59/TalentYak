import type { Metadata, Viewport } from "next";
import {
  Atkinson_Hyperlegible_Next,
  Newsreader,
  Noto_Serif_Devanagari,
} from "next/font/google";
import "./globals.css";
import { ConnectionStatus } from "@/components/pwa/connection-status";
import { env } from "@/lib/env";

// Interface and body text. Drawn for legibility at small sizes and on
// low-quality screens, which matters for dense coaching and logging screens.
const sans = Atkinson_Hyperlegible_Next({
  variable: "--font-sans-src",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

// Public headings only. A warm editorial serif with optical sizing.
const display = Newsreader({
  variable: "--font-display-src",
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  display: "swap",
});

// Kept for existing pages that render Devanagari. Not preloaded on every page.
const devanagari = Noto_Serif_Devanagari({
  variable: "--font-devanagari-src",
  subsets: ["devanagari"],
  weight: ["400", "500"],
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  applicationName: "TalentYak",
  title: {
    default: "TalentYak — Online coaching with Nepali fitness coaches",
    template: "%s · TalentYak",
  },
  description:
    "Online fitness coaching for Nepalis living abroad, with independent coaches based in Nepal. Your coach writes your plan around your life and food; you train on your own schedule.",
  // Shared previews use the real logo. Pages set their own canonical address.
  openGraph: {
    type: "website",
    siteName: "TalentYak",
    locale: "en_GB",
    images: [{ url: "/brand/talentyak/website/talentyak-horizontal-light.png", width: 1200, height: 400, alt: "TalentYak" }],
  },
  twitter: { card: "summary_large_image" },
  appleWebApp: {
    capable: true,
    title: "TalentYak",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

// The icons themselves come from the file conventions in this directory:
// favicon.ico, icon.png and apple-icon.png. Next generates the link tags with
// the correct type and size attributes, so none are declared by hand here.

export const viewport: Viewport = {
  themeColor: "#124f43",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${display.variable} ${devanagari.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <ConnectionStatus />
        {children}
      </body>
    </html>
  );
}
