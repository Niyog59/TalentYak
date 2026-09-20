import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DataTable, PageHeader, Panel } from "@/components/ui/panel";
import { EARNING_STATE_LABEL, formatDate, formatMinor } from "@/lib/format";

export const metadata = { title: "Earnings" };

const EFFECT_LABEL: Record<string, string> = {
  service_earned: "Client payment",
  refund_reversal: "Client refund",
  dispute_hold: "Card dispute opened",
  dispute_release: "Dispute won",
  dispute_loss: "Dispute lost",
  payout: "Paid to you",
  payout_reversal: "Payout returned",
  manual_adjustment: "Adjustment",
};

export default async function CoachEarningsPage() {
  const session = await requireCoach("/coach/earnings");
  const supabase = (await createClient())!;
  const tz = session.provider.timezone;

  const [{ data: balances }, { data: entries }, { data: payouts }] = await Promise.all([
    supabase.from("coach_balances").select("*").eq("provider_id", session.provider.id),
    supabase
      .from("ledger_entries")
      .select("id, occurred_at, effect, currency, amount_minor, earning_states(state, hold_reason, eligible_at)")
      .eq("provider_id", session.provider.id)
      .eq("account", "coach_payable")
      .order("occurred_at", { ascending: false })
      .limit(100),
    supabase
      .from("payout_batch_items")
      .select("id, currency, amount_minor, state, paid_at, settlement_method, created_at")
      .eq("provider_id", session.provider.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return (
    <div>
      <PageHeader title="Earnings">
        You receive 80% of what clients pay for your plans. Money moves through these stages: <strong>pending</strong> until the
        coaching period it pays for is delivered, then <strong>ready to be paid</strong>, then <strong>paid</strong> once a payout
        has actually been sent. A card dispute can put an amount on <strong>hold</strong>. Each currency is kept separate — nothing is converted.
      </PageHeader>

      <Panel title="Balances" id="balances">
        <DataTable
          caption="Balances by currency"
          head={["Currency", "Pending", "Held", "Ready to be paid", "In a payout", "Paid so far"]}
          empty="No earnings yet. They appear here when a client pays for one of your plans."
          rows={(balances ?? []).map((b) => [
            b.currency,
            formatMinor(b.pending_minor, b.currency),
            formatMinor(b.held_minor, b.currency),
            <strong key="e">{formatMinor(b.eligible_minor, b.currency)}</strong>,
            formatMinor(b.batched_minor, b.currency),
            formatMinor(b.paid_minor, b.currency),
          ])}
        />
        <p className="mt-3 text-sm text-ink-muted">
          &ldquo;Paid so far&rdquo; counts only payouts recorded as sent, with a transfer reference. A negative amount means a refund or dispute
          came after money was earned; it is taken from future earnings, never charged to you directly.
        </p>
      </Panel>

      <Panel title="Statement" id="statement">
        <form method="get" action="/coach/earnings/statement" className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="from" className="block font-semibold">From</label>
            <input id="from" name="from" type="date" className="mt-2 min-h-11 rounded-lg border border-line-strong bg-surface px-3" />
          </div>
          <div>
            <label htmlFor="to" className="block font-semibold">To</label>
            <input id="to" name="to" type="date" className="mt-2 min-h-11 rounded-lg border border-line-strong bg-surface px-3" />
          </div>
          <button type="submit" className="min-h-11 rounded-lg border border-line-strong bg-surface px-5 font-semibold hover:border-ink">
            Download CSV
          </button>
        </form>
      </Panel>

      <Panel title="Recent activity" id="activity">
        <DataTable
          caption="Recent earnings activity"
          head={["Date", "What happened", "Amount", "Status"]}
          empty="Nothing yet."
          rows={(entries ?? []).map((e) => {
            const s = (Array.isArray(e.earning_states) ? e.earning_states[0] : e.earning_states) as { state: string; hold_reason: string | null } | null;
            return [
              formatDate(e.occurred_at, tz),
              EFFECT_LABEL[e.effect] ?? e.effect,
              formatMinor(e.amount_minor, e.currency),
              s ? `${EARNING_STATE_LABEL[s.state] ?? s.state}${s.state === "held" && s.hold_reason?.startsWith("dispute") ? " (card dispute)" : ""}` : "—",
            ];
          })}
        />
      </Panel>

      <Panel title="Payouts" id="payouts" description="Payouts are sent by TalentYak in batches. A payout shows as paid only after the transfer has been sent and recorded.">
        <DataTable
          caption="Payouts"
          head={["Prepared", "Amount", "Status", "Paid on"]}
          empty="No payouts yet."
          rows={(payouts ?? []).map((p) => [
            formatDate(p.created_at, tz),
            formatMinor(p.amount_minor, p.currency),
            { prepared: "Being prepared", submitted: "Being sent", paid: "Paid", failed: "Failed — will be retried", returned: "Returned", cancelled: "Cancelled" }[p.state as string] ?? p.state,
            p.paid_at ? formatDate(p.paid_at, tz) : "—",
          ])}
        />
      </Panel>
    </div>
  );
}
