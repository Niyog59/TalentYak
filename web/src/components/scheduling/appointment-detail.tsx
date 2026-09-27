import Link from "next/link";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SelectField, SubmitButton, TextArea } from "@/components/form/fields";
import { ProposeForm } from "@/components/scheduling/propose-form";
import { ProposalList } from "@/components/scheduling/schedule-lists";
import { cancelAppointmentAction, recordOutcomeAction } from "@/lib/scheduling/actions";
import type { AppointmentDetail } from "@/lib/scheduling/server";
import {
  APPOINTMENT_STATE_LABEL,
  HOLD_REASON_LABEL,
  OUTCOME_LABEL,
  WEEKDAY_LABEL,
  durationLabel,
  whenIn,
  type AppointmentState,
} from "@/lib/scheduling/types";

const ACTOR = { customer: "Client", coach: "Coach", admin: "TalentYak", system: "Automatic" } as Record<string, string>;

/**
 * One session: when it is for each person, what state it is in and why, its
 * whole history, and what can be done with it. There is deliberately no
 * "join" button: calls arrive in a later update (Batch 5).
 */
export function AppointmentDetailView({
  a,
  role,
  viewerId,
  viewerTz,
  durations,
  backHref,
}: {
  a: AppointmentDetail;
  role: "customer" | "coach";
  viewerId: string;
  viewerTz: string;
  durations: number[];
  backHref: string;
}) {
  const minutes = Math.round((Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60_000);
  // Per-request server component (its pages are force-dynamic): renders once, so the
  // instability the purity rule guards against cannot occur.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const upcoming = Date.parse(a.starts_at) > now;
  const live = ["booked", "tentative", "on_hold"].includes(a.state);
  const started = !upcoming;

  return (
    <div className="grid gap-6">
      <Link href={backHref} className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">← All sessions</Link>

      <section className="rounded-2xl border border-line bg-surface p-5" aria-labelledby="session-heading">
        <p className="text-sm font-semibold text-ink-muted">{APPOINTMENT_STATE_LABEL[a.state as AppointmentState] ?? a.state}</p>
        <h1 id="session-heading" className="mt-1 font-display text-3xl">Session with {a.otherName}</h1>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="font-semibold">Your time</dt><dd>{whenIn(a.starts_at, viewerTz)}</dd>
          <dt className="font-semibold">{a.otherName}&rsquo;s time</dt><dd>{whenIn(a.starts_at, a.otherTz)}</dd>
          <dt className="font-semibold">Length</dt><dd>{durationLabel(minutes)}</dd>
          {a.series ? (
            <>
              <dt className="font-semibold">Repeats</dt>
              <dd>
                Every {a.series.interval_weeks > 1 ? `${a.series.interval_weeks} weeks on ` : ""}{WEEKDAY_LABEL[a.series.weekday]} at {a.series.local_start.slice(0, 5)} in {a.series.reference_timezone}
                {a.series.state === "ended" ? " (series ended)" : ""}. It stays at that local time when clocks change there, and doesn&rsquo;t move if anyone travels.
              </dd>
            </>
          ) : null}
          {a.time_note ? (<><dt className="font-semibold">Clock change</dt><dd>{a.time_note}.</dd></>) : null}
          <dt className="font-semibold">How you&rsquo;ll meet</dt>
          <dd>Video and audio calls in TalentYak are coming in a later update. For now, agree how to meet in your messages.</dd>
        </dl>
        {a.state === "tentative" ? (
          <p className="mt-4 rounded-lg bg-accent-tint p-3">This session is after the current paid period. It confirms automatically when the next payment goes through, if the time is still free.</p>
        ) : null}
        {a.state === "on_hold" && a.state_reason ? (
          <p className="mt-4 rounded-lg bg-accent-tint p-3">{HOLD_REASON_LABEL[a.state_reason] ?? a.state_reason}</p>
        ) : null}
        {a.state === "held" ? <p className="mt-4 rounded-lg bg-paper-raised p-3">This time is held while payment is completed.</p> : null}
      </section>

      {a.pending.length ? (
        <section aria-labelledby="pending-heading">
          <h2 id="pending-heading" className="text-xl font-semibold">Suggested new time</h2>
          <p className="text-sm text-ink-muted">The session above stays as it is until a new time is accepted.</p>
          <div className="mt-3">
            <ProposalList proposals={a.pending} viewerId={viewerId} viewerTz={viewerTz} durationsFor={() => ({ durations, fixed: a.kind === "consultation" ? minutes : null })} empty="" />
          </div>
        </section>
      ) : null}

      {live && upcoming ? (
        <section className="rounded-2xl border border-line bg-surface p-5" aria-labelledby="move-heading">
          <h2 id="move-heading" className="text-xl font-semibold">Suggest a new time</h2>
          <p className="text-sm text-ink-muted">The current time is kept until {a.otherName} accepts the new one.</p>
          <div className="mt-4">
            <ProposeForm
              kind={a.kind}
              replacesId={a.id}
              isSeriesOccurrence={Boolean(a.series_id)}
              durations={durations}
              fixedDuration={a.kind === "consultation" ? minutes : null}
              viewerTz={viewerTz}
              otherTz={a.otherTz}
              otherLabel={a.otherName}
              allowWeekly={false}
              submitLabel="Suggest this new time"
            />
          </div>
        </section>
      ) : null}

      {live && upcoming ? (
        <section className="rounded-2xl border border-line bg-surface p-5" aria-labelledby="cancel-heading">
          <h2 id="cancel-heading" className="text-xl font-semibold">Cancel</h2>
          <p className="text-sm text-ink-muted">{a.otherName} is told straight away. Cancelling doesn&rsquo;t charge, refund or penalise anyone.</p>
          <ActionForm action={cancelAppointmentAction} className="mt-4 grid gap-4">
            <input type="hidden" name="appointment_id" value={a.id} />
            {a.series_id ? (
              <fieldset className="grid gap-2">
                <legend className="font-semibold">Which sessions</legend>
                <label className="flex min-h-11 items-center gap-3"><input type="radio" name="scope" value="this" defaultChecked className="size-5" /> Only this one</label>
                <label className="flex min-h-11 items-center gap-3"><input type="radio" name="scope" value="future" className="size-5" /> This one and all later ones (earlier sessions are kept)</label>
              </fieldset>
            ) : null}
            <TextArea name="reason" label="A short note for them" rows={2} maxLength={200} required={false} />
            <CheckboxField name="confirm" required label="Yes, cancel" />
            <div><SubmitButton variant="secondary" pendingLabel="Cancelling…">Cancel session</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}

      {role === "coach" && a.state === "booked" && started ? (
        <section className="rounded-2xl border border-line bg-surface p-5" aria-labelledby="outcome-heading">
          <h2 id="outcome-heading" className="text-xl font-semibold">What happened</h2>
          <p className="text-sm text-ink-muted">A record only. It doesn&rsquo;t charge, refund, pay out or mark anything as delivered.</p>
          <ActionForm action={recordOutcomeAction} className="mt-4 grid gap-4 sm:max-w-md">
            <input type="hidden" name="appointment_id" value={a.id} />
            <SelectField name="outcome" label="Outcome" required options={Object.entries(OUTCOME_LABEL).map(([value, label]) => ({ value, label }))} />
            <TextArea name="note" label="Note" rows={2} maxLength={500} required={false} />
            <div><SubmitButton pendingLabel="Saving…">Record</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}

      {a.outcomes.length ? (
        <section aria-labelledby="outcomes-heading">
          <h2 id="outcomes-heading" className="text-xl font-semibold">Recorded outcome</h2>
          <ul className="mt-2 space-y-1">
            {a.outcomes.map((o, i) => (
              <li key={i}>{OUTCOME_LABEL[o.outcome] ?? o.outcome} — {ACTOR[o.recorded_role]}, {whenIn(o.recorded_at, viewerTz)}{o.note ? `: ${o.note}` : ""}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-xl font-semibold">History</h2>
        <ol className="mt-2 space-y-1 text-sm">
          {a.events.map((e, i) => (
            <li key={i}>
              {whenIn(e.created_at, viewerTz)} — {ACTOR[e.actor_role] ?? e.actor_role}:{" "}
              {e.from_state ? `${APPOINTMENT_STATE_LABEL[e.from_state as AppointmentState] ?? e.from_state} → ` : ""}
              {APPOINTMENT_STATE_LABEL[e.to_state as AppointmentState] ?? e.to_state}
              {e.reason ? ` (${e.reason.replaceAll("_", " ")})` : ""}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
