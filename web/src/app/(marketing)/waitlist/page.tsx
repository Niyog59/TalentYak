import type { Metadata } from "next";
import Link from "next/link";
import { WaitlistForm } from "@/components/marketing/waitlist-form";
import { TrackView } from "@/components/marketing/track";
import { listPublicCoaches } from "@/lib/offers/public";
import { WAITLIST_EXPLAINER } from "@/lib/waitlist/copy";
import { featureOnForEveryone } from "@/lib/features/server";

export const metadata: Metadata = {
  title: "Join the waitlist",
  description: "Be told when TalentYak fitness coaching can be booked. Email only, no marketing, leave any time.",
  alternates: { canonical: "/waitlist" },
};
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ coach?: string; plan?: string }> }) {
  const sp = await searchParams;
  const [open, profilesOn] = await Promise.all([featureOnForEveryone("waitlist"), featureOnForEveryone("public_profiles")]);
  const listing = profilesOn ? (await listPublicCoaches()) ?? [] : [];
  const coaches = listing.map(({ coach }) => ({ id: coach.provider_id, name: coach.display_name }));
  const coachId = sp.coach && UUID.test(sp.coach) && coaches.some((c) => c.id === sp.coach) ? sp.coach : null;
  const plan = coachId && sp.plan && UUID.test(sp.plan)
    ? listing.find((l) => l.coach.provider_id === coachId)?.plans.find((p) => p.offer_id === sp.plan) ?? null
    : null;

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6 md:py-16">
      <TrackView subject="waitlist" />
      <h1 className="font-display text-4xl sm:text-5xl">Join the waitlist</h1>
      <p className="mt-3 text-lg text-ink-muted">
        We&rsquo;ll email you when coaching{coachId ? ` with ${coaches.find((c) => c.id === coachId)?.name}` : ""} can be booked.
      </p>
      <ul className="mt-6 list-disc space-y-1.5 pl-6">
        {WAITLIST_EXPLAINER.map((line) => <li key={line}>{line}</li>)}
      </ul>
      {open ? (
        <div className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <WaitlistForm coaches={coaches} coachId={coachId} planId={plan?.offer_id ?? null} planLabel={plan?.title ?? null} />
        </div>
      ) : (
        <p role="note" className="mt-8 rounded-lg border border-line-strong bg-paper-raised p-4">
          The waitlist is closed for new sign-ups right now. If you&rsquo;re already on it, you stay on it, and the link in your emails still lets you leave.
        </p>
      )}
      <p className="mt-6 text-sm text-ink-muted">
        Questions before you sign up? Read the <Link href="/#faq-heading" className="underline">common questions</Link> or <Link href="/about#support-heading" className="underline">contact TalentYak</Link>. Coaches can&rsquo;t be messaged before you&rsquo;ve bought coaching.
      </p>
    </div>
  );
}
