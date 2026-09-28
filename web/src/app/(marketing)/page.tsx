import type { Metadata } from "next";
import { Faqs, HowCoachingWorks, Hero, MeetCoaches, NextAction, PackageBenefits, faqs } from "@/components/marketing/launch-home";
import { JsonLd } from "@/components/marketing/json-ld";
import { TrackView } from "@/components/marketing/track";
import { env } from "@/lib/env";
import { purchaseMode } from "@/lib/launch";
import { listPublicCoaches } from "@/lib/offers/public";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};
export const dynamic = "force-dynamic";

/*
 * The public homepage (M16), in the founder's order: value → founding
 * coaches → how coaching works → package benefits → questions → next action.
 * The primary action is honest about the launch state: "Start coaching" only
 * when the public can actually buy, otherwise the waitlist.
 */
export default async function HomePage() {
  const listing = await listPublicCoaches();
  // The public's view: a tester's own access doesn't change what visitors are told.
  const mode = purchaseMode(null) === "live" ? "live" : "closed";
  return (
    <>
      <TrackView subject="home" />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              name: "TalentYak",
              url: env.siteUrl,
              logo: `${env.siteUrl}/brand/talentyak/icons/icon-512.png`,
              description: "Online fitness coaching for Nepalis living abroad, delivered by independent coaches based in Nepal.",
              ...(env.supportEmail ? { email: env.supportEmail } : {}),
            },
            {
              "@type": "FAQPage",
              mainEntity: faqs(mode).map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
            },
          ],
        }}
      />
      <Hero mode={mode} hasCoaches={Boolean(listing?.length)} />
      <MeetCoaches listing={listing ?? []} failed={listing === null} />
      <HowCoachingWorks />
      <PackageBenefits />
      <Faqs mode={mode} />
      <NextAction mode={mode} />
    </>
  );
}
