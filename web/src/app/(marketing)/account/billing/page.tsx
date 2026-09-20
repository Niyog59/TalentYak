import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listInvoices } from "@/lib/payments/billing";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton } from "@/components/form/fields";
import { DataTable } from "@/components/ui/panel";
import { PURCHASE_STATE_LABEL, formatDate, formatMinor } from "@/lib/format";
import { billingPortalAction, cancelPlanAction } from "../customer-actions";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await requireOnboarded("/account/billing");
  const tz = session.profile.timezone;
  const supabase = (await createClient())!;

  const [{ data: plans }, invoices] = await Promise.all([
    supabase
      .from("purchases")
      .select("id, state, charge_currency, charge_amount_minor, paid_through_at, inclusions_snapshot, subscriptions(state, cancel_at_period_end, current_period_end)")
      .eq("customer_id", session.userId)
      .eq("service_type", "recurring_coaching")
      .in("state", ["active", "cancelling", "past_due"]),
    listInvoices(session.userId).catch(() => null),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20">
      <p><Link href="/account" className="text-brand underline underline-offset-4">← Your account</Link></p>
      <h1 className="mt-3 font-display text-4xl sm:text-5xl">Billing</h1>

      <section aria-labelledby="plans" className="mt-10">
        <h2 id="plans" className="text-2xl font-semibold">Monthly plans</h2>
        {(plans ?? []).length === 0 ? (
          <p className="mt-3 text-ink-muted">You don&rsquo;t have a monthly plan.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {(plans ?? []).map((p) => {
              const sub = (Array.isArray(p.subscriptions) ? p.subscriptions[0] : p.subscriptions) as { cancel_at_period_end: boolean; current_period_end: string | null } | null;
              const cancelling = p.state === "cancelling" || sub?.cancel_at_period_end;
              return (
                <li key={p.id} className="rounded-xl border border-line bg-surface p-5">
                  <p className="text-lg font-semibold">{(p.inclusions_snapshot as { title?: string })?.title}</p>
                  <p className="text-ink-muted">
                    {formatMinor(p.charge_amount_minor, p.charge_currency)} a month · {PURCHASE_STATE_LABEL[p.state]}
                  </p>
                  <p className="mt-1 text-sm">
                    {cancelling
                      ? `Ends ${formatDate(p.paid_through_at ?? sub?.current_period_end, tz)}. You won't be charged again.`
                      : `Next payment ${formatDate(sub?.current_period_end ?? p.paid_through_at, tz)}.`}
                  </p>
                  <ActionForm action={cancelPlanAction} className="mt-4 grid gap-3">
                    <input type="hidden" name="purchase_id" value={p.id} />
                    <input type="hidden" name="cancel" value={cancelling ? "false" : "true"} />
                    {cancelling ? null : (
                      <CheckboxField name="confirm_cancel" required label="Cancel at the end of the month I've paid for" />
                    )}
                    <div>
                      <SubmitButton pendingLabel="Saving…" variant="secondary">{cancelling ? "Keep my plan" : "Cancel plan"}</SubmitButton>
                    </div>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="card" className="mt-10">
        <h2 id="card" className="text-2xl font-semibold">Card</h2>
        <p className="mt-2 text-ink-muted">Update the card you pay with on Stripe&rsquo;s secure page.</p>
        <ActionForm action={billingPortalAction} className="mt-3">
          <SubmitButton pendingLabel="Opening…" variant="secondary">Update card</SubmitButton>
        </ActionForm>
      </section>

      <section aria-labelledby="invoices" className="mt-10">
        <h2 id="invoices" className="text-2xl font-semibold">Receipts</h2>
        <div className="mt-4">
          {invoices === null ? (
            <p role="alert">Receipts couldn&rsquo;t be loaded right now.</p>
          ) : (
            <DataTable
              caption="Receipts"
              head={["Date", "Amount paid", "Status", ""]}
              empty="No receipts yet."
              rows={invoices.map((inv) => [
                formatDate(inv.created, tz),
                formatMinor(inv.amountPaidMinor, inv.currency),
                inv.status ?? "—",
                inv.hostedUrl ? <a key="l" href={inv.hostedUrl} className="underline" rel="noopener noreferrer" target="_blank">View</a> : null,
              ])}
            />
          )}
        </div>
      </section>
    </div>
  );
}
