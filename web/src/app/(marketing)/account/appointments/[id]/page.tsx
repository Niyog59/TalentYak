import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOnboarded } from "@/lib/auth";
import { AppointmentDetailView } from "@/components/scheduling/appointment-detail";
import { coachScheduleSettings, loadAppointment } from "@/lib/scheduling/server";

export const metadata: Metadata = { title: "Session", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CustomerAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireOnboarded(`/account/appointments/${id}`);
  const a = await loadAppointment(id, "customer");
  // Another person's session reads exactly like one that doesn't exist.
  if (!a || a.customer_id !== session.userId) notFound();
  const settings = await coachScheduleSettings(a.provider_id);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-14">
      <AppointmentDetailView a={a} role="customer" viewerId={session.userId} viewerTz={session.profile.timezone ?? "UTC"} durations={settings.durations_minutes} backHref="/account/appointments" />
    </div>
  );
}
