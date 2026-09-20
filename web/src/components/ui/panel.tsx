import type { ReactNode } from "react";

/* Small layout pieces shared by the coach, customer and founder screens. */

export function PageHeader({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-3xl sm:text-4xl">{title}</h1>
        {children ? <div className="mt-2 max-w-2xl text-ink-muted">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  id,
  children,
  description,
  className = "",
}: {
  title: string;
  id?: string;
  children: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section aria-labelledby={headingId} className={`mt-8 rounded-2xl border border-line bg-surface p-5 sm:p-6 ${className}`}>
      <h2 id={headingId} className="text-xl font-semibold">{title}</h2>
      {description ? <div className="mt-1 text-ink-muted">{description}</div> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const tones = {
  neutral: "border-line-strong bg-paper-raised text-ink",
  good: "border-brand bg-brand-tint text-ink",
  warn: "border-line-strong bg-paper-raised text-ink",
  bad: "border-danger bg-danger-tint text-ink",
} as const;

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof tones }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-sm font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Notice({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "bad" }) {
  return (
    <div
      role={tone === "bad" ? "alert" : "note"}
      className={`mt-6 rounded-lg border p-4 ${tone === "bad" ? "border-danger bg-danger-tint" : "border-line-strong bg-paper-raised"}`}
    >
      {children}
    </div>
  );
}

/** A definition list for label/value pairs. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-semibold">{label}</dt>
          <dd className="text-ink-muted">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A table that scrolls sideways inside itself on a phone instead of the page. */
export function DataTable({ caption, head, rows, empty }: { caption: string; head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-ink-muted">{empty}</p>;
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line-strong">
            {head.map((h) => (
              <th key={h} scope="col" className="py-2 pr-4 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i} className="border-b border-line align-top">
              {cells.map((c, j) => (
                <td key={j} className="py-2.5 pr-4">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
