import Link from "next/link";
import type { ReactNode } from "react";
import { formatMinor } from "@/lib/format";

/*
 * Building blocks for the founder panel. Quiet surfaces, strong type, status
 * shown with a word as well as a colour, and honest states: a figure that
 * couldn't be read says so instead of showing zero.
 */

export function AdminHeader({
  title,
  eyebrow,
  children,
  actions,
}: {
  title: string;
  eyebrow?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <p className="text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-brand">{eyebrow}</p> : null}
        <h1 className="mt-1 font-display text-3xl tracking-tight text-ink-deep sm:text-[2.5rem] sm:leading-tight">{title}</h1>
        {children ? <div className="mt-2 text-ink-muted">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({
  title,
  id,
  description,
  actions,
  children,
  className = "",
}: {
  title: string;
  id?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={`mt-8 scroll-mt-24 rounded-xl border border-line bg-surface ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold text-ink-deep">{title}</h2>
          {description ? <div className="mt-0.5 max-w-3xl text-[0.9375rem] text-ink-muted">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export { attempt, attemptCount, failed, loaded, type Loaded } from "@/lib/admin/loaded";
import type { Loaded } from "@/lib/admin/loaded";

/** A row of key figures, divided by hairlines rather than boxed one by one. */
export function Figures({ items }: { items: { label: string; value: Loaded<ReactNode>; note?: ReactNode; href?: string }[] }) {
  return (
    <dl className="-mx-5 -my-4 grid grid-cols-1 gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
      {items.map((f) => (
        <div key={f.label} className="bg-surface px-5 py-4">
          <dt className="text-[0.875rem] font-medium text-ink-muted">{f.label}</dt>
          <dd className="mt-1">
            {f.value.ok ? (
              f.href ? (
                <Link href={f.href} className="font-display text-3xl tabular-nums text-ink-deep underline-offset-4 hover:underline">{f.value.value}</Link>
              ) : (
                <span className="font-display text-3xl tabular-nums text-ink-deep">{f.value.value}</span>
              )
            ) : (
              <span className="text-base font-semibold text-danger">{f.value.reason}</span>
            )}
            {f.note ? <span className="mt-0.5 block text-[0.8125rem] text-ink-muted">{f.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const BADGE = {
  good: "border-emerald-800/25 bg-emerald-50 text-emerald-900",
  warn: "border-amber-800/25 bg-amber-50 text-amber-900",
  bad: "border-danger/30 bg-danger-tint text-danger",
  neutral: "border-line-strong/40 bg-paper-raised text-ink",
  info: "border-brand/25 bg-brand-tint text-brand",
} as const;

export type Tone = keyof typeof BADGE;

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[0.8125rem] font-semibold ${BADGE[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line-strong/50 px-4 py-6 text-center text-ink-muted">{children}</p>;
}

export function ErrorNote({ children = "This couldn't be loaded. Refresh to try again — nothing is assumed in the meantime." }: { children?: ReactNode }) {
  return (
    <p role="alert" className="rounded-lg border border-danger/30 bg-danger-tint px-4 py-3 font-medium text-danger">
      {children}
    </p>
  );
}

/** A table that scrolls within itself on a phone; the page never scrolls sideways. */
export function Table({ caption, head, rows, empty }: { caption: string; head: ReactNode[]; rows: ReactNode[][]; empty: ReactNode }) {
  if (rows.length === 0) return <EmptyNote>{empty}</EmptyNote>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-left text-[0.9375rem]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-y border-line bg-paper-raised/60 text-[0.8125rem] uppercase tracking-[0.04em] text-ink-muted">
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-5 py-2.5 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b border-line align-top last:border-b-0 hover:bg-paper-raised/40">
              {cells.map((c, j) => (
                <td key={j} className="px-5 py-3">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <p className="mt-3 text-[0.875rem] text-ink-muted">{total} {total === 1 ? "record" : "records"}</p>;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[0.9375rem]">
      <p className="text-ink-muted">{first}–{last} of {total}</p>
      <div className="flex gap-2">
        {page > 1 ? <Link href={hrefFor(page - 1)} className="flex min-h-10 items-center rounded-lg border border-line-strong px-3 font-semibold hover:bg-paper-raised">Previous</Link> : null}
        <span className="flex min-h-10 items-center px-2" aria-current="page">Page {page} of {pages}</span>
        {page < pages ? <Link href={hrefFor(page + 1)} className="flex min-h-10 items-center rounded-lg border border-line-strong px-3 font-semibold hover:bg-paper-raised">Next</Link> : null}
      </div>
    </nav>
  );
}

export interface CurrencyAmount {
  currency: string;
  amount_minor: number;
}

/** Amounts per currency, one line each. Never added across currencies. */
export function PerCurrency({ amounts, empty = "None" }: { amounts: CurrencyAmount[] | undefined; empty?: string }) {
  const rows = (amounts ?? []).filter((a) => a.amount_minor !== 0);
  if (!rows.length) return <span className="text-ink-muted">{empty}</span>;
  return (
    <span className="grid gap-0.5">
      {rows.map((a) => (
        <span key={a.currency} className="tabular-nums">{formatMinor(a.amount_minor, a.currency)}</span>
      ))}
    </span>
  );
}

/** A small key/value list for a record's details. */
export function Details({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-[minmax(10rem,max-content)_1fr]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[0.9375rem] font-semibold text-ink">{label}</dt>
          <dd className="min-w-0 break-words text-ink-muted">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const CHART_COLOR = "#12876a"; // validated: lightness band, chroma floor, contrast on white

/**
 * Daily columns for one measure. Hover (or focus) a column for its value; the
 * same numbers are available as a table below the chart.
 */
export function DailyColumns({
  title,
  points,
  format: customFormat,
  unitNote,
}: {
  title: string;
  points: { day: string; value: number }[];
  format?: (n: number) => string;
  unitNote?: string;
}) {
  // Counts get whole-number ticks only; money charts pass their own format.
  const wholeNumbers = !customFormat;
  const width = 640;
  const height = 180;
  const pad = { top: 12, right: 8, bottom: 26, left: 44 };
  const format = customFormat ?? ((n: number) => n.toLocaleString("en-US"));
  const max = Math.max(0, ...points.map((p) => p.value));
  const top = niceMax(max);
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = points.length ? innerW / points.length : innerW;
  const barW = Math.max(2, Math.min(24, slot - 2));
  const y = (v: number) => pad.top + innerH - (top ? (v / top) * innerH : 0);
  const labelEvery = Math.ceil(points.length / 8);
  const total = points.reduce((n, p) => n + p.value, 0);

  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-ink-deep">{title}</span>
        <span className="text-[0.875rem] text-ink-muted">Total {format(total)}{unitNote ? ` · ${unitNote}` : ""}</span>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-auto w-full" role="img" aria-label={`${title}: ${points.length} days, total ${format(total)}. Values are listed in the table below.`}>
        {[0, 0.5, 1].filter((f) => f !== 0.5 || !wholeNumbers || Number.isInteger(top / 2)).map((f) => (
          <g key={f}>
            <line x1={pad.left} x2={width - pad.right} y1={y(top * f)} y2={y(top * f)} stroke="#e4e1da" strokeWidth={1} />
            <text x={pad.left - 6} y={y(top * f) + 4} textAnchor="end" fontSize="11" fill="#556563">{format(top * f)}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = pad.left + i * slot + (slot - barW) / 2;
          const h = Math.max(0, y(0) - y(p.value));
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={p.day} className="group" tabIndex={0} aria-label={`${p.day}: ${format(p.value)}`}>
              <title>{`${p.day}: ${format(p.value)}`}</title>
              {/* A hit target the full height of the slot, wider than the column. */}
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} fill="transparent" />
              {h > 0 ? (
                <path
                  d={`M${x},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z`}
                  fill={CHART_COLOR}
                  className="opacity-90 group-hover:opacity-100 group-focus:opacity-100"
                />
              ) : null}
              {i % labelEvery === 0 ? (
                <text x={pad.left + i * slot + slot / 2} y={height - 8} textAnchor="middle" fontSize="11" fill="#556563">{p.day.slice(5)}</text>
              ) : null}
            </g>
          );
        })}
        <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="#b8b2a6" strokeWidth={1} />
      </svg>
      <details className="mt-1 text-[0.875rem]">
        <summary className="inline-flex min-h-10 cursor-pointer items-center text-brand underline underline-offset-4">Show as a table</summary>
        <table className="mt-2 w-full max-w-sm text-left">
          <caption className="sr-only">{title}</caption>
          <thead><tr><th scope="col" className="py-1 pr-4">Day</th><th scope="col" className="py-1">Value</th></tr></thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.day} className="border-t border-line"><td className="py-1 pr-4">{p.day}</td><td className="py-1 tabular-nums">{format(p.value)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}
