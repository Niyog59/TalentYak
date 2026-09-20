import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { csvField } from "@/lib/payouts";
import { formatMinorAsDecimal } from "@/lib/money/money";

export const dynamic = "force-dynamic";

const EFFECT_LABEL: Record<string, string> = {
  service_earned: "Earned from client payment",
  refund_reversal: "Reversed: client refund",
  dispute_hold: "Held: card dispute opened",
  dispute_release: "Released: dispute won",
  dispute_loss: "Reversed: dispute lost",
  payout: "Paid out to you",
  payout_reversal: "Payout returned",
  manual_adjustment: "Adjustment",
};

/**
 * A coach's own statement as CSV. Read-only, and limited by row-level security
 * to the signed-in coach's own ledger rows, so it is a plain GET: it changes
 * nothing and cannot reveal anyone else's earnings.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session?.provider) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(request.url);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : "1970-01-01";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : "9999-12-31";

  const supabase = (await createClient())!;
  const { data, error } = await supabase
    .from("ledger_entries")
    .select("occurred_at, effect, currency, amount_minor, purchase_id, commission_policy_id, earning_states(state)")
    .eq("provider_id", session.provider.id)
    .eq("account", "coach_payable")
    .gte("occurred_at", `${from}T00:00:00Z`)
    .lte("occurred_at", `${to}T23:59:59.999Z`)
    .order("occurred_at", { ascending: true })
    .limit(10000);
  if (error) return NextResponse.json({ error: "Statement unavailable" }, { status: 500 });

  const lines = [
    ["Date (UTC)", "What happened", "Currency", "Amount", "Status", "Purchase reference", "Commission policy"].map(csvField).join(","),
    ...(data ?? []).map((row) => {
      const state = Array.isArray(row.earning_states) ? row.earning_states[0]?.state : (row.earning_states as { state?: string } | null)?.state;
      return [
        csvField(row.occurred_at.slice(0, 19).replace("T", " ")),
        csvField(EFFECT_LABEL[row.effect] ?? row.effect),
        csvField(row.currency),
        // System-generated number, not user text: written bare so a
        // spreadsheet reads it as a number.
        formatMinorAsDecimal(Number(row.amount_minor), row.currency),
        csvField(state ?? ""),
        csvField(row.purchase_id ? row.purchase_id.slice(0, 8) : ""),
        csvField(row.commission_policy_id ?? ""),
      ].join(",");
    }),
  ];

  return new NextResponse(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="talentyak-statement-${from}-to-${to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
