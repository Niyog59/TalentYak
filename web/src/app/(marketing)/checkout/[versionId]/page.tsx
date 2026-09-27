import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOnboarded } from "@/lib/auth";
import { getPublicPlan } from "@/lib/offers/public";
import { stripeMode } from "@/lib/payments/stripe";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton } from "@/components/form/fields";
import { PlanInclusions, planCadence } from "@/components/marketing/plan-details";
import { formatMinor } from "@/lib/format";
import { coachPhotoUrl } from "@/lib/storage/photos";
import { getLiveExpectations } from "@/lib/expectations/server";
import { ExpectationsDocument } from "@/components/expectations/document";
import { SlotList } from "@/components/scheduling/slot-picker";
import { freeSlots } from "@/lib/scheduling/server";
import { durationLabel } from "@/lib/scheduling/types";
import { startCheckoutAction } from "../actions";

export const metadata: Metadata = { title: "Confirm your plan", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CheckoutConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{ currency?: string; changed?: string }>;
}) {
  const [{ versionId }, { currency: requested, changed }] = await Promise.all([params, searchParams]);
  const session = await requireOnboarded(`/checkout/${versionId}${requested ? `?currency=${encodeURIComponent(requested)}` : ""}`);

  const found = await getPublicPlan(versionId);
  if (!found) notFound();
  const { coach, plan } = found;
  const price = plan.prices.find((p) => p.currency === requested?.toUpperCase()) ?? plan.prices[0];
  const recurring = plan.service_type === "recurring_coaching";
  const mode = stripeMode();
  // Read on every render: what is shown here is exactly what the form names,
  // and the database refuses the purchase if either version has moved on.
  const expectations = await getLiveExpectations(coach.provider_id);
  const oneOffMinutes = !recurring ? plan.call_duration_minutes : null;
  // A one-off session states its length and has its time chosen before paying.
  const slots = !recurring && oneOffMinutes ? await freeSlots(coach.provider_id, oneOffMinutes, 28) : [];
  const sellable = Boolean(expectations.coach && expectations.platform) && (recurring || Boolean(oneOffMinutes));

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 md:py-14">
      <Link href={`/coaches/${coach.slug}`} className="inline-flex min-h-11 items-center font-semibold text-brand underline-offset-4 hover:underline">
        ← Back to {coach.display_name}
      </Link>
      <h1 className="mt-4 font-display text-4xl">Confirm your plan</h1>

      {mode !== "live" ? (
        <p role="note" className="mt-4 rounded-lg border border-line-strong bg-paper-raised p-4">
          <strong>Test mode.</strong> TalentYak isn&rsquo;t taking real payments yet. No real card will be charged; use a Stripe test card.
        </p>
      ) : null}

      <section className="mt-6 rounded-2xl border border-line bg-surface p-5" aria-labelledby="summary">
        <h2 id="summary" className="text-xl font-semibold">{plan.title}</h2>
        <p className="text-ink-muted">with {coach.display_name}</p>
        {!recurring ? (
          <p className="mt-1 font-semibold">{oneOffMinutes ? `One session, ${durationLabel(oneOffMinutes)}` : "Session length not stated yet"}</p>
        ) : null}
        <p className="mt-3 text-2xl">
          <strong>{formatMinor(price.amount_minor, price.currency)}</strong> <span className="text-base text-ink-muted">{planCadence(plan)}</span>
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          Charged in {price.currency}.
          {session.profile.display_currency && session.profile.display_currency !== price.currency
            ? ` Your card may be charged a conversion by your bank if it isn't in ${price.currency}.`
            : ""}
        </p>
        {plan.prices.length > 1 ? (
          <p className="mt-2 text-sm">
            Also available in:{" "}
            {plan.prices.filter((p) => p.currency !== price.currency).map((p, i) => (
              <span key={p.currency}>
                {i > 0 ? ", " : ""}
                <Link href={`/checkout/${plan.version_id}?currency=${p.currency}`} className="underline">{formatMinor(p.amount_minor, p.currency)}</Link>
              </span>
            ))}
          </p>
        ) : null}
        <div className="mt-4"><PlanInclusions plan={plan} /></div>
      </section>

      <section className="mt-6" aria-labelledby="terms">
        <h2 id="terms" className="text-xl font-semibold">How billing works</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-6">
          {recurring ? (
            <>
              <li>You pay {formatMinor(price.amount_minor, price.currency)} now for your first month, then the same amount every month on the same date.</li>
              <li>This price stays the same for as long as you stay on this plan, even if the coach changes their prices later.</li>
              <li>You can cancel any time from your account. You keep access until the end of the month you&rsquo;ve paid for, and you aren&rsquo;t charged again.</li>
              <li>Your place with {coach.display_name} is held for about 30 minutes while you pay.</li>
            </>
          ) : (
            <>
              <li>You pay once. Nothing renews.</li>
              <li>The time you choose below is held for about 30 minutes while you pay. If the payment doesn&rsquo;t finish, the time is released.</li>
            </>
          )}
          <li>If something goes wrong, contact TalentYak. Refunds are reviewed individually.</li>
        </ul>
        <p className="mt-3 text-sm text-ink-muted">
          Read the <Link href="/legal/terms" className="underline">terms</Link> and <Link href="/legal/privacy" className="underline">privacy notice</Link>{" "}
          (drafts while TalentYak is in testing).
        </p>
      </section>

      <section className="mt-8" aria-labelledby="welcome-heading">
        <h2 id="welcome-heading" className="text-xl font-semibold">What you and {coach.display_name} can expect</h2>
        {changed ? (
          <p role="alert" className="mt-3 rounded-lg border border-line-strong bg-paper-raised p-4 font-medium">
            {coach.display_name}&rsquo;s welcome and expectations were updated while you were checking out. Nothing was charged. Please read the current version below before you continue.
          </p>
        ) : null}
        {expectations.coach && expectations.platform ? (
          <details className="mt-3 rounded-2xl border border-line" open={Boolean(changed)}>
            <summary className="flex min-h-11 cursor-pointer items-center px-5 py-3 font-semibold text-brand underline underline-offset-4">
              Read the Coaching Welcome &amp; Expectations
            </summary>
            <div className="border-t border-line">
              <ExpectationsDocument
                platform={expectations.platform}
                coach={expectations.coach}
                coachName={coach.display_name}
                coachPhotoUrl={coachPhotoUrl(coach.photo_path)}
                plan={plan}
                headingLevel={2}
              />
            </div>
          </details>
        ) : (
          <p role="alert" className="mt-3 rounded-lg border border-line-strong bg-paper-raised p-4">
            {coach.display_name} hasn&rsquo;t published their welcome and expectations yet, so this plan can&rsquo;t be bought right now.
          </p>
        )}
        {!recurring && !oneOffMinutes ? (
          <p role="alert" className="mt-3 rounded-lg border border-line-strong bg-paper-raised p-4">
            This session doesn&rsquo;t say how long it is yet, so it can&rsquo;t be booked.
          </p>
        ) : null}
      </section>

      {sellable ? (
      <ActionForm action={startCheckoutAction} className="mt-6 grid gap-4" noticeFirst>
        <input type="hidden" name="expectations_coach_version_id" value={expectations.coach!.id} />
        <input type="hidden" name="expectations_platform_version_id" value={expectations.platform!.id} />
        <input type="hidden" name="version_id" value={plan.version_id} />
        {!recurring && oneOffMinutes ? (
          <section aria-labelledby="slot-heading" className="grid gap-3">
            <h2 id="slot-heading" className="text-xl font-semibold">Choose a time</h2>
            <SlotList slots={slots} viewerTz={session.profile.timezone ?? "UTC"} coachTz={coach.timezone ?? "UTC"} name="slot_starts_at" />
          </section>
        ) : null}
        <input type="hidden" name="currency" value={price.currency} />
        {/* One key per page load: a double click or a retried request reuses the same checkout. */}
        <input type="hidden" name="idempotency_key" value={randomUUID()} />
        <CheckboxField
          name="agree"
          required
          label={recurring
            ? "I understand this renews monthly until I cancel, and I've been shown the welcome and expectations above."
            : "I understand this is a one-off payment, and I've been shown the welcome and expectations above."}
        />
        <div>
          <SubmitButton pendingLabel="Opening secure payment…">Continue to secure payment</SubmitButton>
        </div>
        <p className="text-sm text-ink-muted">You&rsquo;ll enter your card on Stripe&rsquo;s secure page. TalentYak never sees your card number.</p>
      </ActionForm>
      ) : null}
    </div>
  );
}
