import type { Metadata } from "next";
import {
  Fraunces,
  Source_Serif_4,
  IBM_Plex_Sans,
  Noto_Serif_Devanagari,
} from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const devanagari = Noto_Serif_Devanagari({
  variable: "--font-devanagari",
  subsets: ["devanagari"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Ghartira — Some things must still happen at home",
    template: "%s — Ghartira",
  },
  description:
    "Ghartira connects Nepali families abroad with trusted professionals in Nepal — ancestral rites, coaching, and services handled back home on your behalf.",
  icons: {
    icon: [{ url: "/favicon-32.png", sizes: "32x32" }],
    apple: [{ url: "/apple-touch-icon-180.png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${sourceSerif.variable} ${plexSans.variable} ${devanagari.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
