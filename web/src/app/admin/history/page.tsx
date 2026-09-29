import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader, Badge, ErrorNote, Section, Table } from "@/components/admin/ui";
import { formatDate, formatMinor } from "@/lib/format";
import { MODE_LABEL, type FeatureMode } from "@/lib/features/registry";

export const metadata = { title: "Change history" };

/*
 * One timeline of consequential changes, gathered from each workflow's own
 * append-only record: who did it, when, why, and what changed. Private
 * content is never copied into any of these records.
 */

interface Entry {
  at: string;
  source: string;
  what: string;
  actor: string | null;
  reason: string | null;
  href?: string;
}

const SOURCES = [
  ["all", "Everything"],
  ["panel", "Founder panel"],
  ["features", "Feature controls"],
  ["coaches", "Coach status"],
  ["coach_changes", "Coach changes"],
  ["money", "Refunds & payouts"],
  ["support", "Support access"],
  ["roles", "Roles"],
] as const;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const session = await requireAdmin("/admin/history");
  const requested = (await searchParams).source;
  const source = SOURCES.some(([k]) => k === requested) ? requested! : "all";
  const supabase = (await createClient())!;
  const tz = session.profile.timezone;
  const want = (k: string) => source === "all" || source === k;
  const LIMIT = 100;
  const none = Promise.resolve({ data: [] as never[], error: null });

  const [audit, features, status, changes, refunds, payouts, access, roles] = await Promise.all([
    want("panel") ? supabase.from("admin_audit_log").select("action, subject_type, subject_id, reason, actor_id, created_at, after").order("created_at", { ascending: false }).limit(LIMIT) : none,
    want("features") ? supabase.from("feature_setting_changes").select("key, from_mode, to_mode, reason, actor_id, created_at").order("created_at", { ascending: false }).limit(LIMIT) : none,
    want("coaches") ? supabase.from("provider_status_events").select("provider_id, from_status, to_status, action, reason, actor, created_at").order("created_at", { ascending: false }).limit(LIMIT) : none,
    want("coach_changes") ? supabase.from("coach_change_requests").select("id, state, decision_note, decided_by, decided_at").in("state", ["applied", "declined"]).order("decided_at", { ascending: false }).limit(LIMIT) : none,
    want("money") ? supabase.from("refunds").select("purchase_id, amount_minor, currency, state, reason, requested_by, created_at").order("created_at", { ascending: false }).limit(LIMIT) : none,
    want("money") ? supabase.from("payout_batch_events").select("batch_id, action, note, actor, created_at").order("created_at", { ascending: false }).limit(LIMIT) : none,
    want("support") ? supabase.from("support_access_log").select("case_id, action, detail, admin_profile_id, created_at").order("created_at", { ascending: false }).limit(LIMIT) : none,
    want("roles") ? supabase.from("role_changes").select("profile_id, from_role, to_role, changed_by, reason, created_at").order("created_at", { ascending: false }).limit(LIMIT) : none,
  ]);
  const anyError = [audit, features, status, changes, refunds, payouts, access, roles].some((r) => r.error);

  const entries: Entry[] = [
    ...((audit.data ?? []) as { action: string; subject_type: string; subject_id: string | null; reason: string | null; actor_id: string | null; created_at: string }[])
      .filter((a) => a.subject_type !== "feature" && !a.action.startsWith("coach_change."))
      .map((a) => ({
        at: a.created_at, source: "Founder panel", what: `${a.action.replaceAll("_", " ").replace(".", ": ")}`, actor: a.actor_id, reason: a.reason,
        href: a.subject_type === "account" && a.subject_id ? `/admin/accounts/${a.subject_id}` : a.subject_type === "coach" && a.subject_id ? `/admin/coaches/${a.subject_id}` : undefined,
      })),
    ...((features.data ?? []) as { key: string; from_mode: string; to_mode: string; reason: string; actor_id: string | null; created_at: string }[])
      .map((f) => ({ at: f.created_at, source: "Feature controls", what: `${f.key.replaceAll("_", " ")}: ${MODE_LABEL[f.from_mode as FeatureMode] ?? f.from_mode} → ${MODE_LABEL[f.to_mode as FeatureMode] ?? f.to_mode}`, actor: f.actor_id, reason: f.reason, href: `/admin/features#${f.key}` })),
    ...((status.data ?? []) as { provider_id: string; from_status: string | null; to_status: string | null; action: string; reason: string | null; actor: string | null; created_at: string }[])
      .map((s) => ({ at: s.created_at, source: "Coach status", what: `${s.action.replaceAll("_", " ")} (${s.from_status ?? "—"} → ${s.to_status ?? "—"})`, actor: s.actor, reason: s.reason, href: `/admin/coaches/${s.provider_id}` })),
    ...((changes.data ?? []) as { id: string; state: string; decision_note: string | null; decided_by: string | null; decided_at: string }[])
      .map((c) => ({ at: c.decided_at, source: "Coach changes", what: `Coach change ${c.state}`, actor: c.decided_by, reason: c.decision_note, href: "/admin/coach-changes#closed" })),
    ...((refunds.data ?? []) as { purchase_id: string; amount_minor: number; currency: string; state: string; reason: string | null; requested_by: string | null; created_at: string }[])
      .map((r) => ({ at: r.created_at, source: "Refunds", what: `Refund ${formatMinor(r.amount_minor, r.currency)} (${r.state})`, actor: r.requested_by, reason: r.reason, href: `/admin/purchases/${r.purchase_id}` })),
    ...((payouts.data ?? []) as { batch_id: string; action: string; note: string | null; actor: string | null; created_at: string }[])
      .map((p) => ({ at: p.created_at, source: "Payouts", what: `Payout batch: ${p.action.replaceAll("_", " ")}`, actor: p.actor, reason: p.note, href: `/admin/payouts/${p.batch_id}` })),
    ...((access.data ?? []) as { case_id: string; action: string; detail: string | null; admin_profile_id: string | null; created_at: string }[])
      .map((a) => ({ at: a.created_at, source: "Support access", what: `Conversation access: ${a.action}`, actor: a.admin_profile_id, reason: a.detail, href: `/admin/support/${a.case_id}` })),
    ...((roles.data ?? []) as { profile_id: string; from_role: string | null; to_role: string | null; changed_by: string | null; reason: string | null; created_at: string }[])
      .map((r) => ({ at: r.created_at, source: "Roles", what: `Role ${r.from_role ?? "none"} → ${r.to_role ?? "none"}`, actor: r.changed_by, reason: r.reason, href: `/admin/accounts/${r.profile_id}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);

  const actorIds = [...new Set(entries.map((e) => e.actor).filter(Boolean))] as string[];
  const { data: people } = actorIds.length ? await supabase.from("profiles").select("id, full_name, email").in("id", actorIds) : { data: [] };
  const name = (id: string | null) => {
    if (!id) return "System";
    const p = (people ?? []).find((x) => x.id === id);
    return p ? p.full_name || p.email : "Deleted account";
  };

  return (
    <div>
      <AdminHeader eyebrow="System" title="Change history">
        <p>Consequential changes across TalentYak, newest first: who, when, why and what changed. These records are append-only; nobody can edit or delete them from the panel or the database.</p>
      </AdminHeader>
      <nav aria-label="Filter history" className="mt-5">
        <ul className="flex flex-wrap gap-1 text-[0.9375rem]">
          {SOURCES.map(([k, l]) => (
            <li key={k}>
              <Link href={k === "all" ? "/admin/history" : `/admin/history?source=${k}`} aria-current={source === k ? "true" : undefined} className={`flex min-h-10 items-center rounded-lg px-3 font-semibold ${source === k ? "bg-brand text-white" : "border border-line-strong bg-surface hover:bg-paper-raised"}`}>{l}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <Section title={`${entries.length} most recent`}>
        {anyError ? <div className="mb-4"><ErrorNote>Part of the history couldn&rsquo;t be loaded; what&rsquo;s shown may be incomplete.</ErrorNote></div> : null}
        <Table
          caption="Change history"
          head={["When", "Area", "What", "By", "Why"]}
          empty="Nothing recorded yet."
          rows={entries.map((e) => [
            formatDate(e.at, tz, true),
            <Badge key="s">{e.source}</Badge>,
            e.href ? <Link key="w" href={e.href} className="text-brand underline-offset-4 hover:underline">{e.what}</Link> : e.what,
            name(e.actor),
            <span key="r" className="break-words text-ink-muted">{e.reason ?? ""}</span>,
          ])}
        />
      </Section>
    </div>
  );
}
