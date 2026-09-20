import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, PageHeader, Panel } from "@/components/ui/panel";
import { PURCHASE_STATE_LABEL, formatDate } from "@/lib/format";

export const metadata = { title: "Clients" };

export default async function CoachClientsPage() {
  const session = await requireCoach("/coach/clients");
  const supabase = (await createClient())!;
  const { data: clients, error } = await supabase.rpc("my_clients");
  const tz = session.provider.timezone;

  return (
    <div>
      <PageHeader title="Clients">
        People currently assigned to you. You&rsquo;ll get an email when someone new signs up.
      </PageHeader>
      <Panel title="Current clients" id="clients">
        {error ? (
          <p role="alert">Your client list couldn&rsquo;t be loaded. Refresh to try again.</p>
        ) : (clients ?? []).length === 0 ? (
          <EmptyState icon="clients" title="No clients yet" headingLevel="h3">
            When a client signs up to one of your plans and their payment goes through, they appear here.
          </EmptyState>
        ) : (
          <DataTable
            caption="Current clients"
            head={["Client", "Plan", "With you since", "Status", "Paid until"]}
            empty=""
            rows={(clients as { enrollment_id: string; client_name: string; offer_title: string; assigned_from: string; purchase_state: string; paid_through: string | null }[]).map((c) => [
              c.client_name,
              c.offer_title,
              formatDate(c.assigned_from, tz),
              PURCHASE_STATE_LABEL[c.purchase_state] ?? c.purchase_state,
              formatDate(c.paid_through, tz),
            ])}
          />
        )}
      </Panel>
    </div>
  );
}
