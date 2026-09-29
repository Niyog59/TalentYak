import type { Metadata } from "next";
import { Faqs, HowCoachingWorks, NextAction, PackageBenefits } from "@/components/marketing/launch-home";
import { TrackView } from "@/components/marketing/track";
import { purchaseMode } from "@/lib/launch";

export const metadata: Metadata = {
  title: "How it works",
  description: "Your coach writes your plan; you train on your own schedule and log it. Check-ins, messaging and calls follow your package.",
  alternates: { canonical: "/how-it-works" },
};
export const dynamic = "force-dynamic";

export default async function HowItWorksPage() {
  const mode = await purchaseMode(null) === "live" ? "live" : "closed";
  return (
    <>
      <TrackView subject="how-it-works" />
      <HowCoachingWorks headingLevel="h1" />
      <PackageBenefits />
      <Faqs mode={mode} />
      <NextAction mode={mode} />
    </>
  );
}
