import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/panel";
import { PendingEntries } from "@/components/tracking/pending-entries";
import { RangePicker } from "@/components/tracking/progress-overview";
import { TrackingHeader } from "@/components/tracking/tracking-nav";
import { formatDay } from "@/lib/format";
import { addDays } from "@/lib/programmes/content";
import { PAUSED_FOR_PAYMENT_NOTICE } from "@/lib/policy";
import { clientTracking } from "@/lib/tracking/context";
import { buildOverview } from "@/lib/tracking/overview";
import { resolveRange } from "@/lib/tracking/progress";
import { STATUS_LABEL } from "@/lib/tracking/workout";

export const metadata: Metadata = { title: "Your workouts" };
export const dynamic = "force-dynamic";

export default async function WorkoutsPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const [{ enrollmentId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await clientTracking(enrollmentId, `/account/progress/${enrollmentId}/workouts`);
  const range = resolveRange(sp, ctx.today);
  const overview = await buildOverview({
    enrollmentId,
    plans: ctx.plans,
    range: { ...range, from: range.from < addDays(ctx.today, -13) ? range.from : addDays(ctx.today, -13) },
    today: ctx.today,
    timeZone: ctx.tz,
    weightUnit: ctx.prefs.weight_unit,
    lengthUnit: ctx.prefs.length_unit,
  });
  const canAdd = ctx.writeState === "live" || ctx.writeState === "paused";
  const base = ctx.base;
  const startHref = (p: { versionId: string; sessionKey: string; plannedOn: string }) =>
    `${base}/workouts/new?${new URLSearchParams({ version: p.versionId, session: p.sessionKey, date: p.plannedOn }).toString()}`;

  // Planned sessions from the last two weeks with nothing recorded, and today's.
  const recent = overview.consistency.planned.filter((p) => p.plannedOn >= addDays(ctx.today, -13));
  const toLog = recent.filter((p) => p.outcome === "unlogged").reverse();
  const today = recent.filter((p) => p.plannedOn === ctx.today);
  const shown = overview.workouts.filter((w) => w.doc.performedOn >= range.from && w.doc.performedOn <= range.to);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-16">
      <TrackingHeader
        base={base}
        current="workouts"
        title="Your workouts"
        subtitle="Log from your plan, catch up on a missed day, or record a workout that wasn't planned."
        writeState={ctx.writeState}
        pausedNotice={PAUSED_FOR_PAYMENT_NOTICE}
        focus={ctx.focus}
        coachName={ctx.enrollment.coachName}
      />
      <PendingEntries viewerId={ctx.session.userId} live={ctx.writeState === "live"} pausedNotice={PAUSED_FOR_PAYMENT_NOTICE} />

      {canAdd ? (
        <section aria-labelledby="log-heading" className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <h2 id="log-heading" className="text-xl font-semibold">Log a workout</h2>
          {today.length ? (
            <ul className="mt-3 space-y-2">
              {today.map((p) => (
                <li key={p.sessionKey} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-tint p-3">
                  <span><span className="font-semibold">{p.title}</span> <span className="text-ink-muted">· today</span></span>
                  <Link href={p.workoutId ? `${base}/workouts/${p.workoutId}` : startHref(p)} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 font-semibold text-white">
                    {p.workoutId ? "Continue" : "Start"}<span className="sr-only"> {p.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {toLog.length ? (
            <>
              <h3 className="mt-5 font-semibold">Planned sessions not logged yet</h3>
              <ul className="mt-2 divide-y divide-line">
                {toLog.map((p) => (
                  <li key={`${p.weekStart}-${p.sessionKey}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span><span className="font-semibold">{p.title}</span> <span className="text-ink-muted">· {formatDay(p.plannedOn, { weekday: "short", month: "short", day: "numeric" })}</span></span>
                    <Link href={startHref(p)} className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
                      Log it<span className="sr-only"> — {p.title}, {p.plannedOn}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <form method="get" action={`${base}/workouts/new`} className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <label className="block">
              <span className="block font-semibold">Something else — name it</span>
              <input name="title" required maxLength={80} placeholder="e.g. 5 km run, football, swim" className="mt-1 min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3" />
            </label>
            <label className="block">
              <span className="block font-semibold">Date</span>
              <input type="date" name="date" defaultValue={ctx.today} max={ctx.today} required className="mt-1 min-h-12 rounded-lg border border-line-strong bg-surface px-3" />
            </label>
            <button type="submit" className="min-h-12 rounded-lg border border-line-strong bg-surface px-5 font-semibold">Start</button>
          </form>
          <p className="mt-2 text-sm text-ink-muted">Unplanned workouts are kept apart from your plan and never change your consistency figures.</p>
        </section>
      ) : null}

      <section aria-labelledby="history-heading" className="mt-8">
        <h2 id="history-heading" className="text-2xl font-semibold">History</h2>
        <RangePicker range={range} base={`${base}/workouts`} />
        {shown.length ? (
          <ul className="mt-4 space-y-3">
            {shown.map((w) => (
              <li key={w.doc.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`${base}/workouts/${w.doc.id}`} className="text-lg font-semibold text-brand underline underline-offset-4">{w.label}</Link>
                  <StatusPill tone={w.doc.status === "completed" ? "good" : "neutral"}>{STATUS_LABEL[w.doc.status]}</StatusPill>
                </div>
                <p className="text-ink-muted">
                  {formatDay(w.doc.performedOn, { weekday: "long", month: "short", day: "numeric" })} ·{" "}
                  {w.doc.exercises.filter((e) => e.sets.length).length} exercise{w.doc.exercises.filter((e) => e.sets.length).length === 1 ? "" : "s"}, {setCount(w.doc)}
                  {w.doc.sessionKey ? "" : " · unplanned"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState className="mt-4" headingLevel="h3" icon="training" title="No workouts in this period">
            When you log a workout it appears here, with everything you recorded.
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function setCount(doc: { exercises: { sets: unknown[] }[] }): string {
  const n = doc.exercises.reduce((sum, e) => sum + e.sets.length, 0);
  return `${n} set${n === 1 ? "" : "s"}`;
}
