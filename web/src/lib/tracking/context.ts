import "server-only";
import { notFound } from "next/navigation";
import { requireOnboarded, type SessionContext } from "@/lib/auth";
import { localDate } from "@/lib/programmes/content";
import { myEnrollments, plansForEnrollment, type ClientPlan, type MyEnrollment } from "@/lib/programmes/server";
import { trackingFocus, trackingPreferences, trackingWriteState, type TrackingFocus, type TrackingPreferences, type WriteState } from "@/lib/tracking/server";
import { zoneCity } from "@/lib/format";

export interface ClientTrackingContext {
  session: SessionContext;
  enrollment: MyEnrollment;
  plans: ClientPlan[];
  writeState: WriteState;
  prefs: TrackingPreferences;
  focus: TrackingFocus | null;
  tz: string | null;
  zoneLabel: string;
  today: string;
  base: string;
}

/** The signed-in client's own relationship, or a 404 — never someone else's. */
export async function clientTracking(enrollmentId: string, path: string): Promise<ClientTrackingContext> {
  const session = await requireOnboarded(path);
  const enrollment = (await myEnrollments(session.userId)).find((e) => e.id === enrollmentId);
  if (!enrollment) notFound();
  const [plans, writeState, prefs, focus] = await Promise.all([
    plansForEnrollment(enrollmentId),
    trackingWriteState(enrollmentId),
    trackingPreferences(session.userId),
    trackingFocus(enrollmentId, enrollment.openAssignmentId),
  ]);
  const tz = session.profile.timezone;
  return {
    session,
    enrollment,
    plans,
    writeState,
    prefs,
    focus,
    tz,
    zoneLabel: tz ? zoneCity(tz) : "UTC",
    today: localDate(new Date(), tz),
    base: `/account/progress/${enrollmentId}`,
  };
}
