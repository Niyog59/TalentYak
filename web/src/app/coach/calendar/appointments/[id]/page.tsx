import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/auth";
import { AppointmentDetailView } from "@/components/scheduling/appointment-detail";
import { coachScheduleSettings, loadAppointment } from "@/lib/scheduling/server";

export const metadata = { title: "Session" };
export const dynamic = "force-dynamic";

export default async function CoachAppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireCoach(`/coach/calendar/appointments/${id}`);
  const a = await loadAppointment(id, "coach");
  if (!a || a.provider_id !== session.provider.id) notFound();
  const settings = await coachScheduleSettings(session.provider.id);
  return (
    <div className="mx-auto max-w-3xl">
      <AppointmentDetailView a={a} role="coach" viewerId={session.userId} viewerTz={session.provider.timezone ?? "UTC"} durations={settings.durations_minutes} backHref="/coach/calendar" />
    </div>
  );
}
