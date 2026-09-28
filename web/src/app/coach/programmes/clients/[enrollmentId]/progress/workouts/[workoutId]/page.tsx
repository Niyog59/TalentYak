import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { PageHeader } from "@/components/ui/panel";
import { WorkoutDetail } from "@/components/tracking/workout-detail";
import { formatDate } from "@/lib/format";
import { myClient, plansForEnrollment } from "@/lib/programmes/server";
import { clientBasics, sessionFrom, workoutById } from "@/lib/tracking/server";

export const metadata = { title: "Client workout" };
export const dynamic = "force-dynamic";

export default async function CoachWorkoutPage({ params }: { params: Promise<{ enrollmentId: string; workoutId: string }> }) {
  const { enrollmentId, workoutId } = await params;
  const base = `/coach/programmes/clients/${enrollmentId}/progress`;
  await requireCoach(`${base}/workouts/${workoutId}`);
  const client = await myClient(enrollmentId);
  if (!client) notFound();
  // Row-level security returns it only if this coach may see it.
  const [stored, plans, basics] = await Promise.all([workoutById(workoutId), plansForEnrollment(enrollmentId), clientBasics(enrollmentId)]);
  if (!stored || stored.doc.enrollmentId !== enrollmentId) notFound();
  const planned = sessionFrom(plans, stored.doc.planVersionId, stored.doc.sessionKey);
  const heading = planned?.session.title ?? stored.doc.title ?? "Workout";

  return (
    <div className="mx-auto max-w-3xl">
      <p><Link href={base} className="text-brand underline underline-offset-4">← {client.client_name}&rsquo;s progress</Link></p>
      <PageHeader title={heading}>As {client.client_name} recorded it. Read-only.</PageHeader>
      <div className="mt-6">
        <WorkoutDetail
          doc={stored.doc}
          session={planned?.session ?? null}
          versionLabel={planned ? `Performed against version ${planned.version.version} of the plan (“${planned.version.title}”, in force from ${formatDate(planned.version.effective_from, basics?.timezone ?? null)}).` : stored.doc.planVersionId ? "Performed against a plan version you can't see." : null}
          finishedAt={stored.finishedAt}
          updatedAt={stored.updatedAt}
          timeZone={basics?.timezone ?? null}
        />
      </div>
    </div>
  );
}
