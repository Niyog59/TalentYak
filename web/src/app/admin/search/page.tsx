import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader, Badge, EmptyNote, ErrorNote, Section } from "@/components/admin/ui";

export const metadata = { title: "Search" };

const KIND: Record<string, { label: string; href: (id: string) => string }> = {
  account: { label: "Account", href: (id) => `/admin/accounts/${id}` },
  coach: { label: "Coach", href: (id) => `/admin/coaches/${id}` },
  purchase: { label: "Purchase", href: (id) => `/admin/purchases/${id}` },
  support_case: { label: "Support case", href: (id) => `/admin/support/${id}` },
  coach_change: { label: "Coach change", href: () => "/admin/coach-changes" },
};

/*
 * One box for finding people and records: names, emails, coach names and
 * profile addresses, and record IDs. It never searches private content —
 * messages, health records, check-in answers or media are not indexed here.
 */
export default async function AdminSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin("/admin/search");
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const supabase = (await createClient())!;
  const { data, error } = q.length >= 2 ? await supabase.rpc("admin_search", { p_q: q }) : { data: [], error: null };
  const results = (data ?? []) as { kind: string; id: string; label: string; detail: string }[];

  return (
    <div>
      <AdminHeader eyebrow="Search" title={q ? `Results for “${q}”` : "Search"}>
        <p>Names, emails, coach names, profile addresses and record IDs. Private content — messages, health records, check-in answers, photos — is never searchable.</p>
      </AdminHeader>
      <Section title={q.length >= 2 ? `${results.length} found` : "Type at least two characters"}>
        {error ? (
          <ErrorNote>Search couldn&rsquo;t run. Try again.</ErrorNote>
        ) : q.length < 2 ? (
          <EmptyNote>Use the search box at the top of any page.</EmptyNote>
        ) : results.length === 0 ? (
          <EmptyNote>Nothing matches. Try part of an email address, a coach&rsquo;s name, or the first 8+ characters of a record ID.</EmptyNote>
        ) : (
          <ul className="-mx-5 -my-4 divide-y divide-line">
            {results.map((r) => (
              <li key={`${r.kind}-${r.id}`}>
                <Link href={KIND[r.kind]?.href(r.id) ?? "/admin"} className="flex min-h-12 flex-wrap items-center gap-3 px-5 py-3 hover:bg-paper-raised/60">
                  <Badge tone="info">{KIND[r.kind]?.label ?? r.kind}</Badge>
                  <span className="font-semibold">{r.label}</span>
                  <span className="text-ink-muted">{r.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
