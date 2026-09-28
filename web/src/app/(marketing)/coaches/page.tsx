import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/button";
import { PackageCard, packageAction } from "@/components/marketing/package-card";
import { availabilityText } from "@/components/marketing/launch-home";
import { TrackView } from "@/components/marketing/track";
import { getSession } from "@/lib/auth";
import { getLiveExpectations } from "@/lib/expectations/server";
import { purchaseMode } from "@/lib/launch";
import { listPublicCoaches } from "@/lib/offers/public";
import { coachPhotoUrl } from "@/lib/storage/photos";

export const metadata: Metadata = {
  title: "Start coaching",
  description: "Choose a TalentYak coach and package. See what's included, the price and currency and how billing works before you pay.",
  alternates: { canonical: "/coaches" },
};
// Coaches change their own profiles, prices and availability; read per request.
export const dynamic = "force-dynamic";

/*
 * "Start coaching": the founding coaches and their packages, one after the
 * other. Deliberately not a searchable directory or a comparison engine —
 * there are only a few coaches (M16). Choosing leads to sign-in or sign-up
 * and then checkout, with the choice carried through.
 */
export default async function StartCoachingPage() {
  const [listing, session] = await Promise.all([listPublicCoaches(), getSession()]);
  const mode = purchaseMode(session);
  const expectations = new Map(
    await Promise.all((listing ?? []).map(async ({ coach }) => {
      const e = await getLiveExpectations(coach.provider_id).catch(() => ({ coach: null, platform: null }));
      return [coach.provider_id, Boolean(e.coach && e.platform)] as const;
    })),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:py-16">
      <TrackView subject="start" />
      <h1 className="font-display text-4xl sm:text-5xl">Start coaching</h1>
      <p className="mt-3 max-w-2xl text-lg text-ink-muted">
        Choose a coach and a package. You&rsquo;ll create an account (or sign in), read the coach&rsquo;s welcome &amp; expectations,
        and see the final price before you pay.
      </p>
      {mode === "closed" ? (
        <p role="note" className="mt-5 max-w-2xl rounded-lg border border-line-strong bg-paper-raised p-4">
          TalentYak isn&rsquo;t taking payments yet. You can read everything here and <Link href="/waitlist" className="font-semibold underline">join the waitlist</Link> to be told when coaching can be booked.
        </p>
      ) : mode === "test" ? (
        <p role="note" className="mt-5 max-w-2xl rounded-lg border border-line-strong bg-paper-raised p-4">
          <strong>Test checkout.</strong> You can go through checkout with a Stripe test card; nothing real is charged and it isn&rsquo;t a sale.
        </p>
      ) : null}

      {listing === null ? (
        <p role="alert" className="mt-10 rounded-lg border border-line-strong bg-paper-raised p-4">
          The coaches couldn&rsquo;t be loaded right now. Please refresh in a moment.
        </p>
      ) : listing.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-line-strong bg-surface p-6 sm:p-8">
          <h2 className="text-xl font-semibold">Our founding coaches are being confirmed</h2>
          <p className="mt-2 max-w-2xl text-ink-muted">Their profiles and packages appear here once TalentYak has approved them.</p>
          <ButtonLink href="/waitlist" className="mt-5">Join the waitlist</ButtonLink>
        </div>
      ) : (
        <div className="mt-10 space-y-14">
          {listing.map(({ coach, plans }) => {
            const photo = coachPhotoUrl(coach.photo_path);
            return (
              <section key={coach.provider_id} aria-labelledby={`coach-${coach.slug}`}>
                <div className="flex flex-wrap items-center gap-4">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="" width={64} height={64} className="size-16 rounded-xl object-cover" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <h2 id={`coach-${coach.slug}`} className="text-2xl font-semibold">{coach.display_name}</h2>
                    <p className="text-ink-muted">
                      {coach.headline ? `${coach.headline} · ` : ""}
                      <span className={coach.availability === "available" ? "font-semibold text-brand" : ""}>{availabilityText(coach)}</span>
                    </p>
                  </div>
                  <Link href={`/coaches/${coach.slug}`} className="inline-flex min-h-11 w-full items-center font-semibold text-brand underline underline-offset-4 sm:w-auto">
                    About {coach.display_name}
                  </Link>
                </div>
                {plans.length === 0 ? (
                  <p className="mt-4 text-ink-muted">No packages on sale right now.</p>
                ) : (
                  <ul className="mt-5 grid gap-5 md:grid-cols-2">
                    {plans.map((plan) => (
                      <li key={plan.version_id}>
                        <PackageCard
                          coach={coach}
                          plan={plan}
                          mode={mode}
                          action={packageAction({ coach, plan, mode, expectationsPublished: expectations.get(coach.provider_id) ?? false })}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
