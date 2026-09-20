import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Panel } from "@/components/ui/panel";
import { evaluateLiveReadiness } from "@/lib/policy/live-gate";
import { CURRENT_LEGAL } from "@/lib/legal";
import { FULFILLMENT } from "@/lib/fulfillment";

export const metadata = { title: "Overview" };

async function count(query: PromiseLike<{ count: number | null }>) {
  return (await query).count ?? 0;
}

export default async function AdminOverviewPage() {
  await requireAdmin("/admin");
  const supabase = (await createClient())!;
  const head = { count: "exact" as const, head: true };

  const [review, photos, destinations, exceptions, jobs, events, changes, needsReview, activePurchases, openDisputes] = await Promise.all([
    count(supabase.from("providers").select("id", head).in("status", ["submitted", "in_review"])),
    count(supabase.from("provider_public_profiles").select("provider_id", head).not("photo_pending_path", "is", null)),
    supabase.rpc("admin_payout_destinations", { p_provider_id: null }).then(({ data }) =>
      ((data ?? []) as { review_state: string; superseded_at: string | null }[]).filter((d) => d.review_state === "pending_review" && !d.superseded_at).length,
    ),
    count(supabase.from("reconciliation_exceptions").select("id", head).in("state", ["open", "investigating"])),
    count(supabase.from("outbox").select("id", head).in("state", ["failed", "blocked"])),
    count(supabase.from("provider_events").select("id", head).eq("processing_state", "failed")),
    count(supabase.from("coach_change_requests").select("id", head).eq("state", "requested")),
    count(supabase.from("purchases").select("id", head).eq("requires_review", true)),
    count(supabase.from("purchases").select("id", head).in("state", ["active", "cancelling", "past_due"])),
    count(supabase.from("disputes").select("id", head).in("state", ["open", "under_review"])),
  ]);

  // A job can finish while the message bounced. That is a separate failure and
  // it needs its own number, or it is never noticed.
  const badDeliveries = await count(
    supabase.from("notification_deliveries").select("id", head).in("state", ["bounced", "complained", "failed", "uncertain"]),
  );

  const tiles: { label: string; value: number; href: string; urgent?: boolean }[] = [
    { label: "Coaches waiting for review", value: review, href: "/admin/coaches?status=submitted", urgent: review > 0 },
    { label: "Photos to check", value: photos, href: "/admin/coaches#coaches", urgent: photos > 0 },
    { label: "Payout details to check", value: destinations, href: "/admin/coaches#coaches", urgent: destinations > 0 },
    { label: "Coach change requests", value: changes, href: "/admin/coach-changes", urgent: changes > 0 },
    { label: "Open finance exceptions", value: exceptions, href: "/admin/finance", urgent: exceptions > 0 },
    { label: "Purchases needing review", value: needsReview, href: "/admin/finance#review", urgent: needsReview > 0 },
    { label: "Open card disputes", value: openDisputes, href: "/admin/finance#disputes", urgent: openDisputes > 0 },
    { label: "Failed or blocked emails and jobs", value: jobs, href: "/admin/finance#jobs", urgent: jobs > 0 },
    { label: "Emails that bounced or never arrived", value: badDeliveries, href: "/admin/finance#deliveries", urgent: badDeliveries > 0 },
    { label: "Stripe events that failed to process", value: events, href: "/admin/finance#events", urgent: events > 0 },
    { label: "Active paid plans", value: activePurchases, href: "/admin/purchases" },
  ];

  const readiness = evaluateLiveReadiness();
  const unbuilt = Object.values(FULFILLMENT).filter((f) => !f.ready);

  return (
    <div>
      <PageHeader title="Overview">Things that need a person, first.</PageHeader>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <li key={t.label}>
            <Link
              href={t.href}
              className={`block rounded-xl border p-4 hover:border-ink ${t.urgent ? "border-brand bg-brand-tint" : "border-line bg-surface"}`}
            >
              <span className="block font-display text-3xl">{t.value}</span>
              <span className="mt-1 block">{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>

      <Panel title="Can TalentYak take real money yet?" id="live">
        <p className="font-semibold">No.</p>
        <p className="mt-1 text-ink-muted">Every item below must be resolved first. Approving policies alone does not open this.</p>
        <ul className="mt-3 list-disc space-y-1 pl-6">
          {readiness.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
          {!CURRENT_LEGAL.approved ? <li>Terms of service and privacy notice are drafts.</li> : null}
          {unbuilt.map((f) => (
            <li key={f.label}>
              Not built yet: {f.label} ({f.module}). Plans that include it can&rsquo;t be sold for real money.
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
