import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";

export const metadata: Metadata = {
  title: "About TalentYak",
  description:
    "TalentYak is a managed coaching service. You buy coaching through TalentYak, and an independent coach based in Nepal delivers it.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20">
      <h1 className="font-display text-5xl">About TalentYak</h1>
      <p className="mt-4 text-xl text-ink-muted">The name means &ldquo;our own&rdquo;.</p>

      <div className="mt-10 space-y-5 text-lg">
        <p>
          TalentYak is a managed coaching service for Nepalis living abroad. You
          buy coaching through TalentYak, and an independent coach based in Nepal
          delivers it.
        </p>
        <p>
          Coaches set their own plans and prices and make the training
          decisions. TalentYak handles finding a coach, billing, platform support
          and requests to change coach.
        </p>
        <p>
          We&rsquo;re starting with fitness coaching. TalentYak isn&rsquo;t taking
          payments or bookings yet.
        </p>
        <p className="text-ink-muted">
          We only describe checks we actually carry out, and we don&rsquo;t
          show example coaches, reviews or results as if they were real.
        </p>
      </div>

      <div className="mt-10">
        <ButtonLink href="/how-it-works" variant="secondary">
          How TalentYak works
        </ButtonLink>
      </div>
    </div>
  );
}
