import type { Metadata } from "next";
import { CoachCard } from "@/components/fitness/coach-card";
import { sampleCoaches } from "@/lib/sample/fitness";

export const metadata: Metadata = { title: "Coach directory" };

export default function PreviewCoachesPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:py-16">
      <h1 className="font-display text-5xl">Find a coach</h1>
      <p className="mt-3 max-w-2xl text-lg text-ink-muted">
        Compare coaches, what each plan includes and the price with its
        currency — before you pay.
      </p>
      <p className="mt-6 text-ink-muted">
        <span className="tabular font-semibold text-ink">{sampleCoaches.length}</span> coaches
      </p>
      <ul className="mt-4 grid gap-5 md:grid-cols-2">
        {sampleCoaches.map((coach) => (
          <li key={coach.slug}>
            <CoachCard coach={coach} href={`/preview/coaches/${coach.slug}`} />
          </li>
        ))}
      </ul>
    </div>
  );
}
