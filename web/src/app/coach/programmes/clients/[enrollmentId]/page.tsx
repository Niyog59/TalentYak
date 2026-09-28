import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { ButtonLink } from "@/components/button";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, SubmitButton } from "@/components/form/fields";
import { Notice, PageHeader, Panel } from "@/components/ui/panel";
import { PlanningContextPanel } from "@/components/programmes/planning-context";
import { VersionHistory } from "@/components/programmes/version-history";
import { startDraftFromAction, withdrawScheduledAction } from "@/lib/programmes/actions";
import { coachingIsLive, myClient, myTemplates, planningContext, plansForEnrollment, type ClientPlan } from "@/lib/programmes/server";
import { versionInForce, scheduledVersions, type PlanKind } from "@/lib/programmes/content";
import { KIND_LABEL } from "@/lib/programmes/labels";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Client programme" };
export const dynamic = "force-dynamic";

export default async function CoachClientProgrammePage({ params }: { params: Promise<{ enrollmentId: string }> }) {
  const { enrollmentId } = await params;
  const session = await requireCoach(`/coach/programmes/clients/${enrollmentId}`);
  const tz = session.provider.timezone;

  // Only a client currently assigned to this coach. A former coach, or another
  // coach's client, gets "not found" — and the database would refuse anyway.
  const client = await myClient(enrollmentId);
  if (!client) notFound();

  const [live, ctx, plans, templates] = await Promise.all([
    coachingIsLive(enrollmentId),
    planningContext(enrollmentId),
    plansForEnrollment(enrollmentId),
    myTemplates(session.provider.id),
  ]);
  const now = new Date();
  const mine = (kind: PlanKind) => plans.find((p) => p.kind === kind && p.provider_id === session.provider.id);
  const earlier = (kind: PlanKind) => plans.filter((p) => p.kind === kind && p.provider_id !== session.provider.id && p.versions.length);
  const base = `/coach/programmes/clients/${enrollmentId}`;

  function kindPanel(kind: PlanKind) {
    const plan = mine(kind);
    const versions = plan?.versions ?? [];
    const draft = versions.find((v) => !v.published_at);
    const current = versionInForce(versions, now);
    const next = scheduledVersions(versions, now);
    const kindTemplates = templates.filter((t) => t.kind === kind);
    const previous: ClientPlan[] = earlier(kind);

    return (
      <Panel key={kind} title={KIND_LABEL[kind]} id={kind}>
        <ul className="space-y-1.5">
          <li>
            <span className="font-semibold">Current: </span>
            {current ? <>version {current.version}, &ldquo;{current.title}&rdquo;, since {formatDate(current.effective_from, tz)}</> : <span className="text-ink-muted">nothing published yet</span>}
          </li>
          {next.map((v) => (
            <li key={v.id}><span className="font-semibold">Scheduled: </span>version {v.version} starts {formatDate(v.effective_from, ctx?.timezone ?? tz)}, at the start of {client!.client_name}&rsquo;s day</li>
          ))}
          <li>
            <span className="font-semibold">Draft: </span>
            {draft ? <>version {draft.version}, saved {formatDate(draft.updated_at, tz, true)} — your client can&rsquo;t see it</> : <span className="text-ink-muted">none</span>}
          </li>
        </ul>

        <div className="mt-4 flex flex-wrap gap-3">
          {live ? (
            <ButtonLink href={`${base}/${kind}`}>
              {draft ? "Continue the draft" : current || next.length ? "Start an update" : "Write the first version"}
            </ButtonLink>
          ) : null}
          {draft || current ? (
            <ButtonLink href={`${base}/${kind}/preview${draft ? "" : `?v=${current!.id}`}`} variant="secondary">
              Preview as your client
            </ButtonLink>
          ) : null}
        </div>

        {live && !draft && kindTemplates.length ? (
          <ActionForm action={startDraftFromAction} className="mt-5 grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <input type="hidden" name="enrollment_id" value={enrollmentId} />
            <input type="hidden" name="kind" value={kind} />
            <SelectField name="template_id" label="Or start a draft from one of your templates" required options={kindTemplates.map((t) => ({ value: t.id, label: t.title }))} />
            <SubmitButton pendingLabel="Copying…" variant="secondary">Copy into a draft</SubmitButton>
            <p className="text-sm text-ink-muted sm:col-span-2">An independent copy for {client!.client_name}: later changes to the template won&rsquo;t touch it.</p>
          </ActionForm>
        ) : null}
        {live && draft ? (
          <p className="mt-4 text-sm text-ink-muted">To start from a template or an earlier plan instead, publish or discard your draft first.</p>
        ) : null}

        {plan ? (
          <div className="mt-6">
            <h3 className="font-semibold">Versions</h3>
            <VersionHistory
              versions={versions}
              timeZone={tz}
              hrefFor={(v) => `${base}/${kind}/preview?v=${v.id}`}
              actionsFor={(v, status) =>
                status === "scheduled" && live ? (
                  <ActionForm action={withdrawScheduledAction}>
                    <input type="hidden" name="version_id" value={v.id} />
                    <input type="hidden" name="enrollment_id" value={enrollmentId} />
                    <input type="hidden" name="kind" value={kind} />
                    <SubmitButton pendingLabel="Cancelling…" variant="secondary">Cancel this planned update</SubmitButton>
                  </ActionForm>
                ) : null
              }
            />
          </div>
        ) : null}

        {previous.map((p) => (
          <div key={p.id} className="mt-6 rounded-lg border border-line-strong bg-paper-raised p-4">
            <h3 className="font-semibold">From {p.coachName}, {client!.client_name}&rsquo;s previous coach</h3>
            <p className="text-sm text-ink-muted">Shared with you because of what {client!.client_name} agreed when changing coach. Their versions stay credited to them and can&rsquo;t be changed.</p>
            <div className="mt-2">
              <VersionHistory
                versions={p.versions}
                timeZone={tz}
                hrefFor={(v) => `${base}/${kind}/preview?v=${v.id}`}
                actionsFor={(v) =>
                  live && !draft ? (
                    <ActionForm action={startDraftFromAction}>
                      <input type="hidden" name="enrollment_id" value={enrollmentId} />
                      <input type="hidden" name="kind" value={kind} />
                      <input type="hidden" name="version_id" value={v.id} />
                      <SubmitButton pendingLabel="Copying…" variant="secondary">Start my draft from a copy of this</SubmitButton>
                    </ActionForm>
                  ) : null
                }
              />
            </div>
          </div>
        ))}
      </Panel>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p><Link href="/coach/programmes" className="text-brand underline underline-offset-4">← Programmes</Link></p>
      <PageHeader title={client.client_name}>{client.offer_title}</PageHeader>
      <nav aria-label="Client" className="mt-4 flex flex-wrap gap-3">
        <ButtonLink href={`${base}/progress`} variant="secondary" size="sm">Progress and logs</ButtonLink>
      </nav>

      {!live ? (
        <Notice tone="bad">
          Coaching with {client.client_name} is paused, so plans are read-only for now. Nothing is lost: everything is here when coaching resumes.
        </Notice>
      ) : null}

      <Panel title={`What ${client.client_name} has told you`} id="context" description="For planning. Updated by your client whenever things change.">
        {ctx ? <PlanningContextPanel ctx={ctx} timeZone={tz} /> : <p className="text-ink-muted">Not available right now.</p>}
      </Panel>

      {kindPanel("workout")}
      {kindPanel("nutrition")}
    </div>
  );
}
