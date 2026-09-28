import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/button";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { NutritionView } from "@/components/programmes/nutrition-view";
import { FoodDiary } from "@/components/tracking/food-diary";
import { PendingEntries } from "@/components/tracking/pending-entries";
import { TrackingHeader } from "@/components/tracking/tracking-nav";
import { formatDay } from "@/lib/format";
import { addDays, isDateOnly, startOfLocalDay, versionInForce, type NutritionContent } from "@/lib/programmes/content";
import { PAUSED_FOR_PAYMENT_NOTICE } from "@/lib/policy";
import { clientTracking } from "@/lib/tracking/context";
import { foodDays } from "@/lib/tracking/server";

export const metadata: Metadata = { title: "Food diary" };
export const dynamic = "force-dynamic";

export default async function FoodPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const [{ enrollmentId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await clientTracking(enrollmentId, `/account/progress/${enrollmentId}/food`);
  const date = isDateOnly(sp.date) && sp.date <= ctx.today ? sp.date : ctx.today;
  const from = addDays(date, -13);
  const days = await foodDays(enrollmentId, from, date);
  const day = days.find((d) => d.date === date) ?? { date, complete: false, entries: [] };
  const live = ctx.writeState === "live";
  const held = ctx.writeState === "live" || ctx.writeState === "not_permitted" ? null : ctx.writeState;

  // The coach's nutrition guidance in force on that day, beside the diary.
  const nutritionPlan = ctx.plans.find((p) => p.kind === "nutrition" && p.assignment_id === ctx.enrollment.openAssignmentId) ?? ctx.plans.find((p) => p.kind === "nutrition");
  const dayEnd = date === ctx.today ? new Date() : new Date(startOfLocalDay(addDays(date, 1), ctx.tz).getTime() - 1);
  const nutrition = nutritionPlan ? versionInForce(nutritionPlan.versions, dayEnd) : null;
  const targets = (nutrition?.content as NutritionContent | undefined)?.targets ?? null;
  const processing = day.entries.some((e) => e.mediaState && !["ready", "deleted", "failed", "hidden"].includes(e.mediaState));
  const base = `${ctx.base}/food`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-16">
      {processing ? <AutoRefresh everySeconds={5} forSeconds={180} /> : null}
      <TrackingHeader
        base={ctx.base}
        current="food"
        title="Food diary"
        subtitle="Photos, a few words, or both. Numbers only if you know them — nothing is worked out for you."
        writeState={ctx.writeState}
        pausedNotice={PAUSED_FOR_PAYMENT_NOTICE}
        focus={ctx.focus}
        coachName={ctx.enrollment.coachName}
      />
      <PendingEntries viewerId={ctx.session.userId} live={live} pausedNotice={PAUSED_FOR_PAYMENT_NOTICE} />

      {nutrition ? (
        <details className="mt-6 rounded-2xl border border-brand bg-brand-tint p-4">
          <summary className="min-h-11 cursor-pointer font-semibold">
            Your coach&rsquo;s nutrition guidance
            {targets && (targets.calories !== null || targets.proteinG !== null) ? (
              <span className="font-normal">
                {" "}· {[targets.calories !== null ? `about ${targets.calories} kcal` : "", targets.proteinG !== null ? `${targets.proteinG} g protein` : ""].filter(Boolean).join(", ")} a day (coach&rsquo;s estimate)
              </span>
            ) : null}
          </summary>
          <div className="mt-3">
            <NutritionView content={nutrition.content as NutritionContent} />
          </div>
        </details>
      ) : (
        <p className="mt-6 text-ink-muted">Your coach hasn&rsquo;t shared nutrition guidance. You can still keep a diary if it helps.</p>
      )}

      <nav aria-label="Days" className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <ButtonLink href={`${base}?date=${addDays(date, -1)}`} variant="secondary">← <span className="sr-only">Previous day, </span>{formatDay(addDays(date, -1), { weekday: "short", day: "numeric" })}</ButtonLink>
        <h2 className="text-xl font-semibold">{date === ctx.today ? "Today" : formatDay(date, { weekday: "long", month: "short", day: "numeric" })}</h2>
        {date < ctx.today ? (
          <ButtonLink href={`${base}?date=${addDays(date, 1)}`} variant="secondary"><span className="sr-only">Next day, </span>{formatDay(addDays(date, 1), { weekday: "short", day: "numeric" })} →</ButtonLink>
        ) : <span />}
      </nav>

      <div className="mt-4">
        <FoodDiary
          viewerId={ctx.session.userId}
          enrollmentId={enrollmentId}
          date={date}
          today={ctx.today}
          entries={day.entries}
          complete={day.complete}
          live={live}
          held={held}
          pausedNotice={PAUSED_FOR_PAYMENT_NOTICE}
        />
      </div>

      <section aria-labelledby="fortnight" className="mt-10">
        <h2 id="fortnight" className="text-xl font-semibold">The last two weeks</h2>
        <ol className="mt-3 grid grid-cols-7 gap-1.5">
          {Array.from({ length: 14 }, (_, i) => addDays(from, i)).map((d) => {
            const x = days.find((y) => y.date === d);
            const state = !x || !x.entries.length ? "none" : x.complete ? "complete" : "partial";
            return (
              <li key={d}>
                <Link
                  href={`${base}?date=${d}`}
                  aria-current={d === date ? "date" : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center rounded-lg border text-sm ${state === "complete" ? "border-brand bg-brand text-white" : state === "partial" ? "border-brand bg-brand-tint" : "border-dashed border-line-strong bg-surface text-ink-muted"} ${d === date ? "ring-2 ring-ink" : ""}`}
                >
                  <span>{formatDay(d, { weekday: "narrow" })}</span>
                  <span className="font-semibold">{formatDay(d, { day: "numeric" })}</span>
                  <span className="sr-only">{state === "complete" ? "complete" : state === "partial" ? "partial record" : "nothing recorded"}</span>
                </Link>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-sm text-ink-muted">Filled: marked complete. Tinted: partial record. Dashed: nothing recorded — not zero.</p>
      </section>
    </div>
  );
}
