import {
  dayValue,
  formatChange,
  formatDay,
  formatWeight,
  toUnit,
  type WeightUnit,
} from "@/lib/format";

/*
 * Body-weight trend. Deliberately neutral: one colour for the line, no
 * red or green, no arrows, no "good job". An increase and a decrease are
 * drawn and described the same way — interpretation belongs to the coach.
 *
 * Entries are optional, so gaps between dates are normal and drawn to scale.
 * The chart is backed by a plain table for screen readers and exact values.
 */
export function WeightTrend({
  entries,
  unit,
  headingId,
}: {
  entries: { date: string; kg: number }[];
  unit: WeightUnit;
  headingId?: string;
}) {
  if (entries.length === 0) {
    return <p className="text-ink-muted">No weights logged yet. Logging is optional.</p>;
  }

  const first = entries[0];
  const last = entries[entries.length - 1];
  const values = entries.map((e) => toUnit(e.kg, unit));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(0.5, (max - min) * 0.3);
  const lo = min - pad;
  const hi = max + pad;

  const width = 640;
  const height = 220;
  const left = 48;
  const right = 16;
  const top = 16;
  const bottom = 32;
  const start = dayValue(first.date);
  const span = Math.max(1, dayValue(last.date) - start);

  const x = (date: string) => left + ((dayValue(date) - start) / span) * (width - left - right);
  const y = (value: number) => top + (1 - (value - lo) / (hi - lo)) * (height - top - bottom);

  const points = entries.map((e) => ({ ...e, cx: x(e.date), cy: y(toUnit(e.kg, unit)) }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.cx.toFixed(1)} ${p.cy.toFixed(1)}`).join(" ");
  const ticks = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15];

  const summary = `Body weight from ${formatDay(first.date)} to ${formatDay(last.date)}: ${entries.length} entries, from ${formatWeight(first.kg, unit)} to ${formatWeight(last.kg, unit)}.`;

  return (
    <figure aria-labelledby={headingId}>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-ink-muted">Latest</dt>
          <dd className="tabular text-2xl font-semibold">{formatWeight(last.kg, unit)}</dd>
          <dd className="text-sm text-ink-muted">{formatDay(last.date)}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-muted">Change since {formatDay(first.date)}</dt>
          <dd className="tabular text-2xl font-semibold">{formatChange(last.kg - first.kg, unit)}</dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-sm text-ink-muted">Entries</dt>
          <dd className="tabular text-2xl font-semibold">{entries.length}</dd>
          <dd className="text-sm text-ink-muted">Log whenever you like</dd>
        </div>
      </dl>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={summary}
        className="mt-6 h-auto w-full"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" />
            <text x={left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize="14" fill="var(--ink-muted)">
              {tick.toFixed(1)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle
            key={p.date}
            cx={p.cx}
            cy={p.cy}
            r={i === points.length - 1 ? 5 : 3.5}
            fill={i === points.length - 1 ? "var(--brand)" : "var(--surface)"}
            stroke="var(--brand)"
            strokeWidth="2"
          />
        ))}
        <text x={left} y={height - 8} fontSize="14" fill="var(--ink-muted)">{formatDay(first.date)}</text>
        <text x={width - right} y={height - 8} textAnchor="end" fontSize="14" fill="var(--ink-muted)">{formatDay(last.date)}</text>
      </svg>

      <details className="mt-3">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand">
          Show all entries
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">Every body-weight entry</caption>
            <thead className="border-b border-line text-sm text-ink-muted">
              <tr>
                <th scope="col" className="py-2 pr-4 font-semibold">Date</th>
                <th scope="col" className="py-2 font-semibold">Weight</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...entries].reverse().map((e) => (
                <tr key={e.date}>
                  <td className="py-2 pr-4">{formatDay(e.date, { weekday: "short", month: "short", day: "numeric" })}</td>
                  <td className="tabular py-2">{formatWeight(e.kg, unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
