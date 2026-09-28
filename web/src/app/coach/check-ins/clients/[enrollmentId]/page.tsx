import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, SubmitButton, TextField } from "@/components/form/fields";
import { Notice, PageHeader, Panel, StatusPill } from "@/components/ui/panel";
import { formatDate } from "@/lib/format";
import { addCheckinBreakAction, cancelCheckinBreakAction, pauseCheckinsAction, saveCheckinScheduleAction } from "@/lib/checkins/actions";
import { checkinsFor, myCheckinTemplates, refreshCheckins, scheduleFor } from "@/lib/checkins/server";
import { cadenceLabel, DAY_NAMES_ISO, periodLabel } from "@/lib/checkins/status";
import { localDate } from "@/lib/programmes/content";
import { coachingIsLive, myClient } from "@/lib/programmes/server";
import { clientBasics } from "@/lib/tracking/server";

export const metadata = { title: "Client check-ins" };
export const dynamic = "force-dynamic";

const STATUS_WORDS: Record<string, string> = {
  open: "Waiting for the client",
  submitted: "Awaiting review",
  reviewed: "Reviewed",
  reopened: "Reopened",
  missed: "Not sent",
  cancelled: "Closed",
};

function zones(extra: string[]): { value: string; label: string }[] {
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf("timeZone");
  } catch {
    all = ["UTC", "Asia/Kathmandu"];
  }
  const set = [...new Set([...extra.filter(Boolean), ...all])];
  return set.map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
}

export default async function CoachClientCheckinsPage({ params }: { params: Promise<{ enrollmentId: string }> }) {
  const { enrollmentId } = await params;
  const session = await requireCoach(`/coach/check-ins/clients/${enrollmentId}`);
  const client = await myClient(enrollmentId);
  if (!client) notFound();
  await refreshCheckins(enrollmentId);
  const [live, basics, schedule, templates, items] = await Promise.all([
    coachingIsLive(enrollmentId),
    clientBasics(enrollmentId),
    scheduleFor(enrollmentId),
    myCheckinTemplates(),
    checkinsFor(enrollmentId),
  ]);
  const mine = schedule && schedule.provider_id === session.provider.id ? schedule : null;
  const cur = mine?.current ?? null;
  const clientTz = basics?.timezone ?? null;
  const active = templates.filter((t) => !t.archived_at);
  const today = localDate(new Date(), cur?.timezone ?? clientTz);
  const breaks = (mine?.breaks ?? []).filter((b) => !b.cancelled_at && b.ends_on >= today);

  return (
    <div className="mx-auto max-w-3xl">
      <p><Link href="/coach/check-ins" className="text-brand underline underline-offset-4">← Check-ins</Link></p>
      <PageHeader title={`${client.client_name}'s check-ins`}>{client.offer_title}</PageHeader>
      {!live ? (
        <Notice tone="bad">Coaching with {client.client_name} is paused, so check-in settings are read-only and no new check-ins are asked for. Reviews of check-ins sent while coaching was paid can still be finished.</Notice>
      ) : null}

      <Panel title="Schedule" id="schedule" description={cur ? `${cadenceLabel(cur.interval_weeks, cur.due_weekday, cur.due_time)}, ${cur.timezone.replace(/_/g, " ")} time. Version ${cur.version}${mine?.paused_at ? " · paused" : ""}.` : "Not set up yet."}>
        {active.length === 0 ? (
          <p className="text-ink-muted">Create a template first — <Link href="/coach/check-ins#templates" className="text-brand underline underline-offset-4">the weekly starter</Link> takes one tap.</p>
        ) : live ? (
          <ActionForm action={saveCheckinScheduleAction} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="enrollment_id" value={enrollmentId} />
            <SelectField name="template_id" label="Questions" required defaultValue={cur?.template_id ?? active[0].id} options={active.map((t) => ({ value: t.id, label: t.title }))} />
            <SelectField name="interval_weeks" label="How often" required defaultValue={String(cur?.interval_weeks ?? 1)} options={[{ value: "1", label: "Every week" }, { value: "2", label: "Every two weeks" }, { value: "4", label: "Every four weeks" }]} />
            <SelectField name="due_weekday" label="Due day" required defaultValue={String(cur?.due_weekday ?? 7)} options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: DAY_NAMES_ISO[d] }))} />
            <TextField name="due_time" label="Due time (client's time)" type="time" required defaultValue={cur?.due_time?.slice(0, 5) ?? "18:00"} />
            <SelectField
              name="timezone"
              label="Client's timezone"
              required
              className="sm:col-span-2"
              defaultValue={cur?.timezone ?? clientTz ?? "Asia/Kathmandu"}
              help={clientTz ? `${client.client_name}'s account says ${clientTz.replace(/_/g, " ")}. Due times and periods follow this zone.` : "Choose where your client lives. Due times and periods follow this zone."}
              options={zones([cur?.timezone ?? "", clientTz ?? ""])}
            />
            <SelectField
              name="response_days"
              label="Your reply time"
              className="sm:col-span-2"
              defaultValue={cur?.response_days ? String(cur.response_days) : ""}
              help="Counted in the working days you publish in your messaging availability, from when the check-in arrives. Shown to your client. Leave blank to promise no time — TalentYak never sets one for you."
              options={[{ value: "", label: "No set reply time" }, ...[1, 2, 3, 4, 5, 7, 10, 14].map((n) => ({ value: String(n), label: `Within ${n} working day${n === 1 ? "" : "s"}` }))]}
            />
            <div className="sm:col-span-2">
              <SubmitButton pendingLabel="Saving…">{cur ? "Save changes from now on" : "Start check-ins"}</SubmitButton>
              <p className="mt-2 text-sm text-ink-muted">Changes apply forward. A check-in already open keeps its questions and due time; nothing is asked for past weeks.</p>
            </div>
          </ActionForm>
        ) : null}
        <p className="mt-4 text-sm"><Link href="/coach/messages/availability" className="text-brand underline underline-offset-4">Your working days and away dates</Link> decide when your reply time falls.</p>
      </Panel>

      {mine && live ? (
        <Panel title={mine.paused_at ? "Paused" : "Pause check-ins"} id="pause" description={mine.paused_at ? `Paused ${formatDate(mine.paused_at, session.provider.timezone)}${mine.pause_note ? ` — “${mine.pause_note}”` : ""}.` : "Stops new check-ins without a backlog. Coaching itself carries on."}>
          <ActionForm action={pauseCheckinsAction} className="grid gap-3">
            <input type="hidden" name="enrollment_id" value={enrollmentId} />
            {mine.paused_at ? (
              <input type="hidden" name="resume" value="1" />
            ) : (
              <TextField name="note" label="Note" maxLength={300} />
            )}
            <div><SubmitButton variant="secondary" pendingLabel="Working…">{mine.paused_at ? "Resume from the current period" : "Pause check-ins"}</SubmitButton></div>
          </ActionForm>
        </Panel>
      ) : null}

      {mine ? (
        <Panel title="Planned breaks" id="breaks" description="No check-in is asked for while a break lasts. Your client can add breaks too.">
          {breaks.length ? (
            <ul className="mb-4 space-y-2">
              {breaks.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
                  <span>{periodLabel(b.starts_on, b.ends_on)}{b.note ? ` · ${b.note}` : ""}</span>
                  {live ? (
                    <ActionForm action={cancelCheckinBreakAction}>
                      <input type="hidden" name="break_id" value={b.id} />
                      <input type="hidden" name="enrollment_id" value={enrollmentId} />
                      <SubmitButton variant="secondary" pendingLabel="Cancelling…">Cancel</SubmitButton>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="mb-4 text-ink-muted">None planned.</p>}
          {live ? (
            <ActionForm action={addCheckinBreakAction} className="grid gap-4 sm:grid-cols-2" resetOnSuccess>
              <input type="hidden" name="enrollment_id" value={enrollmentId} />
              <TextField name="starts_on" label="First day" type="date" required />
              <TextField name="ends_on" label="Last day" type="date" required />
              <TextField name="note" label="Note" className="sm:col-span-2" maxLength={200} />
              <div className="sm:col-span-2"><SubmitButton variant="secondary" pendingLabel="Adding…">Add a break</SubmitButton></div>
            </ActionForm>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="History" id="history">
        {items.length === 0 ? (
          <p className="text-ink-muted">No check-ins yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((c) => (
              <li key={c.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2">
                {c.status === "submitted" || c.status === "reviewed" || c.status === "reopened" ? (
                  <Link href={`/coach/check-ins/${c.id}`} className="font-semibold text-brand underline underline-offset-4">{periodLabel(c.period_start, c.period_end)}</Link>
                ) : (
                  <span className="font-semibold">{periodLabel(c.period_start, c.period_end)}</span>
                )}
                <StatusPill>{STATUS_WORDS[c.status] ?? c.status}</StatusPill>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
