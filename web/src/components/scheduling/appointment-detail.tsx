import Link from "next/link";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SelectField, SubmitButton, TextArea } from "@/components/form/fields";
import { ProposeForm } from "@/components/scheduling/propose-form";
import { ProposalList } from "@/components/scheduling/schedule-lists";
import { CallPanel } from "@/components/calls/call-panel";
import { cancelAppointmentAction, openSessionCaseAction, recordOutcomeAction, setPurposeAction } from "@/lib/scheduling/actions";
import type { AppointmentDetail } from "@/lib/scheduling/server";
import { clockTime } from "@/lib/calls/window";
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

/** History entries that record something about the session without changing its state. */
const NOTE_EVENT: Record<string, string> = {
  outcome_recorded: "Outcome recorded",
  outcome_corrected: "Outcome corrected (the earlier record is kept)",
  outcome_questioned: "Client asked TalentYak to review the recorded outcome",
  call_problem_reported: "A problem with the call was reported to TalentYak",
  purpose_set: "Purpose added or changed",
  purpose_cleared: "Purpose removed",
};

const inCallFor = (s: number) => (s < 60 ? "under a minute" : `${Math.round(s / 60)} min`);

/**
 * One session: when it is for each person, what state it is in and why, its
 * private call, its whole history, and what can be done with it.
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
  const messagesHref = a.conversationId ? (role === "customer" ? `/account/messages/${a.conversationId}` : `/coach/messages/${a.conversationId}`) : null;
  const myReports = a.call?.my_open_reports ?? [];
  const current = a.outcomes[0] ?? null;
  const roomClosed = !a.call || Date.parse(a.call.closes_at) <= now;

  const reportCallProblem = myReports.includes("call_problem") ? (
    <p className="rounded-lg bg-brand-tint p-3">You&rsquo;ve told TalentYak about a problem with this call. They&rsquo;ll reply in <Link className="font-semibold underline underline-offset-4" href={role === "customer" ? "/account/support" : "/coach/support"}>Support</Link>.</p>
  ) : (
    <ActionForm action={openSessionCaseAction} className="grid gap-3">
      <input type="hidden" name="appointment_id" value={a.id} />
      <input type="hidden" name="topic" value="call_problem" />
      <TextArea name="description" label="What went wrong with the call?" rows={3} maxLength={2000} required
        help="For example: couldn't hear each other, the call kept dropping, couldn't join. Goes to TalentYak support." />
      <div><SubmitButton variant="secondary" pendingLabel="Sending…">Report a call problem</SubmitButton></div>
    </ActionForm>
  );

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
          <dd>A private video or audio call, on this page.{a.call ? ` The room opens at ${clockTime(a.call.opens_at, viewerTz)} and stays open until ${clockTime(a.call.closes_at, viewerTz)}.` : ""}</dd>
          <dt className="font-semibold">Purpose</dt>
          <dd>{a.purpose ?? <span className="text-ink-muted">Not set</span>}</dd>
        </dl>
        {live && Date.parse(a.ends_at) > now ? (
          <details className="mt-4">
            <summary className="min-h-11 cursor-pointer content-center font-semibold text-brand">{a.purpose ? "Change the purpose" : "Add a purpose"}</summary>
            <ActionForm action={setPurposeAction} className="mt-2 grid gap-3 sm:max-w-md">
              <input type="hidden" name="appointment_id" value={a.id} />
              <TextArea name="purpose" label="What this session is for" rows={2} maxLength={140} required={false} defaultValue={a.purpose ?? ""}
                help="A few words you'll both see, like “Review week 3 plan”. Keep health details in your messages." />
              <div><SubmitButton variant="secondary" pendingLabel="Saving…">Save</SubmitButton></div>
            </ActionForm>
          </details>
        ) : null}
        {a.state === "tentative" ? (
          <p className="mt-4 rounded-lg bg-accent-tint p-3">This session is after the current paid period. It confirms automatically when the next payment goes through, if the time is still free.</p>
        ) : null}
        {a.state === "on_hold" && a.state_reason ? (
          <p className="mt-4 rounded-lg bg-accent-tint p-3">{HOLD_REASON_LABEL[a.state_reason] ?? a.state_reason}</p>
        ) : null}
        {a.state === "held" ? <p className="mt-4 rounded-lg bg-paper-raised p-3">This time is held while payment is completed.</p> : null}
      </section>

      {a.call && a.state === "booked" && Date.parse(a.call.closes_at) > now ? (
        <section className="rounded-2xl border border-line bg-surface p-5" aria-labelledby="call-heading">
          <h2 id="call-heading" className="text-xl font-semibold">Call</h2>
          <div className="mt-3">
            <CallPanel
              appointmentId={a.id}
              otherName={a.otherName}
              viewerTz={viewerTz}
              times={{ startsAt: a.starts_at, endsAt: a.ends_at, opensAt: a.call.opens_at, closesAt: a.call.closes_at }}
              warningMinutes={a.call.closing_warning_minutes}
              bookAgainHref={role === "customer" ? "/account/appointments" : "/coach/calendar"}
              messagesHref={messagesHref}
              reportSlot={reportCallProblem}
            />
          </div>
        </section>
      ) : a.call && ["tentative", "on_hold", "held"].includes(a.state) && Date.parse(a.ends_at) > now ? (
        <section className="rounded-2xl border border-line bg-surface p-5" aria-labelledby="call-heading">
          <h2 id="call-heading" className="text-xl font-semibold">Call</h2>
          <p className="mt-2">The call can be joined once this session is confirmed.</p>
        </section>
      ) : null}

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

      {a.attendance.length ? (
        <section aria-labelledby="attendance-heading">
          <h2 id="attendance-heading" className="text-xl font-semibold">Who joined the call</h2>
          <ul className="mt-2 space-y-1">
            {a.attendance.map((x, i) => (
              <li key={i}>
                {x.role === role ? "You" : x.role === "coach" ? `${a.otherName} (coach)` : a.otherName} — joined {whenIn(x.joined_at, viewerTz)}, in the call {inCallFor(x.duration_seconds)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-sm text-ink-muted">From the call service. It shows who connected, not whether the session was delivered; a dropped connection is never treated as a no-show.</p>
        </section>
      ) : null}

      {role === "coach" && a.state === "booked" && started ? (
        <section className="rounded-2xl border border-line bg-surface p-5" aria-labelledby="outcome-heading">
          <h2 id="outcome-heading" className="text-xl font-semibold">{current ? "Correct the record" : "What happened"}</h2>
          <p className="text-sm text-ink-muted">
            A record only. It doesn&rsquo;t charge, refund, pay out or mark anything as delivered, and &ldquo;Technically interrupted&rdquo; is never counted against anyone.
            {current ? " A correction is added alongside the earlier record, which is kept." : ` ${a.otherName} is told what you record.`}
          </p>
          <ActionForm action={recordOutcomeAction} className="mt-4 grid gap-4 sm:max-w-md">
            <input type="hidden" name="appointment_id" value={a.id} />
            {current ? <input type="hidden" name="correcting" value="1" /> : null}
            <SelectField name="outcome" label="Outcome" required options={Object.entries(OUTCOME_LABEL).map(([value, label]) => ({ value, label }))} />
            <TextArea name="note" label={current ? "Why the record is being corrected" : "Note"} rows={2} maxLength={500} required={Boolean(current)} />
            <div><SubmitButton pendingLabel="Saving…">{current ? "Save correction" : "Record"}</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}

      {a.outcomes.length ? (
        <section aria-labelledby="outcomes-heading">
          <h2 id="outcomes-heading" className="text-xl font-semibold">Recorded outcome</h2>
          <ul className="mt-2 space-y-2">
            {a.outcomes.map((o, i) => (
              <li key={o.id}>
                <span className="font-semibold">{OUTCOME_LABEL[o.outcome] ?? o.outcome}</span>
                {i === 0 && a.outcomes.length > 1 ? " (current)" : ""}
                {i > 0 ? <span className="text-ink-muted"> (corrected later)</span> : null}
                {" "}— {ACTOR[o.recorded_role]}, {whenIn(o.recorded_at, viewerTz)}{o.note ? `: ${o.note}` : ""}
              </li>
            ))}
          </ul>
          {role === "customer" ? (
            myReports.includes("outcome_incorrect") ? (
              <p className="mt-3 rounded-lg bg-brand-tint p-3">You&rsquo;ve asked TalentYak to review this. They&rsquo;ll reply in <Link className="font-semibold underline underline-offset-4" href="/account/support">Support</Link>; the record isn&rsquo;t changed until then.</p>
            ) : (
              <details className="mt-3">
                <summary className="min-h-11 cursor-pointer content-center font-semibold text-brand">This isn&rsquo;t right</summary>
                <ActionForm action={openSessionCaseAction} className="mt-2 grid gap-3 sm:max-w-md">
                  <input type="hidden" name="appointment_id" value={a.id} />
                  <input type="hidden" name="topic" value="outcome_incorrect" />
                  <TextArea name="description" label="What actually happened?" rows={3} maxLength={2000} required
                    help="TalentYak support reviews it and replies in Support. Nothing is changed without a record." />
                  <div><SubmitButton variant="secondary" pendingLabel="Sending…">Ask TalentYak to review</SubmitButton></div>
                </ActionForm>
              </details>
            )
          ) : null}
        </section>
      ) : null}

      {a.state === "booked" && started && roomClosed ? (
        <details className="rounded-2xl border border-line bg-surface p-5">
          <summary className="min-h-11 cursor-pointer content-center font-semibold">Something went wrong with the call?</summary>
          <div className="mt-3 grid gap-3">
            <p>
              A technical problem is never counted against you and never counts as a delivered session.{" "}
              {messagesHref ? <><Link className="font-semibold text-brand underline underline-offset-4" href={messagesHref}>Message {a.otherName}</Link> or </> : null}
              <Link className="font-semibold text-brand underline underline-offset-4" href={role === "customer" ? "/account/appointments" : "/coach/calendar"}>arrange another time</Link>.
            </p>
            {reportCallProblem}
          </div>
        </details>
      ) : null}

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-xl font-semibold">History</h2>
        <ol className="mt-2 space-y-1 text-sm">
          {a.events.map((e, i) => (
            <li key={i}>
              {whenIn(e.created_at, viewerTz)} — {ACTOR[e.actor_role] ?? e.actor_role}:{" "}
              {e.from_state === e.to_state && e.reason && NOTE_EVENT[e.reason] ? NOTE_EVENT[e.reason] : (
                <>
                  {e.from_state ? `${APPOINTMENT_STATE_LABEL[e.from_state as AppointmentState] ?? e.from_state} → ` : ""}
                  {APPOINTMENT_STATE_LABEL[e.to_state as AppointmentState] ?? e.to_state}
                  {e.reason ? ` (${e.reason.replaceAll("_", " ")})` : ""}
                </>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
