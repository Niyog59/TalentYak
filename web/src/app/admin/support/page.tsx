import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader, Badge, ErrorNote, Section, Table } from "@/components/admin/ui";
import { CASE_STATE_LABEL, categoryLabel } from "@/lib/support/categories";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Support cases" };

interface CaseRow {
  id: string;
  category: string;
  state: string;
  reporter_role: string;
  reporter_name: string;
  other_name: string | null;
  has_conversation: boolean;
  created_at: string;
}

export default async function SupportCasesPage({ searchParams }: { searchParams: Promise<{ state?: string; owner?: string }> }) {
  const session = await requireAdmin("/admin/support");
  const sp = await searchParams;
  const state = ["open", "in_progress", "resolved", "all"].includes(sp.state ?? "") ? sp.state! : "unresolved";
  const owner = ["me", "none"].includes(sp.owner ?? "") ? sp.owner! : "all";
  const supabase = (await createClient())!;
  const [{ data, error }, { data: owners }] = await Promise.all([
    supabase.rpc("admin_support_cases", { p_state: null }),
    supabase.from("support_cases").select("id, owner_id, owner:profiles!support_cases_owner_id_fkey(full_name, email)"),
  ]);
  const ownerOf = new Map(((owners ?? []) as { id: string; owner_id: string | null; owner: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null }[])
    .map((o) => [o.id, { id: o.owner_id, name: (Array.isArray(o.owner) ? o.owner[0] : o.owner)?.full_name || (Array.isArray(o.owner) ? o.owner[0] : o.owner)?.email || null }]));
  const all = (data ?? []) as CaseRow[];
  const rows = all
    .filter((r) => (state === "all" ? true : state === "unresolved" ? r.state !== "resolved" : r.state === state))
    .filter((r) => owner === "all" || (owner === "none" ? !ownerOf.get(r.id)?.id : ownerOf.get(r.id)?.id === session.userId));
  const tz = session.profile.timezone;
  const link = (s: string, o: string) => `/admin/support?state=${s}&owner=${o}`;

  return (
    <div>
      <AdminHeader eyebrow="People" title="Support cases">
        <p>
          Problems reported by clients and coaches. Conversations are never shown here: reading one needs a recorded, time-limited grant
          for a specific case, from that case&rsquo;s page.
        </p>
      </AdminHeader>

      <nav aria-label="Filter cases" className="mt-5 flex flex-wrap gap-4 text-[0.9375rem]">
        <ul className="flex flex-wrap gap-1">
          {[["unresolved", "Not resolved"], ["open", "Open"], ["in_progress", "Being looked at"], ["resolved", "Resolved"], ["all", "All"]].map(([k, l]) => (
            <li key={k}>
              <Link href={link(k, owner)} aria-current={state === k ? "true" : undefined} className={`flex min-h-10 items-center rounded-lg px-3 font-semibold ${state === k ? "bg-brand text-white" : "border border-line-strong bg-surface hover:bg-paper-raised"}`}>{l}</Link>
            </li>
          ))}
        </ul>
        <ul className="flex flex-wrap gap-1">
          {[["all", "Any owner"], ["me", "Mine"], ["none", "Nobody yet"]].map(([k, l]) => (
            <li key={k}>
              <Link href={link(state, k)} aria-current={owner === k ? "true" : undefined} className={`flex min-h-10 items-center rounded-lg px-3 font-semibold ${owner === k ? "bg-brand text-white" : "border border-line-strong bg-surface hover:bg-paper-raised"}`}>{l}</Link>
            </li>
          ))}
        </ul>
      </nav>

      <Section title={`${rows.length} ${rows.length === 1 ? "case" : "cases"}`}>
        {error ? (
          <ErrorNote />
        ) : (
          <Table
            caption="Support cases"
            head={["Opened", "About", "From", "Conversation with", "Owner", "State"]}
            empty="No cases match."
            rows={rows.map((r) => [
              formatDate(r.created_at, tz, true),
              <Link key={r.id} href={`/admin/support/${r.id}`} className="font-semibold text-brand underline-offset-4 hover:underline">{categoryLabel(r.category)}</Link>,
              `${r.reporter_name} (${r.reporter_role === "coach" ? "coach" : "client"})`,
              r.other_name ?? "—",
              ownerOf.get(r.id)?.name ?? <span key="o" className="text-ink-muted">Nobody</span>,
              <Badge key="s" tone={r.state === "resolved" ? "good" : r.state === "open" ? "warn" : "info"}>{CASE_STATE_LABEL[r.state] ?? r.state}</Badge>,
            ])}
          />
        )}
      </Section>
    </div>
  );
}
