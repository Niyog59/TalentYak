import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SelectField, SubmitButton, TextArea, TextField } from "@/components/form/fields";
import { DataTable, Facts, PageHeader, Panel, StatusPill } from "@/components/ui/panel";
import { OFFER_STATUS_LABEL, PROVIDER_STATUS_LABEL, formatDate, formatMinor } from "@/lib/format";
import { coachPhotoUrl } from "@/lib/storage/photos";
import {
  adjustmentAction,
  capacityCeilingAction,
  providerStatusAction,
  reviewDestinationAction,
  reviewPhotoAction,
} from "../../actions";

export const metadata = { title: "Coach" };

const ACTIONS_FOR: Record<string, { value: string; label: string; needsReason: boolean }[]> = {
  submitted: [
    { value: "start_review", label: "Start review", needsReason: false },
    { value: "approve", label: "Approve", needsReason: false },
    { value: "return_to_onboarding", label: "Return for changes", needsReason: true },
  ],
  in_review: [
    { value: "approve", label: "Approve", needsReason: false },
    { value: "return_to_onboarding", label: "Return for changes", needsReason: true },
  ],
  approved: [
    { value: "suspend", label: "Suspend", needsReason: true },
    { value: "retire", label: "Retire", needsReason: true },
  ],
  suspended: [
    { value: "reinstate", label: "Reinstate", needsReason: false },
    { value: "retire", label: "Retire", needsReason: true },
  ],
  onboarding: [{ value: "retire", label: "Retire", needsReason: true }],
};

export default async function AdminCoachPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`/admin/coaches/${id}`);
  const supabase = (await createClient())!;

  const { data: provider } = await supabase
    .from("providers")
    .select("id, display_name, slug, status, published_at, accepting_new_clients, max_active_clients, capacity_ceiling, capacity_restriction_reason, timezone, created_at, approved_at, suspended_at")
    .eq("id", id)
    .maybeSingle();
  if (!provider) notFound();

  const [{ data: profile }, { data: events }, { data: destinations }, { data: offers }, { data: credentials }, { data: balances }] = await Promise.all([
    supabase.from("provider_public_profiles").select("display_name, headline, bio, approach, specialties, languages, photo_path, photo_pending_path, photo_pending_at").eq("provider_id", id).maybeSingle(),
    supabase.from("provider_status_events").select("action, from_status, to_status, reason, created_at").eq("provider_id", id).order("created_at", { ascending: false }).limit(30),
    supabase.rpc("admin_payout_destinations", { p_provider_id: id }),
    supabase.from("offers").select("id, status, offer_versions(version, title, published_at, superseded_at, offer_prices(currency, amount_minor))").eq("provider_id", id),
    supabase.from("provider_credentials").select("id, kind, claimed_title, issuing_body, verification_state, created_at").eq("provider_id", id),
    supabase.from("coach_balances").select("*").eq("provider_id", id),
  ]);

  let pendingPhoto: string | null = null;
  if (profile?.photo_pending_path) {
    const { data } = await createAdminClient()!.storage.from("coach-photos-pending").createSignedUrl(profile.photo_pending_path, 300);
    pendingPhoto = data?.signedUrl ?? null;
  }
  const actions = ACTIONS_FOR[provider.status] ?? [];
  const currentDestination = ((destinations ?? []) as { id: string; channel: string; masked_reference: string; account_holder_name: string | null; country: string | null; currency: string; review_state: string; created_at: string; superseded_at: string | null }[]).find((d) => !d.superseded_at);

  return (
    <div>
      <p><Link href="/admin/coaches" className="text-brand underline underline-offset-4">← All coaches</Link></p>
      <PageHeader title={provider.display_name}>
        <StatusPill tone={provider.status === "approved" ? "good" : provider.status === "suspended" ? "bad" : "neutral"}>{PROVIDER_STATUS_LABEL[provider.status]}</StatusPill>{" "}
        {provider.published_at && provider.slug ? <Link href={`/coaches/${provider.slug}`} className="underline">Public page</Link> : "Not public"}
      </PageHeader>

      <Panel title="Profile" id="profile">
        <Facts
          items={[
            ["Headline", profile?.headline ?? "—"],
            ["About", <span key="b" className="whitespace-pre-line">{profile?.bio ?? "—"}</span>],
            ["Approach", <span key="a" className="whitespace-pre-line">{profile?.approach ?? "—"}</span>],
            ["Specialties", (profile?.specialties ?? []).join(", ") || "—"],
            ["Languages", (profile?.languages ?? []).join(", ") || "—"],
            ["Timezone", provider.timezone ?? "—"],
            ["Joined", formatDate(provider.created_at, null)],
            ["Approved", formatDate(provider.approved_at, null)],
          ]}
        />
        {coachPhotoUrl(profile?.photo_path) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coachPhotoUrl(profile?.photo_path)!} alt={`Current photo of ${provider.display_name}`} width={120} height={120} className="mt-4 size-30 rounded-xl object-cover" />
        ) : null}
      </Panel>

      <Panel title="Review" id="review" description="Approval lets the coach publish their own profile, plans and prices. Suspension hides them and closes new sign-ups immediately.">
        {actions.length === 0 ? (
          <p className="text-ink-muted">No review actions for a coach who is {PROVIDER_STATUS_LABEL[provider.status]?.toLowerCase()}.</p>
        ) : (
          <ActionForm action={providerStatusAction} className="grid gap-4 sm:max-w-lg">
            <input type="hidden" name="provider_id" value={provider.id} />
            <SelectField name="action" label="Action" required options={actions.map((a) => ({ value: a.value, label: a.label }))} />
            <TextArea name="reason" label="Reason" required={false} rows={3} maxLength={1000} help="Required to return, suspend or retire. Recorded in the history below." />
            <div><SubmitButton pendingLabel="Saving…">Apply</SubmitButton></div>
          </ActionForm>
        )}
        <h3 className="mt-6 font-semibold">History</h3>
        <DataTable
          caption="Status history"
          head={["When", "Action", "Change", "Reason"]}
          empty="No history."
          rows={(events ?? []).map((e) => [formatDate(e.created_at, null, true), e.action, `${e.from_status ?? "—"} → ${e.to_status ?? "—"}`, e.reason ?? ""])}
        />
      </Panel>

      <Panel title="Photo waiting for review" id="photo">
        {pendingPhoto ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pendingPhoto} alt={`Photo submitted by ${provider.display_name}`} width={200} height={200} className="size-50 rounded-xl object-cover" />
            <p className="mt-2 text-sm text-ink-muted">Uploaded {formatDate(profile?.photo_pending_at, null, true)}. Check it is a clear photo of the coach and nothing else.</p>
            <div className="mt-4 flex flex-wrap gap-6">
              <ActionForm action={reviewPhotoAction}>
                <input type="hidden" name="provider_id" value={provider.id} />
                <input type="hidden" name="decision" value="approve" />
                <SubmitButton pendingLabel="Approving…">Approve photo</SubmitButton>
              </ActionForm>
              <ActionForm action={reviewPhotoAction} className="grid gap-3 sm:max-w-md">
                <input type="hidden" name="provider_id" value={provider.id} />
                <input type="hidden" name="decision" value="reject" />
                <TextField name="note" label="Why not" required maxLength={500} />
                <div><SubmitButton pendingLabel="Rejecting…" variant="secondary">Reject photo</SubmitButton></div>
              </ActionForm>
            </div>
          </>
        ) : (
          <p className="text-ink-muted">Nothing waiting.</p>
        )}
      </Panel>

      <Panel title="Capacity" id="capacity" description="The coach sets their own capacity. Set a maximum only when there's a reason, such as a quality concern. It can't go below their current clients.">
        <p>
          Coach&rsquo;s limit: {provider.max_active_clients ?? "none"} · Accepting new clients: {provider.accepting_new_clients ? "yes" : "no"}
          {provider.capacity_ceiling ? ` · Your maximum: ${provider.capacity_ceiling} (${provider.capacity_restriction_reason ?? "no reason recorded"})` : ""}
        </p>
        <ActionForm action={capacityCeilingAction} className="mt-4 grid gap-4 sm:max-w-lg">
          <input type="hidden" name="provider_id" value={provider.id} />
          <TextField name="ceiling" label="Maximum clients" required={false} inputMode="numeric" defaultValue={provider.capacity_ceiling?.toString() ?? ""} help="Leave empty to remove your maximum." />
          <TextArea name="reason" label="Reason" required rows={2} maxLength={1000} />
          <div><SubmitButton pendingLabel="Saving…" variant="secondary">Save maximum</SubmitButton></div>
        </ActionForm>
      </Panel>

      <Panel title="Payout details" id="payout" description="Only the last characters are shown. The full reference is revealed one payout at a time, and each reveal is logged.">
        {currentDestination ? (
          <>
            <Facts
              items={[
                ["Method", currentDestination.channel],
                ["Account", currentDestination.masked_reference],
                ["Holder", currentDestination.account_holder_name ?? "—"],
                ["Country / currency", `${currentDestination.country ?? "—"} / ${currentDestination.currency}`],
                ["Status", currentDestination.review_state.replace("_", " ")],
                ["Added", formatDate(currentDestination.created_at, null, true)],
              ]}
            />
            {currentDestination.review_state === "pending_review" ? (
              <div className="mt-4 flex flex-wrap gap-3">
                {(["approved", "rejected"] as const).map((decision) => (
                  <ActionForm key={decision} action={reviewDestinationAction}>
                    <input type="hidden" name="provider_id" value={provider.id} />
                    <input type="hidden" name="destination_id" value={currentDestination.id} />
                    <input type="hidden" name="decision" value={decision} />
                    <SubmitButton pendingLabel="Saving…" variant={decision === "approved" ? "primary" : "secondary"}>
                      {decision === "approved" ? "Mark as checked" : "Reject"}
                    </SubmitButton>
                  </ActionForm>
                ))}
              </div>
            ) : null}
            <p className="mt-3 text-sm text-ink-muted">You can&rsquo;t approve details you entered yourself for your own coach account.</p>
          </>
        ) : (
          <p className="text-ink-muted">No payout details entered.</p>
        )}
      </Panel>

      <Panel title="Plans" id="plans">
        <DataTable
          caption="Plans"
          head={["Plan", "Status", "Live version", "Prices"]}
          empty="No plans."
          rows={(offers ?? []).map((o) => {
            const live = (o.offer_versions ?? []).find((v) => v.published_at && !v.superseded_at);
            const latest = [...(o.offer_versions ?? [])].sort((a, b) => b.version - a.version)[0];
            return [
              (live ?? latest)?.title ?? "—",
              OFFER_STATUS_LABEL[o.status] ?? o.status,
              live ? `v${live.version}` : "—",
              live ? live.offer_prices.map((p) => formatMinor(p.amount_minor, p.currency)).join(" / ") : "—",
            ];
          })}
        />
      </Panel>

      <Panel title="Credentials" id="credentials" description="What the coach says they hold, and what has been checked.">
        <DataTable
          caption="Credentials"
          head={["Credential", "Issued by", "Checked"]}
          empty="None added."
          rows={(credentials ?? []).map((c) => [c.claimed_title, c.issuing_body ?? "—", c.verification_state])}
        />
      </Panel>

      <Panel title="Earnings and adjustments" id="money">
        <DataTable
          caption="Balances"
          head={["Currency", "Pending", "Held", "Ready", "In payout", "Paid"]}
          empty="No earnings."
          rows={(balances ?? []).map((b) => [b.currency, formatMinor(b.pending_minor, b.currency), formatMinor(b.held_minor, b.currency), formatMinor(b.eligible_minor, b.currency), formatMinor(b.batched_minor, b.currency), formatMinor(b.paid_minor, b.currency)])}
        />
        <details className="mt-5">
          <summary className="cursor-pointer font-semibold">Record a manual adjustment</summary>
          <ActionForm action={adjustmentAction} className="mt-4 grid gap-4 sm:max-w-lg">
            <input type="hidden" name="provider_id" value={provider.id} />
            <input type="hidden" name="idempotency_key" value={crypto.randomUUID()} />
            <SelectField name="currency" label="Currency" required options={["USD", "GBP", "EUR", "AUD", "CAD", "NZD"].map((c) => ({ value: c, label: c }))} />
            <TextField name="amount" label="Amount" required inputMode="decimal" help="Positive adds to what the coach is owed; negative (e.g. -25) deducts." />
            <TextArea name="reason" label="Reason" required rows={2} maxLength={1000} />
            <CheckboxField name="confirm" required label="I understand this is a permanent ledger entry." />
            <div><SubmitButton pendingLabel="Recording…" variant="secondary">Record adjustment</SubmitButton></div>
          </ActionForm>
        </details>
      </Panel>
    </div>
  );
}
