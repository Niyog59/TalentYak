import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/button";
import { EmptyState } from "@/components/ui/empty-state";
import { listPublicCoaches } from "@/lib/offers/public";
import { coachPhotoUrl } from "@/lib/storage/photos";
import { PriceList } from "@/components/marketing/plan-details";

export const metadata: Metadata = {
  title: "Find a coach",
  description: "Compare coaches, what each plan includes and the price with its currency before you pay.",
};

// Coaches change their own profiles and prices; the list is read per request.
export const dynamic = "force-dynamic";

/*
 * Public coach directory: only coaches who are approved, have made their
 * profile public, and are in a public service. No sample coaches, ever.
 */
export default async function CoachesPage() {
  const listing = await listPublicCoaches();

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:py-16">
      <h1 className="font-display text-4xl sm:text-5xl">Find a coach</h1>
      <p className="mt-3 max-w-2xl text-lg text-ink-muted">
        Compare coaches, what each plan includes and the price with its currency — before you pay.
      </p>

      {listing === null ? (
        <p role="alert" className="mt-10 rounded-lg border border-danger bg-danger-tint p-4">
          The coach list couldn&rsquo;t be loaded right now. Please try again in a moment.
        </p>
      ) : listing.length === 0 ? (
        <EmptyState
          className="mt-10"
          icon="coaches"
          title="No coaches are listed yet"
          actions={
            <>
              <ButtonLink href="/how-it-works" variant="secondary">How TalentYak works</ButtonLink>
              <ButtonLink href="/become-a-coach" variant="quiet">Become a coach</ButtonLink>
            </>
          }
        >
          Coach profiles appear here once coaches have been approved and published their plans.
        </EmptyState>
      ) : (
        <ul className="mt-10 grid gap-5 md:grid-cols-2">
          {listing.map(({ coach, plans }) => {
            const photo = coachPhotoUrl(coach.photo_path);
            const monthly = plans.find((p) => p.service_type === "recurring_coaching") ?? plans[0];
            return (
              <li key={coach.provider_id} className="flex flex-col rounded-2xl border border-line bg-surface p-5">
                <div className="flex items-start gap-4">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="" width={72} height={72} className="size-18 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span aria-hidden className="flex size-18 shrink-0 items-center justify-center rounded-xl bg-brand-tint font-display text-2xl text-brand">
                      {coach.display_name.slice(0, 1)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <h2 className="text-xl font-semibold">
                      <Link href={`/coaches/${coach.slug}`} className="underline-offset-4 hover:underline">
                        {coach.display_name}
                      </Link>
                    </h2>
                    {coach.headline ? <p className="text-ink-muted">{coach.headline}</p> : null}
                    <p className="mt-1 text-sm text-ink-muted">
                      Coaches in {coach.languages.join(", ") || "—"}
                      {coach.accepting_new_clients ? "" : " · not taking new clients right now"}
                    </p>
                  </div>
                </div>
                {coach.specialties.length ? (
                  <ul className="mt-3 flex flex-wrap gap-2" aria-label="Specialties">
                    {coach.specialties.slice(0, 6).map((s) => (
                      <li key={s} className="rounded-full bg-paper-raised px-2.5 py-0.5 text-sm">{s}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-auto pt-4">
                  {monthly ? (
                    <>
                      <p className="text-sm font-semibold">{monthly.title}</p>
                      <PriceList plan={monthly} />
                      {plans.length > 1 ? <p className="text-sm text-ink-muted">+ {plans.length - 1} more plan{plans.length > 2 ? "s" : ""}</p> : null}
                    </>
                  ) : (
                    <p className="text-sm text-ink-muted">No plans on sale right now.</p>
                  )}
                  <ButtonLink href={`/coaches/${coach.slug}`} variant="secondary" className="mt-3">
                    View {coach.display_name}
                  </ButtonLink>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
