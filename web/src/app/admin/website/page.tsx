import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AdminHeader, Badge, Details, ErrorNote, Section, Table } from "@/components/admin/ui";
import { purchaseMode } from "@/lib/launch";
import { getFeatureStates } from "@/lib/features/server";
import { MODE_LABEL } from "@/lib/features/registry";
import { CURRENT_LEGAL } from "@/lib/legal";
import { analyticsAppUrl, posthogConfig, PRODUCT_EVENTS } from "@/lib/analytics/posthog";
import { formatDate } from "@/lib/format";
import { daysAgoIso } from "@/lib/admin/range";

export const metadata = { title: "Website & launch" };

const AVAIL: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  available: { label: "Taking clients", tone: "good" },
  full: { label: "Full", tone: "warn" },
  away: { label: "Away", tone: "warn" },
  not_accepting: { label: "Not taking clients", tone: "neutral" },
};

export default async function WebsiteLaunchPage() {
  const session = await requireAdmin("/admin/website");
  const supabase = (await createClient())!;
  const tz = session.profile.timezone;
  const since = daysAgoIso(30).slice(0, 10);

  const [states, publicMode, coaches, avail, waitlist, platformDoc, counts] = await Promise.all([
    getFeatureStates(),
    purchaseMode(null),
    supabase.from("providers").select("id, display_name, slug, status, published_at, suspended_at, accepting_new_clients").eq("status", "approved").order("display_name"),
    supabase.rpc("coach_public_availability"),
    supabase.from("waitlist_entries").select("state"),
    supabase.from("platform_expectation_versions").select("version, published_at").not("published_at", "is", null).is("superseded_at", null).maybeSingle(),
    supabase.from("site_event_counts").select("event, live, count").gte("day", since),
  ]);
  const availability = new Map(((avail.data ?? []) as { provider_id: string; state: string }[]).map((a) => [a.provider_id, a.state]));
  const wl = (waitlist.data ?? []) as { state: string }[];
  const totals = new Map<string, { live: number; other: number }>();
  for (const c of (counts.data ?? []) as { event: string; live: boolean; count: number }[]) {
    const t = totals.get(c.event) ?? { live: 0, other: 0 };
    if (c.live) t.live += Number(c.count); else t.other += Number(c.count);
    totals.set(c.event, t);
  }
  const ph = posthogConfig();
  const phUrl = analyticsAppUrl();

  return (
    <div>
      <AdminHeader eyebrow="Website" title="Website & launch">
        <p>What the public can see and do right now, and why. Coaches publish their own profiles once approved; the switches here only hide or pause.</p>
      </AdminHeader>

      <Section id="availability" title="What visitors can do right now">
        <Details
          items={[
            ["Buy coaching", publicMode === "live" ? <Badge key="b" tone="good">Open to the public</Badge> : <span key="b" className="flex flex-wrap items-center gap-2"><Badge tone="bad">Closed</Badge> Visitors see &ldquo;Join the waitlist&rdquo;. Protected testers can use test checkout while payments are in test mode.</span>],
            ["New purchases switch", MODE_LABEL[states.modes.new_sales]],
            ["Coach profiles", MODE_LABEL[states.modes.public_profiles]],
            ["Waitlist", MODE_LABEL[states.modes.waitlist]],
            ["Terms and privacy notice", CURRENT_LEGAL.approved ? "Approved" : "Drafts — must be final before real payments"],
            ["TalentYak's welcome & expectations section", platformDoc.data ? `Version ${platformDoc.data.version}, published ${formatDate(platformDoc.data.published_at, tz)}` : <Link key="e" href="/admin/expectations" className="text-brand underline">Not published — plans can&rsquo;t be bought until it is</Link>],
          ]}
        />
        <p className="mt-3 text-[0.9375rem] text-ink-muted">
          Change switches in <Link href="/admin/features" className="text-brand underline">feature controls</Link>. Nothing here changes domains or makes unpublished or test content public.
        </p>
      </Section>

      <Section id="coaches" title="Approved coaches" description="Only approved, published coaches appear publicly. On the live site, test accounts never do.">
        {coaches.error ? <ErrorNote /> : (
          <Table
            caption="Approved coaches"
            head={["Coach", "Public profile", "Shown as", ""]}
            empty="No approved coaches yet. The site says founding coaches are being confirmed."
            rows={(coaches.data ?? []).map((c) => {
              const a = AVAIL[availability.get(c.id) ?? ""];
              return [
                <Link key="n" href={`/admin/coaches/${c.id}`} className="font-semibold text-brand underline-offset-4 hover:underline">{c.display_name}</Link>,
                c.suspended_at ? <Badge key="p" tone="bad">Suspended</Badge> : c.published_at ? <Badge key="p" tone="good">Published</Badge> : <Badge key="p">Not published</Badge>,
                a ? <Badge key="a" tone={a.tone}>{a.label}</Badge> : "—",
                c.published_at && c.slug ? <a key="v" href={`/coaches/${c.slug}`} className="text-brand underline" target="_blank" rel="noopener noreferrer">View public page</a> : "",
              ];
            })}
          />
        )}
      </Section>

      <Section id="waitlist" title="Waitlist" actions={<Link href="/admin/waitlist" className="text-brand underline">Open waitlist</Link>}>
        {waitlist.error ? <ErrorNote /> : (
          <p>{wl.filter((w) => w.state === "confirmed").length} confirmed · {wl.filter((w) => w.state === "pending").length} not yet confirmed. Entries are kept until the person leaves; there&rsquo;s no automatic expiry yet.</p>
        )}
      </Section>

      <Section id="analytics" title="Analytics" actions={phUrl ? <a href={phUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-10 items-center rounded-lg bg-brand px-3 font-semibold text-white">Open analytics</a> : null}>
        <Details
          items={[
            ["PostHog", ph ? <Badge key="p" tone="good">Project key set</Badge> : <span key="p" className="flex flex-wrap items-center gap-2"><Badge tone="warn">Not connected</Badge> Set POSTHOG_PROJECT_KEY (and POSTHOG_APP_URL for this link) on the production deployment.</span>],
            ["What is sent", `${PRODUCT_EVENTS.join(", ")} — anonymous, from the server, production only.`],
            ["What is never sent", "Emails, names, health details, messages, form answers, photo or file addresses, query strings, amounts. No browser script: no cookies, no session recordings, no automatic click capture."],
            ["Left out", "Local and preview sites, TalentYak staff and coaches browsing, test accounts, test-mode payments, bots."],
          ]}
        />
        <h3 className="mt-5 font-semibold text-ink-deep">TalentYak&rsquo;s own counts (last 30 days)</h3>
        <p className="text-[0.9375rem] text-ink-muted">Kept in the database since M16 without any analytics service. &ldquo;Real&rdquo; means public production activity only. Purchases are counted from payment records, not here.</p>
        {counts.error ? <ErrorNote /> : (
          <Table
            caption="Site event counts"
            head={["Event", "Real", "Test, preview or staff"]}
            empty="Nothing counted in the last 30 days."
            rows={[...totals.entries()].map(([e, t]) => [e.replaceAll("_", " "), t.live.toLocaleString("en-US"), t.other.toLocaleString("en-US")])}
          />
        )}
      </Section>
    </div>
  );
}
