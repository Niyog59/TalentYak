import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationCategory } from "@/lib/notifications";

/**
 * What must still be true at the moment of sending.
 *
 * A queued job describes the world as it was when something happened. By the
 * time a worker picks it up — seconds later, or hours later after a retry — the
 * world may have moved on: the session was cancelled, the time changed, the
 * coach was reassigned, the person read the message, the person switched the
 * email off, the account was suspended.
 *
 * Sending anyway is not a harmless mistake. A reminder for a cancelled session
 * makes somebody turn up. A "new message" email for a message already read is
 * noise that teaches people to ignore us. A notification to a coach who was
 * reassigned yesterday is a disclosure.
 *
 * So every non-trivial send rechecks its own preconditions here, immediately
 * before calling the provider. A failed recheck is NOT an error: the job is
 * finished as `done` with a reason recorded, because the right thing happened.
 */

export type Decision = { proceed: true } | { proceed: false; reason: string };

export const PROCEED: Decision = { proceed: true };
const skip = (reason: string): Decision => ({ proceed: false, reason });

/**
 * The recipient must still exist and still be able to use the account.
 * A suspended account is not emailed about anything except the suspension
 * itself, which is queued under a topic that does not call this.
 */
export async function recipientStillValid(admin: SupabaseClient, profileId: string): Promise<Decision> {
  const { data } = await admin
    .from("profiles")
    .select("id, email, suspended_at")
    .eq("id", profileId)
    .maybeSingle();

  // A deleted account removes its profile row (the foreign key to auth.users
  // cascades), so "no longer exists" covers deletion too.
  if (!data) return skip("recipient no longer exists");
  if (data.suspended_at) return skip("recipient account is suspended");
  if (!data.email) return skip("recipient has no email address");
  return PROCEED;
}

/**
 * The preference is checked again here, not only when the job was queued.
 * Somebody who switches "session reminders" off should not receive the one
 * that was already sitting in the queue.
 */
export async function emailStillWanted(
  admin: SupabaseClient,
  profileId: string,
  category: NotificationCategory,
): Promise<Decision> {
  const { data, error } = await admin.rpc("notification_email_allowed", {
    p_profile_id: profileId,
    p_category: category,
  });
  if (error) throw new Error(`preference recheck failed: ${error.message}`);
  return data === true ? PROCEED : skip(`recipient has switched off ${category} email`);
}

export interface AppointmentExpectation {
  /** The start time the queued message describes. A moved session invalidates it. */
  startsAt?: string;
  /** Who this message is for. They must still be party to the appointment. */
  recipientProfileId?: string;
  /** Reminders are pointless once the session has begun. */
  mustBeInFuture?: boolean;
}

const LIVE_STATES = new Set(["held", "booked"]);

/**
 * The appointment must still exist, still be live, still be at the time the
 * message describes, and the recipient must still be party to it.
 *
 * `updated_at` is not used as the version token: a touch that changed nothing a
 * reader would notice should not suppress a reminder. What matters is the facts
 * the message actually states.
 */
export async function appointmentStillCurrent(
  admin: SupabaseClient,
  appointmentId: string,
  expect: AppointmentExpectation = {},
): Promise<Decision> {
  const { data } = await admin
    .from("appointments")
    .select("id, state, starts_at, customer_id, provider_id, providers(profile_id)")
    .eq("id", appointmentId)
    .maybeSingle();

  if (!data) return skip("appointment no longer exists");
  if (!LIVE_STATES.has(data.state)) return skip(`appointment is ${data.state}`);

  if (expect.startsAt) {
    const queued = new Date(expect.startsAt).getTime();
    const current = new Date(data.starts_at).getTime();
    if (!Number.isFinite(queued) || queued !== current) {
      return skip("appointment has been rescheduled since this was queued");
    }
  }

  if (expect.mustBeInFuture && new Date(data.starts_at).getTime() <= Date.now()) {
    return skip("appointment has already started");
  }

  if (expect.recipientProfileId) {
    const provider = data.providers as unknown as { profile_id?: string } | { profile_id?: string }[] | null;
    const providerProfileId = Array.isArray(provider) ? provider[0]?.profile_id : provider?.profile_id;
    const isParty =
      data.customer_id === expect.recipientProfileId || providerProfileId === expect.recipientProfileId;
    // A coach who was reassigned off this client is no longer a party to it.
    if (!isParty) return skip("recipient is no longer party to this appointment");
  }

  return PROCEED;
}

/**
 * How many messages are still unread by this person in this conversation, past
 * the point the email was queued at — and zero if they can no longer read the
 * conversation at all (reassigned, suspended, relationship closed to them).
 * Asked immediately before sending, so a message read in the meantime, or on
 * another device, is never emailed about.
 */
export async function unreadMessageCount(
  admin: SupabaseClient,
  profileId: string,
  conversationId: string,
  sinceSeq: number,
): Promise<number | null> {
  const { data, error } = await admin.rpc("unread_message_count", {
    p_profile: profileId,
    p_conversation: conversationId,
    p_since_seq: sinceSeq,
  });
  if (error) return null;
  return Number(data ?? 0);
}

/**
 * A feature the founder has switched off in an emergency sends nothing about
 * itself. Only an explicit "off" skips: a notice about something that already
 * happened is still true while a feature is merely paused.
 */
export async function featureNotSwitchedOff(admin: SupabaseClient, key: string): Promise<Decision> {
  const { data, error } = await admin.rpc("feature_mode", { p_key: key });
  if (error) throw new Error(`feature recheck failed: ${error.message}`);
  return data === "off" ? skip(`${key} is switched off`) : PROCEED;
}
