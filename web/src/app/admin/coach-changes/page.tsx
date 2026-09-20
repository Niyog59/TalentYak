import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, SubmitButton, TextArea, TextField } from "@/components/form/fields";
import { DataTable, PageHeader, Panel } from "@/components/ui/panel";
import { formatDate } from "@/lib/format";
import { applyCoachChangeAction, declineCoachChangeAction } from "../actions";

export const metadata = { title: "Coach changes" };

type Named = { display_name: string } | { display_name: string }[] | null;
const nameOf = (v: Named) => (Array.isArray(v) ? v[0]?.display_name : v?.display_name) ?? "—";

export default async function AdminCoachChangesPage() {
  await requireAdmin("/admin/coach-changes");
  const supabase = (await createClient())!;

  const [{ data: open }, { data: closed }, { data: coaches }] = await Promise.all([
    supabase
      .from("coach_change_requests")
      .select("id, enrollment_id, reason, created_at, current:providers!coach_change_requests_current_provider_id_fkey(display_name), preferred:providers!coach_change_requests_preferred_provider_id_fkey(id, display_name), enrollments(purchase_id)")
      .eq("state", "requested")
      .order("created_at"),
    supabase
      .from("coach_change_requests")
      .select("id, state, decided_at, decision_note, history_scope, current:providers!coach_change_requests_current_provider_id_fkey(display_name), next:providers!coach_change_requests_new_provider_id_fkey(display_name)")
      .neq("state", "requested")
      .order("decided_at", { ascending: false })
      .limit(50),
    supabase.from("providers").select("id, display_name, accepting_new_clients").eq("status", "approved").is("suspended_at", null).order("display_name"),
  ]);

  const coachOptions = [{ value: "", label: "Choose a coach" }, ...(coaches ?? []).map((c) => ({ value: c.id, label: `${c.display_name}${c.accepting_new_clients ? "" : " (not accepting new clients)"}` }))];
  const localNow = new Date().toISOString().slice(0, 16);

  return (
    <div>
      <PageHeader title="Coach changes">
        When a customer asks to change coach. The customer keeps what they paid for; payment for time already coached stays with the previous
        coach, and future periods go to the new one. The new coach must have room for another client.
      </PageHeader>

      <Panel title="Waiting for a decision" id="open">
        {(open ?? []).length === 0 ? <p className="text-ink-muted">No open requests.</p> : null}
        <ul className="divide-y divide-line">
          {(open ?? []).map((r) => {
            const enrollment = (Array.isArray(r.enrollments) ? r.enrollments[0] : r.enrollments) as { purchase_id: string } | null;
            const preferred = (Array.isArray(r.preferred) ? r.preferred[0] : r.preferred) as { id: string; display_name: string } | null;
            return (
              <li key={r.id} className="py-5">
                <p className="font-semibold">
                  From {nameOf(r.current as Named)}
                  {preferred ? ` · asked for ${preferred.display_name}` : ""} · {formatDate(r.created_at, null, true)}
                </p>
                <p className="mt-1 whitespace-pre-line text-ink-muted">{r.reason}</p>
                {enrollment ? <p className="mt-1"><Link href={`/admin/purchases/${enrollment.purchase_id}`} className="underline">View purchase</Link></p> : null}
                <div className="mt-4 grid gap-6 lg:grid-cols-2">
                  <ActionForm action={applyCoachChangeAction} className="grid gap-3">
                    <input type="hidden" name="request_id" value={r.id} />
                    <SelectField name="new_provider_id" label="New coach" required defaultValue={preferred?.id ?? ""} options={coachOptions} />
                    <SelectField
                      name="history_scope"
                      label="What the new coach can see from before"
                      required
                      defaultValue="programme_and_logs"
                      options={[
                        { value: "programme_and_logs", label: "Training programme and logs" },
                        { value: "none", label: "Nothing from before" },
                        { value: "full", label: "Everything, including progress photos — only with the customer's agreement" },
                      ]}
                    />
                    <TextField name="effective_at" label="Takes effect (UTC)" type="datetime-local" required={false} defaultValue={localNow} />
                    <TextArea name="note" label="Note" required rows={2} maxLength={1000} />
                    <div><SubmitButton pendingLabel="Applying…">Change coach</SubmitButton></div>
                  </ActionForm>
                  <ActionForm action={declineCoachChangeAction} className="grid content-start gap-3">
                    <input type="hidden" name="request_id" value={r.id} />
                    <TextArea name="note" label="Why declined" required rows={2} maxLength={1000} />
                    <div><SubmitButton pendingLabel="Declining…" variant="secondary">Decline</SubmitButton></div>
                  </ActionForm>
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Decided" id="closed">
        <DataTable
          caption="Decided requests"
          head={["Decided", "Outcome", "From", "To", "Shared history", "Note"]}
          empty="None yet."
          rows={(closed ?? []).map((r) => [formatDate(r.decided_at, null, true), r.state, nameOf(r.current as Named), nameOf(r.next as Named), r.history_scope ?? "—", r.decision_note ?? ""])}
        />
      </Panel>
    </div>
  );
}
