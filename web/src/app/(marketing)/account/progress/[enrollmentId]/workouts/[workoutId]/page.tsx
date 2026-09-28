import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Paragraphs } from "@/components/programmes/workout-view";
import { WorkoutLogger } from "@/components/tracking/workout-logger";
import { formatDate, formatDay } from "@/lib/format";
import { addDays, isDateOnly, isKey } from "@/lib/programmes/content";
import { cleanText } from "@/lib/expectations/text";
import { PAUSED_FOR_PAYMENT_NOTICE } from "@/lib/policy";
import { clientTracking } from "@/lib/tracking/context";
import { previousResults, sessionFrom, workoutById } from "@/lib/tracking/server";
import { newPlannedDoc, newUnplannedDoc, type WorkoutDoc } from "@/lib/tracking/workout";

export const metadata: Metadata = { title: "Log a workout" };
export const dynamic = "force-dynamic";

export default async function WorkoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string; workoutId: string }>;
  searchParams: Promise<{ version?: string; session?: string; date?: string; title?: string }>;
}) {
  const [{ enrollmentId, workoutId }, sp] = await Promise.all([params, searchParams]);
  if (!isKey(workoutId)) notFound();
  const path = `/account/progress/${enrollmentId}/workouts/${workoutId}`;
  const ctx = await clientTracking(enrollmentId, path);

  const stored = await workoutById(workoutId);
  if (stored && stored.doc.enrollmentId !== enrollmentId) notFound();

  // The version and session the workout follows: the stored record's, or the
  // ones it is being started against.
  const versionId = stored ? stored.doc.planVersionId : isKey(sp.version) ? sp.version : null;
  const sessionKey = stored ? stored.doc.sessionKey : isKey(sp.session) ? sp.session : null;
  const planned = sessionFrom(ctx.plans, versionId, sessionKey);
  if ((versionId || sessionKey) && !planned) notFound();

  const date = stored?.doc.performedOn ?? (isDateOnly(sp.date) && sp.date <= addDays(ctx.today, 1) ? sp.date : ctx.today);
  const title = stored?.doc.title ?? cleanText(sp.title, 80);
  if (!stored && !planned && !title) notFound();

  const fresh: WorkoutDoc = planned
    ? newPlannedDoc({ id: workoutId, enrollmentId, planVersionId: planned.version.id, session: planned.session, performedOn: date, newId: randomUUID })
    : newUnplannedDoc({ id: workoutId, enrollmentId, performedOn: date, title: title || "Workout" });

  const previous = await previousResults(enrollmentId, date, workoutId);
  const heading = planned?.session.title ?? title ?? "Workout";
  const query = stored ? "" : `?${new URLSearchParams(planned ? { version: planned.version.id, session: planned.session.key, date } : { title: title || "Workout", date }).toString()}`;
  const versionNote = planned
    ? `Following version ${planned.version.version} of your plan (“${planned.version.title}”, since ${formatDate(planned.version.effective_from, ctx.tz)}), exactly as it was when this workout started. Later updates to your plan don't change it.`
    : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-32 sm:px-6 md:py-12">
      <p>
        <Link href={`${ctx.base}/workouts`} className="text-brand underline underline-offset-4">← Your workouts</Link>
      </p>
      <h1 className="mt-4 font-display text-3xl sm:text-4xl">{heading}</h1>
      <p className="mt-1 text-ink-muted">
        {formatDay(date, { weekday: "long", month: "long", day: "numeric" })}
        {planned?.session.minutes ? ` · about ${planned.session.minutes} min` : ""}
        {planned ? "" : " · not from your plan"}
      </p>
      {planned?.session.notes ? (
        <details className="mt-3 rounded-xl border border-line bg-surface p-4">
          <summary className="min-h-11 cursor-pointer font-semibold text-brand">Your coach&rsquo;s notes for this session</summary>
          <Paragraphs text={planned.session.notes} className="mt-2" />
        </details>
      ) : null}
      <p className="mt-3 text-ink-muted">
        Record what you actually did. The coach&rsquo;s targets and your last results are shown for reference — a set only counts when you tap &ldquo;Complete set&rdquo;.
      </p>

      <WorkoutLogger
        viewerId={ctx.session.userId}
        workoutId={workoutId}
        initial={stored ? { doc: stored.doc, revision: stored.revision } : null}
        fresh={fresh}
        session={planned?.session ?? null}
        versionNote={versionNote}
        previous={previous}
        weightUnit={ctx.prefs.weight_unit}
        writeState={ctx.writeState}
        pausedNotice={PAUSED_FOR_PAYMENT_NOTICE}
        today={ctx.today}
        zoneLabel={ctx.zoneLabel}
        href={`${path}${query}`}
        label={`${heading} — ${formatDay(date, { weekday: "short", month: "short", day: "numeric" })}`}
        backHref={`${ctx.base}/workouts`}
      />
    </div>
  );
}
