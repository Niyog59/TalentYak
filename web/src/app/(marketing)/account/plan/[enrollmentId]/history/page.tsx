import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOnboarded } from "@/lib/auth";
import { PlanWeek, Paragraphs } from "@/components/programmes/workout-view";
import { NutritionView } from "@/components/programmes/nutrition-view";
import { VersionHistory } from "@/components/programmes/version-history";
import { myEnrollments, plansForEnrollment } from "@/lib/programmes/server";
import { VERSION_STATUS_LABEL, versionStatus, type NutritionContent, type WorkoutContent } from "@/lib/programmes/content";
import { KIND_LABEL } from "@/lib/programmes/labels";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Plan history" };
export const dynamic = "force-dynamic";

export default async function PlanHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const [{ enrollmentId }, { v }] = await Promise.all([params, searchParams]);
  const session = await requireOnboarded(`/account/plan/${enrollmentId}/history`);
  const tz = session.profile.timezone;
  const enrollment = (await myEnrollments(session.userId)).find((e) => e.id === enrollmentId);
  if (!enrollment) notFound();

  // Row-level security returns published versions only: a client never sees a draft.
  const plans = (await plansForEnrollment(enrollmentId)).filter((p) => p.versions.length);
  const base = `/account/plan/${enrollmentId}`;
  const selected = v ? plans.flatMap((p) => p.versions.map((x) => ({ ...x, plan: p }))).find((x) => x.id === v) : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-16">
      <p><Link href={base} className="text-brand underline underline-offset-4">← Your plan</Link></p>
      <h1 className="mt-4 font-display text-4xl">History of your plans</h1>
      <p className="mt-2 text-ink-muted">Every version your coach has published. Earlier versions never change.</p>

      {selected ? (
        <section aria-labelledby="version-heading" className="mt-8 rounded-2xl border border-line-strong bg-surface p-4 sm:p-6">
          <h2 id="version-heading" className="text-2xl font-semibold">{selected.title}</h2>
          <p className="mt-1 text-ink-muted">
            {KIND_LABEL[selected.plan.kind]} · version {selected.version} · {VERSION_STATUS_LABEL[versionStatus(selected, selected.plan.versions, new Date())]} · from {selected.plan.coachName} · starts {formatDate(selected.effective_from, tz, true)}
          </p>
          {selected.change_summary ? (
            <div className="mt-3 rounded-lg border border-line p-3">
              <p className="font-semibold">What changed</p>
              <Paragraphs text={selected.change_summary} />
            </div>
          ) : null}
          <div className="mt-5">
            {selected.plan.kind === "workout" ? <PlanWeek content={selected.content as WorkoutContent} /> : <NutritionView content={selected.content as NutritionContent} />}
          </div>
          <p className="mt-4"><Link href={`${base}/history`} className="text-brand underline underline-offset-4">Close this version</Link></p>
        </section>
      ) : null}

      {plans.length === 0 ? (
        <p className="mt-8 text-ink-muted">Nothing has been published yet.</p>
      ) : (
        plans.map((p) => (
          <section key={p.id} aria-labelledby={`plan-${p.id}`} className="mt-8 rounded-2xl border border-line bg-surface p-4 sm:p-6">
            <h2 id={`plan-${p.id}`} className="text-xl font-semibold">{KIND_LABEL[p.kind]} from {p.coachName}</h2>
            <div className="mt-2">
              <VersionHistory versions={p.versions} timeZone={tz} hrefFor={(x) => `${base}/history?v=${x.id}#version-heading`} />
            </div>
          </section>
        ))
      )}
    </div>
  );
}
