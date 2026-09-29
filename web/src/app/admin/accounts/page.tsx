import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader, Badge, ErrorNote, Pagination, Section, Table } from "@/components/admin/ui";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Accounts" };

const PAGE = 25;
const ROLE_LABEL: Record<string, string> = { customer: "Client", provider: "Coach", admin: "Administrator" };

interface Row {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
  suspended_at: string | null;
  timezone: string | null;
  terms_version: string | null;
  provider_id: string | null;
  provider_status: string | null;
  is_test: boolean;
  on_test_list: boolean;
  last_sign_in: string | null;
}

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string }> }) {
  const session = await requireAdmin("/admin/accounts");
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 100);
  const role = ["customer", "coach", "admin"].includes(sp.role ?? "") ? sp.role! : "";
  const status = ["active", "suspended", "onboarding", "test", "real"].includes(sp.status ?? "") ? sp.status! : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = (await createClient())!;
  const { data, error } = await supabase.rpc("admin_accounts", { p_q: q, p_role: role, p_status: status, p_limit: PAGE, p_offset: (page - 1) * PAGE });
  const result = data as { total: number; rows: Row[] } | null;
  const tz = session.profile.timezone;

  const href = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (role) u.set("role", role);
    if (status) u.set("status", status);
    if (p > 1) u.set("page", String(p));
    return `/admin/accounts${u.size ? `?${u}` : ""}`;
  };

  return (
    <div>
      <AdminHeader eyebrow="People" title="Accounts">
        <p>Everyone with a TalentYak account: clients, coaches and administrators. Open an account for its relationships, purchases, cases and history.</p>
      </AdminHeader>

      <form method="get" className="mt-5 flex flex-wrap items-end gap-3 text-[0.9375rem]">
        <label className="grid gap-1 font-semibold">
          Name or email
          <input name="q" defaultValue={q} maxLength={100} className="min-h-10 w-64 rounded-lg border border-line-strong bg-surface px-3 font-normal" />
        </label>
        <label className="grid gap-1 font-semibold">
          Role
          <select name="role" defaultValue={role} className="min-h-10 rounded-lg border border-line-strong bg-surface px-3 font-normal">
            <option value="">All</option>
            <option value="customer">Clients</option>
            <option value="coach">Coaches</option>
            <option value="admin">Administrators</option>
          </select>
        </label>
        <label className="grid gap-1 font-semibold">
          Status
          <select name="status" defaultValue={status} className="min-h-10 rounded-lg border border-line-strong bg-surface px-3 font-normal">
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="onboarding">Onboarding not finished</option>
            <option value="real">Real accounts only</option>
            <option value="test">Test accounts only</option>
          </select>
        </label>
        <button type="submit" className="min-h-10 rounded-lg bg-brand px-4 font-semibold text-white hover:bg-brand-strong">Filter</button>
        {q || role || status ? <Link href="/admin/accounts" className="flex min-h-10 items-center text-brand underline">Clear</Link> : null}
      </form>

      <Section title={result ? `${result.total} ${result.total === 1 ? "account" : "accounts"}` : "Accounts"}>
        {error || !result ? (
          <ErrorNote />
        ) : (
          <>
            <Table
              caption="Accounts"
              head={["Account", "Role", "Status", "Joined", "Last sign-in"]}
              empty="No accounts match."
              rows={result.rows.map((r) => [
                <span key="a" className="grid">
                  <Link href={`/admin/accounts/${r.id}`} className="font-semibold text-brand underline-offset-4 hover:underline">{r.full_name || r.email}</Link>
                  <span className="break-all text-[0.875rem] text-ink-muted">{r.email}</span>
                </span>,
                <span key="r" className="flex flex-wrap gap-1">{ROLE_LABEL[r.role] ?? r.role}{r.provider_id && r.role !== "provider" ? <Badge>Coach</Badge> : null}</span>,
                <span key="s" className="flex flex-wrap gap-1">
                  {r.suspended_at ? <Badge tone="bad">Suspended</Badge> : !r.timezone || !r.terms_version ? <Badge tone="warn">Onboarding</Badge> : <Badge tone="good">Active</Badge>}
                  {r.is_test ? <Badge tone="info">Test</Badge> : null}
                </span>,
                formatDate(r.created_at, tz),
                r.last_sign_in ? formatDate(r.last_sign_in, tz, true) : <span key="l" className="text-ink-muted">Not recorded</span>,
              ])}
            />
            <Pagination page={page} pageSize={PAGE} total={result.total} hrefFor={href} />
          </>
        )}
      </Section>
    </div>
  );
}
