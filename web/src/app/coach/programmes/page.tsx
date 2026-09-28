import Link from "next/link";
import { requireCoach } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Panel, StatusPill } from "@/components/ui/panel";
import { formatDate } from "@/lib/format";
import { myClients, myTemplates } from "@/lib/programmes/server";
import { scheduledVersions, versionInForce, type PlanKind, type VersionTiming } from "@/lib/programmes/content";
import { KIND_LABEL } from "@/lib/programmes/labels";

export const metadata = { title: "Programmes" };
export const dynamic = "force-dynamic";

type Row = VersionTiming & { plan_id: string };

function PlanState({ versions, tz }: { versions: Row[] | undefined; tz: string | null }) {
  const now = new Date();
  if (!versions?.length) return <StatusPill>Not started</StatusPill>;
  const current = versionInForce(versions, now);
  const next = scheduledVersions(versions, now)[0];
  const draft = versions.find((v) => !v.published_at);
  return (
    <span className="flex flex-wrap gap-1.5">
      {current ? <StatusPill tone="good">Current: version {current.version}</StatusPill> : null}
      {next ? <StatusPill>Update on {formatDate(next.effective_from, tz)}</StatusPill> : null}
      {draft ? <StatusPill tone="warn">Draft</StatusPill> : null}
      {!current && !next && !draft ? <StatusPill>Not started</StatusPill> : null}
    </span>
  );
}

export default async function CoachProgrammesPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const [{ archived }, session] = await Promise.all([searchParams, requireCoach("/coach/programmes")]);
  const tz = session.provider.timezone;
  const supabase = (await createClient())!;
  const clients = await myClients();
  const templates = await myTemplates(session.provider.id, { includeArchived: archived === "1" });

  // This coach's own plans for current clients, with version timing only.
  const ids = (clients ?? []).map((c) => c.enrollment_id);
  const { data: plans } = ids.length
    ? await supabase.from("client_plans").select("id, enrollment_id, kind").in("enrollment_id", ids).eq("provider_id", session.provider.id)
    : { data: [] };
  const { data: versions } = plans?.length
    ? await supabase.from("client_plan_versions").select("id, plan_id, version, published_at, effective_from, withdrawn_at").in("plan_id", plans.map((p) => p.id))
    : { data: [] };
  const versionsFor = (enrollmentId: string, kind: PlanKind) => {
    const plan = plans?.find((p) => p.enrollment_id === enrollmentId && p.kind === kind);
    return plan ? ((versions ?? []) as Row[]).filter((v) => v.plan_id === plan.id) : undefined;
  };

  return (
    <div>
      <PageHeader title="Programmes">
        Workout and nutrition plans for your clients. You decide what each client does and when it changes; clients are told only when you publish.
      </PageHeader>

      <Panel title="Your clients" id="clients">
        {clients === null ? (
          <p role="alert">Your clients couldn&rsquo;t be loaded. Refresh to try again.</p>
        ) : clients.length === 0 ? (
          <EmptyState icon="clients" title="No clients yet" headingLevel="h3">
            When someone signs up to one of your plans, you can write their programme here.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {clients.map((c) => (
              <li key={c.enrollment_id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="text-lg font-semibold">{c.client_name}</p>
                  <p className="text-ink-muted">{c.offer_title}</p>
                  <div className="mt-2 grid gap-1.5">
                    {(["workout", "nutrition"] as const).map((k) => (
                      <p key={k} className="flex flex-wrap items-center gap-2">
                        <span className="w-32 shrink-0 text-sm font-semibold">{KIND_LABEL[k]}</span>
                        <PlanState versions={versionsFor(c.enrollment_id, k)} tz={tz} />
                      </p>
                    ))}
                  </div>
                </div>
                <ButtonLink href={`/coach/programmes/clients/${c.enrollment_id}`} variant="secondary">
                  Open<span className="sr-only"> {c.client_name}&rsquo;s plans</span>
                </ButtonLink>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Templates"
        id="templates"
        description="Reusable starting points. Copying one into a client's plan makes an independent copy — editing the template later never changes a client's plan."
      >
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/coach/programmes/templates/new?kind=workout" variant="secondary">New workout template</ButtonLink>
          <ButtonLink href="/coach/programmes/templates/new?kind=nutrition" variant="secondary">New nutrition template</ButtonLink>
        </div>
        {templates.length ? (
          <ul className="mt-5 divide-y divide-line">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <Link href={`/coach/programmes/templates/${t.id}`} className="font-semibold text-brand underline underline-offset-4">{t.title}</Link>
                  <p className="text-sm text-ink-muted">
                    {KIND_LABEL[t.kind]} · edited {formatDate(t.updated_at, tz)}
                  </p>
                </div>
                {t.archived_at ? <StatusPill>Archived</StatusPill> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-ink-muted">No templates yet.</p>
        )}
        <p className="mt-4 text-sm">
          {archived === "1" ? <Link href="/coach/programmes#templates" className="text-brand underline">Hide archived templates</Link> : <Link href="/coach/programmes?archived=1#templates" className="text-brand underline">Show archived templates</Link>}
        </p>
      </Panel>
    </div>
  );
}
