"use client";

import { useState } from "react";
import {
  DAY_NAMES,
  LIMITS,
  prescription,
  type Alternative,
  type Exercise,
  type ExerciseCore,
  type Session,
  type Target,
  type WorkoutContent,
} from "@/lib/programmes/content";
import { AddButton, Choice, ItemTools, LongText, NumberInput, TextInput, move, newKey } from "@/components/programmes/editor-fields";

/*
 * The coach's workout editor. It keeps the whole plan in state and writes it
 * into one hidden `content` field; the server action validates every value
 * again and the database checks the shape a third time. Keys are created here
 * for new items and never changed for existing ones — they are how M12 tells
 * "the same exercise" across versions.
 */

function blankCore(): ExerciseCore {
  return { key: newKey(), name: "", sets: 3, target: { type: "reps", min: 8, max: 12 }, restSeconds: 90, load: null, loadNote: "", effort: "", notes: "", demoUrl: "" };
}

function blankExercise(): Exercise {
  return { ...blankCore(), progression: "", alternatives: [] };
}

function blankSession(day: number | null, n: number): Session {
  return { key: newKey(), title: `Session ${n}`, day, minutes: 45, notes: "", exercises: [] };
}

function CoreFields({ e, onChange, label }: { e: ExerciseCore; onChange: (e: ExerciseCore) => void; label: string }) {
  const set = <K extends keyof ExerciseCore>(k: K, v: ExerciseCore[K]) => onChange({ ...e, [k]: v });
  const t = e.target;
  const setTarget = (next: Target) => set("target", next);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextInput label={`${label} name`} value={e.name} onChange={(v) => set("name", v)} maxLength={LIMITS.exerciseName} required className="sm:col-span-2" />
      <NumberInput label="Sets" value={e.sets} onChange={(v) => set("sets", v)} min={1} max={20} />
      <Choice
        label="Each set is"
        value={t.type}
        onChange={(v) => setTarget(v === "reps" ? { type: "reps", min: 8, max: 12 } : v === "duration" ? { type: "duration", seconds: 30 } : { type: "none" })}
        options={[
          { value: "reps", label: "A number of reps" },
          { value: "duration", label: "A length of time" },
          { value: "none", label: "Described in the notes" },
        ]}
      />
      {t.type === "reps" ? (
        <>
          <NumberInput label="Reps, from" value={t.min} onChange={(v) => setTarget({ type: "reps", min: v ?? 1, max: t.max })} min={1} max={100} />
          <NumberInput label="Reps, up to" value={t.max} onChange={(v) => setTarget({ type: "reps", min: t.min, max: v })} min={1} max={100} />
        </>
      ) : null}
      {t.type === "duration" ? (
        <NumberInput label="Time per set" suffix="seconds" value={t.seconds} onChange={(v) => setTarget({ type: "duration", seconds: v ?? 30 })} min={5} max={3600} />
      ) : null}
      <NumberInput label="Rest between sets" suffix="seconds" value={e.restSeconds} onChange={(v) => set("restSeconds", v)} min={0} max={900} step={5} />
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <NumberInput label="Target weight" suffix="optional" value={e.load?.amount ?? null} onChange={(v) => set("load", v === null ? null : { amount: v, unit: e.load?.unit ?? "kg" })} min={0.25} max={1000} step={0.25} />
        <Choice label="Unit" value={e.load?.unit ?? "kg"} onChange={(u) => set("load", e.load ? { ...e.load, unit: u } : null)} options={[{ value: "kg", label: "kg" }, { value: "lb", label: "lb" }]} />
      </div>
      <TextInput label="Weight guidance" value={e.loadNote} onChange={(v) => set("loadNote", v)} maxLength={LIMITS.shortText} placeholder="e.g. bodyweight, or a weight you can lift 12 times" />
      <TextInput label="Effort" value={e.effort} onChange={(v) => set("effort", v)} maxLength={LIMITS.shortText} placeholder="e.g. RPE 7, or 2 reps left in the tank" />
      <LongText label="Instructions and notes" value={e.notes} onChange={(v) => set("notes", v)} maxLength={LIMITS.notes} className="sm:col-span-2" />
      <TextInput label="Demonstration link" type="url" value={e.demoUrl} onChange={(v) => set("demoUrl", v)} maxLength={LIMITS.url} placeholder="https://" className="sm:col-span-2" help="A video or page showing the movement. Opens in a new tab for your client." />
    </div>
  );
}

function ExerciseEditor({
  e,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  open,
  onToggle,
}: {
  e: Exercise;
  index: number;
  count: number;
  onChange: (e: Exercise) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  const name = e.name || `exercise ${index + 1}`;
  const setAlt = (i: number, a: Alternative) => onChange({ ...e, alternatives: e.alternatives.map((x, j) => (j === i ? a : x)) });
  return (
    <li className="rounded-xl border border-line bg-surface">
      <details open={open} onToggle={(ev) => onToggle((ev.currentTarget as HTMLDetailsElement).open)}>
        <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 py-2 font-semibold">
          <span className="min-w-0 flex-1">
            {index + 1}. {e.name || <span className="text-ink-muted">Unnamed exercise</span>}
            <span className="font-normal text-ink-muted">{prescription(e) ? ` · ${prescription(e)}` : ""}{e.alternatives.length ? ` · ${e.alternatives.length} alt.` : ""}</span>
          </span>
        </summary>
        <div className="space-y-4 border-t border-line p-4">
          <CoreFields e={e} onChange={(c) => onChange({ ...e, ...c })} label="Exercise" />
          <LongText label="How to progress" value={e.progression} onChange={(v) => onChange({ ...e, progression: v })} maxLength={LIMITS.progression} help="e.g. When you hit 12 reps on every set, add 2.5 kg next time." />

          <fieldset className="rounded-lg border border-line p-3">
            <legend className="px-1 font-semibold">Alternatives</legend>
            <p className="text-sm text-ink-muted">Each alternative keeps its own name, instructions and sets, and its results are recorded separately.</p>
            <ol className="mt-3 space-y-3">
              {e.alternatives.map((a, i) => (
                <li key={a.key} className="rounded-lg bg-paper-raised p-3">
                  <CoreFields e={a} onChange={(next) => setAlt(i, next)} label={`Alternative ${i + 1}`} />
                  <div className="mt-3">
                    <ItemTools
                      name={a.name || `alternative ${i + 1}`}
                      index={i}
                      count={e.alternatives.length}
                      onMove={(to) => onChange({ ...e, alternatives: move(e.alternatives, i, to) })}
                      onRemove={() => onChange({ ...e, alternatives: e.alternatives.filter((_, j) => j !== i) })}
                    />
                  </div>
                </li>
              ))}
            </ol>
            {e.alternatives.length < LIMITS.alternatives ? (
              <div className="mt-3">
                <AddButton onClick={() => onChange({ ...e, alternatives: [...e.alternatives, { ...blankCore(), sets: e.sets, target: e.target, restSeconds: e.restSeconds }] })}>
                  Add an alternative
                </AddButton>
              </div>
            ) : null}
          </fieldset>

          <ItemTools name={name} index={index} count={count} onMove={onMove} onRemove={onRemove} />
        </div>
      </details>
    </li>
  );
}

function SessionEditor({
  s,
  index,
  count,
  weekly,
  onChange,
  onMove,
  onRemove,
  openKeys,
  setOpen,
}: {
  s: Session;
  index: number;
  count: number;
  weekly: boolean;
  onChange: (s: Session) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  openKeys: Set<string>;
  setOpen: (key: string, open: boolean) => void;
}) {
  const setEx = (i: number, e: Exercise) => onChange({ ...s, exercises: s.exercises.map((x, j) => (j === i ? e : x)) });
  return (
    <li className="rounded-2xl border border-line-strong bg-paper p-4 sm:p-5">
      <h3 className="text-lg font-semibold">
        {weekly && s.day !== null ? `${DAY_NAMES[s.day]}: ` : `Session ${index + 1}: `}
        {s.title || "Untitled"}
      </h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TextInput label="Session title" value={s.title} onChange={(v) => onChange({ ...s, title: v })} maxLength={LIMITS.sessionTitle} required placeholder="e.g. Lower body" />
        {weekly ? (
          <Choice label="Day" value={String(s.day ?? 0)} onChange={(v) => onChange({ ...s, day: Number(v) })} options={DAY_NAMES.map((d, i) => ({ value: String(i), label: d }))} />
        ) : null}
        <NumberInput label="Roughly how long" suffix="minutes" value={s.minutes} onChange={(v) => onChange({ ...s, minutes: v })} min={5} max={240} step={5} />
        <LongText label="Session notes" value={s.notes} onChange={(v) => onChange({ ...s, notes: v })} maxLength={LIMITS.sessionNotes} className="sm:col-span-2" help="Warm-up, order, anything for the whole session." />
      </div>

      <h4 className="mt-5 font-semibold">Exercises</h4>
      {s.exercises.length ? (
        <ol className="mt-2 space-y-2">
          {s.exercises.map((e, i) => (
            <ExerciseEditor
              key={e.key}
              e={e}
              index={i}
              count={s.exercises.length}
              onChange={(next) => setEx(i, next)}
              onMove={(to) => onChange({ ...s, exercises: move(s.exercises, i, to) })}
              onRemove={() => onChange({ ...s, exercises: s.exercises.filter((_, j) => j !== i) })}
              open={openKeys.has(e.key)}
              onToggle={(o) => setOpen(e.key, o)}
            />
          ))}
        </ol>
      ) : (
        <p className="mt-1 text-ink-muted">No exercises yet.</p>
      )}
      {s.exercises.length < LIMITS.exercises ? (
        <div className="mt-3">
          <AddButton
            onClick={() => {
              const e = blankExercise();
              setOpen(e.key, true);
              onChange({ ...s, exercises: [...s.exercises, e] });
            }}
          >
            Add an exercise
          </AddButton>
        </div>
      ) : null}

      <div className="mt-5 border-t border-line pt-4">
        <ItemTools name={s.title || `session ${index + 1}`} index={index} count={count} onMove={onMove} onRemove={onRemove} />
      </div>
    </li>
  );
}

export function WorkoutEditor({ initial }: { initial: WorkoutContent }) {
  const [c, setC] = useState<WorkoutContent>(initial);
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const weekly = c.schedule === "weekly";
  const setOpen = (key: string, open: boolean) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  const setSession = (i: number, s: Session) => setC({ ...c, sessions: c.sessions.map((x, j) => (j === i ? s : x)) });
  const freeDays = DAY_NAMES.map((_, d) => d).filter((d) => !c.sessions.some((s) => s.day === d));
  const restNote = (day: number) => c.restNotes.find((r) => r.day === day)?.note ?? "";
  const setRestNote = (day: number, note: string) =>
    setC({ ...c, restNotes: [...c.restNotes.filter((r) => r.day !== day), ...(note ? [{ day, note }] : [])].sort((a, b) => a.day - b.day) });

  return (
    <div className="space-y-6">
      <input type="hidden" name="content" value={JSON.stringify(c)} />

      <fieldset>
        <legend className="font-semibold">How the client follows it</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {([
            ["weekly", "Set days, Monday to Sunday", "Each session sits on a day of the week. Days without one are rest days."],
            ["in_order", "Sessions in order", "The client does session 1, then 2, then 3… on whichever days suit them."],
          ] as const).map(([value, label, help]) => (
            <label key={value} className={`flex min-h-11 cursor-pointer gap-3 rounded-lg border p-3 ${c.schedule === value ? "border-brand bg-brand-tint" : "border-line-strong bg-surface"}`}>
              <input
                type="radio"
                name="schedule_choice"
                value={value}
                checked={c.schedule === value}
                onChange={() => setC({ ...c, schedule: value, sessions: c.sessions.map((s, i) => ({ ...s, day: value === "weekly" ? (s.day ?? Math.min(i, 6)) : null })) })}
                className="mt-1 size-5 accent-brand"
              />
              <span>
                <span className="block font-semibold">{label}</span>
                <span className="block text-sm text-ink-muted">{help}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <LongText label="Overview for your client" value={c.overview} onChange={(v) => setC({ ...c, overview: v })} maxLength={LIMITS.overview} rows={4} help="What this plan is for and how to approach it." />

      <section aria-labelledby="sessions-heading">
        <h2 id="sessions-heading" className="text-xl font-semibold">Sessions</h2>
        {c.sessions.length ? (
          <ol className="mt-3 space-y-4">
            {c.sessions.map((s, i) => (
              <SessionEditor
                key={s.key}
                s={s}
                index={i}
                count={c.sessions.length}
                weekly={weekly}
                onChange={(next) => setSession(i, next)}
                onMove={(to) => setC({ ...c, sessions: move(c.sessions, i, to) })}
                onRemove={() => setC({ ...c, sessions: c.sessions.filter((_, j) => j !== i) })}
                openKeys={openKeys}
                setOpen={setOpen}
              />
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-ink-muted">No sessions yet. Add the first one below.</p>
        )}
        {c.sessions.length < LIMITS.sessions ? (
          <div className="mt-4">
            <AddButton onClick={() => setC({ ...c, sessions: [...c.sessions, blankSession(weekly ? (freeDays[0] ?? 0) : null, c.sessions.length + 1)] })}>
              Add a session
            </AddButton>
          </div>
        ) : null}
      </section>

      {weekly && freeDays.length ? (
        <fieldset className="rounded-2xl border border-line p-4">
          <legend className="px-1 font-semibold">Rest days</legend>
          <p className="text-sm text-ink-muted">Optional guidance for days without a session — a walk, stretching, or simply rest.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {freeDays.map((d) => (
              <TextInput key={d} label={DAY_NAMES[d]} value={restNote(d)} onChange={(v) => setRestNote(d, v)} maxLength={LIMITS.restNote} placeholder="Rest" />
            ))}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
