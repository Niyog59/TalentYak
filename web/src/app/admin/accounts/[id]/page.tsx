import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton, TextArea } from "@/components/form/fields";
import { AdminHeader, Badge, Details, ErrorNote, Section, Table } from "@/components/admin/ui";
import { PURCHASE_STATE_LABEL, formatDate, formatMinor } from "@/lib/format";
import { categoryLabel, CASE_STATE_LABEL } from "@/lib/support/categories";
import { CURRENT_LEGAL } from "@/lib/legal";
import { setAccountSuspensionAction, setTestAccountAction } from "../../panel-actions";

export const metadata = { title: "Account" };

interface Detail {
  profile: {
    id: string; email: string; full_name: string | null; preferred_name: string | null; role: string; timezone: string | null;
    created_at: string; suspended_at: string | null; suspended_reason: string | null; terms_version: string | null;
    terms_accepted_at: string | null; privacy_version: string | null; display_currency: string | null;
  };
  email_confirmed: boolean;
  mfa_factors: number;
  is_test: boolean;
  on_test_list: boolean;
  last_sign_in: string | null;
  provider: { id: string; status: string; display_name: string; slug: string | null; published_at: string | null; suspended_at: string | null; accepting_new_clients: boolean } | null;
  relationships: { id: string; state: string; started_at: string; ended_at: string | null; purchase_id: string | null; coach: string; provider_id: string }[];
  clients_as_coach: number;
  purchases: { id: string; state: string; amount_minor: number; currency: string; created_at: string; paid_through_at: string | null }[];
  support_cases: { id: string; category: string; state: string; created_at: string }[];
  coach_changes: { id: string; state: string; created_at: string }[];
  role_changes: { from: string | null; to: string | null; at: string }[];
}

const ROLE_LABEL: Record<string, string> = { customer: "Client", provider: "Coach", admin: "Administrator" };
const REL_LABEL: Record<string, string> = { active: "Active", paused: "Paused (payment)", pending: "Starting", ended: "Ended" };

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await requireAdmin(`/admin/accounts/${id}`);
  const supabase = (await createClient())!;
  const [{ data, error }, { data: audit }] = await Promise.all([
    supabase.rpc("admin_account_detail", { p_profile: id }),
    supabase.from("admin_audit_log").select("id, action, reason, created_at, before, after, actor:profiles!admin_audit_log_actor_id_fkey(full_name, email)")
      .eq("subject_type", "account").eq("subject_id", id).order("created_at", { ascending: false }).limit(30),
  ]);
  if (error) return <ErrorNote />;
  if (!data) notFound();
  const d = data as Detail;
  const p = d.profile;
  const tz = session.profile.timezone;
  const onboarded = p.terms_version === CURRENT_LEGAL.termsVersion && p.privacy_version === CURRENT_LEGAL.privacyVersion && Boolean(p.timezone);
  const isSelf = p.id === session.userId;

  return (
    <div>
      <AdminHeader
        eyebrow={<Link href="/admin/accounts" className="underline underline-offset-4">Accounts</Link>}
        title={p.full_name || p.email}
        actions={
          <div className="flex flex-wrap gap-2">
            {p.suspended_at ? <Badge tone="bad">Suspended</Badge> : <Badge tone="good">Active</Badge>}
            <Badge>{ROLE_LABEL[p.role] ?? p.role}</Badge>
            {d.provider ? <Badge tone="info">Coach profile</Badge> : null}
            {d.is_test ? <Badge tone="warn">Test account</Badge> : null}
          </div>
        }
      >
        <p className="break-all">{p.email}</p>
      </AdminHeader>

      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <Section title="Account" id="account">
          <Details
            items={[
              ["Joined", formatDate(p.created_at, tz, true)],
              ["Email confirmed", d.email_confirmed ? "Yes" : "No"],
              ["Two-step verification", d.mfa_factors ? `On (${d.mfa_factors} device${d.mfa_factors === 1 ? "" : "s"})` : "Off"],
              ["Last sign-in", d.last_sign_in ? formatDate(d.last_sign_in, tz, true) : "Not recorded (counting began with M17)"],
              ["Onboarding", onboarded ? "Complete" : "Not finished — terms, privacy notice or timezone missing"],
              ["Timezone", p.timezone ?? "Not set"],
              ["Price display preference", p.display_currency ?? "Not set (display only, never the charge currency)"],
              ...(p.suspended_at ? [["Suspended", `${formatDate(p.suspended_at, tz, true)} — ${p.suspended_reason ?? "no reason recorded"}`] as [string, string]] : []),
            ]}
          />
          <p className="mt-4 rounded-lg bg-paper-raised px-3 py-2 text-[0.875rem] text-ink-muted">
            TalentYak can&rsquo;t see this person&rsquo;s health records, tracking values, check-in answers, messages or photos from here. A
            conversation can only be read under a support case, with a recorded reason.
          </p>
        </Section>

        <div>
          <Section title="Actions" id="actions">
            {isSelf ? (
              <p className="text-ink-muted">This is your own account. Change your sign-in details on <Link href="/account/security" className="text-brand underline">Sign-in security</Link>.</p>
            ) : p.role === "admin" ? (
              <p className="text-ink-muted">Administrator accounts are changed only through the founder-access process in the operating guide, never from here.</p>
            ) : d.provider && d.provider.status !== "retired" ? (
              <p className="text-ink-muted">
                This is a coach. Suspend, reinstate or retire them from their <Link href={`/admin/coaches/${d.provider.id}`} className="text-brand underline">coach page</Link>, which also closes their profile and sales and shows the clients who need reassigning.
              </p>
            ) : (
              <ActionForm action={setAccountSuspensionAction} className="grid gap-3">
                <input type="hidden" name="profile_id" value={p.id} />
                <input type="hidden" name="suspend" value={p.suspended_at ? "0" : "1"} />
                <p className="text-[0.9375rem] text-ink-muted">
                  {p.suspended_at
                    ? "Reinstating lets them use their account again. Paid coaching resumes if its paid time hasn't run out."
                    : "Suspending stops them using their account from their next action. Paid coaching pauses, calls close, nothing is deleted and nothing is refunded automatically."}
                </p>
                <TextArea name="reason" label="Reason" required rows={2} maxLength={500} />
                {!p.suspended_at ? <CheckboxField name="confirm" label="I understand the effects above." /> : null}
                <div><SubmitButton variant={p.suspended_at ? "secondary" : "primary"} pendingLabel="Saving…">{p.suspended_at ? "Reinstate account" : "Suspend account"}</SubmitButton></div>
              </ActionForm>
            )}
          </Section>

          <Section title="Test account" id="test">
            <ActionForm action={setTestAccountAction} className="grid gap-3">
              <input type="hidden" name="profile_id" value={p.id} />
              <input type="hidden" name="member" value={d.on_test_list ? "0" : "1"} />
              <p className="text-[0.9375rem] text-ink-muted">
                {d.on_test_list
                  ? "On the test list: features set to “test accounts only” work for this account, and its activity is left out of the overview."
                  : d.is_test
                    ? "Uses a reserved test address, so it's already left out of the overview. Add it to the test list to use “test accounts only” features."
                    : "Not a test account. Adding it lets it use features set to “test accounts only” and leaves its activity out of the overview."}
              </p>
              <TextArea name="reason" label="Reason" required rows={2} maxLength={500} />
              <div><SubmitButton variant="secondary" pendingLabel="Saving…">{d.on_test_list ? "Remove from test list" : "Add to test list"}</SubmitButton></div>
            </ActionForm>
          </Section>
        </div>
      </div>

      {d.provider ? (
        <Section title="Coach profile" id="coach">
          <Details
            items={[
              ["Coach page", <Link key="c" href={`/admin/coaches/${d.provider.id}`} className="text-brand underline">{d.provider.display_name}</Link>],
              ["Status", d.provider.suspended_at ? "Suspended" : d.provider.status],
              ["Public profile", d.provider.published_at ? `Published${d.provider.slug ? ` at /coaches/${d.provider.slug}` : ""}` : "Not published"],
              ["New clients", d.provider.accepting_new_clients ? "Accepting" : "Not accepting"],
              ["Current clients", String(d.clients_as_coach)],
            ]}
          />
        </Section>
      ) : null}

      <Section title="Coaching relationships (as a client)" id="relationships">
        <Table
          caption="Coaching relationships"
          head={["Coach", "State", "Started", "Ended", ""]}
          empty="No coaching bought."
          rows={d.relationships.map((r) => [
            <Link key="c" href={`/admin/coaches/${r.provider_id}`} className="text-brand underline-offset-4 hover:underline">{r.coach}</Link>,
            <Badge key="s" tone={r.state === "active" ? "good" : r.state === "paused" ? "warn" : "neutral"}>{REL_LABEL[r.state] ?? r.state}</Badge>,
            formatDate(r.started_at, tz),
            r.ended_at ? formatDate(r.ended_at, tz) : "—",
            r.purchase_id ? <Link key="p" href={`/admin/purchases/${r.purchase_id}`} className="text-brand underline">Purchase</Link> : "—",
          ])}
        />
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Purchases" id="purchases">
          <Table
            caption="Purchases"
            head={["Bought", "Amount", "State", "Paid until"]}
            empty="None."
            rows={d.purchases.map((pu) => [
              <Link key="p" href={`/admin/purchases/${pu.id}`} className="text-brand underline-offset-4 hover:underline">{formatDate(pu.created_at, tz)}</Link>,
              formatMinor(pu.amount_minor, pu.currency),
              PURCHASE_STATE_LABEL[pu.state] ?? pu.state,
              pu.paid_through_at ? formatDate(pu.paid_through_at, tz) : "—",
            ])}
          />
        </Section>
        <Section title="Support and coach changes" id="cases">
          <Table
            caption="Support cases and coach change requests"
            head={["Opened", "What", "State"]}
            empty="None."
            rows={[
              ...d.support_cases.map((c) => [
                formatDate(c.created_at, tz),
                <Link key="c" href={`/admin/support/${c.id}`} className="text-brand underline-offset-4 hover:underline">{categoryLabel(c.category)}</Link>,
                CASE_STATE_LABEL[c.state] ?? c.state,
              ]),
              ...d.coach_changes.map((c) => [formatDate(c.created_at, tz), <Link key="x" href="/admin/coach-changes" className="text-brand underline-offset-4 hover:underline">Coach change request</Link>, c.state]),
            ]}
          />
        </Section>
      </div>

      <Section title="History" id="history" description="Changes TalentYak made to this account, and role changes.">
        <Table
          caption="Account history"
          head={["When", "What", "By", "Reason"]}
          empty="Nothing recorded."
          rows={[
            ...(audit ?? []).map((a) => {
              const actor = (Array.isArray(a.actor) ? a.actor[0] : a.actor) as { full_name: string | null; email: string } | null;
              return [formatDate(a.created_at, tz, true), a.action.replace(".", " → ").replaceAll("_", " "), actor?.full_name || actor?.email || "—", a.reason ?? ""];
            }),
            ...d.role_changes.map((r) => [formatDate(r.at, tz, true), `Role ${r.from ?? "none"} → ${r.to ?? "none"}`, "System", ""]),
          ]}
        />
      </Section>
    </div>
  );
}
