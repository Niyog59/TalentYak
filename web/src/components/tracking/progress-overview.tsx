import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/panel";
import { TrendChart } from "@/components/tracking/trend-chart";
import { formatDay } from "@/lib/format";
import { METRIC_LABEL, RANGES, type DateRange, type PlannedOutcome } from "@/lib/tracking/progress";
import type { Overview } from "@/lib/tracking/overview";
import { formatDelta, trimNumber, type LengthUnit, type WeightUnit } from "@/lib/tracking/units";

/*
 * The progress page's body, shared by the client and their coach. Every
 * figure says what it is made of; empty sections say what would fill them.
 */

const OUTCOME_LABEL: Record<PlannedOutcome, string> = {
  completed: "Completed",
  partial: "Partly done",
  skipped: "Skipped",
  unlogged: "Not logged",
  upcoming: "Coming up",
};

export function RangePicker({ range, base, extra = {} }: { range: DateRange; base: string; extra?: Record<string, string> }) {
  const q = (p: Record<string, string>) => `${base}?${new URLSearchParams({ ...extra, ...p }).toString()}`;
  return (
    <div className="mt-6">
      <nav aria-label="Date range" className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Link
            key={r.id}
            href={q({ range: r.id })}
            aria-current={range.id === r.id ? "true" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 font-semibold ${range.id === r.id ? "border-brand bg-brand text-white" : "border-line-strong bg-surface"}`}
          >
            {r.label}
          </Link>
        ))}
      </nav>
      <form method="get" action={base} className="mt-3 flex flex-wrap items-end gap-2">
        {Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label className="block">
          <span className="block text-sm font-semibold">From</span>
          <input type="date" name="from" defaultValue={range.from} className="mt-1 min-h-11 rounded-lg border border-line-strong bg-surface px-3" />
        </label>
        <label className="block">
          <span className="block text-sm font-semibold">To</span>
          <input type="date" name="to" defaultValue={range.to} className="mt-1 min-h-11 rounded-lg border border-line-strong bg-surface px-3" />
        </label>
        <button type="submit" className="min-h-11 rounded-lg border border-line-strong bg-surface px-4 font-semibold">Show</button>
      </form>
      <p className="mt-2 text-sm text-ink-muted">Showing {formatDay(range.from, { month: "short", day: "numeric", year: "numeric" })} – {formatDay(range.to, { month: "short", day: "numeric", year: "numeric" })}.</p>
    </div>
  );
}

export function ProgressOverview({
  overview,
  range,
  weightUnit,
  lengthUnit,
  who,
  workoutHref,
  exerciseParam,
  exerciseHref,
}: {
  overview: Overview;
  range: DateRange;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  who: "client" | "coach";
  workoutHref: (id: string) => string;
  exerciseParam: string | undefined;
  exerciseHref: (key: string) => string;
}) {
  const c = overview.consistency;
  const you = who === "client";
  const selected = overview.series.find((s) => s.key === exerciseParam) ?? overview.series[0] ?? null;
  const measured = overview.measurements.filter((m) => m.readings > 0);

  return (
    <div className="space-y-6">
      {/* ---------------- Consistency ---------------- */}
      <section aria-labelledby="consistency-heading" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="consistency-heading" className="text-xl font-semibold">Workout consistency</h2>
        {!overview.hasPlan ? (
          <p className="mt-2 text-ink-muted">No workout plan yet, so there&rsquo;s no schedule to compare with. Workouts {you ? "you log" : "the client logs"} still appear below.</p>
        ) : overview.inOrder && c.due === 0 ? (
          <p className="mt-2 text-ink-muted">This plan is done in order rather than on set days, so there&rsquo;s no weekly schedule to measure against. Workouts recorded in this period: {overview.workouts.length}.</p>
        ) : c.due === 0 ? (
          <p className="mt-2 text-ink-muted">No planned sessions were due in this period yet.</p>
        ) : (
          <>
            <p className="mt-3 text-3xl font-semibold tabular">
              {c.counts.completed} of {c.due} <span className="text-lg font-normal text-ink-muted">planned sessions completed</span>
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(["completed", "partial", "skipped", "unlogged"] as const).map((k) => (
                <div key={k} className="rounded-lg bg-paper-raised p-3">
                  <dt className="text-sm text-ink-muted">{OUTCOME_LABEL[k]}</dt>
                  <dd className="tabular text-2xl font-semibold">{c.counts[k]}</dd>
                </div>
              ))}
            </dl>
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand">How this is worked out</summary>
              <ul className="list-disc space-y-1 pl-6 text-ink-muted">
                <li>Planned sessions come from {you ? "your" : "the client's"} weekly plan, on the days they actually sat — after any moves. Rest days aren&rsquo;t counted.</li>
                <li>A session counts as done if it was recorded any day that week, so a session done a day late still counts.</li>
                <li>Today and later days aren&rsquo;t counted until they&rsquo;re recorded. An unfinished record counts as partly done.</li>
                <li>Unplanned workouts ({c.unplannedWorkouts} in this period) are shown but never change these numbers.</li>
                {c.weeksWithoutPlan ? <li>{c.weeksWithoutPlan} week{c.weeksWithoutPlan === 1 ? "" : "s"} in this period had no plan in place and {c.weeksWithoutPlan === 1 ? "is" : "are"} left out.</li> : null}
              </ul>
            </details>
            <details className="mt-1">
              <summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand">Session by session</summary>
              <ul className="divide-y divide-line">
                {[...c.planned].reverse().map((p) => (
                  <li key={`${p.weekStart}-${p.sessionKey}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-semibold">{p.title}</span>
                      <span className="text-ink-muted"> · {formatDay(p.plannedOn, { weekday: "short", month: "short", day: "numeric" })}</span>
                    </span>
                    {p.workoutId ? (
                      <Link href={workoutHref(p.workoutId)} className="font-semibold text-brand underline underline-offset-4">{OUTCOME_LABEL[p.outcome]}</Link>
                    ) : (
                      <StatusPill>{OUTCOME_LABEL[p.outcome]}</StatusPill>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>

      {/* ---------------- Body weight ---------------- */}
      <section aria-labelledby="weight-heading" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="weight-heading" className="text-xl font-semibold">Body weight</h2>
        {overview.weights.length ? (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-ink-muted">Latest</dt>
                <dd className="tabular text-2xl font-semibold">{trimNumber(overview.weights.at(-1)!.value)} {weightUnit}</dd>
                <dd className="text-sm text-ink-muted">{formatDay(overview.weights.at(-1)!.date)}</dd>
              </div>
              {overview.weights.length > 1 ? (
                <div>
                  <dt className="text-sm text-ink-muted">Change since {formatDay(overview.weights[0].date)}</dt>
                  <dd className="tabular text-2xl font-semibold">{formatDelta(overview.weights.at(-1)!.value - overview.weights[0].value, weightUnit)}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-sm text-ink-muted">Readings</dt>
                <dd className="tabular text-2xl font-semibold">{overview.weights.length}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <TrendChart points={overview.weights} unit={weightUnit} label="Body weight" valueLabel="Weight" from={range.from} to={range.to} />
            </div>
          </>
        ) : (
          <EmptyState className="mt-4" headingLevel="h3" title="No weights in this period">
            Weighing is optional. {you ? "Add a reading on the Body page whenever you like." : "The client hasn't recorded any here."}
          </EmptyState>
        )}
      </section>

      {/* ---------------- Measurements ---------------- */}
      <section aria-labelledby="measure-heading" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="measure-heading" className="text-xl font-semibold">Measurements</h2>
        {measured.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">First and latest reading of each measurement in this period</caption>
              <thead className="border-b border-line text-sm text-ink-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-semibold">Measurement</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">First</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Latest</th>
                  <th scope="col" className="py-2 font-semibold">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {measured.map((m) => (
                  <tr key={m.field}>
                    <th scope="row" className="py-2 pr-4 font-semibold">{m.label}</th>
                    <td className="tabular py-2 pr-4">{trimNumber(m.first!.value)} {lengthUnit}<span className="block text-sm text-ink-muted">{formatDay(m.first!.date)}</span></td>
                    <td className="tabular py-2 pr-4">{trimNumber(m.latest!.value)} {lengthUnit}<span className="block text-sm text-ink-muted">{formatDay(m.latest!.date)}</span></td>
                    <td className="tabular py-2">{m.change !== null ? formatDelta(m.change, lengthUnit) : "One reading"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-sm text-ink-muted">Each change compares readings actually taken; a measurement not taken on a date is left out, not counted as zero.</p>
          </div>
        ) : (
          <EmptyState className="mt-4" headingLevel="h3" title="No measurements in this period">
            Measurements are optional. {you ? "Add waist, hips, chest or arm on the Body page if you find them useful." : "The client hasn't recorded any here."}
          </EmptyState>
        )}
      </section>

      {/* ---------------- Exercise performance ---------------- */}
      <section aria-labelledby="perf-heading" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="perf-heading" className="text-xl font-semibold">Exercise performance</h2>
        {selected ? (
          <>
            <nav aria-label="Exercises" className="mt-3 flex flex-wrap gap-2">
              {overview.series.slice(0, 30).map((s) => (
                <Link
                  key={s.key}
                  href={exerciseHref(s.key)}
                  aria-current={s.key === selected.key ? "true" : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-semibold ${s.key === selected.key ? "border-brand bg-brand-tint" : "border-line-strong bg-surface"}`}
                  scroll={false}
                >
                  {s.name}
                  {s.loadBasis === "per_hand" ? " (per hand)" : s.loadBasis === "total" ? " (total)" : s.loadKind === "assisted" ? " (assisted)" : s.loadKind === "bodyweight" ? " (bodyweight)" : ""}
                </Link>
              ))}
            </nav>
            <p className="mt-4 font-semibold">{selected.name} · {METRIC_LABEL[selected.metric]}</p>
            <p className="text-sm text-ink-muted">
              {selected.points.length} session{selected.points.length === 1 ? "" : "s"}. Only records of this exact exercise
              {selected.loadBasis === "per_hand" ? ", recorded per hand," : selected.loadBasis === "total" ? ", recorded as a combined weight," : ""} are on this line; alternatives and substitutes have their own.
            </p>
            <div className="mt-3">
              <TrendChart points={selected.points} unit={selected.unit} label={`${selected.name}, ${METRIC_LABEL[selected.metric].toLowerCase()}`} valueLabel={METRIC_LABEL[selected.metric]} from={range.from} to={range.to} />
            </div>
          </>
        ) : (
          <EmptyState className="mt-4" headingLevel="h3" title="No exercise results in this period">
            {you ? "Log a workout and each exercise's results appear here." : "Nothing logged in this period."}
          </EmptyState>
        )}
      </section>

      {/* ---------------- Workouts ---------------- */}
      <section aria-labelledby="recent-heading" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="recent-heading" className="text-xl font-semibold">Workouts in this period</h2>
        {overview.workouts.length ? (
          <ul className="mt-3 divide-y divide-line">
            {overview.workouts.slice(0, 60).map((w) => (
              <li key={w.doc.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span>
                  <Link href={workoutHref(w.doc.id)} className="font-semibold text-brand underline underline-offset-4">{w.label}</Link>
                  <span className="block text-sm text-ink-muted">
                    {formatDay(w.doc.performedOn, { weekday: "short", month: "short", day: "numeric" })} · {setCount(w.doc)}
                    {w.doc.sessionKey ? "" : " · unplanned"}
                  </span>
                </span>
                <StatusPill tone={w.doc.status === "completed" ? "good" : "neutral"}>
                  {w.doc.status === "completed" ? "Completed" : w.doc.status === "partial" ? "Partly done" : w.doc.status === "skipped" ? "Skipped" : "Not finished"}
                </StatusPill>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-ink-muted">No workouts recorded in this period.</p>
        )}
      </section>
    </div>
  );
}

function setCount(doc: { exercises: { sets: unknown[] }[] }): string {
  const n = doc.exercises.reduce((sum, e) => sum + e.sets.length, 0);
  return `${n} set${n === 1 ? "" : "s"}`;
}
