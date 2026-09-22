import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton, TextField } from "@/components/form/fields";
import { PageHeader, Panel } from "@/components/ui/panel";
import type { WorkingHours } from "@/lib/messaging/types";
import { saveAvailabilityAction } from "../actions";

export const metadata = { title: "Messaging hours" };

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_NUMBER = [1, 2, 3, 4, 5, 6, 0];

export default async function AvailabilityPage() {
  const session = await requireCoach("/coach/messages/availability");
  const supabase = (await createClient())!;
  const tz = session.provider.timezone ?? "UTC";
  const { data } = await supabase
    .from("coach_messaging_profiles")
    .select("working_hours, response_expectation, away_until, away_note")
    .eq("provider_id", session.provider.id)
    .maybeSingle();

  const hours = (data?.working_hours ?? []) as WorkingHours[];
  const awayUntil = data?.away_until && new Date(data.away_until) > new Date() ? new Date(data.away_until) : null;
  // The stored instant is the start of the day after; show the last away day.
  const awayDate = awayUntil
    ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(awayUntil.getTime() - 60_000))
    : "";

  return (
    <div>
      <PageHeader title="Messaging hours">
        When you usually reply, in your own words. Clients see this in their conversation with you. It&rsquo;s your statement, not a
        TalentYak deadline, and TalentYak never shows clients whether you are online.
      </PageHeader>
      <p className="mb-6">
        <Link href="/coach/messages" className="text-brand underline underline-offset-4">Back to messages</Link>
      </p>

      <ActionForm action={saveAvailabilityAction} className="grid gap-6" noticeFirst>
        <Panel title="Working hours" id="hours">
          <p className="mb-4 text-sm text-ink-muted">Times are in your timezone ({tz.replace("_", " ")}). Change it on your profile.</p>
          <fieldset className="grid gap-3">
            <legend className="sr-only">Days you work</legend>
            {DAYS.map((label, i) => {
              const day = DAY_NUMBER[i];
              const current = hours.find((h) => h.day === day);
              return (
                <div key={day} className="flex flex-wrap items-center gap-3">
                  <label className="flex min-w-32 items-center gap-2 font-medium">
                    <input type="checkbox" name={`day-${day}`} defaultChecked={Boolean(current)} className="size-5 accent-brand" />
                    {label}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="sr-only">{label} start</span>
                    <input type="time" name={`start-${day}`} defaultValue={current?.start ?? "09:00"} className="min-h-11 rounded-lg border border-line-strong bg-surface px-2" />
                  </label>
                  <span aria-hidden>to</span>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="sr-only">{label} end</span>
                    <input type="time" name={`end-${day}`} defaultValue={current?.end ?? "17:00"} className="min-h-11 rounded-lg border border-line-strong bg-surface px-2" />
                  </label>
                </div>
              );
            })}
          </fieldset>
        </Panel>

        <Panel title="How quickly you usually reply" id="response">
          <TextField
            name="response_expectation"
            label="In your words"
            required={false}
            maxLength={200}
            defaultValue={data?.response_expectation ?? ""}
            placeholder="e.g. I reply within a day on weekdays"
            help="Shown to clients exactly as you write it."
          />
        </Panel>

        <Panel title="Away" id="away">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="away_until" label="Away until (last day away)" type="date" required={false} defaultValue={awayDate} help="Leave empty when you're not away." />
            <TextField name="away_note" label="Note for clients" required={false} maxLength={200} defaultValue={data?.away_note ?? ""} placeholder="e.g. Travelling — back on Monday" />
          </div>
        </Panel>

        <div>
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
