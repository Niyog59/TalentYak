import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DataTable, PageHeader, Panel } from "@/components/ui/panel";
import { PURCHASE_STATE_LABEL, formatDate, formatMinor } from "@/lib/format";

export const metadata = { title: "Purchases" };

export default async function AdminPurchasesPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  await requireAdmin("/admin/purchases");
  const { state } = await searchParams;
  const supabase = (await createClient())!;

  let query = supabase
    .from("purchases")
    .select("id, state, service_type, charge_currency, charge_amount_minor, created_at, paid_through_at, requires_review, inclusions_snapshot, customer_id, provider_id, providers(display_name), profiles!purchases_customer_id_fkey(email, full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (state && Object.keys(PURCHASE_STATE_LABEL).includes(state)) query = query.eq("state", state);
  const { data: purchases, error } = await query;

  return (
    <div>
      <PageHeader title="Customers & purchases">Every checkout that created a purchase, newest first. Payment states come only from Stripe.</PageHeader>
      <nav aria-label="Filter by state" className="mt-6 flex flex-wrap gap-2">
        {["", "active", "cancelling", "past_due", "pending_payment", "ended", "refunded", "expired"].map((s) => (
          <Link key={s || "all"} href={s ? `/admin/purchases?state=${s}` : "/admin/purchases"} aria-current={state === s || (!state && !s) ? "page" : undefined} className="rounded-full border border-line-strong px-3 py-1 text-sm aria-[current=page]:border-brand aria-[current=page]:bg-brand-tint">
            {s ? PURCHASE_STATE_LABEL[s] : "All"}
          </Link>
        ))}
      </nav>
      <Panel title="Purchases" id="purchases">
        {error ? <p role="alert">Purchases couldn&rsquo;t be loaded.</p> : null}
        <DataTable
          caption="Purchases"
          head={["Started", "Customer", "Coach", "Plan", "Price", "Status", "Paid until"]}
          empty="No purchases."
          rows={(purchases ?? []).map((p) => {
            const coach = (Array.isArray(p.providers) ? p.providers[0] : p.providers) as { display_name: string } | null;
            const customer = (Array.isArray(p.profiles) ? p.profiles[0] : p.profiles) as { email: string; full_name: string | null } | null;
            return [
              <Link key="d" href={`/admin/purchases/${p.id}`} className="underline">{formatDate(p.created_at, null)}</Link>,
              customer?.full_name || customer?.email || "—",
              coach?.display_name ?? "—",
              (p.inclusions_snapshot as { title?: string })?.title ?? "—",
              `${formatMinor(p.charge_amount_minor, p.charge_currency)}${p.service_type === "recurring_coaching" ? "/mo" : ""}`,
              `${PURCHASE_STATE_LABEL[p.state] ?? p.state}${p.requires_review ? " · needs review" : ""}`,
              formatDate(p.paid_through_at, null),
            ];
          })}
        />
      </Panel>
    </div>
  );
}
