import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { Notice, PageHeader, Panel } from "@/components/ui/panel";
import { PlanForm } from "@/components/programmes/plan-form";
import { PlanningContextPanel } from "@/components/programmes/planning-context";
import { discardDraftAction, savePlanAction } from "@/lib/programmes/actions";
import { coachingIsLive, myClient, planningContext, plansForEnrollment } from "@/lib/programmes/server";
import { addDays, emptyContent, localDate, scheduledVersions, versionInForce, type PlanKind } from "@/lib/programmes/content";
import { KIND_LABEL } from "@/lib/programmes/labels";
import { zoneCity } from "@/lib/format";

export const metadata = { title: "Edit plan" };
export const dynamic = "force-dynamic";

export default async function EditPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string; kind: string }>;
  searchParams: Promise<{ copied?: string }>;
}) {
  const [{ enrollmentId, kind: k }, { copied }] = await Promise.all([params, searchParams]);
  if (k !== "workout" && k !== "nutrition") notFound();
  const kind = k as PlanKind;
  const session = await requireCoach(`/coach/programmes/clients/${enrollmentId}/${kind}`);
  const client = await myClient(enrollmentId);
  if (!client) notFound();

  const [live, ctx, plans] = await Promise.all([coachingIsLive(enrollmentId), planningContext(enrollmentId), plansForEnrollment(enrollmentId)]);
  const base = `/coach/programmes/clients/${enrollmentId}`;
  if (!live) {
    return (
      <div className="mx-auto max-w-3xl">
        <p><Link href={base} className="text-brand underline underline-offset-4">← {client.client_name}</Link></p>
        <PageHeader title={KIND_LABEL[kind]} />
        <Notice tone="bad">Coaching with {client.client_name} is paused, so this plan can&rsquo;t be changed right now. You can still read every version.</Notice>
      </div>
    );
  }

  const plan = plans.find((p) => p.kind === kind && p.provider_id === session.provider.id);
  const versions = plan?.versions ?? [];
  const draft = versions.find((v) => !v.published_at);
  const now = new Date();
  // A revision starts from the newest decision: the latest scheduled update if
  // there is one, otherwise the version in force. Keys carry over, so an
  // exercise the coach keeps stays "the same exercise" for progress.
  const startingPoint = draft ?? scheduledVersions(versions, now).at(-1) ?? versionInForce(versions, now) ?? null;
  const published = versions.filter((v) => v.published_at);
  const tz = ctx?.timezone ?? null;

  return (
    <div className="mx-auto max-w-3xl">
      <p><Link href={base} className="text-brand underline underline-offset-4">← {client.client_name}</Link></p>
      <PageHeader title={`${KIND_LABEL[kind]} for ${client.client_name}`}>
        {draft
          ? `Draft version ${draft.version}. Your client can't see it until you publish.`
          : startingPoint
            ? `Editing starts a new draft from version ${startingPoint.version}. What your client has now stays as it is until you publish.`
            : "Nothing is published yet. Save as often as you like — your client sees nothing until you publish."}
      </PageHeader>
      {copied ? <Notice>Copied into a new draft. It&rsquo;s independent: changes to the original won&rsquo;t reach it.</Notice> : null}

      <Panel title={`What ${client.client_name} has told you`} id="context">
        <details open={!startingPoint}>
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-brand underline underline-offset-4">Experience, equipment, time, limitations{kind === "nutrition" ? ", food and allergies" : ""}</summary>
          <div className="mt-3">{ctx ? <PlanningContextPanel ctx={ctx} timeZone={session.provider.timezone} focus={kind} /> : null}</div>
        </details>
      </Panel>

      <div className="mt-8">
        <PlanForm
          action={savePlanAction}
          kind={kind}
          title={startingPoint?.title ?? ""}
          content={startingPoint?.content ?? emptyContent(kind)}
          hidden={{ enrollment_id: enrollmentId }}
          publish={{ first: published.length === 0, minDate: addDays(localDate(now, tz), 1), tzLabel: tz ? zoneCity(tz) : "UTC" }}
          saveLabel="Save draft"
        />
      </div>

      {draft && plan ? (
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Link href={`${base}/${kind}/preview`} className="font-semibold text-brand underline underline-offset-4">Preview the saved draft as your client</Link>
          <ActionForm action={discardDraftAction}>
            <input type="hidden" name="plan_id" value={plan.id} />
            <input type="hidden" name="enrollment_id" value={enrollmentId} />
            <input type="hidden" name="kind" value={kind} />
            <SubmitButton pendingLabel="Discarding…" variant="quiet">Discard draft</SubmitButton>
          </ActionForm>
        </div>
      ) : null}
    </div>
  );
}
