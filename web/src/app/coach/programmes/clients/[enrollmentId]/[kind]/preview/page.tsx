import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { Notice, PageHeader } from "@/components/ui/panel";
import { PlanWeek, Paragraphs } from "@/components/programmes/workout-view";
import { NutritionView } from "@/components/programmes/nutrition-view";
import { myClient, plansForEnrollment } from "@/lib/programmes/server";
import { VERSION_STATUS_LABEL, versionInForce, versionStatus, type NutritionContent, type PlanKind, type WorkoutContent } from "@/lib/programmes/content";
import { KIND_LABEL } from "@/lib/programmes/labels";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Preview plan" };
export const dynamic = "force-dynamic";

export default async function PreviewPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string; kind: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const [{ enrollmentId, kind: k }, { v }] = await Promise.all([params, searchParams]);
  if (k !== "workout" && k !== "nutrition") notFound();
  const kind = k as PlanKind;
  const session = await requireCoach(`/coach/programmes/clients/${enrollmentId}/${kind}/preview`);
  const client = await myClient(enrollmentId);
  if (!client) notFound();

  // Row-level security has already decided which versions are visible: this
  // coach's own (drafts included), and an earlier coach's published versions
  // only within the client's sharing choice.
  const plans = (await plansForEnrollment(enrollmentId)).filter((p) => p.kind === kind);
  const all = plans.flatMap((p) => p.versions.map((x) => ({ ...x, plan: p })));
  const own = plans.find((p) => p.provider_id === session.provider.id);
  const current = own ? versionInForce(own.versions, new Date()) : null;
  const version = v
    ? all.find((x) => x.id === v)
    : all.find((x) => !x.published_at && x.plan.provider_id === session.provider.id) ?? all.find((x) => x.id === current?.id);
  if (!version) notFound();
  const siblings = version.plan.versions;
  const status = versionStatus(version, siblings, new Date());
  const tz = session.provider.timezone;

  return (
    <div className="mx-auto max-w-3xl">
      <p><Link href={`/coach/programmes/clients/${enrollmentId}`} className="text-brand underline underline-offset-4">← {client.client_name}</Link></p>
      <PageHeader title={version.title}>
        {KIND_LABEL[kind]} · version {version.version} · {VERSION_STATUS_LABEL[status]}
        {version.plan.provider_id !== session.provider.id ? ` · written by ${version.plan.coachName}` : ""}
      </PageHeader>
      <Notice>
        {status === "draft"
          ? "Preview: this is exactly how your client will see it once published. They can't see it yet."
          : status === "scheduled"
            ? `Your client sees this from ${formatDate(version.effective_from, tz, true)}.`
            : "This is what your client sees for this version. Published versions never change."}
      </Notice>
      {version.change_summary ? (
        <div className="mt-4 rounded-lg border border-line p-3">
          <p className="font-semibold">What changed</p>
          <Paragraphs text={version.change_summary} />
        </div>
      ) : null}
      <div className="mt-6">
        {kind === "workout" ? <PlanWeek content={version.content as WorkoutContent} /> : <NutritionView content={version.content as NutritionContent} />}
      </div>
    </div>
  );
}
