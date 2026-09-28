import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOnboarded } from "@/lib/auth";
import { ButtonLink } from "@/components/button";
import { EmptyState } from "@/components/ui/empty-state";
import { myEnrollments } from "@/lib/programmes/server";

export const metadata: Metadata = { title: "Your plan" };
export const dynamic = "force-dynamic";

export default async function PlanIndexPage() {
  const session = await requireOnboarded("/account/plan");
  const enrollments = (await myEnrollments(session.userId)).filter((e) => e.state !== "pending");
  const current = enrollments.filter((e) => e.state === "active" || e.state === "paused");
  if (current.length === 1 && enrollments.length === 1) redirect(`/account/plan/${current[0].id}`);

  return (
    <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20">
      <p><Link href="/account" className="text-brand underline underline-offset-4">← Your account</Link></p>
      <h1 className="mt-4 font-display text-4xl">Your plan</h1>
      {enrollments.length === 0 ? (
        <EmptyState className="mt-8" headingLevel="h2" icon="training" title="No coaching yet" actions={<ButtonLink href="/coaches">Find a coach</ButtonLink>}>
          When you start coaching, the workouts and nutrition guidance your coach writes for you appear here.
        </EmptyState>
      ) : (
        <ul className="mt-8 space-y-3">
          {enrollments.map((e) => (
            <li key={e.id}>
              <Link href={`/account/plan/${e.id}`} className="block rounded-xl border border-line bg-surface p-5 hover:border-brand">
                <span className="block text-lg font-semibold">{e.planTitle}</span>
                <span className="block text-ink-muted">
                  with {e.coachName}
                  {e.state === "ended" ? " · ended — your plans stay here to read" : e.state === "paused" ? " · paused" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
