import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton, TextArea, TextField } from "@/components/form/fields";
import { AdminHeader, Badge, Details, ErrorNote, Section, Table } from "@/components/admin/ui";
import { formatDate, formatMinor } from "@/lib/format";
import { MODE_LABEL } from "@/lib/features/registry";
import { featureMode } from "@/lib/features/server";
import { HISTORY_CHOICES } from "@/components/coach-change/request-panel";
import { applyCoachChangeAction, declineCoachChangeAction } from "../actions";

export const metadata = { title: "Coach changes" };

type Named = { display_name: string } | { display_name: string }[] | null;
const nameOf = (v: Named) => (Array.isArray(v) ? v[0]?.display_name : v?.display_name) ?? "—";
const RANK: Record<string, number> = { none: 0, programme_and_logs: 1, full: 2 };

interface Preview {
  relationship_state: string;
  paid_through_at: string | null;
  purchase_state: string;
  charge_amount_minor: number;
  charge_currency: string;
  calls_included_per_month: number | null;
  upcoming_sessions: number;
  pending_requests: number;
  weekly_series: number;
  unfinished_reviews: number;
  unfinished_reviews_with_attachments: number;
  open_checkin_requests: number;
  published_plans: number;
  unfinished_period_earnings: { currency: string; amount_minor: number; entries: number }[];
  preferred_eligible: boolean | null;
}

interface Candidate { provider_id: string; display_name: string; eligible: boolean; accepting: boolean; commitments: number; capacity: number | null }

export default async function AdminCoachChangesPage() {
  const session = await requireAdmin("/admin/coach-changes");
  const supabase = (await createClient())!;
  const tz = session.profile.timezone;

  const [{ data: open, error }, { data: closed }, mode, { data: prereq }] = await Promise.all([
    supabase
      .from("coach_change_requests")
      .select("id, enrollment_id, customer_id, reason, created_at, consented_history_scope, preferred_provider_id, current:providers!coach_change_requests_current_provider_id_fkey(display_name), preferred:providers!coach_change_requests_preferred_provider_id_fkey(display_name), customer:profiles!coach_change_requests_customer_id_fkey(full_name, email)")
      .eq("state", "requested")
      .order("created_at"),
    supabase
      .from("coach_change_requests")
      .select("id, state, decided_at, withdrawn_at, decision_note, history_scope, current:providers!coach_change_requests_current_provider_id_fkey(display_name), next:providers!coach_change_requests_new_provider_id_fkey(display_name)")
      .neq("state", "requested")
      .order("created_at", { ascending: false })
      .limit(50),
    featureMode("coach_changing"),
    supabase.from("feature_prerequisites").select("description, resolved").eq("key", "coach_change_money_policy").maybeSingle(),
  ]);

  const details = await Promise.all(
    (open ?? []).map(async (r) => {
      const [{ data: preview }, { data: candidates }] = await Promise.all([
        supabase.rpc("admin_coach_change_preview", { p_request: r.id, p_new_provider: null }),
        supabase.rpc("admin_coach_change_candidates", { p_request: r.id }),
      ]);
      return { preview: preview as Preview | null, candidates: (candidates ?? []) as Candidate[] };
    }),
  );

  return (
    <div>
      <AdminHeader eyebrow="People" title="Coach changes">
        <p>
          Clients asking to move to another coach. Nothing changes for them until you apply a change here; then the move happens all at
          once. Changing coach is currently <strong className="text-ink">{MODE_LABEL[mode].toLowerCase()}</strong> for clients —{" "}
          <Link href="/admin/features?change=coach_changing#coach_changing" className="text-brand underline">feature controls</Link>. Requests
          already made are decided here whatever that setting is.
        </p>
      </AdminHeader>

      {prereq && !prereq.resolved ? (
        <div role="note" className="mt-6 rounded-xl border border-amber-800/25 bg-amber-50 p-4 text-[0.9375rem]">
          <p className="font-semibold text-amber-950">Money rules for a coach change are not decided yet</p>
          <p className="mt-1 text-amber-950/90">
            {prereq.description} Until you decide: the client keeps their current price, billing and paid dates; the new coach takes over
            the rest of the paid period; earnings for the part-finished period are held for you to split (shown as a finance exception);
            and no refund or credit happens unless you make one with the refund tool. Changing coach can&rsquo;t be switched on for real clients
            until this is settled.
          </p>
        </div>
      ) : null}

      <Section id="open" title={`Waiting for a decision · ${(open ?? []).length}`}>
        {error ? <ErrorNote /> : (open ?? []).length === 0 ? <p className="text-ink-muted">No open requests.</p> : null}
        <ol className="-mx-5 -my-4 divide-y divide-line">
          {(open ?? []).map((r, i) => {
            const { preview: p, candidates } = details[i];
            const cap = r.consented_history_scope ?? "programme_and_logs";
            const customer = (Array.isArray(r.customer) ? r.customer[0] : r.customer) as { full_name: string | null; email: string } | null;
            const scopes = HISTORY_CHOICES.filter((c) => RANK[c.value] <= RANK[cap]);
            const eligible = candidates.filter((c) => c.eligible);
            return (
              <li key={r.id} className="px-5 py-6">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="text-lg font-semibold">
                    <Link href={`/admin/accounts/${r.customer_id}`} className="text-brand underline-offset-4 hover:underline">{customer?.full_name || customer?.email || "Client"}</Link>{" "}
                    <span className="font-normal text-ink-muted">wants to leave {nameOf(r.current as Named)}</span>
                  </h3>
                  <span className="text-[0.9375rem] text-ink-muted">Asked {formatDate(r.created_at, tz, true)}</span>
                </div>
                <p className="mt-2 whitespace-pre-line rounded-lg bg-paper-raised px-3 py-2">{r.reason}</p>

                <div className="mt-4 grid gap-6 lg:grid-cols-2">
                  <div>
                    <h4 className="font-semibold">Their choices</h4>
                    <Details
                      items={[
                        ["Asked for", r.preferred_provider_id ? <span key="p" className="flex flex-wrap items-center gap-2">{nameOf(r.preferred as Named)} {p?.preferred_eligible ? <Badge tone="good">Can take them now</Badge> : <Badge tone="bad">Can&rsquo;t take them now</Badge>}</span> : "TalentYak to suggest"],
                        ["May see from before", r.consented_history_scope ? HISTORY_CHOICES.find((c) => c.value === r.consented_history_scope)?.label ?? r.consented_history_scope : "Not asked (older request): training and logs at most, never photos"],
                      ]}
                    />
                    <h4 className="mt-4 font-semibold">What applying it would touch</h4>
                    {!p ? (
                      <ErrorNote>The impact couldn&rsquo;t be measured. Don&rsquo;t apply until it can.</ErrorNote>
                    ) : (
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-[0.9375rem]">
                        <li>Plan: {formatMinor(p.charge_amount_minor, p.charge_currency)}, {p.purchase_state}{p.paid_through_at ? `, paid until ${formatDate(p.paid_through_at, tz)}` : ""}. Price and billing stay as they are.</li>
                        <li>{p.upcoming_sessions} upcoming session{p.upcoming_sessions === 1 ? "" : "s"} with the current coach: cancelled when the change takes effect, both told.</li>
                        <li>{p.pending_requests} session request{p.pending_requests === 1 ? "" : "s"} waiting and {p.weekly_series} weekly series: withdrawn / ended.</li>
                        <li>{p.unfinished_reviews} check-in{p.unfinished_reviews === 1 ? "" : "s"} waiting for feedback ({p.unfinished_reviews_with_attachments} with attachments): move to the new coach only if the sharing choice covers them, otherwise flagged for you. {p.open_checkin_requests} unsent request(s) closed, drafts kept.</li>
                        <li>{p.published_plans} published plan{p.published_plans === 1 ? "" : "s"}: stay credited to the current coach; the new coach may read them within the sharing choice and start their own from a copy.</li>
                        <li>Private conversation: never shared. The new coach starts a new, empty one; the client keeps the old one to read.</li>
                        <li>The current coach loses access to this client&rsquo;s records and private photos from the moment it takes effect.</li>
                        <li>
                          Earnings for the part-finished paid period:{" "}
                          {p.unfinished_period_earnings.length
                            ? `${p.unfinished_period_earnings.map((e) => formatMinor(e.amount_minor, e.currency)).join(", ")} held for you to split between the coaches.`
                            : "none to hold."}{" "}
                          Delivered periods stay with the current coach.
                        </li>
                        {p.calls_included_per_month ? <li>{String(p.calls_included_per_month)} calls a month carry on with the new coach from the same paid period.</li> : null}
                      </ul>
                    )}
                  </div>

                  <div className="grid content-start gap-6">
                    <ActionForm action={applyCoachChangeAction} className="grid gap-3 rounded-xl border border-line-strong p-4">
                      <input type="hidden" name="request_id" value={r.id} />
                      <label className="grid gap-1 font-semibold" htmlFor={`coach-${r.id}`}>
                        New coach
                        <select id={`coach-${r.id}`} name="new_provider_id" required defaultValue={r.preferred_provider_id && p?.preferred_eligible ? r.preferred_provider_id : ""} className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 font-normal">
                          <option value="">Choose a coach who can take them now</option>
                          {candidates.map((c) => (
                            <option key={c.provider_id} value={c.provider_id} disabled={!c.eligible}>
                              {c.display_name}{c.eligible ? ` (${c.commitments}${c.capacity ? ` of ${c.capacity}` : ""} places used)` : c.accepting ? " — full, away or a different service" : " — not accepting new clients"}
                            </option>
                          ))}
                        </select>
                        {eligible.length === 0 ? <span className="text-[0.875rem] font-medium text-danger">No coach can take this client right now.</span> : null}
                      </label>
                      <fieldset className="grid gap-1">
                        <legend className="font-semibold">What the new coach may see from before</legend>
                        {scopes.map((c) => (
                          <label key={c.value} className="flex min-h-10 items-center gap-2">
                            <input type="radio" name="history_scope" value={c.value} required defaultChecked={c.value === cap} className="size-5" />
                            {c.label}
                          </label>
                        ))}
                        <span className="text-[0.875rem] text-ink-muted">Never more than the client agreed to.</span>
                      </fieldset>
                      <TextField name="effective_at" label="Takes effect (UTC)" type="datetime-local" required={false} help="Leave empty to make the change now, when you press Apply." />
                      <TextArea name="note" label="Note (what you agreed with the client and the new coach)" required rows={2} maxLength={1000} />
                      <CheckboxField name="confirm" label="I've confirmed with the client and the new coach, and read what this touches." />
                      <div><SubmitButton pendingLabel="Applying…">Apply coach change</SubmitButton></div>
                    </ActionForm>
                    <ActionForm action={declineCoachChangeAction} className="grid gap-3 rounded-xl border border-line p-4">
                      <input type="hidden" name="request_id" value={r.id} />
                      <TextArea name="note" label="Why declined (what you told the client)" required rows={2} maxLength={1000} />
                      <div><SubmitButton pendingLabel="Declining…" variant="secondary">Decline</SubmitButton></div>
                    </ActionForm>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </Section>

      <Section id="closed" title="Decided and withdrawn">
        <Table
          caption="Decided requests"
          head={["When", "Outcome", "From", "To", "Shared history", "Note"]}
          empty="None yet."
          rows={(closed ?? []).map((r) => [
            formatDate(r.decided_at ?? r.withdrawn_at, tz, true),
            <Badge key="o" tone={r.state === "applied" ? "good" : r.state === "declined" ? "bad" : "neutral"}>{r.state}</Badge>,
            nameOf(r.current as Named),
            nameOf(r.next as Named),
            HISTORY_CHOICES.find((c) => c.value === r.history_scope)?.label ?? "—",
            r.decision_note ?? "",
          ])}
        />
      </Section>
    </div>
  );
}
