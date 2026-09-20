import type { PublicPlan } from "@/lib/offers/public";
import { formatMinor } from "@/lib/format";

/**
 * What a plan includes, in the same order for every coach, with "Not included"
 * written out — never left blank — so two plans can be compared line by line.
 */
export function PlanInclusions({ plan }: { plan: PublicPlan }) {
  const rows: [string, string][] = [
    ["Training programme", plan.programme_included ? `Included${plan.programme_review_cadence ? `, reviewed ${plan.programme_review_cadence}` : ""}` : "Not included"],
    ["Video or audio calls", plan.calls_included_per_month ? `${plan.calls_included_per_month} a month, ${plan.call_duration_minutes} min each` : "Not included"],
    ["Check-ins", plan.check_in_cadence ?? "Not included"],
    ["Messaging", plan.messaging_channel ?? "Not included"],
    ["Replies within", plan.response_time_hours ? `${plan.response_time_hours} hours` : "Not stated"],
    ["Exercise form review", plan.form_review_included ? "Included" : "Not included"],
  ];
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-semibold">{k}</dt>
          <dd className={v.startsWith("Not") ? "text-ink-muted" : ""}>{v}</dd>
        </div>
      ))}
      {plan.additional_inclusions.length ? (
        <div className="contents">
          <dt className="font-semibold">Also</dt>
          <dd>{plan.additional_inclusions.join("; ")}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export function planCadence(plan: PublicPlan): string {
  if (plan.service_type !== "recurring_coaching") return "one payment";
  const n = plan.billing_interval_count ?? 1;
  const unit = plan.billing_interval ?? "month";
  return n === 1 ? `a ${unit}` : `every ${n} ${unit}s`;
}

export function PriceList({ plan }: { plan: PublicPlan }) {
  return (
    <p className="text-lg">
      {plan.prices.map((p, i) => (
        <span key={p.currency}>
          {i > 0 ? <span className="text-ink-muted"> or </span> : null}
          <strong>{formatMinor(p.amount_minor, p.currency)}</strong>
        </span>
      ))}{" "}
      <span className="text-base text-ink-muted">{planCadence(plan)}</span>
    </p>
  );
}
