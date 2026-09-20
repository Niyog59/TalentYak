import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton, TextField } from "@/components/form/fields";
import { DataTable, Facts, PageHeader, Panel } from "@/components/ui/panel";
import { formatDate, formatMinor } from "@/lib/format";
import { markSubmittedAction, recordFailedAction, recordPaidAction, revealReferenceAction } from "../../actions";

export const metadata = { title: "Payout batch" };

const ITEM_STATE: Record<string, string> = {
  prepared: "Not sent",
  submitted: "Sent — waiting for confirmation",
  paid: "Paid",
  failed: "Failed",
  returned: "Returned after payment",
  cancelled: "Cancelled",
};

export default async function AdminPayoutBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/admin/payouts/${id}`);
  const supabase = (await createClient())!;

  const { data: batch } = await supabase.from("payout_batches").select("*").eq("id", id).maybeSingle();
  if (!batch) notFound();

  const [{ data: items }, { data: events }] = await Promise.all([
    supabase.from("payout_batch_items").select("id, provider_id, currency, amount_minor, entry_count, state, external_reference, paid_at, evidence_note, failure_reason, settlement_method, providers(display_name)").eq("batch_id", id).order("created_at"),
    supabase.from("payout_batch_events").select("action, note, created_at, item_id").eq("batch_id", id).order("created_at", { ascending: false }).limit(100),
  ]);
  const localNow = new Date().toISOString().slice(0, 16);

  return (
    <div>
      <p><Link href="/admin/payouts" className="text-brand underline underline-offset-4">← All batches</Link></p>
      <PageHeader title={batch.label}>
        {formatMinor(batch.total_minor, batch.currency)} · {batch.state === "exported" ? "file downloaded, NOT paid" : batch.state}
      </PageHeader>

      <Panel title="Steps" id="steps">
        <ol className="list-decimal space-y-4 pl-6">
          <li>
            <p className="font-semibold">Download the payout file</p>
            <p className="text-ink-muted">Account references in the file are masked. Reveal each one below when you make the transfer.</p>
            {/* A POST, not a link: downloading changes the batch's recorded state and is audited. */}
            <form method="post" action={`/admin/payouts/${batch.id}/export`} className="mt-2">
              <button type="submit" className="min-h-11 rounded-lg border border-line-strong bg-surface px-5 font-semibold hover:border-ink" disabled={!["prepared", "exported", "submitted"].includes(batch.state)}>
                Download CSV
              </button>
            </form>
          </li>
          <li>
            <p className="font-semibold">Make the transfers in your transfer service, then mark the batch as sent</p>
            {["prepared", "exported"].includes(batch.state) ? (
              <ActionForm action={markSubmittedAction} className="mt-2 grid gap-3 sm:max-w-md">
                <input type="hidden" name="batch_id" value={batch.id} />
                <TextField name="note" label="Note" required={false} maxLength={1000} help="e.g. which service, and the batch reference if it has one." />
                <div><SubmitButton pendingLabel="Saving…" variant="secondary">Mark batch as sent</SubmitButton></div>
              </ActionForm>
            ) : (
              <p className="text-ink-muted">Sent {formatDate(batch.submitted_at, null, true)}.</p>
            )}
          </li>
          <li>
            <p className="font-semibold">Record each transfer as paid, with its reference — or as failed</p>
          </li>
        </ol>
      </Panel>

      <Panel title="Coaches in this batch" id="items">
        <ul className="divide-y divide-line">
          {(items ?? []).map((item) => {
            const coach = (Array.isArray(item.providers) ? item.providers[0] : item.providers) as { display_name: string } | null;
            return (
              <li key={item.id} className="py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="text-lg font-semibold">{coach?.display_name}</p>
                  <p>
                    <strong>{formatMinor(item.amount_minor, item.currency)}</strong> · {ITEM_STATE[item.state] ?? item.state}
                  </p>
                </div>
                {item.state === "paid" ? (
                  <Facts items={[["Reference", item.external_reference ?? "—"], ["Paid", formatDate(item.paid_at, null, true)], ["Evidence", item.evidence_note ?? "—"], ["Recorded", item.settlement_method === "manual" ? "By hand" : "By API"]]} />
                ) : null}
                {item.failure_reason ? <p className="text-ink-muted">Failure: {item.failure_reason}</p> : null}

                {["prepared", "submitted"].includes(item.state) ? (
                  <div className="mt-3 grid gap-5 lg:grid-cols-3">
                    <ActionForm action={revealReferenceAction}>
                      <input type="hidden" name="item_id" value={item.id} />
                      <SubmitButton pendingLabel="Revealing…" variant="secondary">Reveal account details</SubmitButton>
                    </ActionForm>
                    <ActionForm action={recordPaidAction} className="grid gap-3">
                      <input type="hidden" name="item_id" value={item.id} />
                      <input type="hidden" name="batch_id" value={batch.id} />
                      <TextField name="external_reference" label="Transfer reference" required maxLength={200} />
                      <TextField name="paid_at" label="Sent at (UTC)" type="datetime-local" required defaultValue={localNow} />
                      <TextField name="evidence_note" label="Evidence" required maxLength={1000} help="e.g. where the receipt is saved." />
                      <div><SubmitButton pendingLabel="Recording…">Record as paid</SubmitButton></div>
                    </ActionForm>
                    <ActionForm action={recordFailedAction} className="grid gap-3">
                      <input type="hidden" name="item_id" value={item.id} />
                      <input type="hidden" name="batch_id" value={batch.id} />
                      <TextField name="reason" label="What went wrong" required maxLength={1000} />
                      <div><SubmitButton pendingLabel="Recording…" variant="secondary">Record as failed</SubmitButton></div>
                    </ActionForm>
                  </div>
                ) : null}
                {item.state === "paid" ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-brand underline">Money came back after it was paid</summary>
                    <ActionForm action={recordFailedAction} className="mt-3 grid gap-3 sm:max-w-md">
                      <input type="hidden" name="item_id" value={item.id} />
                      <input type="hidden" name="batch_id" value={batch.id} />
                      <input type="hidden" name="returned" value="on" />
                      <TextField name="reason" label="What happened" required maxLength={1000} />
                      <CheckboxField name="confirm" required label="Record this payout as returned" />
                      <div><SubmitButton pendingLabel="Recording…" variant="secondary">Record return</SubmitButton></div>
                    </ActionForm>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Audit trail" id="audit">
        <DataTable
          caption="Batch events"
          head={["When", "Action", "Note"]}
          empty="No events."
          rows={(events ?? []).map((e) => [formatDate(e.created_at, null, true), e.action, e.note ?? ""])}
        />
      </Panel>
    </div>
  );
}
