import { ButtonLink } from "@/components/button";
import { PlanInclusions, PriceList } from "@/components/marketing/plan-details";
import { TrackedLink } from "@/components/marketing/track";
import type { PublicCoach, PublicPlan } from "@/lib/offers/public";
import type { PurchaseMode } from "@/lib/launch";
import { renewalText, type PackageAction } from "@/lib/offers/presentation";

export { packageAction, renewalText, type PackageAction } from "@/lib/offers/presentation";

/*
 * One package, with everything a person needs before paying: price and
 * currency, how often, whether it renews, what's included, calls, replies,
 * and the approved cancellation and refund terms (cancellation.v2). The
 * button is "Choose" only when this person can actually buy it now; otherwise
 * it says why and offers the waitlist. The checkout re-checks all of it.
 */

export function PackageCard({
  coach,
  plan,
  action,
  mode,
  headingLevel = "h3",
}: {
  coach: PublicCoach;
  plan: PublicPlan;
  action: PackageAction;
  mode: PurchaseMode;
  headingLevel?: "h2" | "h3";
}) {
  const Heading = headingLevel;
  const recurring = plan.service_type === "recurring_coaching";
  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5">
      <Heading className="text-xl font-semibold">{plan.title}</Heading>
      <p className="text-sm text-ink-muted">{recurring ? "Ongoing coaching" : "One-off session"} with {coach.display_name}</p>
      <div className="mt-3"><PriceList plan={plan} /></div>
      <p className="text-sm">{renewalText(plan)}</p>
      {plan.intended_client ? <p className="mt-2 text-sm"><span className="font-semibold">For:</span> {plan.intended_client}</p> : null}
      {plan.description ? <p className="mt-3 whitespace-pre-line">{plan.description}</p> : null}
      <div className="mt-4"><PlanInclusions plan={plan} /></div>
      <details className="mt-4 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand underline underline-offset-4">Cancelling and refunds</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {recurring ? (
            <>
              <li>Cancel any time from your account. You keep access until the end of the period you&rsquo;ve paid for and aren&rsquo;t charged again.</li>
              <li>The price stays the same for as long as you stay on this package, even if the coach changes prices later.</li>
            </>
          ) : (
            <li>The time you choose is held for about 30 minutes while you pay.</li>
          )}
          <li>Cancelling doesn&rsquo;t refund automatically. If something has gone wrong, contact TalentYak — refund requests are reviewed individually.</li>
        </ul>
      </details>
      <div className="mt-auto pt-5">
        {action.kind === "choose" ? (
          <div className="flex flex-wrap gap-3">
            {plan.prices.map((p) => (
              <TrackedLink
                key={p.currency}
                planVersionId={plan.version_id}
                href={`/checkout/${plan.version_id}?currency=${p.currency}`}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-5 font-semibold text-white hover:bg-brand-strong"
              >
                Choose{plan.prices.length > 1 ? ` — pay in ${p.currency}` : ""}<span className="sr-only">: {plan.title} with {coach.display_name}</span>
              </TrackedLink>
            ))}
            {mode === "test" ? <p className="w-full text-sm text-ink-muted">Test checkout — no real card is charged.</p> : null}
          </div>
        ) : (
          <>
            <p className="text-sm font-medium">{action.reason}</p>
            <ButtonLink href={`/waitlist?coach=${coach.provider_id}&plan=${plan.offer_id}`} variant="secondary" className="mt-2">
              Join the waitlist<span className="sr-only"> for {plan.title} with {coach.display_name}</span>
            </ButtonLink>
          </>
        )}
      </div>
    </article>
  );
}
