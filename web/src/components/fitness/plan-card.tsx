import { SampleTag } from "@/components/ui/sample";
import { UnavailableAction } from "@/components/ui/unavailable";
import { formatMoney, zoneCity } from "@/lib/format";
import type { SampleCoach, SamplePlan } from "@/lib/sample/fitness";

/*
 * A coach-created plan.
 *
 * Coaches decide what their plans contain, so plans differ. What is fixed is
 * the list of questions, always in the same order (PRODUCT_CONTRACT §4.1), so
 * two coaches' plans can be compared row by row. Anything a plan leaves out
 * reads "Not included" — never a blank that could be read as a yes.
 */
export function PlanCard({ plan, coach }: { plan: SamplePlan; coach: SampleCoach }) {
  const rows: [string, string | null][] = [
    ["Type of service", plan.kind],
    ["Calls", plan.inclusions.calls],
    ["Messaging", plan.inclusions.messaging],
    ["Programme", plan.inclusions.programme],
    ["Programme changes", plan.inclusions.revision],
    ["Check-ins", plan.inclusions.checkIns],
    ["Form video review", plan.inclusions.formReview],
    ["Eating guidance", plan.inclusions.nutrition],
    ["Languages", coach.languages.join(", ")],
    ["Coach's timezone", `${zoneCity(coach.timeZone)} (${coach.timeZone})`],
  ];

  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-surface">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xl font-semibold">{plan.name}</h3>
          <SampleTag label="Sample plan" />
        </div>
        <p className="mt-2 text-ink-muted">{plan.summary}</p>
        <p className="mt-5">
          <span className="tabular text-3xl font-semibold">
            {formatMoney(plan.priceMinor, plan.currency)}
          </span>{" "}
          <span className="text-ink-muted">{plan.billing}</span>
        </p>
      </div>

      <dl className="divide-y divide-line border-t border-line">
        {rows.map(([term, detail]) => (
          <div key={term} className="px-5 py-3 sm:grid sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4 sm:px-6">
            <dt className="text-sm font-semibold text-ink-muted sm:text-base sm:font-normal">{term}</dt>
            <dd className={detail ? "" : "text-ink-muted"}>{detail ?? "Not included"}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto border-t border-line p-5 sm:p-6">
        <UnavailableAction
          label="Choose this plan"
          reason="Checkout isn't built yet. Nothing can be purchased on this screen."
        />
      </div>
    </article>
  );
}
