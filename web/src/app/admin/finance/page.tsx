import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, SubmitButton, TextField } from "@/components/form/fields";
import { DataTable, PageHeader, Panel } from "@/components/ui/panel";
import { formatDate, formatMinor } from "@/lib/format";
import { releaseHoldAction, resolveExceptionAction, retryJobAction } from "../actions";

export const metadata = { title: "Finance & exceptions" };

const KIND_LABEL: Record<string, string> = {
  missing_payment: "Stripe says paid, no record here",
  unmatched_ledger_entry: "Ledger entry with no Stripe match",
  duplicate_effect: "Same effect recorded twice",
  stale_pending_event: "Stripe event stuck",
  fee_difference: "Fee differs from estimate",
  refund_after_payout: "Refund after the coach was paid",
  unmatched_transfer: "Transfer with no batch item",
  negative_balance: "Coach owes more than earned",
};

export default async function AdminFinancePage() {
  await requireAdmin("/admin/finance");
  const supabase = (await createClient())!;

  const [{ data: exceptions }, { data: review }, { data: disputes }, { data: jobs }, { data: events }, { data: held }] = await Promise.all([
    supabase.from("reconciliation_exceptions").select("id, kind, severity, detail, currency, amount_minor, purchase_id, provider_id, state, created_at").in("state", ["open", "investigating"]).order("created_at", { ascending: false }).limit(100),
    supabase.from("purchases").select("id, review_reason, created_at, state").eq("requires_review", true).order("created_at", { ascending: false }).limit(50),
    supabase.from("disputes").select("id, purchase_id, amount_minor, currency, state, reason, opened_at").in("state", ["open", "under_review"]).order("opened_at", { ascending: false }),
    supabase.from("outbox").select("id, topic, state, attempts, last_error, created_at, scheduled_for").in("state", ["failed", "blocked"]).order("created_at", { ascending: false }).limit(100),
    supabase.from("provider_events").select("id, external_id, event_type, processing_state, attempts, last_error, received_at").in("processing_state", ["failed", "processing", "received"]).order("received_at", { ascending: false }).limit(50),
    supabase.from("earning_states").select("ledger_entry_id, provider_id, currency, hold_reason, updated_at, ledger_entries(amount_minor), providers(display_name)").eq("state", "held").limit(100),
  ]);

  return (
    <div>
      <PageHeader title="Finance & exceptions">
        Anything money-related the system could not settle on its own. Nothing here is fixed by editing a number: resolve the cause, then record what you did.
      </PageHeader>

      <Panel title="Reconciliation exceptions" id="exceptions">
        <DataTable
          caption="Open exceptions"
          head={["Raised", "Kind", "Detail", "Amount", "Update"]}
          empty="No open exceptions."
          rows={(exceptions ?? []).map((e) => [
            formatDate(e.created_at, null, true),
            `${KIND_LABEL[e.kind] ?? e.kind} (${e.severity})`,
            <span key="d">
              {e.detail}
              {e.purchase_id ? <> · <Link href={`/admin/purchases/${e.purchase_id}`} className="underline">purchase</Link></> : null}
              {e.provider_id ? <> · <Link href={`/admin/coaches/${e.provider_id}`} className="underline">coach</Link></> : null}
            </span>,
            e.amount_minor !== null ? formatMinor(e.amount_minor, e.currency) : "—",
            <ActionForm key="f" action={resolveExceptionAction} className="grid min-w-56 gap-2">
              <input type="hidden" name="exception_id" value={e.id} />
              <SelectField name="state" label="Status" required defaultValue={e.state === "open" ? "investigating" : "resolved"} options={[{ value: "investigating", label: "Investigating" }, { value: "resolved", label: "Resolved" }, { value: "accepted", label: "Accepted as is" }]} />
              <TextField name="note" label="What you found or did" required={false} maxLength={2000} />
              <div><SubmitButton pendingLabel="Saving…" variant="secondary">Save</SubmitButton></div>
            </ActionForm>,
          ])}
        />
      </Panel>

      <Panel title="Purchases needing review" id="review" description="For example, a payment that arrived after the customer's place had been released.">
        <DataTable
          caption="Purchases needing review"
          head={["When", "Reason", "State"]}
          empty="None."
          rows={(review ?? []).map((p) => [
            <Link key="l" href={`/admin/purchases/${p.id}`} className="underline">{formatDate(p.created_at, null, true)}</Link>,
            p.review_reason ?? "—",
            p.state,
          ])}
        />
      </Panel>

      <Panel title="Open card disputes" id="disputes" description="The disputed amount is held from the coach's earnings until the dispute closes. Respond to disputes in the Stripe dashboard.">
        <DataTable
          caption="Open disputes"
          head={["Opened", "Amount", "Status", "Reason", "Purchase"]}
          empty="No open disputes."
          rows={(disputes ?? []).map((d) => [
            formatDate(d.opened_at, null),
            formatMinor(d.amount_minor, d.currency),
            d.state,
            d.reason ?? "—",
            d.purchase_id ? <Link key="p" href={`/admin/purchases/${d.purchase_id}`} className="underline">Open</Link> : "—",
          ])}
        />
      </Panel>

      <Panel title="Held earnings" id="held">
        <DataTable
          caption="Held earnings"
          head={["Coach", "Amount", "Reason", "Since", ""]}
          empty="Nothing held."
          rows={(held ?? []).map((h) => {
            const entry = (Array.isArray(h.ledger_entries) ? h.ledger_entries[0] : h.ledger_entries) as { amount_minor: number } | null;
            const coach = (Array.isArray(h.providers) ? h.providers[0] : h.providers) as { display_name: string } | null;
            const byDispute = h.hold_reason?.startsWith("dispute");
            return [
              coach?.display_name ?? "—",
              formatMinor(entry?.amount_minor, h.currency),
              h.hold_reason ?? "—",
              formatDate(h.updated_at, null),
              byDispute ? (
                "Released when the dispute closes"
              ) : (
                <ActionForm key="r" action={releaseHoldAction} className="grid min-w-48 gap-2">
                  <input type="hidden" name="ledger_entry_id" value={h.ledger_entry_id} />
                  <TextField name="note" label="Why release" required maxLength={1000} />
                  <div><SubmitButton pendingLabel="Releasing…" variant="secondary">Release</SubmitButton></div>
                </ActionForm>
              ),
            ];
          })}
        />
      </Panel>

      <Panel title="Emails and background jobs that didn't complete" id="jobs" description="Blocked means the job can't run until something is configured — for example email sending. Retrying runs the job again; it never sends a message twice for the same event.">
        <DataTable
          caption="Failed or blocked jobs"
          head={["Created", "Job", "State", "Attempts", "Last error", ""]}
          empty="Nothing failed."
          rows={(jobs ?? []).map((j) => [
            formatDate(j.created_at, null, true),
            j.topic,
            j.state,
            String(j.attempts),
            <span key="e" className="break-all text-xs">{(j.last_error ?? "").slice(0, 200)}</span>,
            <ActionForm key="r" action={retryJobAction}>
              <input type="hidden" name="job_id" value={j.id} />
              <SubmitButton pendingLabel="Queuing…" variant="quiet">Retry</SubmitButton>
            </ActionForm>,
          ])}
        />
      </Panel>

      <Panel title="Stripe events not yet processed" id="events" description="Stuck or failed events are retried automatically from Stripe's own copy by the scheduled job.">
        <DataTable
          caption="Unprocessed Stripe events"
          head={["Received", "Type", "State", "Attempts", "Error"]}
          empty="All Stripe events processed."
          rows={(events ?? []).map((e) => [formatDate(e.received_at, null, true), e.event_type, e.processing_state, String(e.attempts), <span key="e" className="break-all text-xs">{(e.last_error ?? "").slice(0, 200)}</span>])}
        />
      </Panel>
    </div>
  );
}
