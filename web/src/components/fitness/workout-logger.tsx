"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/ui/icon";
import { SoonTag } from "@/components/ui/sample";
import type { WeightUnit } from "@/lib/format";
import type { SampleExercise } from "@/lib/sample/fitness";

/*
 * Workout logging structure.
 *
 * Shows what the coach prescribed, what the customer did last time, inputs
 * for what they actually do, and a completion state per exercise.
 *
 * Validation is real. Saving is not built (M12), so "Finish workout" never
 * says "Saved": it reports honestly that nothing was stored. When saving is
 * connected, confirmation appears only after the server confirms.
 */

type SetEntry = { load: string; reps: string; done: boolean };
type FieldError = { fieldId: string; message: string; short: string };

const inputClass =
  "tabular block min-h-11 w-full min-w-0 rounded-lg border border-line-strong bg-paper px-3 aria-invalid:border-danger aria-invalid:bg-danger-tint";

export function WorkoutLogger({
  exercises,
  unit,
}: {
  exercises: SampleExercise[];
  unit: WeightUnit;
}) {
  const idBase = useId();
  const summaryRef = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<Record<string, SetEntry[]>>(() =>
    Object.fromEntries(
      exercises.map((exercise) => [
        exercise.id,
        Array.from({ length: exercise.sets }, () => ({ load: "", reps: "", done: false })),
      ]),
    ),
  );
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [finished, setFinished] = useState(false);

  const fieldId = (exerciseId: string, set: number, field: "load" | "reps") =>
    `${idBase}-${exerciseId}-${set}-${field}`;
  const errorFor = (id: string) => errors.find((e) => e.fieldId === id);
  const completed = exercises.filter((e) => entries[e.id].every((s) => s.done)).length;

  function update(exerciseId: string, set: number, patch: Partial<SetEntry>) {
    setFinished(false);
    setEntries((previous) => ({
      ...previous,
      [exerciseId]: previous[exerciseId].map((entry, index) =>
        index === set ? { ...entry, ...patch } : entry,
      ),
    }));
    const prefix = `${idBase}-${exerciseId}-${set}-`;
    setErrors((previous) => previous.filter((e) => !e.fieldId.startsWith(prefix)));
  }

  function validate(): FieldError[] {
    const found: FieldError[] = [];
    for (const exercise of exercises) {
      const amount = exercise.weighted ? "reps" : "seconds";
      entries[exercise.id].forEach((entry, index) => {
        const label = `${exercise.name}, set ${index + 1}`;
        if (entry.load.trim() && !/^\d+([.,]\d+)?$/.test(entry.load.trim())) {
          found.push({
            fieldId: fieldId(exercise.id, index, "load"),
            short: "Enter a number, like 16 or 17.5.",
            message: `${label}: weight must be a number.`,
          });
        }
        if (entry.reps.trim() && !/^\d+$/.test(entry.reps.trim())) {
          found.push({
            fieldId: fieldId(exercise.id, index, "reps"),
            short: `Enter ${amount} as a whole number.`,
            message: `${label}: ${amount} must be a whole number.`,
          });
        } else if (entry.done && !entry.reps.trim()) {
          found.push({
            fieldId: fieldId(exercise.id, index, "reps"),
            short: `Enter ${amount} before marking this set done.`,
            message: `${label}: enter ${amount} before marking it done.`,
          });
        }
      });
    }
    return found;
  }

  function finish() {
    const found = validate();
    setErrors(found);
    setFinished(found.length === 0);
    requestAnimationFrame(() => summaryRef.current?.focus());
  }

  return (
    <>
      <ol className="space-y-5">
        {exercises.map((exercise) => {
          const sets = entries[exercise.id];
          const doneSets = sets.filter((s) => s.done).length;
          const exerciseDone = doneSets === sets.length;
          const amountLabel = exercise.weighted ? "Reps" : "Seconds";
          return (
            <li key={exercise.id} className="rounded-2xl border border-line bg-surface">
              <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
                <div className="min-w-0">
                  <h2 className="text-xl font-semibold">{exercise.name}</h2>
                  <p className="tabular mt-1 text-ink-muted">
                    {exercise.sets} sets × {exercise.targetReps} · rest {exercise.restSeconds} s
                  </p>
                </div>
                <p
                  className={`tabular flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${
                    exerciseDone ? "bg-brand-tint text-brand" : "bg-paper-raised text-ink-muted"
                  }`}
                >
                  {exerciseDone && <Icon name="check" className="size-4" />}
                  {exerciseDone ? "Complete" : `${doneSets} of ${sets.length} sets`}
                </p>
              </div>

              {exercise.coachNote && (
                <p className="mx-4 mt-3 rounded-lg bg-brand-tint px-3 py-2 sm:mx-5">
                  <span className="font-semibold">Coach&rsquo;s note: </span>
                  {exercise.coachNote}
                </p>
              )}

              <p className="px-4 pt-3 text-ink-muted sm:px-5">
                {exercise.previous ? `Last time: ${exercise.previous}` : "First time with this exercise"}
              </p>

              <div role="group" aria-label={`${exercise.name} sets`} className="mt-3 border-t border-line px-4 py-3 sm:px-5">
                <div
                  aria-hidden="true"
                  className="grid grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)_2.75rem] gap-2 pb-1 text-sm font-semibold text-ink-muted"
                >
                  <span>Set</span>
                  <span>{exercise.weighted ? unit : ""}</span>
                  <span>{amountLabel}</span>
                  <span className="text-center">Done</span>
                </div>
                {sets.map((entry, index) => {
                  const loadId = fieldId(exercise.id, index, "load");
                  const repsId = fieldId(exercise.id, index, "reps");
                  const loadError = errorFor(loadId);
                  const repsError = errorFor(repsId);
                  return (
                    <div key={index} className="py-1.5">
                      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-2">
                        <span className="tabular font-semibold">{index + 1}</span>
                        {exercise.weighted ? (
                          <input
                            id={loadId}
                            inputMode="decimal"
                            autoComplete="off"
                            aria-label={`Set ${index + 1} weight in ${unit}`}
                            value={entry.load}
                            onChange={(e) => update(exercise.id, index, { load: e.target.value })}
                            aria-invalid={loadError ? true : undefined}
                            aria-describedby={loadError ? `${loadId}-error` : undefined}
                            className={inputClass}
                          />
                        ) : (
                          <span aria-hidden="true" />
                        )}
                        <input
                          id={repsId}
                          inputMode="numeric"
                          autoComplete="off"
                          aria-label={`Set ${index + 1} ${amountLabel.toLowerCase()}`}
                          value={entry.reps}
                          onChange={(e) => update(exercise.id, index, { reps: e.target.value })}
                          aria-invalid={repsError ? true : undefined}
                          aria-describedby={repsError ? `${repsId}-error` : undefined}
                          className={inputClass}
                        />
                        <label className="flex size-11 cursor-pointer items-center justify-center rounded-lg hover:bg-paper-raised">
                          <input
                            type="checkbox"
                            checked={entry.done}
                            onChange={(e) => update(exercise.id, index, { done: e.target.checked })}
                            className="size-5 accent-brand"
                          />
                          <span className="sr-only">Set {index + 1} done</span>
                        </label>
                      </div>
                      {loadError && (
                        <p id={`${loadId}-error`} className="mt-1 text-sm text-danger">{loadError.short}</p>
                      )}
                      {repsError && (
                        <p id={`${repsId}-error`} className="mt-1 text-sm text-danger">{repsError.short}</p>
                      )}
                    </div>
                  );
                })}
              </div>

              {exercise.formVideoRequested && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-4 sm:px-5">
                  <div className="flex gap-3">
                    <Icon name="video" className="mt-0.5 size-5 shrink-0 text-brand" />
                    <div>
                      <p className="font-semibold">Your coach asked for a form video</p>
                      <p className="text-sm text-ink-muted">
                        <Icon name="lock" className="mr-1 inline size-4 align-[-2px]" />
                        Only you and your coach can see it.
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 font-semibold text-ink-muted">
                    Add form video
                    <SoonTag />
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <div ref={summaryRef} tabIndex={-1} className="rounded-xl">
          {errors.length > 0 && (
            <div role="alert" className="rounded-xl border border-danger bg-danger-tint p-4">
              <p className="flex gap-2 font-semibold text-danger">
                <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
                Check {errors.length} {errors.length === 1 ? "entry" : "entries"} before finishing
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-7">
                {errors.map((error) => (
                  <li key={error.fieldId}>
                    <a
                      href={`#${error.fieldId}`}
                      onClick={(event) => {
                        event.preventDefault();
                        document.getElementById(error.fieldId)?.focus();
                      }}
                      className="text-ink underline underline-offset-4"
                    >
                      {error.message}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {finished && (
            <div role="status" className="rounded-xl border border-line-strong bg-paper-raised p-4">
              <p className="flex gap-2 font-semibold">
                <Icon name="info" className="mt-0.5 size-5 shrink-0 text-brand" />
                Nothing was saved
              </p>
              <p className="mt-1 text-ink-muted">
                This is a sample screen, so your workout wasn&rsquo;t stored. When
                saving is built, you&rsquo;ll see a confirmation only after your
                workout is safely stored.
              </p>
            </div>
          )}
        </div>
        <div className={`flex flex-wrap items-center justify-between gap-3 ${errors.length || finished ? "mt-4" : ""}`}>
          <p className="tabular text-ink-muted">
            {completed} of {exercises.length} exercises complete
          </p>
          <Button type="button" onClick={finish}>
            Finish workout
          </Button>
        </div>
      </div>
    </>
  );
}
