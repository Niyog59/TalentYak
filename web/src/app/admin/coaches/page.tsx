import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton, TextField } from "@/components/form/fields";
import { DataTable, PageHeader, Panel, StatusPill } from "@/components/ui/panel";
import { PROVIDER_STATUS_LABEL, formatDate } from "@/lib/format";
import { inviteCoachAction, revokeInvitationAction } from "../actions";

export const metadata = { title: "Coaches" };

const JOB_LABEL: Record<string, string> = {
  pending: "Email queued",
  processing: "Sending",
  done: "Email accepted by the sending service",
  blocked: "Email NOT sent — sending isn't configured",
  failed: "Email failed",
  cancelled: "Email cancelled",
};

export default async function AdminCoachesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin("/admin/coaches");
  const { status } = await searchParams;
  const supabase = (await createClient())!;

  let providersQuery = supabase
    .from("providers")
    .select("id, display_name, status, published_at, accepting_new_clients, created_at, provider_public_profiles(photo_pending_path)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status === "submitted") providersQuery = providersQuery.in("status", ["submitted", "in_review"]);

  const [{ data: providers }, { data: invitations }, { data: jobs }, { data: destinations }] = await Promise.all([
    providersQuery,
    supabase.from("coach_invitations").select("id, email, created_at, expires_at, accepted_at, revoked_at, provider_id").order("created_at", { ascending: false }).limit(50),
    supabase.from("outbox").select("dedupe_key, state, last_error").eq("topic", "email.coach_invitation").order("created_at", { ascending: false }).limit(100),
    // Masked, admin-only listing: the table itself is closed to every client.
    supabase.rpc("admin_payout_destinations", { p_provider_id: null }),
  ]);
  const jobFor = (id: string) => (jobs ?? []).find((j) => j.dedupe_key === `coach_invitation:${id}`);
  // Per-request server component (force-dynamic layout): renders once, so the
  // instability the purity rule guards against cannot occur.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <div>
      <PageHeader title="Coaches">
        Coaches join by invitation. You check each coach once; after approval they publish their own plans and prices.
      </PageHeader>

      <Panel title="Invite a coach" id="invite" description="The invitation works only for an account with this email address and expires after 7 days.">
        <ActionForm action={inviteCoachAction} resetOnSuccess className="flex flex-wrap items-end gap-4">
          <TextField name="email" label="Coach's email" type="email" required autoComplete="off" className="min-w-64 flex-1" />
          <div>
            <SubmitButton pendingLabel="Inviting…">Send invitation</SubmitButton>
          </div>
        </ActionForm>
      </Panel>

      <Panel title="Invitations" id="invitations">
        <DataTable
          caption="Coach invitations"
          head={["Email", "Sent", "Status", "Email delivery", ""]}
          empty="No invitations yet."
          rows={(invitations ?? []).map((inv) => {
            const job = jobFor(inv.id);
            const state = inv.accepted_at ? "Accepted" : inv.revoked_at ? "Revoked" : new Date(inv.expires_at).getTime() < now ? "Expired" : "Waiting";
            return [
              inv.email,
              formatDate(inv.created_at, null),
              inv.accepted_at && inv.provider_id ? <Link key="a" href={`/admin/coaches/${inv.provider_id}`} className="underline">Accepted</Link> : state,
              job ? JOB_LABEL[job.state] ?? job.state : "—",
              state === "Waiting" ? (
                <ActionForm key="r" action={revokeInvitationAction}>
                  <input type="hidden" name="invitation_id" value={inv.id} />
                  <SubmitButton pendingLabel="Revoking…" variant="quiet">Revoke</SubmitButton>
                </ActionForm>
              ) : null,
            ];
          })}
        />
      </Panel>

      <Panel title={status === "submitted" ? "Waiting for review" : "All coaches"} id="coaches">
        {status ? (
          <p className="mb-3"><Link href="/admin/coaches" className="text-brand underline">Show all coaches</Link></p>
        ) : null}
        <DataTable
          caption="Coaches"
          head={["Coach", "Status", "Public", "Needs checking", "Joined"]}
          empty="No coaches yet."
          rows={(providers ?? []).map((p) => {
            const profile = (Array.isArray(p.provider_public_profiles) ? p.provider_public_profiles[0] : p.provider_public_profiles) as { photo_pending_path: string | null } | null;
            const pendingDestination = ((destinations ?? []) as { provider_id: string; review_state: string; superseded_at: string | null }[]).some(
              (d) => d.provider_id === p.id && !d.superseded_at && d.review_state === "pending_review",
            );
            const checks = [profile?.photo_pending_path ? "photo" : null, pendingDestination ? "payout details" : null].filter(Boolean).join(", ");
            return [
              <Link key="n" href={`/admin/coaches/${p.id}`} className="font-semibold underline-offset-4 hover:underline">{p.display_name}</Link>,
              <StatusPill key="s" tone={p.status === "approved" ? "good" : p.status === "suspended" ? "bad" : "neutral"}>{PROVIDER_STATUS_LABEL[p.status] ?? p.status}</StatusPill>,
              p.published_at ? (p.accepting_new_clients ? "Yes, open" : "Yes, closed to new clients") : "No",
              checks || "—",
              formatDate(p.created_at, null),
            ];
          })}
        />
      </Panel>
    </div>
  );
}
