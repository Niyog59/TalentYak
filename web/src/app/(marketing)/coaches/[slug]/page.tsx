import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/button";
import { getPublicCoach } from "@/lib/offers/public";
import { coachPhotoUrl } from "@/lib/storage/photos";
import { PlanInclusions, PriceList } from "@/components/marketing/plan-details";
import { getSession } from "@/lib/auth";
import { getLiveExpectations } from "@/lib/expectations/server";
import { ExpectationsDocument } from "@/components/expectations/document";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const found = await getPublicCoach(slug);
  if (!found) return { title: "Coach not found" };
  return {
    title: `${found.coach.display_name} — coach`,
    description: found.coach.headline ?? `Coaching plans from ${found.coach.display_name} on TalentYak.`,
  };
}

export default async function CoachProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const [{ slug }, { checkout }] = await Promise.all([params, searchParams]);
  const found = await getPublicCoach(slug);
  if (!found) notFound();
  const { coach, plans } = found;
  const session = await getSession();
  const photo = coachPhotoUrl(coach.photo_path);
  const years = coach.experience_since ? new Date().getUTCFullYear() - Number(coach.experience_since.slice(0, 4)) : null;
  const displayCurrency = session?.profile.display_currency ?? null;
  // The public, non-personalised version: no client, no health data, nothing
  // about anyone who has bought.
  const expectations = await getLiveExpectations(coach.provider_id);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 md:py-14">
      <Link href="/coaches" className="inline-flex min-h-11 items-center font-semibold text-brand underline-offset-4 hover:underline">
        ← All coaches
      </Link>

      {checkout === "cancelled" ? (
        <p role="status" className="mt-4 rounded-lg border border-line-strong bg-paper-raised p-4">
          Checkout was cancelled. Nothing was charged.
        </p>
      ) : null}

      <header className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={`Photo of ${coach.display_name}`} width={160} height={160} className="size-40 rounded-2xl object-cover" />
        ) : null}
        <div className="min-w-0">
          <h1 className="font-display text-4xl sm:text-5xl">{coach.display_name}</h1>
          {coach.headline ? <p className="mt-2 text-lg text-ink-muted">{coach.headline}</p> : null}
          <p className="mt-3">
            Coaches in {coach.languages.join(", ")}
            {years && years > 0 ? ` · coaching for ${years}+ year${years === 1 ? "" : "s"}` : ""}
            {coach.timezone ? ` · based in ${coach.timezone.split("/").pop()?.replaceAll("_", " ")} time` : ""}
          </p>
          {!coach.accepting_new_clients ? (
            <p className="mt-3 rounded-lg border border-line-strong bg-paper-raised p-3 font-medium">
              {coach.display_name} isn&rsquo;t taking new ongoing clients right now.
            </p>
          ) : null}
        </div>
      </header>

      {coach.bio ? (
        <section className="mt-10" aria-labelledby="about">
          <h2 id="about" className="text-2xl font-semibold">About</h2>
          <p className="mt-3 max-w-3xl whitespace-pre-line">{coach.bio}</p>
        </section>
      ) : null}
      {coach.approach ? (
        <section className="mt-8" aria-labelledby="approach">
          <h2 id="approach" className="text-2xl font-semibold">How I coach</h2>
          <p className="mt-3 max-w-3xl whitespace-pre-line">{coach.approach}</p>
        </section>
      ) : null}
      {coach.specialties.length ? (
        <p className="mt-6"><span className="font-semibold">Specialties:</span> {coach.specialties.join(", ")}</p>
      ) : null}

      <section className="mt-12" aria-labelledby="plans">
        <h2 id="plans" className="text-2xl font-semibold">Plans</h2>
        <p className="mt-2 max-w-3xl text-ink-muted">
          Prices are set by {coach.display_name}. You&rsquo;re charged in the currency shown on the plan you choose
          {displayCurrency ? ` — if it isn't ${displayCurrency}, your bank converts it at its own rate` : ""}. Nothing is charged until you confirm at checkout.
        </p>
        {plans.length === 0 ? (
          <p className="mt-6 text-ink-muted">No plans are on sale right now.</p>
        ) : (
          <ul className="mt-6 grid gap-5 md:grid-cols-2">
            {plans.map((plan) => {
              const closed = plan.service_type === "recurring_coaching" && !coach.accepting_new_clients;
              return (
                <li key={plan.version_id} className="flex flex-col rounded-2xl border border-line bg-surface p-5">
                  <h3 className="text-xl font-semibold">{plan.title}</h3>
                  <p className="text-sm text-ink-muted">
                    {plan.service_type === "recurring_coaching" ? "Monthly coaching · renews each month until you cancel" : "One-off session"}
                  </p>
                  <div className="mt-3"><PriceList plan={plan} /></div>
                  {plan.intended_client ? <p className="mt-2 text-sm"><span className="font-semibold">For:</span> {plan.intended_client}</p> : null}
                  {plan.description ? <p className="mt-3 whitespace-pre-line">{plan.description}</p> : null}
                  <div className="mt-4"><PlanInclusions plan={plan} /></div>
                  <div className="mt-auto flex flex-wrap gap-3 pt-5">
                    {closed ? (
                      <p className="font-medium text-ink-muted">Not taking new clients</p>
                    ) : (
                      plan.prices.map((p) => (
                        <ButtonLink key={p.currency} href={`/checkout/${plan.version_id}?currency=${p.currency}`} variant={plan.prices.length > 1 ? "secondary" : "primary"}>
                          Choose — pay in {p.currency}
                        </ButtonLink>
                      ))
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="welcome">
        <h2 id="welcome" className="text-2xl font-semibold">Welcome &amp; expectations</h2>
        {expectations.coach && expectations.platform ? (
          <>
            <p className="mt-2 max-w-3xl text-ink-muted">
              What you and {coach.display_name} can expect from each other. You&rsquo;ll see it again, with your plan&rsquo;s details, before you pay.
            </p>
            <details className="mt-4 max-w-3xl rounded-2xl border border-line">
              <summary className="flex min-h-11 cursor-pointer items-center px-5 py-3 font-semibold text-brand underline underline-offset-4">
                Read {coach.display_name}&rsquo;s welcome &amp; expectations
              </summary>
              <div className="border-t border-line">
                <ExpectationsDocument
                  platform={expectations.platform}
                  coach={expectations.coach}
                  coachName={coach.display_name}
                  coachPhotoUrl={photo}
                  plan={null}
                  headingLevel={2}
                />
              </div>
            </details>
          </>
        ) : (
          <p className="mt-2 text-ink-muted">
            {coach.display_name} hasn&rsquo;t published their welcome and expectations yet. Plans can be bought once they have.
          </p>
        )}
      </section>
    </div>
  );
}
