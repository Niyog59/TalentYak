import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { payoutsToCsv } from "@/lib/payouts";

/**
 * Creates a payout batch from all pending, provider-assigned ledger
 * entries, marks them exported, and streams the Payoneer CSV.
 */
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Not configured" }, { status: 501 });
  }

  const { data: pending } = await admin
    .from("payout_ledger")
    .select(
      "id, provider_id, provider_share_cents, providers(display_name, payout_reference)",
    )
    .eq("status", "pending")
    .not("provider_id", "is", null);

  if (!pending || pending.length === 0) {
    return NextResponse.json({ error: "Nothing to export" }, { status: 400 });
  }

  const label = `${new Date().toISOString().slice(0, 10)} Payoneer batch`;
  const { data: batch } = await admin
    .from("payout_batches")
    .insert({ label, exported_at: new Date().toISOString() })
    .select("id")
    .single();
  if (!batch) {
    return NextResponse.json({ error: "Batch creation failed" }, { status: 500 });
  }

  await admin
    .from("payout_ledger")
    .update({ status: "exported", batch_id: batch.id })
    .in(
      "id",
      pending.map((p) => p.id),
    );

  const byProvider = new Map<
    string,
    {
      provider_name: string;
      payout_reference: string | null;
      total_cents: number;
      entry_count: number;
    }
  >();
  for (const row of pending) {
    const provider = Array.isArray(row.providers)
      ? row.providers[0]
      : row.providers;
    const key = row.provider_id as string;
    const entry = byProvider.get(key) ?? {
      provider_name:
        (provider as { display_name: string } | null)?.display_name ?? key,
      payout_reference:
        (provider as { payout_reference: string | null } | null)
          ?.payout_reference ?? null,
      total_cents: 0,
      entry_count: 0,
    };
    entry.total_cents += row.provider_share_cents;
    entry.entry_count += 1;
    byProvider.set(key, entry);
  }

  const csv = payoutsToCsv([...byProvider.values()]);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="ghartira-payouts-${label.slice(0, 10)}.csv"`,
    },
  });
}
