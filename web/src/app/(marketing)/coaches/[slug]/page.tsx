import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/button";
import { ExpectationsDocument } from "@/components/expectations/document";
import { JsonLd } from "@/components/marketing/json-ld";
import { availabilityText } from "@/components/marketing/launch-home";
import { PackageCard, packageAction } from "@/components/marketing/package-card";
import { TrackView } from "@/components/marketing/track";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { getLiveExpectations } from "@/lib/expectations/server";
import { purchaseMode } from "@/lib/launch";
import { featureOnForEveryone } from "@/lib/features/server";
import { getPublicCoach } from "@/lib/offers/public";
import { coachPhotoUrl } from "@/lib/storage/photos";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const found = await getPublicCoach(slug);
  if (!found) return { title: "Coach not found", robots: { index: false } };
  const photo = coachPhotoUrl(found.coach.photo_path);
  const description = found.coach.headline ?? `Fitness coaching packages from ${found.coach.display_name} on TalentYak.`;
  return {
    title: `${found.coach.display_name} — fitness coach`,
    description,
    alternates: { canonical: `/coaches/${found.coach.slug}` },
    openGraph: { title: `${found.coach.display_name} on TalentYak`, description, url: `/coaches/${found.coach.slug}`, images: photo ? [{ url: photo }] : [{ url: "/brand/talentyak/website/talentyak-horizontal-light.png", width: 1200, height: 400, alt: "TalentYak" }] },
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
  if (!(await featureOnForEveryone("public_profiles"))) return <ProfilesPaused waitlistOpen={await featureOnForEveryone("waitlist")} />;
  const found = await getPublicCoach(slug);
  if (!found) notFound();
  const { coach, plans } = found;
  const session = await getSession();
  const mode = await purchaseMode(session);
  const photo = coachPhotoUrl(coach.photo_path);
  const years = coach.experience_since ? new Date().getUTCFullYear() - Number(coach.experience_since.slice(0, 4)) : null;
  // The public, non-personalised version: nothing about anyone who has bought.
  const expectations = await getLiveExpectations(coach.provider_id);
  const published = Boolean(expectations.coach && expectations.platform);
  const city = coach.timezone ? coach.timezone.split("/").pop()?.replaceAll("_", " ") : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 md:py-14">
      <TrackView event="coach_profile_view" subject={coach.slug} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          mainEntity: {
            "@type": "Person",
            name: coach.display_name,
            ...(coach.headline ? { description: coach.headline } : {}),
            jobTitle: "Fitness coach",
            ...(coach.languages.length ? { knowsLanguage: coach.languages } : {}),
            ...(photo ? { image: photo } : {}),
            url: `${env.siteUrl}/coaches/${coach.slug}`,
            ...(coach.credentials.length
              ? { hasCredential: coach.credentials.map((c) => ({ "@type": "EducationalOccupationalCredential", name: c.title, ...(c.issuing_body ? { recognizedBy: { "@type": "Organization", name: c.issuing_body } } : {}) })) }
              : {}),
          },
        }}
      />
      <Link href="/coaches" className="inline-flex min-h-11 items-center font-semibold text-brand underline-offset-4 hover:underline">
        ← All coaches and packages
      </Link>

      {checkout === "cancelled" ? (
        <p role="status" className="mt-4 rounded-lg border border-line-strong bg-paper-raised p-4">Checkout was cancelled. Nothing was charged.</p>
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
            Coaches in {coach.languages.join(", ") || "—"}
            {years && years > 0 ? ` · coaching since ${coach.experience_since!.slice(0, 4)}` : ""}
            {city ? ` · based in ${city} time` : ""}
          </p>
          <p className={`mt-3 inline-flex rounded-full border px-3 py-1 font-semibold ${coach.availability === "available" ? "border-brand bg-brand-tint" : "border-line-strong bg-paper-raised"}`}>
            {availabilityText(coach)}
          </p>
          {coach.availability !== "available" ? (
            <p className="mt-3">
              <Link href={`/waitlist?coach=${coach.provider_id}`} className="font-semibold text-brand underline underline-offset-4">
                Join the waitlist for {coach.display_name}
              </Link>{" "}
              — we&rsquo;ll email you when there&rsquo;s room. It doesn&rsquo;t reserve a place.
            </p>
          ) : null}
        </div>
      </header>

      {coach.bio ? (
        <section className="mt-10" aria-labelledby="about">
          <h2 id="about" className="text-2xl font-semibold">About {coach.display_name}</h2>
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
        <section className="mt-8" aria-labelledby="specialties">
          <h2 id="specialties" className="text-2xl font-semibold">Specialties</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {coach.specialties.map((s) => <li key={s} className="rounded-full bg-paper-raised px-3 py-1">{s}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="mt-8" aria-labelledby="qualifications">
        <h2 id="qualifications" className="text-2xl font-semibold">Qualifications</h2>
        {coach.credentials.length ? (
          <ul className="mt-3 space-y-3">
            {coach.credentials.map((c) => (
              <li key={`${c.title}-${c.issued_year}`} className="rounded-xl border border-line bg-surface p-4">
                <p className="font-semibold">{c.title}{c.issuing_body ? ` — ${c.issuing_body}` : ""}{c.issued_year ? ` (${c.issued_year})` : ""}</p>
                <p className="mt-1 text-sm">
                  <span className="rounded-full border border-brand bg-brand-tint px-2 py-0.5 font-semibold">Checked by TalentYak</span>
                  {c.verified_detail ? <span className="text-ink-muted"> · {c.verified_detail}</span> : null}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 max-w-3xl text-ink-muted">
            No qualifications have been checked by TalentYak yet. We only list qualifications once we&rsquo;ve seen the evidence.
          </p>
        )}
      </section>

      <section className="mt-12" aria-labelledby="packages">
        <h2 id="packages" className="text-2xl font-semibold">Packages</h2>
        <p className="mt-2 max-w-3xl text-ink-muted">
          You follow your programme yourself, on your own schedule — workouts aren&rsquo;t live sessions. Messaging, check-ins and
          calls happen as each package describes. Prices are set by {coach.display_name}; you&rsquo;re charged in the currency
          shown{session?.profile.display_currency ? `, and if that isn't ${session.profile.display_currency}, your bank converts it at its own rate` : ""}.
        </p>
        {plans.length === 0 ? (
          <p className="mt-6 text-ink-muted">No packages are on sale right now.</p>
        ) : (
          <ul className="mt-6 grid gap-5 md:grid-cols-2">
            {plans.map((plan) => (
              <li key={plan.version_id}>
                <PackageCard coach={coach} plan={plan} mode={mode} action={packageAction({ coach, plan, mode, expectationsPublished: published })} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="welcome">
        <h2 id="welcome" className="text-2xl font-semibold">Welcome &amp; expectations</h2>
        {published ? (
          <>
            <p className="mt-2 max-w-3xl text-ink-muted">
              What you and {coach.display_name} can expect from each other, in {coach.display_name}&rsquo;s words — including how quickly they usually reply. You&rsquo;ll see it again, with your package&rsquo;s details, before you pay.
            </p>
            {expectations.coach?.response_expectation ? (
              <p className="mt-3 max-w-3xl"><span className="font-semibold">Usual reply time:</span> {expectations.coach.response_expectation}</p>
            ) : null}
            <details className="mt-4 max-w-3xl rounded-2xl border border-line">
              <summary className="flex min-h-11 cursor-pointer items-center px-5 py-3 font-semibold text-brand underline underline-offset-4">
                Read {coach.display_name}&rsquo;s welcome &amp; expectations
              </summary>
              <div className="border-t border-line">
                <ExpectationsDocument platform={expectations.platform!} coach={expectations.coach!} coachName={coach.display_name} coachPhotoUrl={photo} plan={null} headingLevel={2} />
              </div>
            </details>
          </>
        ) : (
          <p className="mt-2 text-ink-muted">{coach.display_name} hasn&rsquo;t published their welcome and expectations yet. Packages can be bought once they have.</p>
        )}
      </section>

      <section className="mt-12 rounded-2xl border border-line bg-paper-raised p-5" aria-labelledby="questions">
        <h2 id="questions" className="text-xl font-semibold">Questions before you choose?</h2>
        <p className="mt-2">
          Coaches can&rsquo;t be messaged before you buy. Ask TalentYak instead — see <Link href="/about#support-heading" className="underline">contact</Link> and{" "}
          <Link href="/#faq-heading" className="underline">common questions</Link>.
        </p>
        <ButtonLink href="/coaches" variant="secondary" className="mt-4">See all coaches</ButtonLink>
      </section>
    </div>
  );
}

function ProfilesPaused({ waitlistOpen }: { waitlistOpen: boolean }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-4xl sm:text-5xl">Coaches</h1>
      <p role="note" className="mt-6 rounded-lg border border-line-strong bg-paper-raised p-4">
        Coach profiles are unavailable for a short while. Nothing has changed with anyone&rsquo;s coaching.{" "}
        {waitlistOpen ? (
          <><Link href="/waitlist" className="font-semibold underline">Join the waitlist</Link> to hear when you can start.</>
        ) : env.supportEmail ? (
          <>Questions? Email <a href={`mailto:${env.supportEmail}`} className="font-semibold underline">{env.supportEmail}</a>.</>
        ) : null}
      </p>
    </div>
  );
}
