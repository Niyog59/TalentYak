"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, SubmitButton, TextField } from "@/components/form/fields";
import { proposeAction } from "@/lib/scheduling/actions";
import { durationLabel } from "@/lib/scheduling/types";
import { zoneCity } from "@/lib/format";

/**
 * Suggest a time. The person types a date and a time and says which clock
 * they mean — theirs or the other person's — so "6pm" is never ambiguous
 * across Nepal and North America. A weekly suggestion is anchored to that
 * clock (the series' reference zone) and keeps that local time across clock
 * changes. Nothing is booked until the other person accepts.
 */
export function ProposeForm({
  kind = "coaching",
  enrollmentId,
  purchaseId,
  enrollmentOptions,
  durations,
  fixedDuration,
  viewerTz,
  otherTz,
  otherLabel,
  replacesId,
  isSeriesOccurrence = false,
  counterOf,
  allowWeekly = true,
  submitLabel = "Send suggestion",
}: {
  kind?: "coaching" | "consultation";
  enrollmentId?: string;
  purchaseId?: string;
  /** For a coach choosing which client to suggest a time to. */
  enrollmentOptions?: { value: string; label: string }[];
  durations: number[];
  fixedDuration?: number | null;
  viewerTz: string;
  otherTz?: string | null;
  otherLabel: string;
  replacesId?: string;
  isSeriesOccurrence?: boolean;
  counterOf?: string;
  allowWeekly?: boolean;
  submitLabel?: string;
}) {
  // One key per form instance: a double click or a retried request is one suggestion.
  const requestKey = useMemo(() => crypto.randomUUID().replaceAll("-", "").slice(0, 32), []);
  const [weekly, setWeekly] = useState(false);
  const zones = [{ value: viewerTz, label: `My time (${zoneCity(viewerTz)})` }];
  if (otherTz && otherTz !== viewerTz) zones.push({ value: otherTz, label: `${otherLabel}'s time (${zoneCity(otherTz)})` });

  return (
    <ActionForm action={proposeAction} className="grid gap-4" resetOnSuccess>
      <input type="hidden" name="request_key" value={requestKey} />
      <input type="hidden" name="kind" value={kind} />
      {enrollmentId ? <input type="hidden" name="enrollment_id" value={enrollmentId} /> : null}
      {purchaseId ? <input type="hidden" name="purchase_id" value={purchaseId} /> : null}
      {replacesId ? <input type="hidden" name="replaces_appointment_id" value={replacesId} /> : null}
      {counterOf ? <input type="hidden" name="counter_of" value={counterOf} /> : null}
      {enrollmentOptions ? <SelectField name="enrollment_id" label="Client" required options={enrollmentOptions} /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField name="date" label="Date" type="date" required />
        <TextField name="time" label="Time" type="time" required step={300} />
        <SelectField name="timezone" label="In whose time" required options={zones} defaultValue={viewerTz} />
      </div>

      {fixedDuration ? (
        <>
          <input type="hidden" name="duration_minutes" value={fixedDuration} />
          <p className="text-sm">Length: {durationLabel(fixedDuration)}</p>
        </>
      ) : (
        <SelectField
          name="duration_minutes"
          label="Length"
          required
          options={durations.map((d) => ({ value: String(d), label: durationLabel(d) }))}
          defaultValue={String(durations.includes(60) ? 60 : durations[0])}
        />
      )}

      {isSeriesOccurrence ? (
        <fieldset className="grid gap-2">
          <legend className="font-semibold">Which sessions</legend>
          <label className="flex min-h-11 items-center gap-3"><input type="radio" name="series_scope" value="this" defaultChecked className="size-5" /> Only this one</label>
          <label className="flex min-h-11 items-center gap-3"><input type="radio" name="series_scope" value="future" className="size-5" /> This one and all later ones in the series</label>
        </fieldset>
      ) : null}

      {allowWeekly && !replacesId && !counterOf && kind === "coaching" ? (
        <div className="grid gap-3">
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" name="recurrence" value="weekly" className="size-5" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
            <span>Repeat every week at this time</span>
          </label>
          {weekly ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <p className="text-sm sm:col-span-2">
                It repeats at this local time in the zone chosen under &ldquo;In whose time&rdquo;. When clocks change there, it stays at the
                same local time; travelling or changing a display setting doesn&rsquo;t move it.
              </p>
              <TextField name="repeat_until" label="Until" type="date" required={false} help="Leave empty to keep going." />
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="text-sm text-ink-muted">Nothing is booked until {otherLabel} accepts.</p>
      <div><SubmitButton pendingLabel="Sending…">{submitLabel}</SubmitButton></div>
    </ActionForm>
  );
}
