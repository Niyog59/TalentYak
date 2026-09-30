import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader, Badge, ErrorNote, Pagination, Section, Table } from "@/components/admin/ui";
import { formatDate } from "@/lib/format";
import { featureMode } from "@/lib/features/server";
import { COUNTRIES, LANGUAGES, SPECIALTIES, STATUS_LABEL, STATUS_TONE, countryLabel, type ApplicationStatus } from "@/lib/coach-applications/rules";

export const metadata = { title: "Coach applications" };

const PAGE = 25;
const FILTER_STATUSES = ["open", "new", "reviewing", "interview", "approved", "waitlisted", "declined", "withdrawn", "all"] as const;
const OPEN: ApplicationStatus[] = ["new", "reviewing", "interview"];

interface Row {
  id: string;
  full_name: string;
  status: ApplicationStatus;
  country: string;
  languages: string[];
  specialties: string[];
  submitted_at: string | null;
  agreement_signed_at: string | null;
  profiles: { email: string } | { email: string }[] | null;
}

/** Text for an ilike pattern: wildcards and the filter syntax's own characters removed. */
function searchText(q: string): string {
  return q.replace(/[%_,()\\*]/g, " ").trim().slice(0, 100);
}

export default async function CoachApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; specialty?: string; language?: string; country?: string; page?: string }>;
}) {
  const session = await requireAdmin("/admin/coach-applications");
  const sp = await searchParams;
  const q = searchText(sp.q ?? "");
  const status = (FILTER_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status! : "open";
  const specialty = (SPECIALTIES as readonly string[]).includes(sp.specialty ?? "") ? sp.specialty! : "";
  const language = (LANGUAGES as readonly string[]).includes(sp.language ?? "") ? sp.language! : "";
  const country = COUNTRIES.some((c) => c.value === sp.country) ? sp.country! : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const tz = session.profile.timezone;
  const supabase = (await createClient())!;

  let query = supabase
    .from("coach_applications")
    .select("id, full_name, status, country, languages, specialties, submitted_at, agreement_signed_at, profiles(email)", { count: "exact" })
    .neq("status", "draft")
    .order("submitted_at", { ascending: false, nullsFirst: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (status === "open") query = query.in("status", OPEN);
  else if (status !== "all") query = query.eq("status", status);
  if (specialty) query = query.contains("specialties", [specialty]);
  if (language) query = query.contains("languages", [language]);
  if (country) query = query.eq("country", country);

  let searchFailed = false;
  if (q) {
    if (q.includes("@")) {
      const { data: people, error } = await supabase.from("profiles").select("id").ilike("email", `%${q}%`).limit(50);
      searchFailed = Boolean(error);
      query = query.in("profile_id", (people ?? []).map((p) => p.id).concat(["00000000-0000-0000-0000-000000000000"]));
    } else {
      query = query.ilike("full_name", `%${q}%`);
    }
  }
  const { data, count, error } = await query;
  const rows = (data ?? []) as Row[];
  const mode = await featureMode("coach_applications");

  const href = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (status !== "open") u.set("status", status);
    if (specialty) u.set("specialty", specialty);
    if (language) u.set("language", language);
    if (country) u.set("country", country);
    if (p > 1) u.set("page", String(p));
    return `/admin/coach-applications${u.size ? `?${u}` : ""}`;
  };
  const select = "min-h-10 rounded-lg border border-line-strong bg-surface px-3 font-normal";

  return (
    <div>
      <AdminHeader eyebrow="People" title="Coach applications">
        <p>
          People who applied to coach. Drafts aren&rsquo;t shown until the applicant sends them. Approving sends an invitation to sign the coach agreement; it doesn&rsquo;t make anyone a coach.
          Applications are <strong>{mode === "on" ? "open" : "closed"}</strong> (<Link href="/admin/features" className="text-brand underline">Feature controls</Link>).
        </p>
      </AdminHeader>

      <form method="get" className="mt-5 flex flex-wrap items-end gap-3 text-[0.9375rem]">
        <label className="grid gap-1 font-semibold">
          Name or email
          <input name="q" defaultValue={q} maxLength={100} className="min-h-10 w-64 rounded-lg border border-line-strong bg-surface px-3 font-normal" />
        </label>
        <label className="grid gap-1 font-semibold">
          Status
          <select name="status" defaultValue={status} className={select}>
            <option value="open">Waiting for a decision</option>
            {(["new", "reviewing", "interview", "approved", "waitlisted", "declined", "withdrawn"] as const).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
            <option value="all">All</option>
          </select>
        </label>
        <label className="grid gap-1 font-semibold">
          Specialty
          <select name="specialty" defaultValue={specialty} className={select}>
            <option value="">Any</option>
            {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="grid gap-1 font-semibold">
          Language
          <select name="language" defaultValue={language} className={select}>
            <option value="">Any</option>
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="grid gap-1 font-semibold">
          Country
          <select name="country" defaultValue={country} className={select}>
            <option value="">Any</option>
            {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <button type="submit" className="min-h-10 rounded-lg bg-brand px-4 font-semibold text-white hover:bg-brand-strong">Filter</button>
        {q || status !== "open" || specialty || language || country ? <Link href="/admin/coach-applications" className="flex min-h-10 items-center text-brand underline">Clear</Link> : null}
      </form>

      <Section title={error ? "Applications" : `${count ?? 0} ${count === 1 ? "application" : "applications"}`}>
        {error || searchFailed ? (
          <ErrorNote />
        ) : (
          <>
            <Table
              caption="Coach applications"
              head={["Applicant", "Status", "Country", "Specialties", "Languages", "Sent"]}
              empty="No applications match."
              rows={rows.map((r) => {
                const email = (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles)?.email ?? "";
                return [
                  <span key="a" className="grid">
                    <Link href={`/admin/coach-applications/${r.id}`} className="font-semibold text-brand underline-offset-4 hover:underline">{r.full_name}</Link>
                    <span className="break-all text-[0.875rem] text-ink-muted">{email}</span>
                  </span>,
                  <span key="s" className="flex flex-wrap gap-1">
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    {r.status === "approved" ? <Badge tone={r.agreement_signed_at ? "good" : "warn"}>{r.agreement_signed_at ? "Signed" : "Not signed"}</Badge> : null}
                  </span>,
                  countryLabel(r.country),
                  r.specialties.slice(0, 3).join(", ") + (r.specialties.length > 3 ? ` +${r.specialties.length - 3}` : ""),
                  r.languages.join(", "),
                  r.submitted_at ? formatDate(r.submitted_at, tz) : "—",
                ];
              })}
            />
            <Pagination page={page} pageSize={PAGE} total={count ?? 0} hrefFor={href} />
          </>
        )}
      </Section>
    </div>
  );
}
