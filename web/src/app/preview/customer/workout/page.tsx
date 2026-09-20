import type { Metadata } from "next";
import Link from "next/link";
import { WorkoutLogger } from "@/components/fitness/workout-logger";
import { Icon } from "@/components/ui/icon";
import { sampleCustomer, sampleWorkout } from "@/lib/sample/fitness";

export const metadata: Metadata = { title: "Workout logging" };

export default function PreviewWorkoutPage() {
  return (
    <>
      <Link
        href="/preview/customer"
        className="inline-flex min-h-11 items-center gap-2 font-semibold text-brand underline-offset-4 hover:underline"
      >
        <Icon name="arrowRight" className="size-4 rotate-180" />
        Today
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold">{sampleWorkout.title}</h1>
          <p className="mt-2 text-ink-muted">
            {sampleWorkout.programme} · version {sampleWorkout.programmeVersion} · week{" "}
            {sampleWorkout.week}, day {sampleWorkout.day} · about {sampleWorkout.estimatedMinutes} minutes
          </p>
        </div>
        <p className="rounded-full border border-line-strong px-3 py-1 font-semibold text-ink-muted">
          Not saved
        </p>
      </header>

      <p className="mt-4 max-w-2xl text-ink-muted">
        Enter what you actually did. Leave anything blank that you skipped —
        your coach sees exactly what you record.
      </p>

      <div className="mt-8">
        <WorkoutLogger exercises={sampleWorkout.exercises} unit={sampleCustomer.weightUnit} />
      </div>
    </>
  );
}
