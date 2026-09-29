import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, SubmitButton, TextArea } from "@/components/form/fields";
import { Facts, PageHeader, Panel } from "@/components/ui/panel";
import { CASE_STATE_LABEL, categoryLabel } from "@/lib/support/categories";
import { grantMessageAccessAction, revokeMessageAccessAction, updateSupportCaseAction } from "@/lib/support/actions";
import { recordOutcomeAction } from "@/lib/scheduling/actions";
import { APPOINTMENT_STATE_LABEL, OUTCOME_LABEL, type AppointmentState } from "@/lib/scheduling/types";
import { addSupportNoteAction, assignSupportCaseAction } from "../../panel-actions";

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

  const [{ data: grants }, { data: log }, { data: links }, { data: notes }, { data: events }, { data: admins }] = await Promise.all([
    supabase.from("support_message_access").select("id, granted_to, reason, granted_at, expires_at, revoked_at").eq("case_id", id).order("granted_at", { ascending: false }),
    supabase.from("support_access_log").select("id, admin_profile_id, action, detail, created_at").eq("case_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.rpc("admin_support_case_links", { p_case: id }),
    supabase.from("support_case_notes").select("id, body, created_at, author:profiles!support_case_notes_author_id_fkey(full_name, email)").eq("case_id", id).order("created_at"),
    supabase.from("support_case_events").select("id, kind, detail, created_at, actor:profiles!support_case_events_actor_id_fkey(full_name, email)").eq("case_id", id).order("created_at", { ascending: false }).limit(50),
    supabase.from("profiles").select("id, full_name, email").eq("role", "admin").is("suspended_at", null),
  ]);
  const rel = (links ?? {}) as { reporter_profile_id?: string; owner_id?: string | null; customer_id?: string | null; provider_id?: string | null; enrollment_id?: string | null; purchase_id?: string | null };
  const adminName = (pid: string | null | undefined) => {
    const a = (admins ?? []).find((x) => x.id === pid);
    return a ? a.full_name || a.email : null;
  };
  const personOf = (v: unknown) => {
    const one = (Array.isArray(v) ? v[0] : v) as { full_name: string | null; email: string } | null;
    return one ? one.full_name || one.email : "—";
  };
  // A report opened from a session page: the session, what was recorded, and
  // who the call service saw connect — the context needed to settle a call
  // problem or a questioned outcome. Nothing here moves money.
  const { data: link } = await supabase.from("support_cases").select("appointment_id, session_topic").eq("id", id).maybeSingle();
  const appointmentId = (link?.appointment_id as string | null) ?? null;
  const [{ data: appt }, { data: outcomes }, { data: attendance }, { data: rooms }] = appointmentId
    ? await Promise.all([
        supabase.from("appointments").select("id, kind, state, state_reason, starts_at, ends_at, purpose").eq("id", appointmentId).maybeSingle(),
        supabase.from("appointment_outcomes").select("id, outcome, note, recorded_role, recorded_at, corrects").eq("appointment_id", appointmentId)
          .order("recorded_at", { ascending: false }).order("id", { ascending: false }),
        supabase.from("call_attendance").select("role, joined_at, duration_seconds, source").eq("appointment_id", appointmentId).order("joined_at"),
        supabase.from("call_rooms").select("state, opens_at, closes_at, close_reason, provider_created_at, closed_at").eq("appointment_id", appointmentId).order("created_at"),
      ])
    : [{ data: null }, { data: null }, { data: null }, { data: null }];

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
      <PageHeader title={categoryLabel(c.category, link?.session_topic as string | null)}>
        <Link href="/admin/support" className="text-brand underline underline-offset-4">All cases</Link>
      </PageHeader>

      <div className="grid gap-6">
        <Panel title="Case" id="case">
          <Facts
            items={[
              ["State", CASE_STATE_LABEL[c.state] ?? c.state],
              ["Opened", when(c.created_at)],
              ["From", `${c.reporter_name} (${c.reporter_role === "coach" ? "coach" : "client"})`],
              ["Conversation with", c.other_name ?? (appointmentId ? "Not about a conversation — about a session, below" : "Not about a conversation")],
              ...(c.resolved_at ? [["Resolved", when(c.resolved_at)] as [string, string]] : []),
            ]}
          />
          <p className="mt-4 whitespace-pre-wrap break-words rounded-lg bg-paper-raised px-3 py-2">{c.description}</p>
        </Panel>

        {appt ? (
          <Panel title="Session" id="session">
            <Facts
              items={[
                ["When", `${when(appt.starts_at)} – ${when(appt.ends_at)}`],
                ["State", APPOINTMENT_STATE_LABEL[appt.state as AppointmentState] ?? appt.state],
                ["Kind", appt.kind === "consultation" ? "One-off session" : "Coaching session"],
                ...(appt.purpose ? [["Purpose", appt.purpose] as [string, string]] : []),
              ]}
            />
            <h3 className="mt-4 font-semibold">Call</h3>
            {(rooms ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">No call room was ever opened for this session.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {(rooms ?? []).map((r, i) => (
                  <li key={i}>
                    Room {r.provider_created_at ? `open ${when(r.opens_at)} – ${when(r.closes_at)}` : "reserved but never created at the call service"}
                    {r.closed_at ? `; closed ${when(r.closed_at)}${r.close_reason ? ` (${String(r.close_reason).replaceAll("_", " ")})` : ""}` : `; ${r.state}`}
                  </li>
                ))}
              </ul>
            )}
            <h3 className="mt-4 font-semibold">Who connected (from the call service)</h3>
            {(attendance ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">Nobody, or not recorded yet. The call service&rsquo;s record is fetched a few minutes after the room closes.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {(attendance ?? []).map((x, i) => (
                  <li key={i}>{x.role === "coach" ? "Coach" : "Client"} — joined {when(x.joined_at)}, {Math.round(x.duration_seconds / 60)} min</li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-sm text-ink-muted">Connection is not proof that coaching was delivered, and a dropped connection is not a no-show.</p>
            <h3 className="mt-4 font-semibold">Recorded outcome</h3>
            {(outcomes ?? []).length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing recorded.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm">
                {(outcomes ?? []).map((o, i) => (
                  <li key={o.id}>
                    <span className="font-semibold">{OUTCOME_LABEL[o.outcome] ?? o.outcome}</span>{i === 0 ? " (current)" : " (corrected later)"} — {o.recorded_role === "admin" ? "TalentYak" : "coach"}, {when(o.recorded_at)}{o.note ? `: ${o.note}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {appt.state === "booked" ? (
              <ActionForm action={recordOutcomeAction} className="mt-4 grid gap-3 sm:max-w-md">
                <input type="hidden" name="appointment_id" value={appt.id} />
                {(outcomes ?? []).length ? <input type="hidden" name="correcting" value="1" /> : null}
                <SelectField name="outcome" label={(outcomes ?? []).length ? "Correct the outcome to" : "Record the outcome as"} required
                  options={Object.entries(OUTCOME_LABEL).map(([value, label]) => ({ value, label }))} />
                <TextArea name="note" label="Reason (shown on the session to both people)" required rows={2} maxLength={500} />
                <p className="text-sm text-ink-muted">Adds a record; the earlier one is kept. Both people are told. No charge, refund or payout follows from it — use the finance tools for those.</p>
                <div><SubmitButton variant="secondary" pendingLabel="Saving…">Save outcome</SubmitButton></div>
              </ActionForm>
            ) : null}
          </Panel>
        ) : null}

        <Panel title="Owner and related records" id="owner">
          <Facts
            items={[
              ["Owner", adminName(rel.owner_id) ?? "Nobody yet"],
              ["Reported by", rel.reporter_profile_id ? <Link key="r" href={`/admin/accounts/${rel.reporter_profile_id}`} className="text-brand underline">{c.reporter_name}&rsquo;s account</Link> : c.reporter_name],
              ...(rel.customer_id && rel.customer_id !== rel.reporter_profile_id ? [["Client", <Link key="cu" href={`/admin/accounts/${rel.customer_id}`} className="text-brand underline">Client&rsquo;s account</Link>] as [string, React.ReactNode]] : []),
              ...(rel.provider_id ? [["Coach", <Link key="co" href={`/admin/coaches/${rel.provider_id}`} className="text-brand underline">Coach page</Link>] as [string, React.ReactNode]] : []),
              ...(rel.purchase_id ? [["Purchase", <Link key="pu" href={`/admin/purchases/${rel.purchase_id}`} className="text-brand underline">The purchase behind this relationship</Link>] as [string, React.ReactNode]] : []),
            ]}
          />
          <ActionForm action={assignSupportCaseAction} className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="case_id" value={c.id} />
            <SelectField
              name="owner"
              label="Change owner"
              required={false}
              defaultValue={rel.owner_id === session.userId ? "me" : rel.owner_id ?? ""}
              options={[
                { value: "", label: "Nobody" },
                { value: "me", label: "Me" },
                ...(admins ?? []).filter((a) => a.id !== session.userId).map((a) => ({ value: a.id, label: a.full_name || a.email })),
              ]}
            />
            <SubmitButton variant="secondary" pendingLabel="Saving…">Save owner</SubmitButton>
          </ActionForm>
        </Panel>

        <Panel title="Internal notes" id="notes" description="Only administrators see these — never the person who reported it. Don't copy private content (health details, message text) into a note.">
          {(notes ?? []).length === 0 ? <p className="text-sm text-ink-muted">No notes yet.</p> : null}
          <ol className="space-y-2">
            {(notes ?? []).map((n) => (
              <li key={n.id} className="rounded-lg border border-line bg-paper-raised px-3 py-2">
                <p className="text-xs text-ink-muted">{personOf(n.author)} · {when(n.created_at)}</p>
                <p className="whitespace-pre-wrap break-words">{n.body}</p>
              </li>
            ))}
          </ol>
          <ActionForm action={addSupportNoteAction} className="mt-3 grid gap-3">
            <input type="hidden" name="case_id" value={c.id} />
            <TextArea name="body" label="Add a note" required rows={3} maxLength={4000} />
            <div><SubmitButton variant="secondary" pendingLabel="Adding…">Add note</SubmitButton></div>
          </ActionForm>
        </Panel>

        <Panel title="Case history" id="events">
          {(events ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing recorded yet (history starts with M17).</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(events ?? []).map((e) => {
                const d = (e.detail ?? {}) as Record<string, string | null>;
                const what = e.kind === "state_changed"
                  ? `State: ${CASE_STATE_LABEL[d.from ?? ""] ?? d.from} → ${CASE_STATE_LABEL[d.to ?? ""] ?? d.to}`
                  : e.kind === "owner_changed"
                    ? `Owner: ${adminName(d.from) ?? "nobody"} → ${adminName(d.to) ?? "nobody"}`
                    : e.kind === "note_added" ? "Internal note added" : "Case opened";
                return <li key={e.id}>{when(e.created_at)} — {what}{e.actor ? ` · ${personOf(e.actor)}` : ""}</li>;
              })}
            </ul>
          )}
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
