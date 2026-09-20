"use client";

import { useId, useState } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/ui/icon";
import type { WeightUnit } from "@/lib/format";

/*
 * Quick weight entry.
 *
 * Validation is real. Saving is not built yet, so a valid entry produces an
 * honest "not saved" message. When M12 connects storage, the success message
 * appears only after the server confirms the save — never before.
 */
export function QuickWeightEntry({
  dateLabel,
  unit,
  lastEntry,
}: {
  dateLabel: string;
  unit: WeightUnit;
  lastEntry?: string;
}) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notSaved, setNotSaved] = useState<string | null>(null);

  const [minimum, maximum] = unit === "kg" ? [20, 350] : [45, 770];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setNotSaved(null);
    const cleaned = value.trim().replace(",", ".");
    if (!cleaned) {
      setError("Enter your weight to log it.");
      return;
    }
    const number = Number(cleaned);
    if (!Number.isFinite(number)) {
      setError(`Enter a number, like ${unit === "kg" ? "72.4" : "159.6"}.`);
      return;
    }
    if (number < minimum || number > maximum) {
      setError(`Enter a weight between ${minimum} and ${maximum} ${unit}.`);
      return;
    }
    setError(null);
    setNotSaved(`${number.toFixed(1)} ${unit} was not saved — this is a sample screen.`);
  }

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor={inputId} className="block text-lg font-semibold">
        Weight for {dateLabel}
      </label>
      <p id={hintId} className="mt-1 text-ink-muted">
        Optional. Log it whenever you like.{lastEntry ? ` Last entry: ${lastEntry}.` : ""}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1 basis-40">
          <input
            id={inputId}
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            className="tabular block min-h-12 w-full rounded-lg border border-line-strong bg-surface py-2 pl-4 pr-12 aria-invalid:border-danger aria-invalid:bg-danger-tint"
          />
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-ink-muted">
            {unit}
          </span>
        </div>
        <Button type="submit" variant="secondary">
          Log weight
        </Button>
      </div>

      {error && (
        <p id={errorId} role="alert" className="mt-2 flex gap-2 text-danger">
          <Icon name="alert" className="mt-0.5 size-5 shrink-0" />
          {error}
        </p>
      )}
      <div role="status" className="mt-2">
        {notSaved && (
          <p className="flex gap-2">
            <Icon name="info" className="mt-0.5 size-5 shrink-0 text-brand" />
            {notSaved}
          </p>
        )}
      </div>
    </form>
  );
}
