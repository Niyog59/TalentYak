import { formatDay } from "@/lib/format";
import { trimNumber } from "@/lib/tracking/units";

/*
 * A line through the readings that exist, placed on a true date axis so gaps
 * show as gaps in time. A missing day is never drawn as zero, and nothing is
 * smoothed or projected. One neutral colour: a line going up or down is not
 * a verdict. A table of the exact values backs every chart.
 */
export function TrendChart({
  points,
  unit,
  label,
  from,
  to,
  valueLabel = "Value",
  details,
}: {
  points: { date: string; value: number; detail?: string }[];
  unit: string;
  label: string;
  from: string;
  to: string;
  valueLabel?: string;
  details?: boolean;
}) {
  if (!points.length) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const values = sorted.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(max === min ? Math.max(1, Math.abs(max) * 0.05) : (max - min) * 0.2, 0.5);
  const lo = min - pad;
  const hi = max + pad;

  const width = 640;
  const height = 220;
  const left = 52;
  const right = 16;
  const top = 16;
  const bottom = 32;
  const t0 = Date.parse(`${from}T00:00:00Z`);
  const t1 = Math.max(t0 + 86_400_000, Date.parse(`${to}T00:00:00Z`));
  const x = (d: string) => left + ((Date.parse(`${d}T00:00:00Z`) - t0) / (t1 - t0)) * (width - left - right);
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (height - top - bottom);
  const path = sorted.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const ticks = [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15];
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const summary = `${label}: ${sorted.length} reading${sorted.length === 1 ? "" : "s"} between ${formatDay(first.date)} and ${formatDay(last.date)}, from ${trimNumber(first.value)} to ${trimNumber(last.value)} ${unit}.`;

  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} className="h-auto w-full">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="14" fill="var(--ink-muted)">{trimNumber(t)}</text>
          </g>
        ))}
        {sorted.length > 1 ? <path d={path} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" /> : null}
        {sorted.map((p, i) => (
          <circle key={`${p.date}-${i}`} cx={x(p.date)} cy={y(p.value)} r={i === sorted.length - 1 ? 5 : 3.5} fill={i === sorted.length - 1 ? "var(--brand)" : "var(--surface)"} stroke="var(--brand)" strokeWidth="2" />
        ))}
        <text x={left} y={height - 8} fontSize="14" fill="var(--ink-muted)">{formatDay(from)}</text>
        <text x={width - right} y={height - 8} textAnchor="end" fontSize="14" fill="var(--ink-muted)">{formatDay(to)}</text>
      </svg>
      <figcaption className="sr-only">{summary}</figcaption>
      {details !== false ? (
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand">Show every reading</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">{label}, every reading</caption>
              <thead className="border-b border-line text-sm text-ink-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4 font-semibold">Date</th>
                  <th scope="col" className="py-2 font-semibold">{valueLabel}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...sorted].reverse().map((p, i) => (
                  <tr key={`${p.date}-${i}`}>
                    <td className="py-2 pr-4">{formatDay(p.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</td>
                    <td className="tabular py-2">{trimNumber(p.value)} {unit}{p.detail ? ` ${p.detail}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  );
}
