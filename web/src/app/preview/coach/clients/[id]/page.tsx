import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WeightTrend } from "@/components/fitness/weight-trend";
import { Icon } from "@/components/ui/icon";
import { SoonTag } from "@/components/ui/sample";
import { UnavailableAction } from "@/components/ui/unavailable";
import { formatDay, zoneCity } from "@/lib/format";
import {
  sampleClientDetail,
  sampleCoachOverview,
  sampleHistory,
  sampleWeights,
} from "@/lib/sample/fitness";

export const metadata: Metadata = { title: "Client detail" };

const sections = [
  { id: "programme", label: "Programme" },
  { id: "progress", label: "Progress" },
  { id: "check-ins", label: "Check-ins" },
  { id: "media", label: "Media" },
];

export function generateStaticParams() {
  return sampleCoachOverview.clients.map((client) => ({ id: client.id }));
}

export default async function PreviewClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rosterEntry = sampleCoachOverview.clients.find((c) => c.id === id);
  if (!rosterEntry) notFound();

  // One detailed sample defines the layout. Every client on the roster opens
  // it with their own name, plan and timezone.
  const client = {
    ...sampleClientDetail,
    id: rosterEntry.id,
    name: rosterEntry.name,
    plan: rosterEntry.plan,
    timeZone: rosterEntry.timeZone,
  };

  return (
    <>
      <Link
        href="/preview/coach/clients"
        className="inline-flex min-h-11 items-center gap-2 font-semibold text-brand underline-offset-4 hover:underline"
      >
        <Icon name="arrowRight" className="size-4 rotate-180" />
        Clients
      </Link>

      <header className="mt-4">
        <h1 className="text-4xl font-semibold">{client.name}</h1>
        <p className="mt-2 text-ink-muted">
          {client.plan} · {zoneCity(client.timeZone)} time · client since{" "}
          {formatDay(client.startedOn, { month: "long", day: "numeric" })}
        </p>
        <p className="mt-3 max-w-2xl">
          <span className="font-semibold">Goals: </span>
          {client.goals}
        </p>
      </header>

      <nav
        aria-label="Client sections"
        className="sticky top-14 z-20 -mx-4 mt-6 overflow-x-auto border-y border-line bg-paper px-4 lg:top-0 lg:mx-0 lg:rounded-xl lg:border lg:px-2"
      >
        <ul className="flex gap-1 py-1.5">
          {sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 font-semibold hover:bg-paper-raised"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <section
        id="programme"
        aria-labelledby="programme-heading"
        className="mt-8 scroll-mt-32 rounded-2xl border border-line bg-surface p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="programme-heading" className="text-2xl font-semibold">Programme</h2>
          <p className="text-ink-muted">
            Version {client.programme.version} · published {formatDay(client.programme.publishedOn)}
          </p>
        </div>
        <p className="mt-2 text-ink-muted">
          You decide when to change it. Keeping the current programme is a
          complete review. Earlier versions stay in the history exactly as they were.
        </p>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {client.programme.days.map((day) => (
            <div key={day.title} className="rounded-xl border border-line p-4">
              <h3 className="font-semibold">{day.title}</h3>
              <ul className="tabular mt-2 space-y-1 text-ink-muted">
                {day.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-ink-muted">
          Previous:{" "}
          {client.programme.previousVersions
            .map((v) => `version ${v.version} (${formatDay(v.publishedOn)})`)
            .join(", ")}
        </p>
        <UnavailableAction className="mt-5 max-w-sm" label="Edit programme" reason="Programme editing is built in M11." />
      </section>

      <section
        id="progress"
        aria-labelledby="progress-heading"
        className="mt-5 scroll-mt-32 rounded-2xl border border-line bg-surface p-5 sm:p-6"
      >
        <h2 id="progress-heading" className="text-2xl font-semibold">Progress</h2>
        <div className="mt-4">
          <WeightTrend entries={sampleWeights} unit="kg" headingId="progress-heading" />
        </div>
        <h3 className="mt-6 font-semibold">Recent workouts</h3>
        <ul className="mt-2 divide-y divide-line">
          {sampleHistory.slice(0, 3).map((session) => (
            <li key={session.id} className="flex flex-wrap justify-between gap-2 py-2.5">
              <span>
                {session.title} <span className="tabular text-ink-muted">· {session.done}</span>
              </span>
              <span className="text-ink-muted">{formatDay(session.date)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        id="check-ins"
        aria-labelledby="checkins-heading"
        className="mt-5 scroll-mt-32 rounded-2xl border border-line bg-surface p-5 sm:p-6"
      >
        <h2 id="checkins-heading" className="text-2xl font-semibold">Check-ins</h2>
        <ul className="mt-3 divide-y divide-line">
          {client.checkIns.map((checkIn) => (
            <li key={checkIn.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-semibold">
                  {formatDay(checkIn.date, { weekday: "short", month: "short", day: "numeric" })}
                </p>
                <p className="text-ink-muted">{checkIn.summary}</p>
              </div>
              <span className="rounded-full bg-paper-raised px-3 py-1 text-sm font-semibold">{checkIn.status}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        id="media"
        aria-labelledby="media-heading"
        className="mt-5 scroll-mt-32 rounded-2xl border border-line bg-surface p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="media-heading" className="text-2xl font-semibold">Form videos and photos</h2>
          <SoonTag />
        </div>
        <p className="mt-2 flex gap-2 text-ink-muted">
          <Icon name="lock" className="mt-0.5 size-5 shrink-0" />
          Private to {client.name} and you. Another coach can&rsquo;t open these.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {client.media.map((item) => (
            <li key={item.id} className="flex gap-3 rounded-xl border border-line p-3">
              <span
                aria-hidden="true"
                className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-paper-raised text-ink-muted"
              >
                <Icon name={item.kind === "Form video" ? "video" : "camera"} className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold">{item.kind}</p>
                <p className="text-ink-muted">
                  {item.label} · {formatDay(item.date)}
                </p>
                <p className="text-sm">{item.reviewed ? "Reviewed" : "Waiting for your review"}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
