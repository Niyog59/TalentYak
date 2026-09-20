import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton, TextArea, TextField } from "@/components/form/fields";
import { DataTable, Facts, Notice, PageHeader, Panel } from "@/components/ui/panel";
import { PURCHASE_STATE_LABEL, formatDate, formatMinor } from "@/lib/format";
import { formatMinorAsDecimal } from "@/lib/money/money";
import { refundAction } from "../../actions";

export const metadata = { title: "Purchase" };

export default async function AdminPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/admin/purchases/${id}`);
  const supabase = (await createClient())!;

  const { data: purchase } = await supabase
    .from("purchases")
    .select("*, providers(display_name), profiles!purchases_customer_id_fkey(email, full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!purchase) notFound();

  const [{ data: subscription }, { data: cycles }, { data: refunds }, { data: disputes }, { data: assignments }, { data: entries }] = await Promise.all([
    supabase.from("subscriptions").select("stripe_subscription_id, state, current_period_start, current_period_end, cancel_at_period_end, last_event_at").eq("purchase_id", id).maybeSingle(),
    supabase.from("billing_cycles").select("id, sequence, period_start, period_end, currency, amount_minor, state, paid_at, delivered_at, stripe_payment_intent_id").eq("purchase_id", id).order("sequence"),
    supabase.from("refunds").select("id, billing_cycle_id, amount_minor, currency, state, reason, created_at, stripe_refund_id").eq("purchase_id", id).order("created_at"),
    supabase.from("disputes").select("id, amount_minor, currency, state, reason, opened_at, closed_at").eq("purchase_id", id),
    supabase.from("enrollment_assignments").select("id, effective_from, effective_to, reason, history_scope, providers!enrollment_assignments_provider_id_fkey(display_name), enrollments!inner(purchase_id)").eq("enrollments.purchase_id", id).order("effective_from"),
    supabase.from("ledger_entries").select("occurred_at, account, effect, amount_minor, currency, effect_key").eq("purchase_id", id).order("occurred_at"),
  ]);

  const coach = (Array.isArray(purchase.providers) ? purchase.providers[0] : purchase.providers) as { display_name: string } | null;
  const customer = (Array.isArray(purchase.profiles) ? purchase.profiles[0] : purchase.profiles) as { email: string; full_name: string | null } | null;
  const snapshot = purchase.inclusions_snapshot as { title?: string; offer_version?: number };
  const refundedFor = (cycleId: string) =>
    (refunds ?? []).filter((r) => r.billing_cycle_id === cycleId && ["succeeded", "pending", "requested"].includes(r.state)).reduce((s, r) => s + Number(r.amount_minor), 0);

  return (
    <div>
      <p><Link href="/admin/purchases" className="text-brand underline underline-offset-4">← All purchases</Link></p>
      <PageHeader title={snapshot.title ?? "Purchase"}>
        {customer?.full_name || customer?.email} with {coach?.display_name}
      </PageHeader>

      {purchase.requires_review ? <Notice tone="bad">Needs review: {purchase.review_reason ?? "no reason recorded"}</Notice> : null}

      <Panel title="Summary" id="summary">
        <Facts
          items={[
            ["Status", PURCHASE_STATE_LABEL[purchase.state] ?? purchase.state],
            ["Price", `${formatMinor(purchase.charge_amount_minor, purchase.charge_currency)}${purchase.service_type === "recurring_coaching" ? " a month" : ""}`],
            ["Plan version", `v${snapshot.offer_version ?? "?"} (terms frozen at purchase)`],
            ["Customer email", customer?.email ?? "—"],
            ["Started", formatDate(purchase.started_at, null, true)],
            ["Paid until", formatDate(purchase.paid_through_at, null, true)],
            ["Ends", formatDate(purchase.ends_at, null, true)],
            ["Commission policy", purchase.commission_policy_id],
            ["Stripe subscription", subscription ? `${subscription.stripe_subscription_id} · ${subscription.state}${subscription.cancel_at_period_end ? " · cancels at period end" : ""}` : "—"],
          ]}
        />
      </Panel>

      <Panel title="Payments" id="cycles" description="Each paid period. A refund is sent to Stripe and recorded from Stripe's answer — never marked by hand.">
        <DataTable
          caption="Billing periods"
          head={["#", "Period", "Amount", "Status", "Refunded", "Refund"]}
          empty="No payments recorded."
          rows={(cycles ?? []).map((c) => {
            const refunded = refundedFor(c.id);
            const remaining = Number(c.amount_minor) - refunded;
            return [
              String(c.sequence),
              `${formatDate(c.period_start, null)} – ${formatDate(c.period_end, null)}`,
              formatMinor(c.amount_minor, c.currency),
              c.state,
              refunded ? formatMinor(refunded, c.currency) : "—",
              ["paid", "delivered"].includes(c.state) && remaining > 0 && c.stripe_payment_intent_id ? (
                <details key="r">
                  <summary className="cursor-pointer text-brand underline">Refund…</summary>
                  <ActionForm action={refundAction} className="mt-3 grid min-w-64 gap-3">
                    <input type="hidden" name="purchase_id" value={purchase.id} />
                    <input type="hidden" name="billing_cycle_id" value={c.id} />
                    <input type="hidden" name="currency" value={c.currency} />
                    <TextField name="amount" label={`Amount (up to ${formatMinorAsDecimal(remaining, c.currency)} ${c.currency})`} required inputMode="decimal" defaultValue={formatMinorAsDecimal(remaining, c.currency)} />
                    <TextArea name="reason" label="Reason" required rows={2} maxLength={1000} />
                    <CheckboxField name="confirm" required label="Send this refund" />
                    <div><SubmitButton pendingLabel="Refunding…" variant="secondary">Refund</SubmitButton></div>
                  </ActionForm>
                </details>
              ) : null,
            ];
          })}
        />
      </Panel>

      <Panel title="Refunds and disputes" id="refunds">
        <DataTable
          caption="Refunds"
          head={["Requested", "Amount", "Status", "Reason", "Stripe"]}
          empty="No refunds."
          rows={(refunds ?? []).map((r) => [formatDate(r.created_at, null, true), formatMinor(r.amount_minor, r.currency), r.state, r.reason ?? "—", r.stripe_refund_id ?? "—"])}
        />
        <div className="mt-5">
          <DataTable
            caption="Disputes"
            head={["Opened", "Amount", "Status", "Reason", "Closed"]}
            empty="No card disputes."
            rows={(disputes ?? []).map((d) => [formatDate(d.opened_at, null), formatMinor(d.amount_minor, d.currency), d.state, d.reason ?? "—", formatDate(d.closed_at, null)])}
          />
        </div>
      </Panel>

      <Panel title="Coach assignment history" id="assignments">
        <DataTable
          caption="Coach assignments"
          head={["From", "To", "Coach", "History shared", "Reason"]}
          empty="No enrollment yet — it starts when the first payment is confirmed."
          rows={(assignments ?? []).map((a) => {
            const p = (Array.isArray(a.providers) ? a.providers[0] : a.providers) as { display_name: string } | null;
            return [formatDate(a.effective_from, null, true), a.effective_to ? formatDate(a.effective_to, null, true) : "now", p?.display_name ?? "—", a.history_scope, a.reason ?? "—"];
          })}
        />
      </Panel>

      <Panel title="Ledger" id="ledger" description="Append-only. Corrections appear as new rows.">
        <DataTable
          caption="Ledger entries"
          head={["When", "Account", "Effect", "Amount", "Key"]}
          empty="No ledger entries."
          rows={(entries ?? []).map((e) => [formatDate(e.occurred_at, null, true), e.account, e.effect, formatMinor(e.amount_minor, e.currency), <code key="k" className="text-xs">{e.effect_key}</code>])}
        />
      </Panel>
    </div>
  );
}
