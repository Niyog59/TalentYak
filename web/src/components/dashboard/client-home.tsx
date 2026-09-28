import Link from "next/link";
import { ButtonLink } from "@/components/button";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { StatusPill } from "@/components/ui/panel";
import { SectionFailed } from "@/components/dashboard/live";
import { dismissNoticeAction } from "@/lib/dashboard/actions";
import type { ClientDashboard, ConversationLink, Relationship, WeekCell } from "@/lib/dashboard/client";
import type { Loaded } from "@/lib/dashboard/load";
import { span, visibleNotices } from "@/lib/dashboard/tasks";
import { CLIENT_STAGE_LABEL } from "@/lib/checkins/status";
import { formatDate, formatDay } from "@/lib/format";
import { PAUSED_FOR_PAYMENT_NOTICE } from "@/lib/policy";
import { DAY_SHORT, addDays } from "@/lib/programmes/content";
import { APPOINTMENT_STATE_LABEL, HOLD_REASON_LABEL, bothZones, durationLabel } from "@/lib/scheduling/types";
import { FOCUS_LABEL } from "@/lib/tracking/labels";
import { STATUS_LABEL } from "@/lib/tracking/workout";

/*
 * The client's home: what to do today first, then each coaching
 * relationship on its own, labelled with its coach. Nothing here marks
 * anything as read, accepted or done.
 */

const link = "font-semibold text-brand underline underline-offset-4";
const num = (n: number) => String(Math.round(n * 10) / 10);

type Appointment = Extract<ClientDashboard["schedule"], { ok: true }>["data"]["upcoming"][number];

function Block({ title, children, id }: { title: string; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="border-t border-line py-5 first:border-t-0 first:pt-0">
      <h3 id={id} className="font-semibold text-ink-muted">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// To do
// ---------------------------------------------------------------------------

interface Todo {
  key: string;
  text: string;
  who: string;
  href: string;
  cta: string;
  urgent?: boolean;
  note?: string;
}

/** "Maya", or "Maya · Strength basics" when there is more than one relationship to tell apart. */
function whoFor(d: ClientDashboard, coachName: string, enrollmentId: string | null): string {
  if (d.current.length < 2 || !enrollmentId) return coachName;
  const e = d.current.find((r) => r.e.id === enrollmentId)?.e ?? d.ended.find((x) => x.id === enrollmentId);
  return e ? `${coachName} · ${e.planTitle}` : coachName;
}

export function TodoList({ d, nowMs, tz }: { d: ClientDashboard; nowMs: number; tz: string | null }) {
  const items: Todo[] = [];
  for (const r of d.current) {
    if (r.writeState === "paused") {
      items.push({ key: `pay-${r.e.id}`, text: PAUSED_FOR_PAYMENT_NOTICE, who: whoFor(d, r.e.coachName, r.e.id), href: "/account/billing", cta: "Update your card", urgent: true });
    }
    if (r.checkins.ok && r.checkins.data.open && r.writeState === "live") {
      const c = r.checkins.data.open;
      const late = Date.parse(c.dueAt) < nowMs;
      items.push({
        key: `ci-${c.id}`,
        text: c.stage === "draft" ? `Finish your check-in for ${c.period}` : `Your check-in for ${c.period}`,
        note: late ? "It's past the due time — sending it late is fine." : `Due ${formatDate(c.dueAt, c.timezone, true)}`,
        who: whoFor(d, r.e.coachName, r.e.id),
        href: `/account/progress/${r.e.id}/check-ins/${c.id}`,
        cta: c.stage === "draft" ? "Continue" : "Start",
      });
    }
  }
  if (d.schedule.ok) {
    for (const p of d.schedule.data.toAnswer) {
      items.push({
        key: `p-${p.id}`,
        text: `${p.replaces_appointment_id ? "A new time was suggested for a session" : "A session time was suggested"}: ${bothZones(p.starts_at, tz, p.otherTz, p.otherName)}`,
        note: `Expires in ${span(Date.parse(p.expires_at) - nowMs)}. Nothing is booked until you accept.`,
        who: whoFor(d, p.otherName, p.enrollment_id),
        href: "/account/appointments#answer-heading",
        cta: "Answer",
      });
    }
  }
  if (d.messages.ok) {
    for (const c of d.messages.data.filter((m) => m.unread > 0)) {
      items.push({ key: `m-${c.id}`, text: `${c.unread} unread message${c.unread === 1 ? "" : "s"}`, who: whoFor(d, c.coachName, c.enrollmentId), href: `/account/messages/${c.id}`, cta: "Read" });
    }
  }
  const failed = [!d.schedule.ok && "session requests", !d.messages.ok && "messages", d.current.some((r) => !r.checkins.ok) && "check-ins"].filter(Boolean) as string[];

  return (
    <section aria-labelledby="todo-heading" className="mt-8">
      <h2 id="todo-heading" className="text-2xl font-semibold">To do</h2>
      {failed.length ? (
        <p role="alert" className="mt-3 rounded-lg border border-line-strong bg-paper-raised p-3">
          Your {failed.join(", ")} couldn&rsquo;t be checked just now, so this list may be missing something. It tries again automatically, or refresh the page.
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="mt-3 text-ink-muted">{failed.length ? "Nothing else from what loaded." : "Nothing needs you right now."}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {items.map((t) => (
            <li key={t.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className={t.urgent ? "font-semibold" : ""}>{t.text}</p>
                <p className="text-sm text-ink-muted">{t.note ? `${t.note} · ` : ""}{t.who}</p>
              </div>
              <ButtonLink href={t.href} variant={t.urgent ? "primary" : "secondary"} size="sm" className="min-h-11">
                {t.cta}<span className="sr-only">: {t.text}</span>
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Getting started
// ---------------------------------------------------------------------------

export function GettingStarted({ d }: { d: ClientDashboard }) {
  const steps = d.current.flatMap((r) => (r.onboarding.ok ? r.onboarding.data.map((s) => ({ ...s, r })) : []));
  // The training profile is one form for all coaches: list it once.
  const seen = new Set<string>();
  const unique = steps.filter((s) => (s.key === "training" ? !seen.has("training") && seen.add("training") : true));
  const open = unique.filter((s) => !s.done);
  if (!open.length) return null;
  return (
    <section aria-labelledby="start-heading" className="mt-8 rounded-2xl border border-brand bg-brand-tint/40 p-5">
      <h2 id="start-heading" className="text-xl font-semibold">Getting started</h2>
      <p className="mt-1 text-ink-muted">Helpful first steps. None of them hold up your coaching.</p>
      <ol className="mt-3 space-y-2">
        {unique.map((s) => (
          <li key={`${s.r.e.id}-${s.key}`} className="flex items-start gap-3">
            <span aria-hidden className={`mt-2 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${s.done ? "border-brand bg-brand text-white" : "border-line-strong bg-surface"}`}>{s.done ? "✓" : ""}</span>
            <div>
              <Link href={s.href} className="inline-flex min-h-11 items-center font-semibold underline-offset-4 hover:underline">{s.label}</Link>
              <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
              {s.key !== "training" && d.current.length > 1 ? <p className="text-sm text-ink-muted">{s.r.e.planTitle} with {s.r.e.coachName}</p> : null}
              {s.note && !s.done ? <p className="text-sm text-ink-muted">{s.note}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// One relationship
// ---------------------------------------------------------------------------

function WeekStrip({ week, weekStart, today, planHref }: { week: WeekCell[]; weekStart: string; today: string; planHref: string }) {
  return (
    <div className="mt-4">
      <ol className="grid grid-cols-7 gap-1 text-center text-sm" aria-label="This week">
        {week.map((c) => {
          const state = c.noPlan ? "No plan yet" : c.rest ? "Rest day" : c.logged >= c.sessions ? "Logged" : `${c.sessions} session${c.sessions === 1 ? "" : "s"}`;
          return (
            <li key={c.date} className={`rounded-lg border px-0.5 py-2 ${c.date === today ? "border-brand bg-brand-tint" : "border-line bg-surface"}`}>
              <span className="block font-semibold">{DAY_SHORT[c.day]}</span>
              <span aria-hidden className="mt-1 block text-base leading-none">{c.noPlan ? "·" : c.rest ? "–" : c.logged >= c.sessions ? "✓" : "●"}</span>
              <span className="sr-only">{formatDay(c.date)}: {state}{c.date === today ? " (today)" : ""}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-xs text-ink-muted">● workout · ✓ logged · – rest day</p>
      <nav aria-label="Weeks" className="mt-2 flex flex-wrap gap-x-5 text-sm">
        <Link href={`${planHref}?week=${addDays(weekStart, -7)}#week-heading`} className={`inline-flex min-h-11 items-center ${link}`}>← Last week</Link>
        <Link href={`${planHref}#week-heading`} className={`inline-flex min-h-11 items-center ${link}`}>This week in full</Link>
        <Link href={`${planHref}?week=${addDays(weekStart, 7)}#week-heading`} className={`inline-flex min-h-11 items-center ${link}`}>Next week →</Link>
      </nav>
    </div>
  );
}

function TodayCard({ r, today }: { r: Relationship; today: string }) {
  const planHref = `/account/plan/${r.e.id}`;
  const live = r.writeState === "live";
  if (!r.today.ok) return <SectionFailed what="Today's workout" />;
  const { workout: w, week, weekStart } = r.today.data;
  return (
    <div className="rounded-2xl border border-brand bg-brand-tint/40 p-5">
      <p className="font-semibold text-ink-muted">Today&rsquo;s workout · {formatDay(today, { weekday: "long", month: "short", day: "numeric" })}</p>
      {w.kind === "waiting" ? (
        <>
          <p className="mt-1 text-2xl font-semibold">{w.firstPlanScheduled ? "Your workout plan starts soon" : `${r.e.coachName} is preparing your workout plan`}</p>
          <p className="mt-1 text-ink-muted">{w.firstPlanScheduled ? "It's published and starts on the date shown in your plan." : "You'll get a notice when it's published, and it appears here."}</p>
          <ButtonLink href={planHref} variant="secondary" className="mt-4">Your plan</ButtonLink>
        </>
      ) : w.kind === "in_order" ? (
        <>
          <p className="mt-1 text-2xl font-semibold">{w.title}</p>
          <p className="mt-1 text-ink-muted">This plan is done in order rather than on set days. Pick up with your next session.</p>
          <ButtonLink href={planHref} className="mt-4">Open your next workout</ButtonLink>
        </>
      ) : w.kind === "rest" ? (
        <>
          <p className="mt-1 text-2xl font-semibold">Rest day</p>
          <p className="mt-1">{w.note ?? "Nothing scheduled today."}</p>
          <p className="mt-2 text-sm"><Link href={`/account/progress/${r.e.id}/workouts`} className={link}>Log an unplanned workout</Link></p>
        </>
      ) : (
        <ul className="mt-2 space-y-4">
          {w.sessions.map((s) => (
            <li key={s.href}>
              <p className="text-2xl font-semibold">{s.title}</p>
              <p className="text-ink-muted">
                {s.exercises} exercise{s.exercises === 1 ? "" : "s"}{s.minutes ? ` · about ${s.minutes} min` : ""}
                {s.logged ? ` · ${STATUS_LABEL[s.logged]}` : ""}
              </p>
              {s.logged && s.logged !== "in_progress" ? (
                <ButtonLink href={s.href} variant="secondary" className="mt-3">View or correct<span className="sr-only">: {s.title}</span></ButtonLink>
              ) : live ? (
                <ButtonLink href={s.href} className="mt-3 w-full sm:w-auto">{s.logged === "in_progress" ? "Continue workout" : "Start workout"}<span className="sr-only">: {s.title}</span></ButtonLink>
              ) : (
                <p className="mt-3 text-sm">Logging is paused right now. <Link href={planHref} className={link}>You can still read the workout</Link>.</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {week ? <WeekStrip week={week} weekStart={weekStart} today={today} planHref={planHref} /> : null}
    </div>
  );
}

function SessionLine({ a, tz, live }: { a: Appointment; tz: string | null; live: boolean }) {
  const minutes = Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000);
  const canJoin = a.joinable && live;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold">{bothZones(a.starts_at, tz, a.otherTz, a.otherName)}</p>
        <p className="text-sm text-ink-muted">
          {durationLabel(minutes)} · {APPOINTMENT_STATE_LABEL[a.state]}{a.purpose ? ` · ${a.purpose}` : ""}
        </p>
        {a.state === "on_hold" && a.state_reason ? <p className="text-sm">{HOLD_REASON_LABEL[a.state_reason] ?? ""}</p> : null}
      </div>
      <ButtonLink href={`/account/appointments/${a.id}`} variant={canJoin ? "primary" : "secondary"} size="sm" className="min-h-11">
        {canJoin ? "Join call" : "Details"}<span className="sr-only">: session {bothZones(a.starts_at, tz, null, "")}</span>
      </ButtonLink>
    </div>
  );
}

function Sessions({ r, d, tz }: { r: Relationship; d: ClientDashboard; tz: string | null }) {
  if (!d.schedule.ok) return <SectionFailed what="Your sessions" />;
  const s = d.schedule.data;
  const mine = s.upcoming.filter((a) => a.enrollment_id === r.e.id);
  const next = mine[0];
  const waiting = s.mine.filter((p) => p.enrollment_id === r.e.id);
  const closed = s.recentlyClosed.filter((p) => p.enrollment_id === r.e.id);
  const cancelled = s.cancelled.filter((a) => a.enrollment_id === r.e.id);
  const live = r.writeState === "live";
  return (
    <>
      {next ? <SessionLine a={next} tz={tz} live={live} /> : <p className="text-ink-muted">No session booked.</p>}
      {mine.length > 1 ? <p className="mt-1 text-sm text-ink-muted">{mine.length - 1} more booked.</p> : null}
      {waiting.length ? <p className="mt-2 text-sm">You suggested {waiting.length === 1 ? "a time" : `${waiting.length} times`} — waiting for {r.e.coachName} to answer.</p> : null}
      {closed.map((p) => (
        <p key={p.id} className="mt-2 text-sm">Your suggestion for {bothZones(p.starts_at, tz, null, "")} was {p.state === "expired" ? "not answered in time" : p.state === "declined" ? "declined" : "not possible"}. You can suggest another time.</p>
      ))}
      {cancelled.map((a) => (
        <p key={a.id} className="mt-2 text-sm">Cancelled: <Link href={`/account/appointments/${a.id}`} className={link}>{bothZones(a.starts_at, tz, null, "")}</Link></p>
      ))}
      <p className="mt-2 flex flex-wrap gap-x-5 text-sm">
        <Link href="/account/appointments" className={`inline-flex min-h-11 items-center ${link}`}>{live ? "Book, move or cancel a session" : "Your sessions"}</Link>
      </p>
    </>
  );
}

function Checkins({ r }: { r: Relationship }) {
  if (!r.checkins.ok) return <SectionFailed what="Your check-ins" />;
  const c = r.checkins.data;
  const base = `/account/progress/${r.e.id}/check-ins`;
  if (!c.open && !c.waiting.length && !c.feedback.length) {
    return <p className="text-ink-muted">Nothing due. <Link href={base} className={link}>Your check-ins</Link></p>;
  }
  return (
    <ul className="space-y-1.5">
      {c.open ? (
        <li>
          <Link href={`${base}/${c.open.id}`} className={link}>{c.open.period}</Link>: {CLIENT_STAGE_LABEL[c.open.stage]}
          {r.writeState !== "live" ? " — kept for you; it can be sent when coaching is active again" : ""}
        </li>
      ) : null}
      {c.waiting.map((w) => (
        <li key={w.id}><Link href={`${base}/${w.id}`} className={link}>{w.period}</Link>: {CLIENT_STAGE_LABEL[w.stage]}</li>
      ))}
      {c.feedback.map((f) => (
        <li key={f.id}><Link href={`${base}/${f.id}`} className={link}>{f.period}</Link>: feedback from {r.e.coachName}</li>
      ))}
    </ul>
  );
}

function Nutrition({ r }: { r: Relationship }) {
  if (!r.nutrition.ok) return <SectionFailed what="Your nutrition" />;
  const n = r.nutrition.data;
  const food = `/account/progress/${r.e.id}/food`;
  return (
    <>
      {n.plan ? (
        <p>
          <Link href={`/account/plan/${r.e.id}#nutrition`} className={link}>{n.plan.title}</Link>
          <span className="text-ink-muted">
            {[n.plan.calories ? `about ${n.plan.calories} kcal a day` : null, n.plan.proteinG ? `${n.plan.proteinG} g protein` : null, n.plan.meals ? `${n.plan.meals} meal${n.plan.meals === 1 ? "" : "s"} planned` : null]
              .filter(Boolean)
              .map((x) => ` · ${x}`)
              .join("")}
          </span>
        </p>
      ) : (
        <p className="text-ink-muted">No nutrition guidance from {r.e.coachName} yet. Not every coach includes it.</p>
      )}
      <p className="mt-1">
        Today&rsquo;s food diary:{" "}
        {n.today.entries ? `${n.today.entries} entr${n.today.entries === 1 ? "y" : "ies"}${n.today.complete ? ", marked as the whole day" : ""}` : "nothing recorded yet"} ·{" "}
        <Link href={food} className={link}>{r.writeState === "live" ? "Add food" : "Food diary"}</Link>
      </p>
    </>
  );
}

function Progress({ r }: { r: Relationship }) {
  if (!r.progress.ok) return <SectionFailed what="Your progress" />;
  const p = r.progress.data;
  const lines: string[] = [];
  if (p.consistency === "no_plan") lines.push("No workout plan in the last 4 weeks.");
  else if (p.consistency === "in_order") lines.push("Your plan is done in order, so there's no weekly target to count against.");
  else if (p.consistency.due) lines.push(`Last 4 weeks: ${p.consistency.completed} of ${p.consistency.due} planned sessions completed${p.consistency.partial ? `, ${p.consistency.partial} partly done` : ""}.`);
  else lines.push("No planned sessions have come round yet in the last 4 weeks.");
  for (const s of p.strength) lines.push(`${s.name}: ${s.metric.toLowerCase()} ${num(s.first)} → ${num(s.latest)} ${s.unit} over ${s.points} workouts.`);
  if (p.weight) {
    lines.push(
      !p.weight.readings
        ? "No weight recorded in the last 4 weeks."
        : p.weight.readings === 1 || p.weight.first === null
          ? `One weigh-in: ${num(p.weight.latest ?? 0)} ${p.weight.unit}.`
          : `Weight: ${num(p.weight.first)} → ${num(p.weight.latest!)} ${p.weight.unit} over ${p.weight.readings} readings.`,
    );
  }
  for (const m of p.measurements) {
    lines.push(m.readings > 1 && m.first !== null && m.latest !== null ? `${m.label}: ${num(m.first)} → ${num(m.latest)} ${m.unit}.` : m.readings ? `${m.label}: ${num(m.latest ?? m.first ?? 0)} ${m.unit} (one reading).` : `${m.label}: not recorded in the last 4 weeks.`);
  }
  return (
    <>
      <ul className="space-y-1 text-sm">
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
      {p.focus.length ? <p className="mt-2 text-sm text-ink-muted">{r.e.coachName} suggested tracking: {p.focus.map((f) => FOCUS_LABEL[f] ?? f).join(", ").toLowerCase()}. All optional.</p> : null}
      <p className="mt-2 text-sm"><Link href={`/account/progress/${r.e.id}`} className={link}>All your progress</Link></p>
    </>
  );
}

function Package({ r, tz }: { r: Relationship; tz: string | null }) {
  if (!r.pkg.ok) return <SectionFailed what="Your plan details" />;
  const p = r.pkg.data;
  if (!p) return <p className="text-ink-muted">{r.e.planTitle}</p>;
  const renewal =
    p.serviceType === "one_off_consultation"
      ? "A one-off session."
      : p.state === "past_due"
        ? "The last payment didn't go through."
        : p.cancelling
          ? `Won't renew — ends ${p.paidThrough ? formatDate(p.paidThrough, tz) : "at the end of the paid period"}.`
          : p.paidThrough
            ? `Renews on ${formatDate(p.paidThrough, tz)}.`
            : "";
  return (
    <>
      <p>
        <span className="font-semibold">{p.title}</span> with {r.e.coachName}
        {p.paidThrough ? ` · paid until ${formatDate(p.paidThrough, tz)}` : ""}
      </p>
      <p className="text-sm text-ink-muted">{renewal}</p>
      {p.allowance ? (
        <p className="mt-1 text-sm">
          {p.allowance.used === null
            ? `${p.allowance.allowed} calls included each paid month.`
            : `Calls this period: ${Math.max(0, p.allowance.allowed - p.allowance.used)} of ${p.allowance.allowed} left${p.allowance.periodEnd ? `, until ${formatDate(p.allowance.periodEnd, tz)}` : ""}.`}
        </p>
      ) : null}
      <p className="mt-2 flex flex-wrap gap-x-5 text-sm">
        <Link href="/account/billing" className={`inline-flex min-h-11 items-center ${link}`}>Billing</Link>
        <Link href={`/account/expectations/${r.e.id}`} className={`inline-flex min-h-11 items-center ${link}`}>Welcome &amp; expectations</Link>
      </p>
    </>
  );
}

function Messages({ convs, r }: { convs: Loaded<ConversationLink[]>; r: Relationship }) {
  if (!convs.ok) return <SectionFailed what="Your messages" />;
  const mine = convs.data.filter((c) => c.enrollmentId === r.e.id);
  if (!mine.length) return <p className="text-ink-muted">No conversation yet. <Link href="/account/messages" className={link}>Messages</Link></p>;
  return (
    <ul className="space-y-1">
      {mine.map((c) => (
        <li key={c.id}>
          <Link href={`/account/messages/${c.id}`} className={link}>{c.coachName}</Link>
          <span className="text-ink-muted">
            {c.unread ? ` · ${c.unread} unread` : " · nothing unread"}
            {!c.canSend ? " · read-only now" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

const RANK = { sessions: 0, in_order: 1, rest: 2, waiting: 3 } as const;
const rank = (r: Relationship) => (r.today.ok ? RANK[r.today.data.workout.kind] : 4);

/** First thing on the page: today's workout for each coaching relationship, a workout to do first. */
export function TodayWorkouts({ d }: { d: ClientDashboard }) {
  if (!d.current.length) return null;
  return (
    <section aria-labelledby="workout-heading" className="mt-6">
      <h2 id="workout-heading" className="sr-only">Today&rsquo;s workout</h2>
      <div className="grid gap-4">
        {[...d.current].sort((a, b) => rank(a) - rank(b)).map((r) => (
          <div key={r.e.id}>
            {d.current.length > 1 ? <p className="mb-1 text-sm font-semibold text-ink-muted">{r.e.planTitle} · {r.e.coachName}</p> : null}
            <TodayCard r={r} today={d.today} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function RelationshipCard({ r, d, tz }: { r: Relationship; d: ClientDashboard; tz: string | null }) {
  const id = `rel-${r.e.id}`;
  const stateText = r.writeState === "paused" ? "Paused — payment" : r.writeState === "suspended" ? "On hold — contact support" : r.writeState === "live" ? "Active" : "Not active";
  return (
    <section aria-labelledby={id} className="mt-10">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={id} className="text-2xl font-semibold">{r.e.planTitle} <span className="font-normal text-ink-muted">with {r.e.coachName}</span></h2>
        <StatusPill tone={r.writeState === "live" ? "good" : r.writeState === "paused" || r.writeState === "suspended" ? "bad" : "neutral"}>{stateText}</StatusPill>
      </div>
      {r.writeState === "paused" ? (
        <p role="alert" className="mt-3 rounded-lg border border-danger bg-danger-tint p-4 font-medium">
          {PAUSED_FOR_PAYMENT_NOTICE} <Link href="/account/billing" className="underline">Update your card</Link>. Everything you&rsquo;ve recorded stays here to read.
        </p>
      ) : null}
      <div className="mt-4 grid gap-x-8 md:grid-cols-2">
        <div>
          <Block title="Next session" id={`${id}-sessions`}><Sessions r={r} d={d} tz={tz} /></Block>
          <Block title="Check-ins" id={`${id}-checkins`}><Checkins r={r} /></Block>
          <Block title="Messages" id={`${id}-messages`}><Messages convs={d.messages} r={r} /></Block>
        </div>
        <div>
          <Block title="Nutrition and food" id={`${id}-food`}><Nutrition r={r} /></Block>
          <Block title="Progress" id={`${id}-progress`}><Progress r={r} /></Block>
          <Block title="Your plan" id={`${id}-package`}><Package r={r} tz={tz} /></Block>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Updates, one-off sessions, support, earlier coaching
// ---------------------------------------------------------------------------

export function Updates({ d, tz }: { d: ClientDashboard; tz: string | null }) {
  const all = d.current.flatMap((r) => (r.notices.ok ? r.notices.data : []));
  const notices = visibleNotices(all, d.marks.ok ? d.marks.data : []);
  const failed = d.current.some((r) => !r.notices.ok);
  if (!notices.length && !failed) return null;
  return (
    <section aria-labelledby="updates-heading" className="mt-10">
      <h2 id="updates-heading" className="text-2xl font-semibold">Updates from your coach</h2>
      {failed ? <div className="mt-3"><SectionFailed what="Some updates" /></div> : null}
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {notices.map((n) => (
          <li key={n.key} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <Link href={n.href} className={`text-lg ${link}`}>{n.title}</Link>
              <p className="text-sm text-ink-muted">{n.coachName} · {formatDate(n.at, tz)}</p>
              {n.detail ? <p className="mt-1">{n.detail}</p> : null}
              {n.actionNeeded ? <p className="mt-1 text-sm font-semibold">You were asked to confirm you&rsquo;ve read this. It stays here until you do.</p> : null}
            </div>
            {!n.actionNeeded ? (
              <ActionForm action={dismissNoticeAction}>
                <input type="hidden" name="item" value={n.key} />
                <SubmitButton variant="quiet" pendingLabel="…">Dismiss<span className="sr-only">: {n.title}</span></SubmitButton>
              </ActionForm>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-ink-muted">Dismissing only hides the note here. It doesn&rsquo;t accept or agree to anything.</p>
    </section>
  );
}

export function OneOffSessions({ d, tz }: { d: ClientDashboard; tz: string | null }) {
  if (!d.schedule.ok) return null;
  const list = d.schedule.data.upcoming.filter((a) => !a.enrollment_id);
  if (!list.length) return null;
  return (
    <section aria-labelledby="oneoff-heading" className="mt-10">
      <h2 id="oneoff-heading" className="text-2xl font-semibold">One-off sessions</h2>
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {list.map((a) => (
          <li key={a.id} className="py-3">
            <p className="text-sm text-ink-muted">With {a.otherName}</p>
            <SessionLine a={a} tz={tz} live />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SupportBlock() {
  return (
    <section aria-labelledby="help-heading" className="mt-10 rounded-2xl border border-line bg-surface p-5">
      <h2 id="help-heading" className="text-xl font-semibold">Need help?</h2>
      <p className="mt-1 text-ink-muted">TalentYak support is here even while coaching is paused.</p>
      <ul className="mt-3 grid gap-1 sm:grid-cols-3">
        <li><Link href="/account/support?category=other&about=coach_unavailable" className={`inline-flex min-h-11 items-center ${link}`}>My coach isn&rsquo;t available</Link></li>
        <li><Link href="/account/support?category=technical&about=call_failed" className={`inline-flex min-h-11 items-center ${link}`}>A call didn&rsquo;t work</Link></li>
        <li><Link href="/account/support?category=billing" className={`inline-flex min-h-11 items-center ${link}`}>A payment problem</Link></li>
      </ul>
    </section>
  );
}

export function EarlierCoaching({ d }: { d: ClientDashboard }) {
  if (!d.ended.length && !d.pending.length) return null;
  return (
    <>
      {d.pending.map((e) => (
        <p key={e.id} role="status" className="mt-8 rounded-lg border border-line-strong bg-paper-raised p-4">
          Your coaching with {e.coachName} is being set up. It appears here once the payment is confirmed.
        </p>
      ))}
      {d.ended.length ? (
        <section aria-labelledby="earlier-heading" className="mt-10">
          <h2 id="earlier-heading" className="text-xl font-semibold">Earlier coaching</h2>
          <p className="mt-1 text-ink-muted">Ended. Everything stays here for you to read.</p>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {d.ended.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span><span className="font-semibold">{e.planTitle}</span> <span className="text-ink-muted">with {e.coachName}</span></span>
                <span className="flex flex-wrap gap-x-4 text-sm">
                  <Link href={`/account/plan/${e.id}`} className={`inline-flex min-h-11 items-center ${link}`}>Plans</Link>
                  <Link href={`/account/progress/${e.id}`} className={`inline-flex min-h-11 items-center ${link}`}>Records</Link>
                  <Link href={`/account/progress/${e.id}/check-ins`} className={`inline-flex min-h-11 items-center ${link}`}>Check-ins</Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
