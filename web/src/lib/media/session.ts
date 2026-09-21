import "server-only";
import { getSession, isOnboarded, type SessionContext } from "@/lib/auth";

/**
 * The signed-in person for a media route, or null.
 *
 * Route handlers answer with a status code rather than redirecting the way a
 * page does: an uploader that followed a redirect to the sign-in page would
 * report a baffling failure instead of "sign in again".
 */
export async function mediaSession(): Promise<SessionContext | null> {
  const session = await getSession();
  if (!session || !isOnboarded(session) || session.profile.suspended_at) return null;
  return session;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
