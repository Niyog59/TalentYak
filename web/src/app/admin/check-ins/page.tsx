import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { DataTable, PageHeader, Panel } from "@/components/ui/panel";
import { formatDate } from "@/lib/format";
import { periodLabel } from "@/lib/checkins/status";
import { resolveCheckinFlagAction } from "../actions";

export const metadata = { title: "Check-ins needing attention" };
export const dynamic = "force-dynamic";

interface Row {
  checkin_id: string;
  reason: "coach_change_scope" | "coach_away";
  client_name: string;
  coach_name: string;
  period_start: string;
  period_end: string;
  submitted_at: string | null;
  away_until: string | null;
}

/*
 * What TalentYak sees: that a check-in needs a person, never what it says.
 * Answers, attachments and progress are not readable from here.
 */
export default async function AdminCheckinsPage() {
  await requireAdmin("/admin/check-ins");
  const supabase = (await createClient())!;
  const { data, error } = await supabase.rpc("admin_checkin_attention");
  const rows = (data ?? []) as Row[];
  const flagged = rows.filter((r) => r.reason === "coach_change_scope");
  const away = rows.filter((r) => r.reason === "coach_away");

  return (
    <div>
      <PageHeader title="Check-ins needing attention">
        Metadata only. Nobody at TalentYak can read a client&rsquo;s answers, attachments or progress from here.
      </PageHeader>
      {error ? <p role="alert" className="mt-4 text-danger">This list couldn&rsquo;t be loaded.</p> : null}

      <Panel title={`After a coach change (${flagged.length})`} id="flagged" description="Sent before the coach changed, and the client's sharing choice doesn't let the new coach see it. Close it (the client is told and can send a new one), or look again after the client changes what they share.">
        <DataTable
          caption="Check-ins flagged after a coach change"
          head={["Client", "Period", "Sent", "Previously responsible", ""]}
          empty="Nothing flagged."
          rows={flagged.map((r) => [
            r.client_name,
            periodLabel(r.period_start, r.period_end),
            formatDate(r.submitted_at, null, true),
            r.coach_name,
            <div key="a" className="flex flex-wrap gap-2">
              <ActionForm action={resolveCheckinFlagAction}>
                <input type="hidden" name="checkin_id" value={r.checkin_id} />
                <input type="hidden" name="resolution" value="recheck" />
                <SubmitButton variant="secondary" pendingLabel="Checking…">Check again</SubmitButton>
              </ActionForm>
              <ActionForm action={resolveCheckinFlagAction}>
                <input type="hidden" name="checkin_id" value={r.checkin_id} />
                <input type="hidden" name="resolution" value="close" />
                <SubmitButton variant="secondary" pendingLabel="Closing…">Close and tell the client</SubmitButton>
              </ActionForm>
            </div>,
          ])}
        />
      </Panel>

      <Panel title={`Waiting while the coach is away (${away.length})`} id="away" description="The client sees their coach's away date and a way to contact support.">
        <DataTable
          caption="Check-ins waiting while the coach is away"
          head={["Client", "Coach", "Period", "Sent", "Away until"]}
          empty="None."
          rows={away.map((r) => [r.client_name, r.coach_name, periodLabel(r.period_start, r.period_end), formatDate(r.submitted_at, null, true), formatDate(r.away_until, null)])}
        />
      </Panel>
    </div>
  );
}
