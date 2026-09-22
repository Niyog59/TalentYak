import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, PageHeader, Panel } from "@/components/ui/panel";
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

export default async function SupportCasesPage() {
  const session = await requireAdmin("/admin/support");
  const supabase = (await createClient())!;
  const { data, error } = await supabase.rpc("admin_support_cases", { p_state: null });
  const rows = (data ?? []) as CaseRow[];
  const open = rows.filter((r) => r.state !== "resolved");
  const tz = session.profile.timezone;

  return (
    <div>
      <PageHeader title="Support cases">
        Problems reported by clients and coaches. Conversations are not visible here: reading one needs a recorded, time-limited grant
        for a specific case, from that case&rsquo;s page. The full founder dashboard is M17.
      </PageHeader>
      {error ? (
        <p role="alert">Cases couldn&rsquo;t be loaded. Refresh to try again.</p>
      ) : rows.length === 0 ? (
        <EmptyState headingLevel="h2" icon="alert" title="No cases">Nothing has been reported.</EmptyState>
      ) : (
        <Panel title={`${open.length} open`} id="cases">
          <DataTable
            caption="Support cases"
            head={["Opened", "About", "From", "Conversation with", "State"]}
            empty=""
            rows={rows.map((r) => [
              formatDate(r.created_at, tz),
              <Link key={r.id} href={`/admin/support/${r.id}`} className="text-brand underline underline-offset-4">{categoryLabel(r.category)}</Link>,
              `${r.reporter_name} (${r.reporter_role === "coach" ? "coach" : "client"})`,
              r.other_name ?? "—",
              CASE_STATE_LABEL[r.state] ?? r.state,
            ])}
          />
        </Panel>
      )}
    </div>
  );
}
