"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { proposeAction } from "@/lib/scheduling/actions";
import { zoneCity } from "@/lib/format";

/**
 * Free times from the coach's calendar, in the viewer's own zone, grouped by
 * their local day, with the coach's local time alongside. Choosing one sends a
 * request (or, inside checkout, becomes the held slot).
 */
export function SlotList({
  slots,
  viewerTz,
  coachTz,
  name = "starts_at",
  required = true,
}: {
  slots: string[];
  viewerTz: string;
  coachTz: string;
  name?: string;
  required?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const days = useMemo(() => {
    const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: viewerTz });
    const groups = new Map<string, string[]>();
    for (const s of slots) {
      const key = dayFmt.format(new Date(s));
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    return [...groups.entries()];
  }, [slots, viewerTz]);
  const mine = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: viewerTz });
  const theirs = new Intl.DateTimeFormat("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: coachTz });

  if (slots.length === 0) {
    return <p className="text-ink-muted">No free times in the coach&rsquo;s calendar right now. You can still suggest a time below.</p>;
  }
  const visible = showAll ? days : days.slice(0, 5);
  return (
    <fieldset className="grid gap-4">
      <legend className="font-semibold">Times shown in your time ({zoneCity(viewerTz)})</legend>
      {visible.map(([day, times]) => (
        <div key={day}>
          <p className="font-semibold">{day}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {times.map((s) => (
              <label key={s} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 has-[:checked]:border-brand has-[:checked]:bg-brand-tint">
                <input type="radio" name={name} value={s} required={required} className="size-4" />
                <span>{mine.format(new Date(s))}</span>
                {coachTz !== viewerTz ? <span className="text-xs text-ink-muted">({theirs.format(new Date(s))} coach)</span> : null}
              </label>
            ))}
          </div>
        </div>
      ))}
      {days.length > 5 ? (
        <button type="button" className="min-h-11 justify-self-start font-semibold text-brand underline underline-offset-4" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer days" : `Show all ${days.length} days`}
        </button>
      ) : null}
    </fieldset>
  );
}

/** A client requesting one of the free times. */
export function SlotRequestForm({
  slots,
  viewerTz,
  coachTz,
  duration,
  kind = "coaching",
  enrollmentId,
  purchaseId,
  replacesId,
}: {
  slots: string[];
  viewerTz: string;
  coachTz: string;
  duration: number;
  kind?: "coaching" | "consultation";
  enrollmentId?: string;
  purchaseId?: string;
  replacesId?: string;
}) {
  const requestKey = useMemo(() => crypto.randomUUID().replaceAll("-", "").slice(0, 32), []);
  return (
    <ActionForm action={proposeAction} className="grid gap-4" resetOnSuccess>
      <input type="hidden" name="request_key" value={requestKey} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="duration_minutes" value={duration} />
      {enrollmentId ? <input type="hidden" name="enrollment_id" value={enrollmentId} /> : null}
      {purchaseId ? <input type="hidden" name="purchase_id" value={purchaseId} /> : null}
      {replacesId ? <input type="hidden" name="replaces_appointment_id" value={replacesId} /> : null}
      <SlotList slots={slots} viewerTz={viewerTz} coachTz={coachTz} />
      {slots.length ? <div><SubmitButton pendingLabel="Sending…">Request this time</SubmitButton></div> : null}
    </ActionForm>
  );
}
