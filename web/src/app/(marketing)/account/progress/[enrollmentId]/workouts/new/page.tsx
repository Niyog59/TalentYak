import { randomUUID } from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { addDays, isDateOnly, isKey } from "@/lib/programmes/content";
import { cleanText } from "@/lib/expectations/text";
import { clientTracking } from "@/lib/tracking/context";
import { sessionFrom, workoutForSessionDay } from "@/lib/tracking/server";

export const dynamic = "force-dynamic";

/**
 * Starting a workout. A planned session already recorded for that day opens
 * the existing record — never a second one. Otherwise the workout gets its id
 * here, in the address, so a refresh keeps the same one.
 */
export default async function NewWorkoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ enrollmentId: string }>;
  searchParams: Promise<{ version?: string; session?: string; date?: string; title?: string }>;
}) {
  const [{ enrollmentId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await clientTracking(enrollmentId, `/account/progress/${enrollmentId}/workouts`);
  const date = isDateOnly(sp.date) && sp.date <= addDays(ctx.today, 1) ? sp.date : ctx.today;
  const base = `${ctx.base}/workouts`;

  if (isKey(sp.version) && isKey(sp.session)) {
    if (!sessionFrom(ctx.plans, sp.version, sp.session)) notFound();
    const existing = await workoutForSessionDay(enrollmentId, sp.session, date);
    if (existing) redirect(`${base}/${existing.id}`);
    redirect(`${base}/${randomUUID()}?${new URLSearchParams({ version: sp.version, session: sp.session, date }).toString()}`);
  }

  const title = cleanText(sp.title, 80);
  if (!title) redirect(base);
  redirect(`${base}/${randomUUID()}?${new URLSearchParams({ title, date }).toString()}`);
}
