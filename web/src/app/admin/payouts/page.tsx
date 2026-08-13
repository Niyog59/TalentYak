import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth";
import { ButtonLink, Button } from "@/components/button";

interface LedgerRow {
  id: string;
  provider_id: string | null;
  provider_share_cents: number;
  platform_share_cents: number;
  gross_cents: number;
  rule: string;
  status: string;
  providers: { display_name: string; payout_reference: string | null } | null;
}

export default async function AdminPayoutsPage() {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data: pendingRaw } = await supabase
    .from("payout_ledger")
    .select(
      "id, provider_id, provider_share_cents, platform_share_cents, gross_cents, rule, status, providers(display_name, payout_reference)",
    )
    .eq("status", "pending");

  const pending = (pendingRaw ?? []).map((r) => ({
    ...r,
    providers: Array.isArray(r.providers) ? r.providers[0] : r.providers,
  })) as LedgerRow[];

  const { data: batches } = await supabase
    .from("payout_batches")
    .select("id, label, exported_at, notes")
    .order("created_at", { ascending: false })
    .limit(12);

  // Group pending by provider.
  const byProvider = new Map<
    string,
    { name: string; ref: string | null; total: number; count: number }
  >();
  let unassignedTotal = 0;
  for (const row of pending) {
    if (!row.provider_id) {
      unassignedTotal += row.provider_share_cents;
      continue;
    }
    const key = row.provider_id;
    const entry = byProvider.get(key) ?? {
      name: row.providers?.display_name ?? key.slice(0, 8),
      ref: row.providers?.payout_reference ?? null,
      total: 0,
      count: 0,
    };
    entry.total += row.provider_share_cents;
    entry.count += 1;
    byProvider.set(key, entry);
  }

  async function markBatchPaid(formData: FormData) {
    "use server";
    if (!(await isAdmin())) return;
    const admin = createAdminClient();
    if (!admin) return;
    const batchId = String(formData.get("batch_id"));
    await admin
      .from("payout_ledger")
      .update({ status: "paid" })
      .eq("batch_id", batchId)
      .eq("status", "exported");
    await admin
      .from("payout_batches")
      .update({ notes: "Paid" })
      .eq("id", batchId);
    revalidatePath("/admin/payouts");
  }

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-3xl">Payouts</h1>
      <p className="mt-2 max-w-xl font-sans text-sm text-ink/60">
        Provider earnings accrue per payment via each vertical&rsquo;s payout
        rule. Export a Payoneer CSV monthly; mark the batch paid once
        transfers clear.
      </p>

      <section className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 className="label text-ink/50">Pending by provider</h2>
          {byProvider.size > 0 && (
            <ButtonLink href="/admin/payouts/export" variant="secondary">
              Export Payoneer CSV
            </ButtonLink>
          )}
        </div>
        {byProvider.size > 0 ? (
          <table className="mt-4 w-full border-collapse font-sans text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="label py-3 pr-4 font-medium text-ink/50">Provider</th>
                <th className="label py-3 pr-4 font-medium text-ink/50">Payoneer ref</th>
                <th className="label py-3 pr-4 font-medium text-ink/50">Entries</th>
                <th className="label py-3 text-right font-medium text-ink/50">Owed</th>
              </tr>
            </thead>
            <tbody>
              {[...byProvider.values()].map((p) => (
                <tr key={p.name} className="border-b border-line">
                  <td className="py-3 pr-4">{p.name}</td>
                  <td className="py-3 pr-4 text-ink/60">{p.ref ?? "missing"}</td>
                  <td className="py-3 pr-4 text-ink/60">{p.count}</td>
                  <td className="py-3 text-right">${(p.total / 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-4 text-sm text-ink/60">Nothing pending.</p>
        )}
        {unassignedTotal > 0 && (
          <p className="mt-3 text-sm text-terracotta-dark">
            ${(unassignedTotal / 100).toFixed(2)} in provider shares has no
            provider assigned — assign providers on those bookings before
            exporting.
          </p>
        )}
      </section>

      <section className="mt-12">
        <h2 className="label text-ink/50">Batches</h2>
        <ul className="mt-4 font-sans text-sm">
          {(batches ?? []).map((b) => (
            <li key={b.id} className="rule flex items-center justify-between py-3 first:border-t-0">
              <span>
                {b.label}
                <span className="text-ink/50">
                  {" "}
                  · exported {b.exported_at ? new Date(b.exported_at).toLocaleDateString() : "—"}
                  {b.notes === "Paid" && " · paid"}
                </span>
              </span>
              {b.notes !== "Paid" && (
                <form action={markBatchPaid}>
                  <input type="hidden" name="batch_id" value={b.id} />
                  <Button variant="link" type="submit">
                    Mark paid
                  </Button>
                </form>
              )}
            </li>
          ))}
          {(batches ?? []).length === 0 && (
            <p className="text-sm text-ink/60">No batches yet.</p>
          )}
        </ul>
      </section>
    </div>
  );
}
