import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";
import { QuickWeightEntry } from "@/components/fitness/quick-weight-entry";
import { Icon } from "@/components/ui/icon";
import { UnavailableAction } from "@/components/ui/unavailable";
import { formatDay, formatInZone, formatWeight, zoneCity } from "@/lib/format";
import {
  sampleCustomer,
  sampleFeedback,
  sampleNextCall,
  sampleWeights,
  sampleWorkout,
} from "@/lib/sample/fitness";

export const metadata: Metadata = { title: "Today" };

export default function PreviewTodayPage() {
  const call = formatInZone(sampleNextCall.startsAt, sampleCustomer.timeZone);
  const coachSide = formatInZone(sampleNextCall.startsAt, sampleNextCall.coachTimeZone);
  const lastWeight = sampleWeights[sampleWeights.length - 1];

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-ink-muted">Thursday, September 10</p>
          <h1 className="text-4xl font-semibold">Today</h1>
        </div>
        <p className="flex items-center gap-2 text-ink-muted">
          <Icon name="globe" className="size-5" />
          Times shown in {zoneCity(sampleCustomer.timeZone)} time ({call.zone})
        </p>
      </header>

      <div className="mt-8 grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <section
          aria-labelledby="workout-heading"
          className="on-dark rounded-2xl bg-ink p-6 text-paper sm:p-7 lg:row-span-2"
        >
          <p className="font-semibold text-paper/85">Today&rsquo;s workout</p>
          <h2 id="workout-heading" className="mt-1 font-display text-5xl">
            {sampleWorkout.title}
          </h2>
          <p className="mt-2 text-paper/85">
            {sampleWorkout.programme} · version {sampleWorkout.programmeVersion} · week{" "}
            {sampleWorkout.week}, day {sampleWorkout.day} · about {sampleWorkout.estimatedMinutes} minutes
          </p>
          <ul className="mt-6 divide-y divide-paper/15 border-y border-paper/15">
            {sampleWorkout.exercises.map((exercise) => (
              <li key={exercise.id} className="flex justify-between gap-4 py-3">
                <span>{exercise.name}</span>
                <span className="tabular shrink-0 text-paper/85">
                  {exercise.sets} × {exercise.targetReps}
                </span>
              </li>
            ))}
          </ul>
          <ButtonLink href="/preview/customer/workout" variant="inverse" className="mt-7 w-full sm:w-auto">
            Start workout
            <Icon name="arrowRight" />
          </ButtonLink>
        </section>

        <section aria-labelledby="call-heading" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <h2 id="call-heading" className="flex items-center gap-2 font-semibold">
            <Icon name="video" className="size-5 text-brand" />
            Next call
          </h2>
          <p className="mt-3 text-2xl font-semibold">{call.date}</p>
          <p className="tabular text-2xl">
            {call.time} <span className="text-lg text-ink-muted">{call.zone}</span>
          </p>
          <p className="mt-2 text-ink-muted">
            {sampleNextCall.durationMinutes}-minute {sampleNextCall.modality.toLowerCase()} with{" "}
            {sampleNextCall.coachName}. For your coach it&rsquo;s {coachSide.date}, {coachSide.time}{" "}
            in {zoneCity(sampleNextCall.coachTimeZone)}.
          </p>
          <UnavailableAction className="mt-5" label="Join call" reason="Calls aren't built yet." />
        </section>

        <section aria-label="Log your weight" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <QuickWeightEntry
            dateLabel="Thu, Sep 10"
            unit={sampleCustomer.weightUnit}
            lastEntry={`${formatWeight(lastWeight.kg, sampleCustomer.weightUnit)} on ${formatDay(lastWeight.date)}`}
          />
        </section>

        <section aria-labelledby="feedback-heading" className="lg:col-span-2">
          <h2 id="feedback-heading" className="text-xl font-semibold">Recent feedback from your coach</h2>
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {sampleFeedback.map((item) => (
              <li key={item.id} className="rounded-2xl border border-line bg-surface p-5">
                <p className="text-sm text-ink-muted">
                  {formatDay(item.date)} · {item.about}
                </p>
                <p className="mt-2">{item.text}</p>
                <p className="mt-3 text-sm font-semibold">{item.from}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
