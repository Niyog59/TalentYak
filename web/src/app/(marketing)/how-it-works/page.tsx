import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";
import { CommonQuestions, HowItWorks } from "@/components/marketing/homepage";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "You work with a coach. TalentYak keeps your plan, progress and conversations in one place.",
};

export default function HowItWorksPage() {
  return (
    <>
      <HowItWorks mode="live" headingLevel="h1" />
      <CommonQuestions mode="live" />
      <div className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
        <ButtonLink href="/coaches">Find your coach</ButtonLink>
      </div>
    </>
  );
}
