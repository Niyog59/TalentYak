"use client";

import { useContext, useId } from "react";
import { ActionStateContext } from "@/components/form/fields";
import { Icon } from "@/components/ui/icon";

/*
 * A set of tick boxes with an "Other" text box, as one labelled group. The
 * group's error (from the server, by name) is announced with the group, and
 * each box is a real checkbox with its own label — no styled divs.
 */
export function ChoiceGroup({
  name,
  legend,
  help,
  options,
  selected,
  otherLabel,
  otherDefault,
}: {
  name: string;
  legend: string;
  help?: string;
  options: readonly string[];
  selected: string[];
  otherLabel: string;
  otherDefault: string;
}) {
  const id = useId();
  const state = useContext(ActionStateContext);
  const error = state?.fieldErrors?.[name];
  const chosen = new Set(selected.map((s) => s.toLowerCase()));
  const describedBy = [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <fieldset aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
      <legend className="font-semibold">{legend}</legend>
      {help ? <p id={`${id}-help`} className="mt-1.5 text-sm text-ink-muted">{help}</p> : null}
      <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {options.map((option, i) => (
          <div key={option} className="flex gap-3">
            <input
              id={`${id}-${i}`}
              type="checkbox"
              name={name}
              value={option}
              defaultChecked={chosen.has(option.toLowerCase())}
              className="mt-1 size-5 shrink-0 accent-brand"
            />
            <label htmlFor={`${id}-${i}`}>{option}</label>
          </div>
        ))}
      </div>
      <label htmlFor={`${id}-other`} className="mt-4 block text-[0.9375rem] font-medium">
        {otherLabel} <span className="font-normal text-ink-muted">(optional, separate with commas)</span>
      </label>
      <input
        id={`${id}-other`}
        name={`${name}_other`}
        type="text"
        maxLength={300}
        defaultValue={otherDefault}
        className="mt-2 block min-h-12 w-full rounded-lg border border-line-strong bg-surface px-4 text-ink"
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 flex gap-1.5 text-sm font-semibold text-danger">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
