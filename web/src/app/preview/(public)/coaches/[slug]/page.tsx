import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanCard } from "@/components/fitness/plan-card";
import { Icon } from "@/components/ui/icon";
import { SampleTag } from "@/components/ui/sample";
import { UnavailableAction } from "@/components/ui/unavailable";
import { formatInZone, formatMoney, zoneCity } from "@/lib/format";
import { sampleCoaches, sampleCustomer } from "@/lib/sample/fitness";

export const metadata: Metadata = { title: "Coach profile" };

export function generateStaticParams() {
  return sampleCoaches.map((coach) => ({ slug: coach.slug }));
}

export default async function PreviewCoachProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const coach = sampleCoaches.find((c) => c.slug === slug);
  if (!coach) notFound();

  // Open times are stored as instants and shown in the viewer's timezone.
  const viewerZone = sampleCustomer.timeZone;
  const slots = coach.openSlots.map((iso) => ({ iso, ...formatInZone(iso, viewerZone) }));
  const viewerZoneLabel = slots[0]?.zone ?? viewerZone;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 md:py-14">
      <Link
        href="/preview/coaches"
        className="inline-flex min-h-11 items-center gap-2 font-semibold text-brand underline-offset-4 hover:underline"
      >
        <Icon name="arrowRight" className="size-4 rotate-180" />
        All coaches
      </Link>

      <header className="mt-6 flex flex-col gap-6 md:flex-row md:items-center">
        <span
          aria-hidden="true"
          className="flex size-24 shrink-0 items-center justify-center rounded-2xl bg-brand-tint font-display text-5xl text-brand"
        >
          {coach.initials}
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-5xl">{coach.name}</h1>
            <SampleTag />
          </div>
          <p className="mt-2 text-lg text-ink-muted">
            {coach.basedIn} · Speaks {coach.languages.join(" and ")} · Focus: {coach.focus.join(", ")}
          </p>
          <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-brand-tint px-3 py-1 font-semibold text-brand">
            <Icon name="check" className="size-4" />
            Accepting new clients
          </p>
        </div>
      </header>

      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <section aria-labelledby="intro-heading" className="rounded-2xl border border-dashed border-line-strong p-5 sm:p-6">
          <h2 id="intro-heading" className="font-semibold">About this coach</h2>
          <p className="mt-2 text-ink-muted">
            The coach&rsquo;s own introduction appears here, written by the
            coach. TalentYak doesn&rsquo;t write coach biographies.
          </p>
        </section>
        <section aria-labelledby="credentials-heading" className="rounded-2xl border border-dashed border-line-strong p-5 sm:p-6">
          <h2 id="credentials-heading" className="font-semibold">Qualifications</h2>
          <p className="mt-2 text-ink-muted">
            Credentials appear here only after TalentYak has checked them with
            the organisation that issued them.
          </p>
        </section>
      </div>

      <section aria-labelledby="plans-heading" className="mt-14">
        <h2 id="plans-heading" className="font-display text-4xl">Ongoing coaching</h2>
        <p className="mt-2 max-w-2xl text-ink-muted">
          {coach.name} sets these plans and prices. Each lists exactly what&rsquo;s
          included, in the same order, so you can compare.
        </p>
        <ul className="mt-6 grid gap-5 lg:grid-cols-2">
          {coach.plans.map((plan) => (
            <li key={plan.id}>
              <PlanCard plan={plan} coach={coach} />
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-14 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <section aria-labelledby="consult-heading" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="consult-heading" className="text-2xl font-semibold">{coach.consultation.name}</h2>
            <SampleTag label="Sample offer" />
          </div>
          <p className="mt-4">
            <span className="tabular text-3xl font-semibold">
              {formatMoney(coach.consultation.priceMinor, coach.consultation.currency)}
            </span>{" "}
            <span className="text-ink-muted">
              for {coach.consultation.durationMinutes} minutes · {coach.consultation.modality}
            </span>
          </p>
          <p className="mt-3">{coach.consultation.purpose}</p>
          <p className="mt-3 text-ink-muted">This is a paid session. It isn&rsquo;t free and doesn&rsquo;t include an ongoing programme.</p>
          <UnavailableAction className="mt-6" label="Book a consultation" reason="Booking isn't built yet." />
        </section>

        <section aria-labelledby="times-heading" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <h2 id="times-heading" className="text-2xl font-semibold">Next open times</h2>
          <p className="mt-2 flex items-center gap-2 text-ink-muted">
            <Icon name="globe" className="size-5 shrink-0" />
            Shown in your time: {zoneCity(viewerZone)} ({viewerZoneLabel})
          </p>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {slots.map((slot) => (
              <li key={slot.iso} className="tabular flex min-h-12 items-center justify-between gap-3 py-2">
                <span>{slot.date}</span>
                <span className="font-semibold">
                  {slot.time} <span className="font-normal text-ink-muted">{slot.zone}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-muted">
            {coach.name} sets availability in {zoneCity(coach.timeZone)} time. Changing
            your timezone isn&rsquo;t built yet.
          </p>
        </section>
      </div>
    </div>
  );
}
