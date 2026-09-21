import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton, TextField } from "@/components/form/fields";
import { DataTable, PageHeader, Panel } from "@/components/ui/panel";
import { formatDate } from "@/lib/format";
import { placeRetentionHoldAction, releaseRetentionHoldAction } from "../actions";

export const metadata = { title: "Data and retention" };

/*
 * What the retention rules WOULD do, and the controls that stop them.
 *
 * There is no delete button on this page, and there cannot be one yet: no
 * executor exists, the destructive switch is off, and every policy is a
 * proposal. This screen exists so the blast radius of a proposed rule can be
 * seen before anyone approves it, and so a hold can be placed on somebody
 * without waiting for that day.
 */

interface DryRunRow {
  resource_id: string;
  profile_id: string;
  eligible_at: string;
  already_tracked: boolean;
}

export default async function AdminRetentionPage() {
  await requireAdmin("/admin/retention");
  const supabase = (await createClient())!;

  const [{ data: settings }, { data: policies }, { data: candidates }, { data: notices }, { data: requests }] =
    await Promise.all([
      supabase.from("retention_settings").select("destructive_execution_enabled").maybeSingle(),
      supabase.from("retention_policies").select("id, resource_type, retain_days, notice_days, status, note").order("id"),
      supabase
        .from("retention_candidates")
        .select("id, policy_id, resource_type, state, hold_reason, cancelled_reason, deletion_due_at, is_synthetic, last_checked_at")
        .in("state", ["scheduled", "notice_failed", "held"])
        .order("deletion_due_at")
        .limit(100),
      supabase
        .from("retention_notices")
        .select("id, candidate_id, days_before, due_at, state, attempts, last_error")
        .eq("state", "failed")
        .order("due_at", { ascending: false })
        .limit(50),
      supabase
        .from("deletion_requests")
        .select("id, state, requested_at, outcome_note")
        .in("state", ["received", "in_review"])
        .order("requested_at"),
    ]);

  // The dry run creates nothing. It is the only honest way to present a
  // proposed rule: here is who it would catch today.
  const dryRun = await supabase.rpc("retention_dry_run", { p_policy_id: "retention.media.v1" });
  const wouldCatch = ((dryRun.data ?? []) as DryRunRow[]);
  const people = new Set(wouldCatch.map((r) => r.profile_id)).size;

  const destructive = settings?.destructive_execution_enabled === true;

  return (
    <div>
      <PageHeader title="Data and retention">
        What the proposed retention rules would affect, and the holds that stop them. Nothing on this
        page deletes anything.
      </PageHeader>

      <Panel title="Automatic deletion" id="switch">
        <p className="font-semibold">{destructive ? "On" : "Off."}</p>
        <p className="mt-1 text-ink-muted">
          {destructive
            ? "The switch is on, but no deletion job exists yet. Nothing will be removed until one is built against an approved policy."
            : "Nothing is deleted on a schedule. Turning this on is a decision, and it has no effect until a retention policy is approved and a deletion job is built and reviewed."}
        </p>
      </Panel>

      <Panel
        title="Proposed rules"
        id="policies"
        description="None of these is approved. The periods are placeholders written for discussion, not policy."
      >
        <DataTable
          caption="Retention policies"
          head={["Rule", "Applies to", "Kept for", "Notice before", "Status"]}
          empty="No policies."
          rows={(policies ?? []).map((p) => [
            p.id,
            p.resource_type,
            `${p.retain_days} days`,
            (p.notice_days as number[]).map((d) => `${d}d`).join(", "),
            p.status,
          ])}
        />
      </Panel>

      <Panel
        title="Dry run: photos and clips"
        id="dry-run"
        description="Who the proposed media rule would catch if it were approved today. Computed on the spot; nothing is scheduled and nobody is told."
      >
        {dryRun.error ? (
          <p className="text-danger">The dry run couldn&rsquo;t be computed: {dryRun.error.message}</p>
        ) : (
          <p>
            <span className="font-display text-3xl">{wouldCatch.length}</span>{" "}
            {wouldCatch.length === 1 ? "file" : "files"} belonging to {people}{" "}
            {people === 1 ? "person" : "people"} would be past the proposed period.
            {wouldCatch.some((r) => r.already_tracked) ? " Some are already being tracked." : ""}
          </p>
        )}
      </Panel>

      <Panel
        title="Tracked items"
        id="candidates"
        description="Re-checked by the daily sweep. Anything no longer eligible — a returning customer, a file its owner already deleted — is let off automatically. A hold outranks the schedule and is only ever released by a person."
      >
        <DataTable
          caption="Retention candidates"
          head={["Due", "Rule", "State", "Detail", ""]}
          empty="Nothing is being tracked."
          rows={(candidates ?? []).map((c) => [
            formatDate(c.deletion_due_at, null),
            `${c.policy_id}${c.is_synthetic ? " (test)" : ""}`,
            c.state === "notice_failed" ? "notice not delivered — clock stopped" : c.state,
            c.hold_reason ?? (c.last_checked_at ? `checked ${formatDate(c.last_checked_at, null, true)}` : "—"),
            c.state === "held" ? (
              <ActionForm key="r" action={releaseRetentionHoldAction}>
                <input type="hidden" name="candidate_id" value={c.id} />
                <SubmitButton variant="quiet" pendingLabel="Releasing…">Release hold</SubmitButton>
              </ActionForm>
            ) : (
              <ActionForm key="h" action={placeRetentionHoldAction} className="grid min-w-56 gap-2">
                <input type="hidden" name="candidate_id" value={c.id} />
                <TextField name="reason" label="Reason for hold" maxLength={500} />
                <div><SubmitButton variant="secondary" pendingLabel="Holding…">Hold</SubmitButton></div>
              </ActionForm>
            ),
          ])}
        />
      </Panel>

      <Panel
        title="Notices that did not arrive"
        id="failed-notices"
        description="An advance notice that failed stops the clock for that item. Nobody is deleted on the strength of a warning they never received."
      >
        <DataTable
          caption="Failed retention notices"
          head={["Was due", "Days before", "Attempts", "Error"]}
          empty="No failed notices."
          rows={(notices ?? []).map((n) => [
            formatDate(n.due_at, null, true),
            String(n.days_before),
            String(n.attempts),
            <span key="e" className="break-all text-xs">{(n.last_error ?? "").slice(0, 200)}</span>,
          ])}
        />
      </Panel>

      <Panel
        title="Deletion requests"
        id="requests"
        description="People asking for their data to be removed. Separate from retention: not on a clock, and not waiting for a policy. Payment records are kept by law and anonymised."
      >
        <DataTable
          caption="Open deletion requests"
          head={["Received", "State", "Note"]}
          empty="No open requests."
          rows={(requests ?? []).map((r) => [
            formatDate(r.requested_at, null, true),
            r.state,
            <span key="n" className="text-sm">{r.outcome_note ?? "—"}</span>,
          ])}
        />
      </Panel>
    </div>
  );
}
