import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/button";
import { Panel, StatusPill } from "@/components/ui/panel";
import { CheckinForm } from "@/components/checkins/checkin-form";
import { ExpectationNote } from "@/components/checkins/expectation";
import { AnswersView, FeedbackView, RevisionList, SnapshotView } from "@/components/checkins/views";
import { PAUSED_FOR_PAYMENT_NOTICE } from "@/lib/policy";
import { formatDate } from "@/lib/format";
import { buildSnapshot, checkinDetail, reviewExpectation } from "@/lib/checkins/server";
import { describeSnapshot } from "@/lib/checkins/snapshot";
import { CLIENT_STAGE_LABEL, CLOSED_REASON, clientStage, periodLabel, wasLate } from "@/lib/checkins/status";
import { clientTracking } from "@/lib/tracking/context";

export const metadata: Metadata = { title: "Check-in" };
export const dynamic = "force-dynamic";

export default async function CheckinPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string; checkinId: string }>;
  searchParams: Promise<{ correct?: string; sent?: string }>;
}) {
  const [{ enrollmentId, checkinId }, sp] = await Promise.all([params, searchParams]);
  const path = `/account/progress/${enrollmentId}/check-ins/${checkinId}`;
  const ctx = await clientTracking(enrollmentId, path);
  const detail = await checkinDetail(checkinId);
  if (!detail || detail.checkin.enrollment_id !== enrollmentId) notFound();
  const { checkin: c, questions, submissions, feedback } = detail;
  const listHref = `${ctx.base}/check-ins`;
  const latest = submissions.at(-1) ?? null;
  const published = feedback.filter((f) => f.published_at).sort((a, b) => b.published_at!.localeCompare(a.published_at!));
  const covers = published.some((f) => f.refers_to_revision >= (c.review_revision ?? 1));
  const stage = clientStage(c, Boolean(detail.draft), covers, published.length > 0);
  const live = ctx.writeState === "live";
  const answering = c.status === "open" || (sp.correct === "1" && ["submitted", "reviewed", "reopened"].includes(c.status));
  const period = periodLabel(c.period_start, c.period_end);

  // The period's progress as it stands now: a preview before sending, and
  // the comparison that shows later additions after it.
  const units = latest?.progress_snapshot
    ? { weight: latest.progress_snapshot.weight.unit, length: latest.progress_snapshot.measurements[0]?.unit ?? ctx.prefs.length_unit }
    : { weight: ctx.prefs.weight_unit, length: ctx.prefs.length_unit };
  const now = await buildSnapshot({
    enrollmentId,
    plans: ctx.plans,
    from: c.period_start,
    to: c.period_end,
    today: ctx.today,
    timeZone: c.timezone,
    weightUnit: units.weight,
    lengthUnit: units.length,
  }).catch(() => null);

  const header = (
    <>
      <p><Link href={listHref} className="text-brand underline underline-offset-4">← Check-ins</Link></p>
      <h1 className="mt-4 font-display text-4xl sm:text-5xl">Check-in: {period}</h1>
      <p className="mt-2 text-lg text-ink-muted">
        For {ctx.enrollment.coachName}. Due {formatDate(c.due_at, c.timezone, true)}
        {c.first_submitted_at ? ` · sent ${formatDate(c.first_submitted_at, c.timezone, true)}${wasLate(c) ? " (after the due time — that's fine)" : ""}` : ""}.
      </p>
      <p className="mt-3"><StatusPill tone={stage === "feedback_received" ? "good" : "neutral"}>{CLIENT_STAGE_LABEL[stage]}</StatusPill></p>
    </>
  );

  if (answering) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 md:py-16">
        {header}
        <Panel title="Added for you from your records" id="summary" description="Your coach sees this with your answers. Nothing to type again.">
          {now ? (
            <ul className="space-y-2">
              {describeSnapshot(now).map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className={`mt-2 size-2 shrink-0 rounded-full ${l.incomplete ? "border border-ink-muted" : "bg-brand"}`} />
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-muted">Your records couldn&rsquo;t be summarised just now. You can still send your answers.</p>
          )}
          <p className="mt-3 text-sm text-ink-muted">
            Want to add something first? <Link href={`/account/plan/${enrollmentId}`} className="text-brand underline underline-offset-4">Log a workout</Link>,{" "}
            <Link href={`${ctx.base}/body`} className="text-brand underline underline-offset-4">weight</Link> or <Link href={`${ctx.base}/food`} className="text-brand underline underline-offset-4">food</Link>.
          </p>
        </Panel>
        <CheckinForm
          viewerId={ctx.session.userId}
          checkinId={c.id}
          enrollmentId={enrollmentId}
          questions={questions}
          mode={c.status === "open" ? "first" : "correct"}
          serverDraft={detail.draft}
          lastSent={latest?.answers ?? null}
          submittedRevision={c.current_revision}
          writeState={ctx.writeState}
          pausedNotice={PAUSED_FOR_PAYMENT_NOTICE}
          doneHref={path}
        />
      </div>
    );
  }

  const expectation = c.status === "submitted" || c.status === "reopened" ? await reviewExpectation(c.id) : null;
  const versions = ctx.plans.flatMap((p) => p.versions.map((v) => ({ ...v, kind: p.kind })));

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 md:py-16">
      {header}
      {ctx.writeState === "paused" ? (
        <p role="alert" className="mt-5 rounded-lg border border-danger bg-danger-tint p-4 font-medium">
          {PAUSED_FOR_PAYMENT_NOTICE} <Link href="/account/billing" className="underline">Update your card</Link>.
        </p>
      ) : null}
      {sp.sent === "1" ? <p role="status" className="mt-5 rounded-lg border border-brand bg-brand-tint p-4 font-medium">Sent. {ctx.enrollment.coachName} can see it now.</p> : null}

      {c.status === "missed" || c.status === "cancelled" ? (
        <p className="mt-5 rounded-lg border border-line-strong bg-paper-raised p-4">{CLOSED_REASON[c.status_reason ?? ""] ?? "This check-in is closed."}</p>
      ) : null}
      {c.status === "cancelled" && detail.draft ? (
        <Panel title="Your unsent answers" id="unsent" description="Kept for you. Nobody else can see them.">
          <AnswersView questions={questions} answers={detail.draft.answers} />
        </Panel>
      ) : null}
      {c.needs_resolution ? (
        <p role="note" className="mt-5 rounded-lg border border-line-strong bg-paper-raised p-4">
          Your coach changed after you sent this. Because of what you chose to share with your new coach, TalentYak is sorting out who replies — nothing you wrote has been shown to anyone new.
        </p>
      ) : null}

      {expectation && !c.needs_resolution && !covers ? <ExpectationNote e={expectation} viewer="client" timeZone={ctx.tz} supportHref="/account/support" /> : null}

      {published.length ? (
        <Panel title={published.length > 1 ? "Feedback from your coach (newest first)" : "Feedback from your coach"} id="feedback">
          <div className="space-y-4">
            {published.map((f) => (
              <FeedbackView
                key={f.id}
                feedback={f}
                timeZone={ctx.tz}
                submissions={submissions}
                planLabel={f.plan_id ? "Open your plan" : null}
                planHref={f.plan_id ? `/account/plan/${enrollmentId}` : null}
                conversationHref={f.conversation_id ? `/account/messages/${f.conversation_id}` : null}
                versionLink={(id) => {
                  const v = versions.find((x) => x.id === id);
                  return v ? { versionId: id, label: `${v.kind === "workout" ? "Workout" : "Nutrition"} plan, version ${v.version}`, href: `/account/plan/${enrollmentId}/history?v=${id}` } : { versionId: id, label: "A published plan version", href: null };
                }}
              />
            ))}
          </div>
        </Panel>
      ) : null}

      {latest ? (
        <Panel title="What you sent" id="answers" description={submissions.length > 1 ? `Version ${latest.revision}, sent ${formatDate(latest.submitted_at, ctx.tz, true)}. Earlier versions are kept.` : undefined}>
          <AnswersView questions={questions} answers={latest.answers} previous={submissions.length > 1 ? submissions.at(-2)!.answers : null} />
          <div className="mt-4"><RevisionList submissions={submissions} timeZone={ctx.tz} /></div>
          {live && c.needs_resolution === null ? (
            <div className="mt-5">
              <ButtonLink href={`${path}?correct=1`} variant="secondary">Correct my answers</ButtonLink>
              <p className="mt-1 text-sm text-ink-muted">Your original stays on record with any feedback on it.</p>
            </div>
          ) : !live && ctx.writeState === "paused" ? (
            <p className="mt-4 text-sm text-ink-muted">Corrections can be made once coaching is active again.</p>
          ) : null}
        </Panel>
      ) : null}

      {latest ? (
        <Panel title="Your progress in this period" id="progress">
          <SnapshotView snapshot={submissions[0].progress_snapshot} current={now} timeZone={ctx.tz} />
        </Panel>
      ) : null}
    </div>
  );
}
