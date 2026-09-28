"use client";

import { useId, type ReactNode } from "react";

/*
 * Small labelled controls for the plan editors. Each one is a real <label> and
 * input pair at a comfortable size for a phone; nothing here submits on its
 * own — the editor serialises its state into one hidden field.
 */

const control =
  "mt-1 block w-full rounded-lg border border-line-strong bg-surface px-3 text-ink placeholder:text-ink-muted min-h-11";

export function TextInput({
  label,
  value,
  onChange,
  maxLength,
  placeholder,
  required,
  className = "",
  type = "text",
  help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  placeholder?: string;
  required?: boolean;
  className?: string;
  type?: "text" | "url";
  help?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="block font-semibold">
        {label}
        {required ? null : <span className="font-normal text-ink-muted"> (optional)</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={help ? `${id}-help` : undefined}
        className={control}
      />
      {help ? <p id={`${id}-help`} className="mt-1 text-sm text-ink-muted">{help}</p> : null}
    </div>
  );
}

export function LongText({
  label,
  value,
  onChange,
  maxLength,
  rows = 3,
  className = "",
  help,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  rows?: number;
  className?: string;
  help?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="block font-semibold">
        {label} <span className="font-normal text-ink-muted">(optional)</span>
      </label>
      <textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={help ? `${id}-help` : undefined}
        className={`${control} py-2`}
      />
      {help ? <p id={`${id}-help`} className="mt-1 text-sm text-ink-muted">{help}</p> : null}
    </div>
  );
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  className = "",
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="block font-semibold">
        {label}
        {suffix ? <span className="font-normal text-ink-muted"> ({suffix})</span> : null}
      </label>
      <input
        id={id}
        type="number"
        inputMode={step < 1 ? "decimal" : "numeric"}
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className={control}
      />
    </div>
  );
}

export function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
  className = "",
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="block font-semibold">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={control}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

/** Up, down and remove, with names that say which item. */
export function ItemTools({
  name,
  index,
  count,
  onMove,
  onRemove,
  children,
}: {
  name: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
  children?: ReactNode;
}) {
  const btn = "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-3 font-semibold hover:bg-paper-raised disabled:opacity-40";
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className={btn} disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${name} up`}>↑</button>
      <button type="button" className={btn} disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={`Move ${name} down`}>↓</button>
      {children}
      <button type="button" className={`${btn} text-danger`} onClick={onRemove} aria-label={`Remove ${name}`}>Remove</button>
    </div>
  );
}

export function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-brand px-4 font-semibold text-brand hover:bg-brand-tint"
    >
      <span aria-hidden>+</span> {children}
    </button>
  );
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function newKey(): string {
  return crypto.randomUUID();
}
