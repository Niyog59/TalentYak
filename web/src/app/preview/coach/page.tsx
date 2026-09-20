import type { Metadata } from "next";
import Link from "next/link";
import { ClientList } from "@/app/preview/coach/client-list";
import { Icon } from "@/components/ui/icon";
import { formatInZone, zoneCity } from "@/lib/format";
import { sampleCoachOverview } from "@/lib/sample/fitness";

export const metadata: Metadata = { title: "Coach overview" };

const reviewAction: Record<string, string> = {
  "Check-in": "Review check-in",
  "Form video": "Review form video",
  Message: "Reply to message",
};

export default function PreviewCoachOverviewPage() {
  const zone = sampleCoachOverview.coachTimeZone;
  const zoneLabel = formatInZone(sampleCoachOverview.upcomingCalls[0].startsAt, zone).zone;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl font-semibold">Overview</h1>
        <p className="flex items-center gap-2 text-ink-muted">
          <Icon name="globe" className="size-5" />
          Times shown in {zoneCity(zone)} time ({zoneLabel})
        </p>
      </header>

      <div className="mt-8 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="review-heading" className="rounded-2xl border border-line bg-surface">
          <div className="flex items-baseline justify-between gap-3 px-5 pt-5 sm:px-6">
            <h2 id="review-heading" className="text-xl font-semibold">Needs your review</h2>
            <p className="tabular text-ink-muted">{sampleCoachOverview.needsReview.length} items</p>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {sampleCoachOverview.needsReview.map((item) => {
              const received = formatInZone(item.at, zone);
              return (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-accent-text">{item.kind}</p>
                    <p className="font-semibold">{item.client}</p>
                    <p className="text-ink-muted">
                      {item.detail} · {received.date}, {received.time}
                    </p>
                  </div>
                  <Link
                    href={`/preview/coach/clients/${item.clientId}`}
                    className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 font-semibold hover:border-ink hover:bg-paper-raised"
                  >
                    {reviewAction[item.kind] ?? "Open"}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="calls-heading" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <h2 id="calls-heading" className="text-xl font-semibold">Upcoming calls</h2>
          <ul className="mt-3 divide-y divide-line">
            {sampleCoachOverview.upcomingCalls.map((call) => {
              const mine = formatInZone(call.startsAt, zone);
              const theirs = formatInZone(call.startsAt, call.clientTimeZone);
              return (
                <li key={call.id} className="py-3">
                  <p className="tabular text-lg font-semibold">
                    {mine.date}, {mine.time} <span className="font-normal text-ink-muted">{mine.zone}</span>
                  </p>
                  <p>
                    {call.client} · {call.durationMinutes} min {call.modality.toLowerCase()}
                  </p>
                  <p className="tabular text-sm text-ink-muted">
                    Client&rsquo;s time: {theirs.time} {theirs.zone} ({zoneCity(call.clientTimeZone)})
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section aria-labelledby="clients-heading" className="mt-8">
        <h2 id="clients-heading" className="text-xl font-semibold">Clients</h2>
        <div className="mt-4">
          <ClientList />
        </div>
      </section>
    </>
  );
}
