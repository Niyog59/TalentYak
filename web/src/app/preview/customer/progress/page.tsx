import type { Metadata } from "next";
import { WeightTrend } from "@/components/fitness/weight-trend";
import { Icon } from "@/components/ui/icon";
import { SoonTag } from "@/components/ui/sample";
import { formatDay } from "@/lib/format";
import { sampleCustomer, sampleFeedback, sampleHistory, sampleWeights } from "@/lib/sample/fitness";

export const metadata: Metadata = { title: "Progress" };

export default function PreviewProgressPage() {
  return (
    <>
      <h1 className="text-4xl font-semibold">Progress</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">
        Your records, shown as they are. Your coach sees the same records.
      </p>

      <section aria-labelledby="weight-heading" className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="weight-heading" className="text-xl font-semibold">Body weight</h2>
        <div className="mt-4">
          <WeightTrend entries={sampleWeights} unit={sampleCustomer.weightUnit} headingId="weight-heading" />
        </div>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section aria-labelledby="history-heading" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <h2 id="history-heading" className="text-xl font-semibold">Training history</h2>
          <ul className="mt-4 divide-y divide-line">
            {sampleHistory.map((session) => (
              <li key={session.id} className="py-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-semibold">{session.title}</p>
                  <p className="text-ink-muted">{formatDay(session.date, { weekday: "short", month: "short", day: "numeric" })}</p>
                </div>
                <p className="tabular text-ink-muted">{session.done}</p>
                {session.note && <p className="mt-1">&ldquo;{session.note}&rdquo;</p>}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="coach-feedback-heading" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <h2 id="coach-feedback-heading" className="text-xl font-semibold">Coach feedback</h2>
          <ul className="mt-4 divide-y divide-line">
            {sampleFeedback.map((item) => (
              <li key={item.id} className="py-3">
                <p className="text-sm text-ink-muted">
                  {formatDay(item.date)} · {item.about}
                </p>
                <p className="mt-1">{item.text}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section aria-labelledby="private-heading" className="mt-5 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="private-heading" className="text-xl font-semibold">Measurements and progress photos</h2>
          <SoonTag />
        </div>
        <p className="mt-2 flex gap-2 text-ink-muted">
          <Icon name="lock" className="mt-0.5 size-5 shrink-0" />
          Private. Only you and your current coach can see these.
        </p>
      </section>
    </>
  );
}
