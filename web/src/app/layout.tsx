import type { Metadata } from "next";
import { Inter, Noto_Serif_Devanagari } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
      className={`${inter.variable} ${devanagari.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
