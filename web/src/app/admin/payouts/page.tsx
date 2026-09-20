import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, SubmitButton, TextField } from "@/components/form/fields";
import { DataTable, Notice, PageHeader, Panel } from "@/components/ui/panel";
import { formatDate, formatMinor } from "@/lib/format";
import { CHARGE_CURRENCIES } from "@/lib/payments/currencies";
import { prepareBatchAction } from "../actions";

export const metadata = { title: "Payouts" };

const BATCH_STATE: Record<string, string> = {
  prepared: "Prepared — not sent",
  exported: "File downloaded — NOT paid",
  submitted: "Sent to transfer service — confirm each transfer",
  paid: "All transfers recorded as paid",
  failed: "Has failed transfers",
  cancelled: "Cancelled",
};

export default async function AdminPayoutsPage() {
  await requireAdmin("/admin/payouts");
  const supabase = (await createClient())!;
  const [{ data: batches }, { data: balances }] = await Promise.all([
    supabase.from("payout_batches").select("id, label, state, currency, total_minor, created_at, exported_at, submitted_at").not("currency", "is", null).order("created_at", { ascending: false }).limit(50),
    supabase.from("coach_balances").select("currency, eligible_minor, held_minor, pending_minor"),
  ]);

  const totals = new Map<string, { eligible: number; held: number; pending: number }>();
  for (const b of balances ?? []) {
    const t = totals.get(b.currency) ?? { eligible: 0, held: 0, pending: 0 };
    t.eligible += Number(b.eligible_minor);
    t.held += Number(b.held_minor);
    t.pending += Number(b.pending_minor);
    totals.set(b.currency, t);
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader title="Payouts">
        Preparing a batch reserves coaches&rsquo; ready earnings so they can&rsquo;t be paid twice. Downloading the file does not pay anyone.
        A coach is shown as paid only when you record the transfer reference.
      </PageHeader>

      <Notice>
        No transfer service has been confirmed for paying coaches in Nepal. TalentYak does not send money itself: you make each transfer in
        the service you choose, then record it here.
      </Notice>

      <Panel title="Owed to coaches, by currency" id="totals">
        <DataTable
          caption="Totals owed"
          head={["Currency", "Ready to pay", "Held", "Pending delivery"]}
          empty="Nothing owed."
          rows={[...totals.entries()].map(([c, t]) => [c, formatMinor(t.eligible, c), formatMinor(t.held, c), formatMinor(t.pending, c)])}
        />
      </Panel>

      <Panel title="Prepare a batch" id="prepare" description="Includes each coach whose ready earnings in this currency are positive, whose payout details have been checked, and who is at or above the minimum. Everyone else is listed with the reason.">
        <ActionForm action={prepareBatchAction} className="grid gap-4 sm:max-w-lg">
          <SelectField name="currency" label="Currency" required options={CHARGE_CURRENCIES.map((c) => ({ value: c.code, label: c.label }))} />
          <TextField name="eligible_through" label="Earnings ready on or before" type="date" required defaultValue={today} />
          <TextField name="minimum" label="Minimum per coach" required={false} inputMode="decimal" help="Leave empty for no minimum." />
          <TextField name="label" label="Label" required={false} maxLength={120} />
          <div><SubmitButton pendingLabel="Preparing…">Prepare batch</SubmitButton></div>
        </ActionForm>
      </Panel>

      <Panel title="Batches" id="batches">
        <DataTable
          caption="Payout batches"
          head={["Prepared", "Label", "Total", "Status"]}
          empty="No batches yet."
          rows={(batches ?? []).map((b) => [
            <Link key="l" href={`/admin/payouts/${b.id}`} className="underline">{formatDate(b.created_at, null, true)}</Link>,
            b.label,
            formatMinor(b.total_minor, b.currency),
            BATCH_STATE[b.state] ?? b.state,
          ])}
        />
      </Panel>
    </div>
  );
}
