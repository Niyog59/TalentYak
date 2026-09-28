import Link from "next/link";
import type { CoachExpectationsVersion } from "@/lib/expectations/types";

/**
 * What happens after paying, in the coach's own published words where there
 * are any. No timescale is promised that the coach hasn't published.
 */
export function NextSteps({
  coachName,
  programme,
  coachExpectations,
  paid = false,
  enrollmentId = null,
}: {
  coachName: string;
  programme: boolean;
  coachExpectations: Pick<CoachExpectationsVersion, "response_expectation" | "messaging_availability" | "provides"> | null;
  paid?: boolean;
  enrollmentId?: string | null;
}) {
  return (
    <section aria-labelledby="next-steps-heading" className="mt-8 rounded-2xl border border-line bg-surface p-5 text-left">
      <h2 id="next-steps-heading" className="text-xl font-semibold">{paid ? "What happens now" : "What happens after you pay"}</h2>
      <ol className="mt-3 list-decimal space-y-3 pl-5">
        <li>
          <strong>Payment confirmed.</strong> Stripe confirms the payment to TalentYak (usually within seconds) and you get a receipt by email. Your coaching appears in your account.
        </li>
        <li>
          <strong>Tell {coachName} about you.</strong>{" "}
          {paid ? <Link href="/account/training-profile" className="underline">Fill in your training &amp; food profile</Link> : "You fill in a short training & food profile"} — your goals, equipment, the food you eat, and anything to work around. {coachName} plans from it.
        </li>
        <li>
          <strong>First contact.</strong> A private conversation with {coachName} opens in your account.
          {coachExpectations?.response_expectation ? <> In {coachName}&rsquo;s words, replies come: <em>&ldquo;{coachExpectations.response_expectation}&rdquo;</em></> : null}
          {coachExpectations?.messaging_availability ? <> Available on messages: <em>&ldquo;{coachExpectations.messaging_availability}&rdquo;</em></> : null}
        </li>
        <li>
          <strong>Your first plan.</strong>{" "}
          {programme
            ? `${coachName} writes your training programme. You get a notice when it's published, and it appears on your Today page.`
            : "This package doesn't include a written programme."}
          {coachExpectations?.provides ? <> What {coachName} provides: <em>&ldquo;{coachExpectations.provides}&rdquo;</em></> : null}
        </li>
      </ol>
      {paid ? (
        <p className="mt-4 flex flex-wrap gap-x-5">
          <Link href="/account" className="font-semibold text-brand underline underline-offset-4">Go to your Today page</Link>
          {enrollmentId ? <Link href={`/account/expectations/${enrollmentId}`} className="font-semibold text-brand underline underline-offset-4">Your welcome &amp; expectations</Link> : null}
        </p>
      ) : null}
    </section>
  );
}
