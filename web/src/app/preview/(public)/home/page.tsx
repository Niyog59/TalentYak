import type { Metadata } from "next";
import { Homepage } from "@/components/marketing/homepage";

export const metadata: Metadata = { title: "Homepage" };

export default function PreviewHomePage() {
  return <Homepage mode="sample" />;
}
