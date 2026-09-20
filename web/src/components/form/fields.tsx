"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/button";
import { Icon } from "@/components/ui/icon";
import type { ActionState } from "@/lib/actions";

/*
 * Form primitives shared by every screen.
 *
 * Each field renders a real <label>, links its help and error text with
 * aria-describedby, and marks itself aria-invalid when the server rejected it.
 * Errors are announced: the form-level notice uses role="alert" for failures
 * and role="status" for success, so a screen-reader user hears the outcome
 * without hunting for it. Nothing here is decoration over a div.
 */

/**
 * The outcome of the enclosing ActionForm's last submission. Fields read their
 * own error from it by name, so a server-rendered page can lay out a form in
 * plain markup and still get per-field messages.
 */
export const ActionStateContext = createContext<ActionState | null>(null);

/** True while the enclosing ActionForm's action is running. */
export const ActionPendingContext = createContext(false);

function useFieldError(name: string, explicit?: string): string | undefined {
  const state = useContext(ActionStateContext);
  return explicit ?? state?.fieldErrors?.[name];
}

const inputClass =
  "mt-2 block w-full rounded-lg border border-line-strong bg-surface px-4 text-ink placeholder:text-ink-muted aria-[invalid=true]:border-danger";

interface BaseProps {
  name: string;
  label: string;
  help?: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
}

function Described({
  helpId,
  errorId,
  help,
  error,
}: {
  helpId: string;
  errorId: string;
  help?: ReactNode;
  error?: string;
}) {
  return (
    <>
      {help ? (
        <p id={helpId} className="mt-1.5 text-sm text-ink-muted">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1.5 flex gap-1.5 text-sm font-semibold text-danger">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </>
  );
}

function describedBy(helpId: string, errorId: string, help?: ReactNode, error?: string) {
  return [help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
}

export function TextField({
  name,
  label,
  help,
  error,
  required,
  className = "",
  type = "text",
  defaultValue,
  autoComplete,
  inputMode,
  maxLength,
  placeholder,
  min,
  max,
  step,
}: BaseProps & {
  type?: string;
  defaultValue?: string | number;
  autoComplete?: string;
  inputMode?: "text" | "email" | "numeric" | "decimal" | "tel" | "url";
  maxLength?: number;
  placeholder?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
}) {
  const id = useId();
  error = useFieldError(name, error);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <label htmlFor={id} className="block font-semibold">
        {label}
        {required ? null : <span className="font-normal text-ink-muted"> (optional)</span>}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(helpId, errorId, help, error)}
        className={`${inputClass} min-h-12`}
      />
      <Described helpId={helpId} errorId={errorId} help={help} error={error} />
    </div>
  );
}

export function TextArea({
  name,
  label,
  help,
  error,
  required,
  className = "",
  defaultValue,
  rows = 5,
  maxLength,
}: BaseProps & { defaultValue?: string; rows?: number; maxLength?: number }) {
  const id = useId();
  error = useFieldError(name, error);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <label htmlFor={id} className="block font-semibold">
        {label}
        {required ? null : <span className="font-normal text-ink-muted"> (optional)</span>}
      </label>
      <textarea
        id={id}
        name={name}
        required={required}
        defaultValue={defaultValue}
        rows={rows}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(helpId, errorId, help, error)}
        className={`${inputClass} py-3`}
      />
      <Described helpId={helpId} errorId={errorId} help={help} error={error} />
    </div>
  );
}

export function SelectField({
  name,
  label,
  help,
  error,
  required,
  className = "",
  defaultValue,
  options,
}: BaseProps & { defaultValue?: string; options: { value: string; label: string }[] }) {
  const id = useId();
  error = useFieldError(name, error);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <label htmlFor={id} className="block font-semibold">
        {label}
        {required ? null : <span className="font-normal text-ink-muted"> (optional)</span>}
      </label>
      <select
        id={id}
        name={name}
        required={required}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(helpId, errorId, help, error)}
        className={`${inputClass} min-h-12`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Described helpId={helpId} errorId={errorId} help={help} error={error} />
    </div>
  );
}

export function CheckboxField({
  name,
  label,
  help,
  error,
  required,
  className = "",
  defaultChecked,
  value = "on",
}: Omit<BaseProps, "label"> & { label: ReactNode; defaultChecked?: boolean; value?: string }) {
  const id = useId();
  error = useFieldError(name, error);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className={className}>
      <div className="flex gap-3">
        <input
          id={id}
          name={name}
          type="checkbox"
          value={value}
          required={required}
          defaultChecked={defaultChecked}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(helpId, errorId, help, error)}
          className="mt-1 size-5 shrink-0 accent-brand"
        />
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
      </div>
      <div className="pl-8">
        <Described helpId={helpId} errorId={errorId} help={help} error={error} />
      </div>
    </div>
  );
}

/** Disables itself and says what it is doing while the action runs. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className = "",
  name,
  value,
}: {
  children: ReactNode;
  pendingLabel: string;
  variant?: "primary" | "secondary" | "quiet";
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending: nativePending } = useFormStatus();
  const actionPending = useContext(ActionPendingContext);
  const pending = nativePending || actionPending;
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-disabled={pending} className={className} name={name} value={value}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

/** The outcome of the last submission. Never a silent failed save. */
export function FormNotice({ state }: { state: ActionState }) {
  if (!state.message) return null;
  if (state.ok) {
    return (
      <p role="status" className="flex gap-2 rounded-lg border border-line bg-brand-tint p-3 font-medium text-ink">
        <Icon name="check" className="mt-0.5 size-5 shrink-0 text-success" />
        {state.message}
      </p>
    );
  }
  return (
    <p role="alert" className="flex gap-2 rounded-lg border border-danger bg-danger-tint p-3 font-medium text-ink">
      <Icon name="alert" className="mt-0.5 size-5 shrink-0 text-danger" />
      {state.message}
    </p>
  );
}
