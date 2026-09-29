import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader, Badge, ErrorNote, Pagination, Section, Table } from "@/components/admin/ui";
import { PURCHASE_STATE_LABEL, formatDate, formatMinor } from "@/lib/format";

export const metadata = { title: "Purchases" };

const PAGE = 30;
const STATES = ["active", "cancelling", "past_due", "pending_payment", "ended", "refunded", "expired"];
const TONE: Record<string, "good" | "warn" | "bad" | "neutral"> = { active: "good", cancelling: "warn", past_due: "bad", refunded: "neutral", ended: "neutral" };

export default async function AdminPurchasesPage({ searchParams }: { searchParams: Promise<{ state?: string; review?: string; page?: string }> }) {
  const session = await requireAdmin("/admin/purchases");
  const sp = await searchParams;
  const state = STATES.includes(sp.state ?? "") ? sp.state! : "";
  const review = sp.review === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = (await createClient())!;
  const tz = session.profile.timezone;

  let query = supabase
    .from("purchases")
    .select("id, state, service_type, charge_currency, charge_amount_minor, created_at, paid_through_at, requires_review, inclusions_snapshot, customer_id, provider_id, providers(display_name), profiles!purchases_customer_id_fkey(email, full_name), subscriptions(state, cancel_at_period_end)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (state) query = query.eq("state", state);
  if (review) query = query.eq("requires_review", true);
  const { data: purchases, error, count } = await query;

  const href = (p: number, s = state, r = review) => {
    const u = new URLSearchParams();
    if (s) u.set("state", s);
    if (r) u.set("review", "1");
    if (p > 1) u.set("page", String(p));
    return `/admin/purchases${u.size ? `?${u}` : ""}`;
  };

  return (
    <div>
      <AdminHeader eyebrow="Money" title="Purchases & subscriptions">
        <p>Every checkout that created a purchase, newest first. Payment states come only from Stripe&rsquo;s signed events — never from a browser or a hand edit.</p>
      </AdminHeader>
      <nav aria-label="Filter purchases" className="mt-5">
        <ul className="flex flex-wrap gap-1 text-[0.9375rem]">
          {["", ...STATES].map((s) => (
            <li key={s || "all"}>
              <Link href={href(1, s, false)} aria-current={state === s && !review ? "true" : undefined} className={`flex min-h-10 items-center rounded-lg px-3 font-semibold ${state === s && !review ? "bg-brand text-white" : "border border-line-strong bg-surface hover:bg-paper-raised"}`}>
                {s ? PURCHASE_STATE_LABEL[s] ?? s : "All"}
              </Link>
            </li>
          ))}
          <li>
            <Link href={href(1, "", true)} aria-current={review ? "true" : undefined} className={`flex min-h-10 items-center rounded-lg px-3 font-semibold ${review ? "bg-brand text-white" : "border border-line-strong bg-surface hover:bg-paper-raised"}`}>Needs review</Link>
          </li>
        </ul>
      </nav>
      <Section title={count === null || count === undefined ? "Purchases" : `${count} ${count === 1 ? "purchase" : "purchases"}`}>
        {error ? <ErrorNote /> : (
          <>
            <Table
              caption="Purchases"
              head={["Started", "Customer", "Coach", "Plan", "Price", "Status", "Paid until"]}
              empty="No purchases match."
              rows={(purchases ?? []).map((p) => {
                const coach = (Array.isArray(p.providers) ? p.providers[0] : p.providers) as { display_name: string } | null;
                const customer = (Array.isArray(p.profiles) ? p.profiles[0] : p.profiles) as { email: string; full_name: string | null } | null;
                const sub = (Array.isArray(p.subscriptions) ? p.subscriptions[0] : p.subscriptions) as { state: string; cancel_at_period_end: boolean } | null;
                return [
                  <Link key="d" href={`/admin/purchases/${p.id}`} className="font-semibold text-brand underline-offset-4 hover:underline">{formatDate(p.created_at, tz)}</Link>,
                  <Link key="c" href={`/admin/accounts/${p.customer_id}`} className="underline-offset-4 hover:underline">{customer?.full_name || customer?.email || "—"}</Link>,
                  <Link key="co" href={`/admin/coaches/${p.provider_id}`} className="underline-offset-4 hover:underline">{coach?.display_name ?? "—"}</Link>,
                  (p.inclusions_snapshot as { title?: string })?.title ?? "—",
                  <span key="p" className="tabular-nums">{formatMinor(p.charge_amount_minor, p.charge_currency)}{p.service_type === "recurring_coaching" ? "/mo" : ""}</span>,
                  <span key="s" className="flex flex-wrap gap-1">
                    <Badge tone={TONE[p.state] ?? "neutral"}>{PURCHASE_STATE_LABEL[p.state] ?? p.state}</Badge>
                    {sub?.cancel_at_period_end ? <Badge tone="warn">Cancels at period end</Badge> : null}
                    {p.requires_review ? <Badge tone="bad">Needs review</Badge> : null}
                  </span>,
                  formatDate(p.paid_through_at, tz),
                ];
              })}
            />
            <Pagination page={page} pageSize={PAGE} total={count ?? 0} hrefFor={(n) => href(n)} />
          </>
        )}
      </Section>
    </div>
  );
}
