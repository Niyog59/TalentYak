import { ButtonLink } from "@/components/button";
import { SampleTag } from "@/components/ui/sample";
import { formatMoney } from "@/lib/format";
import type { SampleCoach } from "@/lib/sample/fitness";

/*
 * Coach summary card. Structurally this is a provider profile card and will
 * generalise to other services; the wording ("coach", "plans") is fitness.
 */
export function CoachCard({
  coach,
  href,
  sample = true,
}: {
  coach: SampleCoach;
  href: string;
  sample?: boolean;
}) {
  const cheapest = coach.plans.reduce((low, plan) =>
    plan.priceMinor < low.priceMinor ? plan : low,
  );

  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-brand-tint font-display text-3xl text-brand"
        >
          {coach.initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xl font-semibold">{coach.name}</h3>
            {sample && <SampleTag />}
          </div>
          <p className="mt-1 text-ink-muted">
            {coach.basedIn} · Speaks {coach.languages.join(" and ")}
          </p>
        </div>
      </div>

      <p className="mt-4">
        <span className="text-ink-muted">Focus: </span>
        {coach.focus.join(", ")}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4">
        <div>
          <dt className="text-sm text-ink-muted">Coaching from</dt>
          <dd className="tabular font-semibold">
            {formatMoney(cheapest.priceMinor, cheapest.currency)}
            <span className="font-normal text-ink-muted"> / month</span>
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-muted">One-off consultation</dt>
          <dd className="tabular font-semibold">
            {formatMoney(coach.consultation.priceMinor, coach.consultation.currency)}
            <span className="font-normal text-ink-muted">
              {" "}· {coach.consultation.durationMinutes} min
            </span>
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-1 items-end">
        <ButtonLink href={href} variant="secondary" className="w-full">
          View {coach.name}&rsquo;s plans
        </ButtonLink>
      </div>
    </article>
  );
}
