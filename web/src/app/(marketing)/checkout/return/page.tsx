import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/button";
import { AutoRefresh } from "@/components/ui/auto-refresh";
import { NextSteps } from "@/components/marketing/next-steps";
import { getLiveExpectations } from "@/lib/expectations/server";

export const metadata: Metadata = { title: "Payment status", robots: { index: false } };
export const dynamic = "force-dynamic";

/*
 * Where Stripe sends the customer after paying.
 *
 * Arriving here proves nothing — anyone can type this address. The page only
 * reports what the database says, and the database changes only when Stripe's
 * signed webhook confirms the payment (invariant 5). Until then it says so and
 * checks again.
 */
export default async function CheckoutReturnPage({ searchParams }: { searchParams: Promise<{ attempt?: string }> }) {
  const { attempt } = await searchParams;
  await requireSession("/account");
  const supabase = (await createClient())!;

  const valid = attempt && /^[0-9a-f-]{36}$/i.test(attempt);
  // Row-level security: a customer can only read their own attempts.
  const { data: row } = valid
    ? await supabase.from("checkout_attempts").select("state, purchases(id, state, provider_id, inclusions_snapshot)").eq("id", attempt).maybeSingle()
    : { data: null };
  const purchase = (Array.isArray(row?.purchases) ? row?.purchases[0] : row?.purchases) as
    | { id: string; state: string; provider_id: string; inclusions_snapshot: { programme_included?: boolean } | null }
    | undefined;

  const confirmed = purchase && ["active", "cancelling"].includes(purchase.state);
  const failed = row && ["expired", "abandoned", "failed"].includes(row.state) && !confirmed;
  const late = purchase?.state === "pending_payment" && row?.state === "expired";

  // After confirmation: the coach's own published commitments, and where to go next.
  const [coachRow, enrollment, expectations] = confirmed && purchase
    ? await Promise.all([
        supabase.from("provider_public_profiles").select("display_name").eq("provider_id", purchase.provider_id).maybeSingle(),
        supabase.from("enrollments").select("id").eq("purchase_id", purchase.id).maybeSingle(),
        getLiveExpectations(purchase.provider_id).catch(() => ({ coach: null, platform: null })),
      ])
    : [null, null, null];

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
      {!row ? (
        <>
          <h1 className="font-display text-4xl">We couldn&rsquo;t find that checkout</h1>
          <p className="mt-3 text-ink-muted">If you paid, your plan appears in your account once the payment is confirmed.</p>
          <ButtonLink href="/account" className="mt-6">Go to your account</ButtonLink>
        </>
      ) : confirmed ? (
        <>
          <h1 className="font-display text-4xl">You&rsquo;re in</h1>
          <p className="mt-3">Your payment is confirmed. We&rsquo;ve emailed you a receipt, and your coach has been told.</p>
          <NextSteps
            paid
            coachName={(coachRow?.data?.display_name as string) ?? "Your coach"}
            programme={Boolean(purchase?.inclusions_snapshot?.programme_included)}
            coachExpectations={expectations?.coach ?? null}
            enrollmentId={(enrollment?.data?.id as string) ?? null}
          />
        </>
      ) : failed && !late ? (
        <>
          <h1 className="font-display text-4xl">This checkout didn&rsquo;t complete</h1>
          <p className="mt-3 text-ink-muted">Nothing was charged. You can choose the plan again.</p>
          <ButtonLink href="/coaches" className="mt-6">Back to coaches</ButtonLink>
        </>
      ) : (
        <>
          <h1 className="font-display text-4xl">Confirming your payment…</h1>
          <p className="mt-3" role="status">
            This usually takes a few seconds. This page checks again automatically; you don&rsquo;t need to pay again.
          </p>
          <AutoRefresh everySeconds={3} forSeconds={90} />
          <p className="mt-6 text-sm text-ink-muted">
            Taking longer? Your plan will appear in <Link href="/account" className="underline">your account</Link> as soon as the payment is confirmed.
          </p>
        </>
      )}
    </div>
  );
}
