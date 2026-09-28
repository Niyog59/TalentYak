"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/button";
import { formatDay } from "@/lib/format";
import { readItem, removeItem, send, writeItem, type StoredOp } from "@/lib/tracking/device";
import { convertLength, convertWeight, parseAmount, trimNumber, type LengthUnit, type WeightUnit } from "@/lib/tracking/units";
import { heldMessage } from "@/components/tracking/save-badge";

/*
 * One date's weight and measurements. Every reading is optional. The entry is
 * kept on this device before it is sent, so a dropped connection or a pause
 * loses nothing; if the same date was changed on another device meanwhile,
 * the client chooses which to keep.
 */

export interface BodyDayView {
  date: string;
  token: string;
  weight: { value: number; unit: WeightUnit; kg: number } | null;
  cm: { waist: number | null; hips: number | null; chest: number | null; arm: number | null } | null;
}

const FIELDS = [
  ["waist", "Waist"],
  ["hips", "Hips"],
  ["chest", "Chest"],
  ["arm", "Arm"],
] as const;
type Field = (typeof FIELDS)[number][0];

type Values = { weight: string } & Record<Field, string>;

const input = "tabular mt-1 block min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3 text-lg";

export function BodyEntry({
  viewerId,
  enrollmentId,
  today,
  days,
  weightUnit: prefWeight,
  lengthUnit: prefLength,
  live,
  held,
  pausedNotice,
  showMeasurements,
}: {
  viewerId: string;
  enrollmentId: string;
  today: string;
  days: BodyDayView[];
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  live: boolean;
  held: "paused" | "ended" | "suspended" | "unavailable" | null;
  pausedNotice: string;
  showMeasurements: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [wUnit, setWUnit] = useState<WeightUnit>(prefWeight);
  const [lUnit, setLUnit] = useState<LengthUnit>(prefLength);
  const [values, setValues] = useState<Values>({ weight: "", waist: "", hips: "", chest: "", arm: "" });
  const [status, setStatus] = useState<{ tone: "ok" | "info" | "bad"; text: string } | null>(null);
  const [conflict, setConflict] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(showMeasurements);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const existing = byDate.get(date) ?? null;
  const opId = `body:${enrollmentId}:${date}`;

  // Show what is saved (or still waiting on this device) for the chosen date.
  // Device storage is read after render, in a timer, never during it.
  function fill() {
    const waiting = readItem<StoredOp>(viewerId, "op", opId);
    if (waiting) {
      const b = waiting.body;
      setWUnit((b.weightUnit as WeightUnit) ?? prefWeight);
      setLUnit((b.lengthUnit as LengthUnit) ?? prefLength);
      setValues({ weight: String(b.weight ?? ""), waist: String(b.waist ?? ""), hips: String(b.hips ?? ""), chest: String(b.chest ?? ""), arm: String(b.arm ?? "") });
      setStatus({ tone: "info", text: "These values are waiting on this device and haven't been saved yet." });
      return;
    }
    const d = byDate.get(date);
    const w = d?.weight ? (d.weight.unit === wUnit ? d.weight.value : convertWeight(d.weight.kg, "kg", wUnit)) : null;
    const len = (cm: number | null | undefined) => (cm === null || cm === undefined ? "" : trimNumber(convertLength(cm, "cm", lUnit), 1));
    setValues({
      weight: w === null ? "" : trimNumber(w, 2),
      waist: len(d?.cm?.waist),
      hips: len(d?.cm?.hips),
      chest: len(d?.cm?.chest),
      arm: len(d?.cm?.arm),
    });
    setConflict(null);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => fill(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, byDate]);

  function changeUnit<T extends WeightUnit | LengthUnit>(kind: "weight" | "length", to: T) {
    // Convert what's typed, so switching unit never changes the reading.
    if (kind === "weight") {
      const n = parseAmount(values.weight);
      setValues((v) => ({ ...v, weight: n === null ? v.weight : trimNumber(convertWeight(n, wUnit, to as WeightUnit), 1) }));
      setWUnit(to as WeightUnit);
    } else {
      setValues((v) => {
        const next = { ...v };
        for (const [f] of FIELDS) {
          const n = parseAmount(v[f]);
          if (n !== null) next[f] = trimNumber(convertLength(n, lUnit, to as LengthUnit), 1);
        }
        return next;
      });
      setLUnit(to as LengthUnit);
    }
  }

  async function submit(opts: { force?: boolean; clear?: boolean } = {}) {
    const v = opts.clear ? { weight: "", waist: "", hips: "", chest: "", arm: "" } : values;
    for (const [k, s] of Object.entries(v)) {
      if (s.trim() && parseAmount(s) === null) {
        setStatus({ tone: "bad", text: `${k === "weight" ? "Weight" : FIELDS.find((f) => f[0] === k)![1]}: enter a number, like 72.5.` });
        return;
      }
    }
    if (!opts.clear && !Object.values(v).some((s) => s.trim())) {
      setStatus({ tone: "bad", text: "Enter at least one reading." });
      return;
    }
    const body: Record<string, unknown> = {
      op: "body.save",
      enrollmentId,
      date,
      weight: v.weight.trim() || null,
      weightUnit: wUnit,
      waist: v.waist.trim() || null,
      hips: v.hips.trim() || null,
      chest: v.chest.trim() || null,
      arm: v.arm.trim() || null,
      lengthUnit: lUnit,
      base: existing?.token ?? "",
      ...(opts.force ? { force: true } : {}),
    };
    const label = `Body readings — ${formatDay(date, { weekday: "short", month: "short", day: "numeric" })}`;
    const op: StoredOp = { v: 1, kind: "op", id: opId, body, href: `/account/progress/${enrollmentId}/body`, label, state: "pending", updatedAt: Date.now() };
    writeItem(viewerId, op);
    setBusy(true);
    setStatus({ tone: "info", text: "Saving…" });
    const r = await send(body);
    setBusy(false);
    if (r.status === "saved") {
      removeItem(viewerId, "op", opId);
      setConflict(null);
      setStatus({ tone: "ok", text: opts.clear ? "Removed for that date." : "Saved." });
      window.dispatchEvent(new Event("talentyak:tracking-changed"));
      router.refresh();
    } else if (r.status === "offline") {
      writeItem(viewerId, { ...op, state: "offline" });
      setStatus({ tone: "info", text: "No connection. Kept on this device — it will save when you're back online." });
    } else if (r.status === "held") {
      writeItem(viewerId, { ...op, state: "held" });
      setStatus({ tone: "bad", text: r.reason === "paused" ? `${pausedNotice} Kept on this device until coaching resumes.` : heldMessage(r.reason) });
    } else if (r.status === "conflict") {
      writeItem(viewerId, { ...op, state: "conflict" });
      setConflict(body);
      setStatus(null);
    } else {
      writeItem(viewerId, { ...op, state: "failed", message: r.message });
      setStatus({ tone: "bad", text: r.message });
    }
    window.dispatchEvent(new Event("talentyak:tracking-changed"));
  }

  const locked = !live && held !== "paused";

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block font-semibold">Date</span>
          <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="mt-1 min-h-12 rounded-lg border border-line-strong bg-surface px-3" />
        </label>
        {existing ? <p className="pb-3 text-sm text-ink-muted">You have readings saved for this date — change them below.</p> : null}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block font-semibold" htmlFor="body-weight">Body weight <span className="font-normal text-ink-muted">(optional)</span></label>
          <div className="flex gap-2">
            <input id="body-weight" inputMode="decimal" autoComplete="off" value={values.weight} disabled={locked} onChange={(e) => setValues({ ...values, weight: e.target.value.slice(0, 8) })} className={input} />
            <UnitToggle label="Weight unit" value={wUnit} options={["kg", "lb"]} onChange={(u) => changeUnit("weight", u as WeightUnit)} />
          </div>
        </div>
      </div>

      {more ? (
        <fieldset className="mt-5">
          <legend className="font-semibold">Measurements <span className="font-normal text-ink-muted">(all optional)</span></legend>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span>Unit</span>
            <UnitToggle label="Measurement unit" value={lUnit} options={["cm", "in"]} onChange={(u) => changeUnit("length", u as LengthUnit)} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {FIELDS.map(([f, label]) => (
              <label key={f} className="block">
                <span className="block text-sm font-semibold">{label} ({lUnit})</span>
                <input inputMode="decimal" autoComplete="off" value={values[f]} disabled={locked} onChange={(e) => setValues({ ...values, [f]: e.target.value.slice(0, 8) })} className={input} />
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <Button variant="quiet" size="sm" className="mt-3" onClick={() => setMore(true)}>Add measurements too</Button>
      )}

      {conflict ? (
        <div role="alert" className="mt-4 rounded-lg border border-danger bg-danger-tint p-4">
          <p className="font-semibold">These readings for {formatDay(date)} were changed on another device since this page loaded.</p>
          <p className="mt-1">Nothing has been overwritten. Choose which to keep:</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void submit({ force: true })}>Keep what I entered here</Button>
            <Button size="sm" variant="secondary" onClick={() => { removeItem(viewerId, "op", opId); setConflict(null); window.location.reload(); }}>Use the saved readings</Button>
          </div>
        </div>
      ) : null}

      {status ? (
        <p role={status.tone === "bad" ? "alert" : "status"} className={`mt-4 font-medium ${status.tone === "bad" ? "text-danger" : status.tone === "ok" ? "text-brand" : "text-ink-muted"}`}>
          {status.text}
        </p>
      ) : null}

      {!locked ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void submit()}>{busy ? "Saving…" : "Save"}</Button>
          {existing ? (
            <Button variant="quiet" disabled={busy} onClick={() => { if (window.confirm(`Remove all readings for ${formatDay(date)}?`)) void submit({ clear: true }); }}>
              Remove this date&rsquo;s readings
            </Button>
          ) : null}
        </div>
      ) : null}

      {days.length ? (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full text-left">
            <caption className="mb-2 text-left font-semibold">Recent readings</caption>
            <thead className="border-b border-line text-sm text-ink-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-semibold">Date</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Weight</th>
                {FIELDS.map(([f, l]) => <th key={f} scope="col" className="py-2 pr-3 font-semibold">{l}</th>)}
                <th scope="col" className="py-2"><span className="sr-only">Change</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {days.slice(0, 40).map((d) => (
                <tr key={d.date}>
                  <td className="py-2 pr-3">{formatDay(d.date, { month: "short", day: "numeric", year: "numeric" })}</td>
                  <td className="tabular py-2 pr-3">{d.weight ? `${trimNumber(d.weight.unit === prefWeight ? d.weight.value : convertWeight(d.weight.kg, "kg", prefWeight), 1)} ${prefWeight}` : "—"}</td>
                  {FIELDS.map(([f]) => (
                    <td key={f} className="tabular py-2 pr-3">{d.cm?.[f] != null ? `${trimNumber(convertLength(d.cm[f]!, "cm", prefLength), 1)} ${prefLength}` : "—"}</td>
                  ))}
                  <td className="py-2">
                    {!locked ? (
                      <Button size="sm" variant="quiet" onClick={() => { setDate(d.date); setMore(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                        Edit<span className="sr-only"> {d.date}</span>
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm text-ink-muted">A dash means nothing was recorded — not zero.</p>
        </div>
      ) : null}
    </div>
  );
}

function UnitToggle({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div role="group" aria-label={label} className="mt-1 flex shrink-0 overflow-hidden rounded-lg border border-line-strong">
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => value !== o && onChange(o)} className={`min-h-12 min-w-12 px-3 font-semibold ${value === o ? "bg-brand text-white" : "bg-surface"}`}>
          {o}
        </button>
      ))}
    </div>
  );
}
