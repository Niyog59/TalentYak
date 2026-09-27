import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SelectField, SubmitButton, TextField } from "@/components/form/fields";
import { Notice, PageHeader, Panel } from "@/components/ui/panel";
import { AppointmentList, ProposalList } from "@/components/scheduling/schedule-lists";
import { ProposeForm } from "@/components/scheduling/propose-form";
import { coachScheduleSettings, loadSchedule } from "@/lib/scheduling/server";
import { DURATION_CHOICES, WEEKDAY_LABEL, durationLabel, whenIn } from "@/lib/scheduling/types";
import {
  addExceptionAction,
  addWindowAction,
  removeExceptionAction,
  removeWindowAction,
  saveScheduleSettingsAction,
} from "./actions";

export const metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

export default async function CoachCalendarPage() {
  const session = await requireCoach("/coach/calendar");
  const { provider } = session;
  const tz = provider.timezone ?? "UTC";
  const supabase = (await createClient())!;
  // Per-request server component (force-dynamic): renders once, so the
  // instability the purity rule guards against cannot occur.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  const [schedule, settings, { data: windows }, { data: exceptions }, { data: conflicts }, { data: clients }] = await Promise.all([
    loadSchedule("coach", { userId: session.userId, providerId: provider.id }),
    coachScheduleSettings(provider.id),
    supabase.from("availability_windows").select("id, weekday, start_time, end_time").eq("provider_id", provider.id).order("weekday").order("start_time"),
    supabase.from("availability_exceptions").select("id, kind, starts_on, ends_on, start_time, end_time, note").eq("provider_id", provider.id)
      .gte("ends_on", new Date(now - 86_400_000).toISOString().slice(0, 10)).order("starts_on"),
    supabase.rpc("my_schedule_conflicts"),
    supabase.rpc("my_clients"),
  ]);

  const incoming = schedule.proposals.filter((p) => p.state === "pending" && p.proposed_by !== session.userId);
  const mine = schedule.proposals.filter((p) => p.proposed_by === session.userId);
  const held = schedule.upcoming.filter((a) => a.state === "on_hold" && a.state_reason === "conflict");
  const clash = (conflicts ?? []) as { appointment_id: string; starts_at: string; client_name: string }[];
  const clientOptions = ((clients ?? []) as { enrollment_id: string; client_name: string; offer_title: string }[])
    .map((c) => ({ value: c.enrollment_id, label: `${c.client_name} — ${c.offer_title}` }));
  const durationsFor = (p: { kind: string; duration_minutes: number }) => ({ durations: settings.durations_minutes, fixed: p.kind === "consultation" ? p.duration_minutes : null });

  return (
    <div>
      <PageHeader title="Calendar">
        Your hours, your sessions, and the times clients have suggested. Everything here is in your time zone, {tz}; clients see times in theirs.
      </PageHeader>

      {!provider.timezone ? (
        <Notice tone="bad">Set your time zone on your <Link href="/coach/profile" className="underline">profile</Link> before clients can book with you.</Notice>
      ) : null}
      {(windows ?? []).length === 0 ? (
        <Notice>You haven&rsquo;t set any hours yet, so clients can&rsquo;t pick a time. You can still suggest times to them.</Notice>
      ) : null}

      <Panel title="Waiting for your answer" id="answer">
        <ProposalList proposals={incoming} viewerId={session.userId} viewerTz={tz} durationsFor={durationsFor} empty="Nothing to answer." />
      </Panel>

      <Panel title="Clashes" id="clashes" description="Booked sessions that no longer fit your hours, or that clash with something else. They stay as they are until you move or cancel them.">
        {clash.length === 0 && held.length === 0 ? (
          <p className="text-ink-muted">No clashes.</p>
        ) : (
          <ul className="grid gap-2">
            {clash.map((c) => (
              <li key={c.appointment_id}>
                <Link href={`/coach/calendar/appointments/${c.appointment_id}`} className="font-semibold text-brand underline underline-offset-4">
                  {c.client_name}, {whenIn(c.starts_at, tz)}
                </Link>{" "}
                — outside your current hours
              </li>
            ))}
            {held.map((a) => (
              <li key={a.id}>
                <Link href={`/coach/calendar/appointments/${a.id}`} className="font-semibold text-brand underline underline-offset-4">
                  {a.otherName}, {whenIn(a.starts_at, tz)}
                </Link>{" "}
                — on hold: something else is booked then
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Upcoming" id="upcoming">
        <AppointmentList appointments={schedule.upcoming} viewerTz={tz} hrefFor={(a) => `/coach/calendar/appointments/${a.id}`} empty="No sessions booked." />
      </Panel>

      <Panel title="Suggest a time to a client" id="suggest" description="They accept, decline or suggest another time. Nothing is booked until they accept.">
        {clientOptions.length === 0 ? (
          <p className="text-ink-muted">When you have clients, you can suggest times to them here or in your messages.</p>
        ) : (
          <ProposeForm enrollmentOptions={clientOptions} durations={settings.durations_minutes} viewerTz={tz} otherLabel="your client" />
        )}
      </Panel>

      <Panel title="Your weekly hours" id="hours" description="When clients may pick a time. Several windows a day are fine.">
        {(windows ?? []).length ? (
          <ul className="grid gap-2">
            {(windows ?? []).map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span>{WEEKDAY_LABEL[w.weekday]} {w.start_time.slice(0, 5)}–{w.end_time.slice(0, 5)}</span>
                <ActionForm action={removeWindowAction}>
                  <input type="hidden" name="id" value={w.id} />
                  <SubmitButton variant="quiet" pendingLabel="Removing…">Remove</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : null}
        <ActionForm action={addWindowAction} className="mt-4 grid gap-4" resetOnSuccess>
          <fieldset>
            <legend className="font-semibold">Days</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {WEEKDAY_LABEL.map((d, i) => (
                <label key={d} className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3">
                  <input type="checkbox" name="weekday" value={i} className="size-5" /> {d.slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2 sm:max-w-md">
            <TextField name="start_time" label="From" type="time" required />
            <TextField name="end_time" label="To" type="time" required />
          </div>
          <div><SubmitButton pendingLabel="Adding…">Add hours</SubmitButton></div>
        </ActionForm>
      </Panel>

      <Panel title="Days off and extra hours" id="exceptions" description="Time off wins over your weekly hours. Extra hours add to them for those dates.">
        {(exceptions ?? []).length ? (
          <ul className="grid gap-2">
            {(exceptions ?? []).map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span>
                  {x.kind === "extra" ? "Extra hours" : "Time off"}: {x.starts_on}{x.ends_on !== x.starts_on ? ` to ${x.ends_on}` : ""}
                  {x.start_time ? `, ${x.start_time.slice(0, 5)}–${x.end_time?.slice(0, 5)}` : ", all day"}
                  {x.note ? ` — ${x.note}` : ""}
                </span>
                <ActionForm action={removeExceptionAction}>
                  <input type="hidden" name="id" value={x.id} />
                  <SubmitButton variant="quiet" pendingLabel="Removing…">Remove</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        ) : null}
        <ActionForm action={addExceptionAction} className="mt-4 grid gap-4" resetOnSuccess>
          <SelectField name="kind" label="Type" required options={[{ value: "unavailable", label: "Time off" }, { value: "extra", label: "Extra hours" }]} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="starts_on" label="From date" type="date" required />
            <TextField name="ends_on" label="To date" type="date" required={false} help="Leave empty for one day." />
            <TextField name="start_time" label="From time" type="time" required={false} help="Leave both times empty for whole days off." />
            <TextField name="end_time" label="To time" type="time" required={false} />
          </div>
          <TextField name="note" label="Note (only you see it)" required={false} maxLength={200} />
          <div><SubmitButton pendingLabel="Adding…">Add</SubmitButton></div>
        </ActionForm>
      </Panel>

      <Panel title="How clients book you" id="settings" description="Starting values you can change. None of them is a TalentYak rule.">
        <ActionForm action={saveScheduleSettingsAction} className="grid gap-4">
          <fieldset>
            <legend className="font-semibold">Session lengths you offer</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DURATION_CHOICES.map((d) => (
                <label key={d} className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3">
                  <input type="checkbox" name="durations" value={d} defaultChecked={settings.durations_minutes.includes(d)} className="size-5" /> {durationLabel(d)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="buffer_before_minutes" label="Gap before a session (minutes)" type="number" inputMode="numeric" min={0} max={120} defaultValue={settings.buffer_before_minutes} required={false} />
            <TextField name="buffer_after_minutes" label="Gap after a session (minutes)" type="number" inputMode="numeric" min={0} max={120} defaultValue={settings.buffer_after_minutes} required={false} />
            <TextField name="min_notice_hours" label="Minimum notice (hours)" type="number" inputMode="numeric" min={0} max={168} defaultValue={Math.round(settings.min_notice_minutes / 60)} required={false} />
            <TextField name="horizon_days" label="How far ahead clients can book (days)" type="number" inputMode="numeric" min={1} max={180} defaultValue={settings.horizon_days} required={false} />
            <TextField name="daily_limit" label="Most sessions in a day" type="number" inputMode="numeric" min={1} max={24} defaultValue={settings.daily_limit ?? ""} required={false} help="Leave empty for no limit." />
          </div>
          <CheckboxField
            name="auto_confirm"
            defaultChecked={settings.auto_confirm_client_requests}
            label="Confirm client requests straight away when they fit my hours"
            help="Off: you confirm each request yourself. You can change this any time."
          />
          <div><SubmitButton pendingLabel="Saving…">Save</SubmitButton></div>
        </ActionForm>
      </Panel>

      <Panel title="Your suggestions" id="mine">
        <ProposalList proposals={mine} viewerId={session.userId} viewerTz={tz} durationsFor={durationsFor} empty="None." />
      </Panel>

      <Panel title="Past" id="past">
        <AppointmentList appointments={schedule.past} viewerTz={tz} hrefFor={(a) => `/coach/calendar/appointments/${a.id}`} empty="No past sessions." />
      </Panel>
    </div>
  );
}
