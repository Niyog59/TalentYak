import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, SubmitButton, TextArea } from "@/components/form/fields";
import { Facts, PageHeader, Panel } from "@/components/ui/panel";
import { CASE_STATE_LABEL, categoryLabel } from "@/lib/support/categories";
import { grantMessageAccessAction, revokeMessageAccessAction, updateSupportCaseAction } from "@/lib/support/actions";

export const metadata = { title: "Support case" };
export const dynamic = "force-dynamic";

interface CaseRow {
  id: string;
  category: string;
  state: string;
  reporter_role: string;
  reporter_name: string;
  other_name: string | null;
  has_conversation: boolean;
  description: string;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

export default async function SupportCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireAdmin(`/admin/support/${id}`);
  const supabase = (await createClient())!;
  const tz = session.profile.timezone ?? "UTC";
  const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  const { data: all } = await supabase.rpc("admin_support_cases", { p_state: null });
  const c = ((all ?? []) as CaseRow[]).find((r) => r.id === id);
  if (!c) notFound();

  const [{ data: grants }, { data: log }] = await Promise.all([
    supabase.from("support_message_access").select("id, granted_to, reason, granted_at, expires_at, revoked_at").eq("case_id", id).order("granted_at", { ascending: false }),
    supabase.from("support_access_log").select("id, admin_profile_id, action, detail, created_at").eq("case_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  const myGrant = (grants ?? []).find((g) => g.granted_to === session.userId && !g.revoked_at && new Date(g.expires_at) > new Date());

  // Reading is itself recorded by the database, every time this page loads.
  const { data: messages } = myGrant
    ? await supabase.rpc("admin_case_messages", { p_case: id, p_before_seq: null, p_limit: 100 })
    : { data: null };
  const thread = ((messages ?? []) as { seq: number; sender_role: string; kind: string; body: string | null; has_attachment: boolean; created_at: string }[])
    .sort((a, b) => a.seq - b.seq);
  const partyName = (role: string) =>
    role === c.reporter_role ? c.reporter_name : c.other_name ?? (role === "coach" ? "Coach" : "Client");

  return (
    <div>
      <PageHeader title={categoryLabel(c.category)}>
        <Link href="/admin/support" className="text-brand underline underline-offset-4">All cases</Link>
      </PageHeader>

      <div className="grid gap-6">
        <Panel title="Case" id="case">
          <Facts
            items={[
              ["State", CASE_STATE_LABEL[c.state] ?? c.state],
              ["Opened", when(c.created_at)],
              ["From", `${c.reporter_name} (${c.reporter_role === "coach" ? "coach" : "client"})`],
              ["Conversation with", c.other_name ?? "Not about a conversation"],
              ...(c.resolved_at ? [["Resolved", when(c.resolved_at)] as [string, string]] : []),
            ]}
          />
          <p className="mt-4 whitespace-pre-wrap break-words rounded-lg bg-paper-raised px-3 py-2">{c.description}</p>
        </Panel>

        <Panel title="Resolve" id="resolve">
          <ActionForm action={updateSupportCaseAction} className="grid gap-4">
            <input type="hidden" name="case_id" value={c.id} />
            <SelectField
              name="state"
              label="State"
              required
              defaultValue={c.state}
              options={[
                { value: "open", label: "Open" },
                { value: "in_progress", label: "Being looked at" },
                { value: "resolved", label: "Resolved" },
              ]}
            />
            <TextArea
              name="note"
              label="Note to the reporter"
              required={false}
              rows={3}
              maxLength={2000}
              help="Shown to the person who reported this. Required to resolve."
            />
            {c.resolution_note ? <p className="text-sm text-ink-muted">Current note: {c.resolution_note}</p> : null}
            <div><SubmitButton pendingLabel="Saving…">Save</SubmitButton></div>
          </ActionForm>
        </Panel>

        {c.has_conversation ? (
          <Panel title="Conversation access" id="access">
            {myGrant ? (
              <>
                <p className="text-sm">
                  You have access until {when(myGrant.expires_at)} for: &ldquo;{myGrant.reason}&rdquo;. Each view is recorded. Attachments
                  are listed but not shown.
                </p>
                <ActionForm action={revokeMessageAccessAction} className="mt-3">
                  <input type="hidden" name="access_id" value={myGrant.id} />
                  <input type="hidden" name="case_id" value={c.id} />
                  <SubmitButton variant="secondary" pendingLabel="Ending…">End my access now</SubmitButton>
                </ActionForm>
                <ol className="mt-4 space-y-2">
                  {thread.length === 0 ? <li className="text-ink-muted">No messages in this conversation.</li> : null}
                  {thread.map((m) => (
                    <li key={m.seq} className="rounded-lg border border-line bg-surface px-3 py-2">
                      <p className="text-xs text-ink-muted">{partyName(m.sender_role)} · {when(m.created_at)}</p>
                      {m.has_attachment ? <p className="text-sm italic">[photo or clip — not shown]</p> : null}
                      {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
                    </li>
                  ))}
                </ol>
              </>
            ) : c.state === "resolved" ? (
              <p className="text-sm text-ink-muted">The case is resolved; conversation access is closed.</p>
            ) : (
              <ActionForm action={grantMessageAccessAction} className="grid gap-3">
                <input type="hidden" name="case_id" value={c.id} />
                <p className="text-sm">
                  Only if resolving this case needs it. Access is for you only, for this conversation only, expires automatically, and
                  every grant and view is recorded below.
                </p>
                <TextArea name="reason" label="Why you need to read it" required rows={2} maxLength={500} />
                <div><SubmitButton variant="secondary" pendingLabel="Granting…">Grant me access</SubmitButton></div>
              </ActionForm>
            )}
          </Panel>
        ) : null}

        <Panel title="Access record" id="log">
          {(log ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">No one has accessed this case&rsquo;s conversation.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(log ?? []).map((l) => (
                <li key={l.id}>
                  {when(l.created_at)} — {l.action}
                  {l.admin_profile_id === session.userId ? " by you" : ""}
                  {l.detail ? ` (${l.detail})` : ""}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
