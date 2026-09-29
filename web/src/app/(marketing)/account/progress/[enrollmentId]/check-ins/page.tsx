import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/button";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton, TextField } from "@/components/form/fields";
import { Panel, StatusPill } from "@/components/ui/panel";
import { TrackingHeader } from "@/components/tracking/tracking-nav";
import { PAUSED_FOR_PAYMENT_NOTICE } from "@/lib/policy";
import { formatDate } from "@/lib/format";
import { addMyCheckinBreakAction, cancelCheckinBreakAction } from "@/lib/checkins/actions";
import { checkinsFor, refreshCheckins, scheduleFor } from "@/lib/checkins/server";
import { cadenceLabel, CLIENT_STAGE_LABEL, clientStage, periodLabel, wasLate, type ClientStage } from "@/lib/checkins/status";
import { clientTracking } from "@/lib/tracking/context";

export const metadata: Metadata = { title: "Check-ins" };
export const dynamic = "force-dynamic";

const TONE: Record<ClientStage, "good" | "warn" | "neutral" | "bad"> = {
  awaiting_submission: "warn",
  draft: "warn",
  awaiting_feedback: "neutral",
  feedback_received: "good",
  reopened: "neutral",
  missed: "neutral",
  closed: "neutral",
};

export default async function CheckinsPage({ params }: { params: Promise<{ enrollmentId: string }> }) {
  const { enrollmentId } = await params;
  const ctx = await clientTracking(enrollmentId, `/account/progress/${enrollmentId}/check-ins`);
  // Makes this period's request if it's due — never one for a past period.
  await refreshCheckins(enrollmentId);
  const [items, schedule] = await Promise.all([checkinsFor(enrollmentId), scheduleFor(enrollmentId)]);
  const base = `${ctx.base}/check-ins`;
  const live = ctx.writeState === "live" || ctx.writeState === "logging_paused";
  const current = items.find((c) => c.status === "open");
  const breaks = (schedule?.breaks ?? []).filter((b) => !b.cancelled_at && b.ends_on >= ctx.today);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-16">
      <TrackingHeader
        base={ctx.base}
        current="checkins"
        title="Check-ins"
        subtitle={`A short regular update for ${ctx.enrollment.coachName}. Only you and your current coach can see it.`}
        writeState={ctx.writeState}
        pausedNotice={PAUSED_FOR_PAYMENT_NOTICE}
      />

      {schedule?.current ? (
        <p className="mt-5 text-ink-muted">
          {cadenceLabel(schedule.current.interval_weeks, schedule.current.due_weekday, schedule.current.due_time)} ({schedule.current.timezone.replace(/_/g, " ")} time).
          {schedule.paused_at ? " Paused by your coach for now — nothing is being asked." : ""} Missing one never affects your coaching.
        </p>
      ) : (
        <p className="mt-5 rounded-lg border border-line-strong bg-paper-raised p-4">
          {ctx.enrollment.coachName} hasn&rsquo;t set up regular check-ins yet. You can always message them in the meantime.
        </p>
      )}

      {current ? (
        <section aria-labelledby="now-heading" className="mt-6 rounded-2xl border border-brand bg-brand-tint p-5">
          <h2 id="now-heading" className="text-xl font-semibold">This period: {periodLabel(current.period_start, current.period_end)}</h2>
          <p className="mt-1">Due {formatDate(current.due_at, current.timezone, true)} — about two minutes. Your workouts, weight and food diary are added for you.</p>
          <div className="mt-4">
            <ButtonLink href={`${base}/${current.id}`}>{current.hasDraft ? "Finish your check-in" : "Start your check-in"}</ButtonLink>
          </div>
        </section>
      ) : null}

      <Panel title="Your check-ins" id="list">
        {items.length === 0 ? (
          <p className="text-ink-muted">Nothing here yet. When your coach&rsquo;s schedule starts, each period&rsquo;s check-in appears here.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((c) => {
              const stage = clientStage(c, c.hasDraft, c.feedbackCoversLatest, c.anyFeedback);
              return (
                <li key={c.id} className="py-3">
                  <Link href={`${base}/${c.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-semibold text-brand underline underline-offset-4">{periodLabel(c.period_start, c.period_end)}</span>
                      <span className="block text-sm text-ink-muted">
                        {c.first_submitted_at
                          ? `Sent ${formatDate(c.first_submitted_at, c.timezone, true)}${wasLate(c) ? " (after the due time)" : ""}${c.current_revision > 1 ? ` · updated ${c.current_revision - 1}×` : ""}`
                          : `Due ${formatDate(c.due_at, c.timezone, true)}`}
                      </span>
                    </span>
                    <StatusPill tone={TONE[stage]}>{CLIENT_STAGE_LABEL[stage]}</StatusPill>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {schedule ? (
        <Panel title="Planned breaks" id="breaks" description="Travelling, a festival, a busy fortnight? No check-in is asked for while a break lasts.">
          {breaks.length ? (
            <ul className="mb-4 space-y-2">
              {breaks.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
                  <span>{periodLabel(b.starts_on, b.ends_on)}{b.note ? ` · ${b.note}` : ""}</span>
                  {live ? (
                    <ActionForm action={cancelCheckinBreakAction}>
                      <input type="hidden" name="break_id" value={b.id} />
                      <input type="hidden" name="enrollment_id" value={enrollmentId} />
                      <SubmitButton variant="secondary" pendingLabel="Cancelling…">Cancel break</SubmitButton>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {live ? (
            <ActionForm action={addMyCheckinBreakAction} className="grid gap-4 sm:grid-cols-2" resetOnSuccess>
              <input type="hidden" name="enrollment_id" value={enrollmentId} />
              <TextField name="starts_on" label="First day" type="date" required />
              <TextField name="ends_on" label="Last day" type="date" required />
              <TextField name="note" label="Note for your coach" className="sm:col-span-2" maxLength={200} />
              <div className="sm:col-span-2"><SubmitButton variant="secondary" pendingLabel="Adding…">Add a break</SubmitButton></div>
            </ActionForm>
          ) : (
            <p className="text-ink-muted">Breaks can be added while coaching is active.</p>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
