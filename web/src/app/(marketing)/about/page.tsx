import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/button";
import { TrackView } from "@/components/marketing/track";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "About TalentYak",
  description:
    "TalentYak is a managed coaching service for Nepalis living abroad. You buy coaching through TalentYak, and an independent coach based in Nepal delivers it.",
  alternates: { canonical: "/about" },
};

/*
 * Only what is true today. The selection steps are the ones the product
 * actually enforces: invitation, TalentYak's approval before a profile is
 * public, qualifications shown only once checked, and published welcome &
 * expectations before anyone can buy. TalentYak does not supervise training
 * decisions and does not say it does (AAF-OPS-04).
 */
export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20">
      <TrackView subject="about" />
      <h1 className="font-display text-5xl">About TalentYak</h1>

      <div className="mt-8 space-y-5 text-lg">
        <p>
          TalentYak is a managed coaching service for Nepalis living abroad. You buy coaching through TalentYak, and an
          independent coach based in Nepal delivers it.
        </p>
        <p>
          Coaches set their own plans and prices and make the training decisions. TalentYak handles finding a coach,
          billing, platform support and requests to change coach. We&rsquo;re starting with fitness coaching and a small
          number of founding coaches.
        </p>
        <p className="text-ink-muted">
          We only describe checks we actually carry out, and we don&rsquo;t show example coaches, reviews or results as if
          they were real.
        </p>
      </div>

      <section aria-labelledby="selection-heading" className="mt-14">
        <h2 id="selection-heading" className="text-3xl font-semibold">How coaches are selected</h2>
        <ol className="mt-5 list-decimal space-y-3 pl-6 text-lg">
          <li><strong>By invitation.</strong> Coaches join only when TalentYak invites them; there&rsquo;s no open sign-up.</li>
          <li><strong>Profile review.</strong> TalentYak reviews each coach&rsquo;s profile and approves it before anyone can see it or buy from them.</li>
          <li>
            <strong>Qualifications.</strong> A qualification appears on a profile only after TalentYak has checked the
            evidence, and it&rsquo;s marked &ldquo;Checked by TalentYak&rdquo; with what was checked. Other claims aren&rsquo;t shown.
          </li>
          <li><strong>Clear expectations.</strong> Before anyone can buy, the coach publishes what they provide, how they work and how quickly they usually reply. You read it before paying.</li>
          <li>
            <strong>While you&rsquo;re coached.</strong> You can report a problem or ask to change coach at any time, and
            TalentYak can pause or remove a coach. TalentYak doesn&rsquo;t review or approve the training advice itself —
            your coach is responsible for your programme.
          </li>
        </ol>
      </section>

      <section aria-labelledby="support-heading" className="mt-14 rounded-2xl border border-line bg-surface p-6">
        <h2 id="support-heading" className="text-2xl font-semibold">Questions and support</h2>
        <p className="mt-2">
          Before you buy, questions go to TalentYak — coaches can&rsquo;t be messaged until you&rsquo;ve bought coaching with them.
        </p>
        {env.supportEmail ? (
          <p className="mt-3 text-lg">
            Email <a href={`mailto:${env.supportEmail}`} className="font-semibold text-brand underline underline-offset-4">{env.supportEmail}</a>.
          </p>
        ) : (
          <p className="mt-3 text-ink-muted">Our support email is being set up.</p>
        )}
        <p className="mt-3 text-ink-muted">
          Already a client? Use <Link href="/account/support" className="underline">Report a problem</Link> in your account, which also works while coaching is paused.
        </p>
      </section>

      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href="/coaches">Start coaching</ButtonLink>
        <ButtonLink href="/how-it-works" variant="secondary">How TalentYak works</ButtonLink>
      </div>
    </div>
  );
}
