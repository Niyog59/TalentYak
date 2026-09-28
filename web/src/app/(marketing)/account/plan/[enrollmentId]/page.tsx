import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOnboarded } from "@/lib/auth";
import { ButtonLink } from "@/components/button";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, SubmitButton } from "@/components/form/fields";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/panel";
import { SessionCard, PlanWeek, Paragraphs } from "@/components/programmes/workout-view";
import { NutritionView } from "@/components/programmes/nutrition-view";
import { moveSessionAction } from "@/lib/programmes/actions";
import { myEnrollments, plansForEnrollment, weekRecords, type ClientPlan, type PlanVersion } from "@/lib/programmes/server";
import {
  DAY_NAMES,
  addDays,
  isDateOnly,
  layOutWeek,
  localDate,
  mondayOf,
  scheduledVersions,
  startOfLocalDay,
  versionInForce,
  weekday,
  type NutritionContent,
  type PlacedSession,
  type WeekDay,
  type WorkoutContent,
} from "@/lib/programmes/content";
import { formatDate, formatDay } from "@/lib/format";
import { PAUSED_FOR_PAYMENT_NOTICE } from "@/lib/policy";
import { createClient } from "@/lib/supabase/server";
import { STATUS_LABEL, type WorkoutStatus } from "@/lib/tracking/workout";

export const metadata: Metadata = { title: "Your plan" };
export const dynamic = "force-dynamic";

async function week(plan: ClientPlan, weekStart: string, today: string, tz: string | null, now: Date): Promise<WeekDay[]> {
  const records = await weekRecords(plan, weekStart, addDays(weekStart, 6));
  const byId = new Map(plan.versions.map((v) => [v.id, v]));
  const asWorkout = (v: PlanVersion | null | undefined) => (v ? { id: v.id, content: v.content as WorkoutContent } : null);
  return layOutWeek({
    weekStart,
    // Today follows what is in force right now; other days, what is in force when they start.
    versionForDay: (date) => asWorkout(versionInForce(plan.versions, date === today ? now : startOfLocalDay(date, tz))),
    versionById: (id) => asWorkout(byId.get(id)),
    moves: records.moves,
    started: records.started,
  });
}

function MoveForm({ plan, placed, weekStart, enrollmentId, day }: { plan: ClientPlan; placed: PlacedSession; weekStart: string; enrollmentId: string; day: number }) {
  return (
    <details className="mt-3">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand underline underline-offset-4">
        Move this session<span className="sr-only">: {placed.session.title}</span>
      </summary>
      <ActionForm action={moveSessionAction} className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <input type="hidden" name="plan_id" value={plan.id} />
        <input type="hidden" name="version_id" value={placed.versionId} />
        <input type="hidden" name="session_key" value={placed.session.key} />
        <input type="hidden" name="week_start" value={weekStart} />
        <input type="hidden" name="enrollment_id" value={enrollmentId} />
        <SelectField
          name="to_day"
          label="Move it this week to"
          required
          options={DAY_NAMES.map((d, i) => ({ value: String(i), label: d })).filter((o) => Number(o.value) !== day)}
        />
        <SubmitButton pendingLabel="Moving…" variant="secondary">Move</SubmitButton>
        <p className="text-sm text-ink-muted sm:col-span-2">Only this week changes. The workout itself stays exactly as your coach wrote it.</p>
      </ActionForm>
    </details>
  );
}

function PutBack({ plan, placed, weekStart, enrollmentId }: { plan: ClientPlan; placed: PlacedSession; weekStart: string; enrollmentId: string }) {
  return (
    <ActionForm action={moveSessionAction} className="mt-2">
      <input type="hidden" name="plan_id" value={plan.id} />
      <input type="hidden" name="version_id" value={placed.versionId} />
      <input type="hidden" name="session_key" value={placed.session.key} />
      <input type="hidden" name="week_start" value={weekStart} />
      <input type="hidden" name="enrollment_id" value={enrollmentId} />
      <input type="hidden" name="to_day" value="" />
      <SubmitButton pendingLabel="Moving…" variant="quiet">Put it back on {DAY_NAMES[placed.movedFrom!]}</SubmitButton>
    </ActionForm>
  );
}

/** Records already started for sessions in this week, by date and session. */
async function loggedThisWeek(enrollmentId: string, from: string, to: string): Promise<Map<string, { id: string; status: WorkoutStatus }>> {
  const supabase = await createClient();
  const out = new Map<string, { id: string; status: WorkoutStatus }>();
  if (!supabase) return out;
  const { data } = await supabase.from("workout_logs").select("id, session_key, performed_at, status")
    .eq("enrollment_id", enrollmentId).not("session_key", "is", null).gte("performed_at", from).lte("performed_at", to);
  for (const r of data ?? []) out.set(`${r.performed_at}:${r.session_key}`, { id: r.id as string, status: r.status as WorkoutStatus });
  return out;
}

function LogLink({ enrollmentId, placed, date, logged, primary }: { enrollmentId: string; placed: PlacedSession; date: string; logged: { id: string; status: WorkoutStatus } | undefined; primary?: boolean }) {
  const base = `/account/progress/${enrollmentId}/workouts`;
  const href = logged ? `${base}/${logged.id}` : `${base}/new?${new URLSearchParams({ version: placed.versionId, session: placed.session.key, date }).toString()}`;
  const label = logged ? (logged.status === "in_progress" ? "Continue logging" : `Logged: ${STATUS_LABEL[logged.status].toLowerCase()} — view or correct`) : primary ? "Start logging this workout" : "Log it";
  return (
    <ButtonLink href={href} variant={primary && !logged ? "primary" : "secondary"} size={primary ? "md" : "sm"} className="mt-3">
      {label}<span className="sr-only">: {placed.session.title}</span>
    </ButtonLink>
  );
}

function Badges({ placed, versions }: { placed: PlacedSession; versions: PlanVersion[] }) {
  const v = versions.find((x) => x.id === placed.versionId);
  return (
    <>
      {placed.movedFrom !== null ? <StatusPill>Moved from {DAY_NAMES[placed.movedFrom]}</StatusPill> : null}
      {placed.fromStartedRecord && v ? <StatusPill>Started under version {v.version}</StatusPill> : null}
    </>
  );
}

export default async function ClientPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const [{ enrollmentId }, { week: weekParam }] = await Promise.all([params, searchParams]);
  const session = await requireOnboarded(`/account/plan/${enrollmentId}`);
  const tz = session.profile.timezone;
  const enrollment = (await myEnrollments(session.userId)).find((e) => e.id === enrollmentId);
  if (!enrollment) notFound();

  const plans = await plansForEnrollment(enrollmentId);
  // The current coach's plans. An earlier coach's stay readable in the history.
  const currentPlan = (kind: "workout" | "nutrition") =>
    plans.find((p) => p.kind === kind && p.assignment_id === enrollment.openAssignmentId && p.versions.length) ??
    (enrollment.openAssignmentId ? undefined : plans.find((p) => p.kind === kind && p.versions.length));
  const workout = currentPlan("workout");
  const nutrition = currentPlan("nutrition");
  const earlierPlans = plans.some((p) => p.versions.length && p !== workout && p !== nutrition);

  const now = new Date();
  const today = localDate(now, tz);
  const thisWeek = mondayOf(today);
  const shownWeek = isDateOnly(weekParam) ? mondayOf(weekParam) : thisWeek;
  const workoutNow = workout ? versionInForce(workout.versions, now) : null;
  const weekly = (workoutNow?.content as WorkoutContent | undefined)?.schedule !== "in_order";

  const currentWeek = workout && weekly ? await week(workout, thisWeek, today, tz, now) : null;
  const displayedWeek = workout && weekly ? (shownWeek === thisWeek ? currentWeek : await week(workout, shownWeek, today, tz, now)) : null;
  const todayPlan = currentWeek?.[weekday(today)] ?? null;

  const nutritionNow = nutrition ? versionInForce(nutrition.versions, now) : null;
  const upcoming = [
    ...(workout ? scheduledVersions(workout.versions, now).map((v) => ({ v, kind: "workout plan" })) : []),
    ...(nutrition ? scheduledVersions(nutrition.versions, now).map((v) => ({ v, kind: "nutrition plan" })) : []),
  ];
  const canMove = enrollment.state !== "ended" && shownWeek >= thisWeek;
  const logged = workout && weekly ? await loggedThisWeek(enrollmentId, shownWeek < thisWeek ? shownWeek : thisWeek, addDays(shownWeek > thisWeek ? shownWeek : thisWeek, 6)) : new Map();
  const base = `/account/plan/${enrollmentId}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-16">
      <p><Link href="/account" className="text-brand underline underline-offset-4">← Your account</Link></p>
      <h1 className="mt-4 font-display text-4xl sm:text-5xl">Your plan</h1>
      <p className="mt-2 text-lg text-ink-muted">{enrollment.planTitle} with {enrollment.coachName}</p>

      {enrollment.state === "paused" ? (
        <p role="alert" className="mt-5 rounded-lg border border-danger bg-danger-tint p-4 font-medium">
          {PAUSED_FOR_PAYMENT_NOTICE} <Link href="/account/billing" className="underline">Update your card</Link>.
        </p>
      ) : null}
      {enrollment.state === "ended" ? (
        <p role="note" className="mt-5 rounded-lg border border-line-strong bg-paper-raised p-4">This coaching has ended. Your plans stay here for you to read.</p>
      ) : null}

      <nav aria-label="Plan" className="mt-6 flex flex-wrap gap-3">
        <ButtonLink href={`/account/progress/${enrollmentId}`} variant="secondary" size="sm">Your progress &amp; logs</ButtonLink>
        <ButtonLink href={`${base}/history`} variant="secondary" size="sm">History of your plans</ButtonLink>
        <ButtonLink href="/account/training-profile" variant="secondary" size="sm">Your training &amp; food profile</ButtonLink>
        <ButtonLink href="/account/messages" variant="secondary" size="sm">Message your coach</ButtonLink>
      </nav>

      {upcoming.map(({ v, kind }) => (
        <div key={v.id} role="note" className="mt-6 rounded-xl border border-brand bg-brand-tint p-4">
          <p className="font-semibold">Your coach has planned an update to your {kind}, starting {formatDay(localDate(new Date(v.effective_from!), tz), { weekday: "long", month: "short", day: "numeric" })}.</p>
          {v.change_summary ? <Paragraphs text={v.change_summary} className="mt-1" /> : null}
          <p className="mt-1"><Link href={`${base}/history?v=${v.id}`} className="text-brand underline underline-offset-4">See the update</Link></p>
        </div>
      ))}

      {/* ---------------- Today ---------------- */}
      <section aria-labelledby="today-heading" className="mt-10">
        <h2 id="today-heading" className="text-2xl font-semibold">Today · {formatDay(today, { weekday: "long", month: "short", day: "numeric" })}</h2>
        {!workoutNow ? (
          <EmptyState className="mt-4" headingLevel="h3" icon="training" title={workout ? "Your workout plan starts soon" : "Your coach is preparing your workout plan"}>
            {workout ? "Your first plan has been published and starts on the date above." : `When ${enrollment.coachName} publishes it, you'll get a notice and it appears here.`}
            {earlierPlans ? <> Earlier plans are in your <Link href={`${base}/history`} className="text-brand underline">history</Link>.</> : null}
          </EmptyState>
        ) : !weekly ? (
          <div className="mt-4">
            <PlanWeek content={workoutNow.content as WorkoutContent} />
          </div>
        ) : todayPlan && todayPlan.sessions.length ? (
          <div className="mt-4 space-y-4">
            {todayPlan.sessions.map((p) => (
              <SessionCard
                key={p.session.key}
                session={p.session}
                badge={<Badges placed={p} versions={workout!.versions} />}
                footer={
                  <>
                    <LogLink enrollmentId={enrollmentId} placed={p} date={today} logged={logged.get(`${today}:${p.session.key}`)} primary />
                    {canMove && !p.fromStartedRecord && !logged.get(`${today}:${p.session.key}`) ? (
                      <>
                        {p.movedFrom !== null ? <PutBack plan={workout!} placed={p} weekStart={thisWeek} enrollmentId={enrollmentId} /> : null}
                        <MoveForm plan={workout!} placed={p} weekStart={thisWeek} enrollmentId={enrollmentId} day={todayPlan.day} />
                      </>
                    ) : null}
                  </>
                }
              />
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-line-strong bg-surface p-5">
            <p className="text-lg font-semibold">Rest day</p>
            {todayPlan?.restNote ? <p className="mt-1">{todayPlan.restNote}</p> : <p className="mt-1 text-ink-muted">Nothing scheduled today.</p>}
          </div>
        )}
        {nutritionNow ? (
          <p className="mt-4"><Link href="#nutrition" className="font-semibold text-brand underline underline-offset-4">Today&rsquo;s nutrition guidance</Link></p>
        ) : null}
      </section>

      {/* ---------------- Week ---------------- */}
      {displayedWeek ? (
        <section aria-labelledby="week-heading" className="mt-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="week-heading" className="text-2xl font-semibold">
              {shownWeek === thisWeek ? "This week" : `Week of ${formatDay(shownWeek, { month: "short", day: "numeric" })}`}
            </h2>
            <nav aria-label="Weeks" className="flex gap-2">
              <ButtonLink href={`${base}?week=${addDays(shownWeek, -7)}#week-heading`} variant="secondary">← Previous<span className="sr-only"> week</span></ButtonLink>
              {shownWeek !== thisWeek ? <ButtonLink href={`${base}#week-heading`} variant="secondary">This week</ButtonLink> : null}
              <ButtonLink href={`${base}?week=${addDays(shownWeek, 7)}#week-heading`} variant="secondary">Next<span className="sr-only"> week</span> →</ButtonLink>
            </nav>
          </div>
          <ol className="mt-4 space-y-3">
            {displayedWeek.map((d) => (
              <li key={d.date} className={`rounded-2xl border p-4 ${d.date === today ? "border-brand bg-brand-tint/40" : "border-line bg-surface"}`}>
                <h3 className="flex flex-wrap items-center gap-2 font-semibold">
                  {DAY_NAMES[d.day]} <span className="font-normal text-ink-muted">{formatDay(d.date)}</span>
                  {d.date === today ? <StatusPill tone="good">Today</StatusPill> : null}
                </h3>
                {d.sessions.length ? (
                  <ul className="mt-2 space-y-2">
                    {d.sessions.map((p) => (
                      <li key={p.session.key}>
                        <details>
                          <summary className="min-h-11 cursor-pointer py-2">
                            <span className="font-semibold">{p.session.title}</span>
                            <span className="text-ink-muted"> · {p.session.exercises.length} exercise{p.session.exercises.length === 1 ? "" : "s"}{p.session.minutes ? ` · about ${p.session.minutes} min` : ""}</span>
                            {p.movedFrom !== null ? <span className="text-ink-muted"> · moved from {DAY_NAMES[p.movedFrom]}</span> : null}
                          </summary>
                          <div className="mt-2">
                            <SessionCard
                              session={p.session}
                              heading="h4"
                              badge={<Badges placed={p} versions={workout!.versions} />}
                              footer={
                                <>
                                  {d.date <= today ? <LogLink enrollmentId={enrollmentId} placed={p} date={d.date} logged={logged.get(`${d.date}:${p.session.key}`)} /> : null}
                                  {canMove && !p.fromStartedRecord ? (
                                    <>
                                      {p.movedFrom !== null ? <PutBack plan={workout!} placed={p} weekStart={shownWeek} enrollmentId={enrollmentId} /> : null}
                                      <MoveForm plan={workout!} placed={p} weekStart={shownWeek} enrollmentId={enrollmentId} day={d.day} />
                                    </>
                                  ) : null}
                                </>
                              }
                            />
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-ink-muted">{d.versionId ? `Rest${d.restNote ? ` — ${d.restNote}` : ""}` : "No plan in place yet"}</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* ---------------- Nutrition ---------------- */}
      <section aria-labelledby="nutrition" className="mt-12">
        <h2 id="nutrition" className="text-2xl font-semibold">Nutrition</h2>
        {nutritionNow ? (
          <div className="mt-4">
            <p className="mb-4 text-ink-muted">&ldquo;{nutritionNow.title}&rdquo; · version {nutritionNow.version}, since {formatDate(nutritionNow.effective_from, tz)}</p>
            <NutritionView content={nutritionNow.content as NutritionContent} />
          </div>
        ) : (
          <p className="mt-2 text-ink-muted">
            {nutrition ? "Your nutrition plan starts on the date above." : "Your coach hasn't shared nutrition guidance yet. Not every coach includes it."}
          </p>
        )}
      </section>

      <p className="mt-12 text-sm text-ink-muted">
        Every version of your plan is kept. Each workout you log records the version you followed, so a later update never changes it.{" "}
        <Link href={`/account/progress/${enrollmentId}/workouts`} className="text-brand underline underline-offset-4">Log an unplanned workout or catch up on a missed day</Link>.
      </p>
    </div>
  );
}
