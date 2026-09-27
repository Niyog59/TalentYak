import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SelectField, SubmitButton, TextField } from "@/components/form/fields";
import { Notice, PageHeader, Panel } from "@/components/ui/panel";
import { currentSchedulingPolicy } from "@/lib/policy/registry";
import { APPOINTMENT_STATE_LABEL, HOLD_REASON_LABEL, whenIn, type AppointmentState } from "@/lib/scheduling/types";
import { formatMinor } from "@/lib/format";
import { adminCancelAction, resolveConsultationAction, saveSchedulingSettingsAction } from "./actions";

export const metadata = { title: "Scheduling" };
export const dynamic = "force-dynamic";

export default async function AdminSchedulingPage() {
  const session = await requireAdmin("/admin/scheduling");
  const tz = session.profile.timezone ?? "UTC";
  const supabase = (await createClient())!;
  const policy = currentSchedulingPolicy();
  // Per-request server component (force-dynamic): renders once, so the
  // instability the purity rule guards against cannot occur.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  const [{ data: settings }, { data: held }, { data: review }, { data: refused }, { data: upcoming }] = await Promise.all([
    supabase.from("scheduling_settings").select("*").single(),
    supabase.from("appointments").select("id, starts_at, state, state_reason, kind, customer_id, provider_id").eq("state", "on_hold").order("starts_at").limit(50),
    supabase.from("purchases").select("id, customer_id, provider_id, charge_amount_minor, charge_currency, state, review_reason, created_at")
      .eq("service_type", "one_off_consultation").eq("requires_review", true).order("created_at", { ascending: false }).limit(50),
    supabase.from("appointment_proposals").select("id, starts_at, state, state_reason, proposer_role, created_at").eq("state", "conflicted")
      .gte("created_at", new Date(now - 7 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(30),
    supabase.from("appointments").select("id, starts_at, state, kind, customer_id, provider_id").in("state", ["booked", "tentative"])
      .gte("starts_at", new Date(now).toISOString()).order("starts_at").limit(30),
  ]);

  const ids = [...(held ?? []), ...(review ?? []), ...(upcoming ?? [])];
  const [{ data: people }, { data: coaches }] = await Promise.all([
    supabase.from("profiles").select("id, preferred_name, full_name").in("id", [...new Set(ids.map((r) => r.customer_id))]),
    supabase.from("providers").select("id, display_name").in("id", [...new Set(ids.map((r) => r.provider_id))]),
  ]);
  const client = (id: string) => { const p = (people ?? []).find((x) => x.id === id); return p?.preferred_name || p?.full_name || "Client"; };
  const coach = (id: string) => (coaches ?? []).find((x) => x.id === id)?.display_name ?? "Coach";

  return (
    <div>
      <PageHeader title="Scheduling">
        Exceptions that need a person, support actions, and the scheduling timings. Nothing here moves money; refunds go
        through the purchase&rsquo;s refund process.
      </PageHeader>

      <Panel title="Sessions on hold" id="on-hold" description="Paused for payment, suspended, or clashing. The system restores them when it can; the rest need someone.">
        {(held ?? []).length === 0 ? <p className="text-ink-muted">None.</p> : (
          <ul className="grid gap-2">
            {(held ?? []).map((a) => (
              <li key={a.id}>
                <strong>{coach(a.provider_id)}</strong> with {client(a.customer_id)} · {whenIn(a.starts_at, tz)} — {HOLD_REASON_LABEL[a.state_reason ?? ""] ?? a.state_reason}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="One-off sessions paid after their held time lapsed" id="late" description="Nothing was oversold and no money is kept quietly. Reopen it so the client can choose a new time, or refund it from the purchase, then mark it resolved.">
        {(review ?? []).length === 0 ? <p className="text-ink-muted">None.</p> : (
          <ul className="grid gap-4">
            {(review ?? []).map((p) => (
              <li key={p.id} className="rounded-lg border border-line p-3">
                <p><strong>{client(p.customer_id)}</strong> with {coach(p.provider_id)} · {formatMinor(p.charge_amount_minor, p.charge_currency)} · {p.review_reason}</p>
                <p className="text-sm"><Link href={`/admin/purchases/${p.id}`} className="underline">Open the purchase (refunds)</Link></p>
                <ActionForm action={resolveConsultationAction} className="mt-2 grid gap-3 sm:max-w-md">
                  <input type="hidden" name="purchase_id" value={p.id} />
                  <SelectField name="action" label="Action" required options={[
                    { value: "reopen_for_rebooking", label: "Reopen so the client can choose a new time" },
                    { value: "mark_resolved", label: "Mark resolved (for example, after a refund)" },
                  ]} />
                  <TextField name="note" label="Reason" required maxLength={200} />
                  <div><SubmitButton pendingLabel="Saving…">Apply</SubmitButton></div>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Suggestions that couldn't be confirmed (last 7 days)" id="refused">
        {(refused ?? []).length === 0 ? <p className="text-ink-muted">None.</p> : (
          <ul className="grid gap-1 text-sm">
            {(refused ?? []).map((r) => <li key={r.id}>{whenIn(r.starts_at, tz)} · from the {r.proposer_role} · {r.state_reason}</li>)}
          </ul>
        )}
      </Panel>

      <Panel title="Cancel a session on someone's behalf" id="cancel" description="Both people are told, with your reason. It doesn't refund or penalise anyone.">
        {(upcoming ?? []).length === 0 ? <p className="text-ink-muted">No upcoming sessions.</p> : (
          <ul className="grid gap-3">
            {(upcoming ?? []).map((a) => (
              <li key={a.id} className="rounded-lg border border-line p-3">
                <p><strong>{coach(a.provider_id)}</strong> with {client(a.customer_id)} · {whenIn(a.starts_at, tz)} · {APPOINTMENT_STATE_LABEL[a.state as AppointmentState]}{a.kind === "consultation" ? " · one-off" : ""}</p>
                <details className="mt-1">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-brand underline">Cancel this session</summary>
                  <ActionForm action={adminCancelAction} className="mt-2 grid gap-3 sm:max-w-md">
                    <input type="hidden" name="appointment_id" value={a.id} />
                    <TextField name="reason" label="Reason" required maxLength={200} />
                    <div><SubmitButton variant="secondary" pendingLabel="Cancelling…">Cancel session</SubmitButton></div>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Timings" id="timings" description={`${policy.id} — ${policy.status === "sandbox_default" ? "development defaults, not approved rules" : "approved"}. Coaches set their own lengths, gaps, notice and horizon; these are the starting values and the platform-wide timings.`}>
        {settings ? (
          <ActionForm action={saveSchedulingSettingsAction} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="proposal_ttl_hours" label="Unanswered suggestions expire after (hours)" type="number" inputMode="numeric" min={1} max={336} required defaultValue={settings.proposal_ttl_hours} />
              <TextField name="reminder_offsets_minutes" label="Reminders (minutes before, comma-separated)" required defaultValue={(settings.reminder_offsets_minutes as number[]).join(", ")} />
              <TextField name="default_min_notice_hours" label="Default minimum notice (hours)" type="number" inputMode="numeric" min={0} max={168} required defaultValue={Math.round(settings.default_min_notice_minutes / 60)} />
              <TextField name="default_horizon_days" label="Default booking horizon (days)" type="number" inputMode="numeric" min={1} max={180} required defaultValue={settings.default_horizon_days} />
              <TextField name="default_buffer_minutes" label="Default gap after a session (minutes)" type="number" inputMode="numeric" min={0} max={120} required defaultValue={settings.default_buffer_minutes} />
              <TextField name="slot_hold_minutes" label="One-off session time held during checkout (minutes)" type="number" inputMode="numeric" min={31} max={120} required defaultValue={settings.slot_hold_minutes} />
            </div>
            <CheckboxField name="confirm_beyond_paid_through" defaultChecked={settings.confirm_beyond_paid_through}
              label="Confirm sessions after the paid period (off: they stay tentative until the renewal is paid)" />
            <Notice>Changing a value here does not approve it. The policy stays a development default until the founder approves it.</Notice>
            <div><SubmitButton pendingLabel="Saving…">Save</SubmitButton></div>
          </ActionForm>
        ) : null}
      </Panel>
    </div>
  );
}
