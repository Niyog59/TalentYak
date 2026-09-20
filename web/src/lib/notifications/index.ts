import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Telling somebody something.
 *
 * One call writes to the person's inbox and, when the category allows it and
 * they have not switched it off, queues the email. The inbox row is written
 * FIRST and immediately, so the record exists whether or not the email is ever
 * accepted by a provider — and so a person who has switched email off is still
 * told, in the place they can go and look.
 *
 * The preference is checked twice on purpose: here, to avoid queueing an email
 * nobody wants, and again in the worker immediately before sending, because a
 * person may switch it off in the minutes between. See `lib/worker/recheck.ts`.
 *
 * WHAT MAY GO IN A TITLE OR BODY. A summary the server wrote. Never message
 * text, never anything about a body, an injury, a weight, a ceremony or a
 * person who has died. "You have 3 unread messages from Anjali" is a summary;
 * the message itself is not. Titles reach lock screens and email subject lines.
 */

export type NotificationCategory =
  | "account_security"
  | "billing"
  | "coaching"
  | "appointments"
  | "data_and_privacy"
  | "appointment_reminders"
  | "messages"
  | "expectations"
  | "product_updates";

export interface NotifyArgs {
  profileId: string;
  category: NotificationCategory;
  /** A summary, 160 characters or fewer. Never content. */
  title: string;
  /** A longer summary, 600 characters or fewer. Never content. */
  body?: string;
  /** Same-site path the person goes to in order to act on it. */
  path?: string;
  /** One notification per event per person, however often the producer fires. */
  dedupeKey?: string;
  /** The email to queue alongside it, if any. */
  email?: {
    topic: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
    scheduledFor?: Date;
    expiresAt?: Date;
  };
}

export interface NotifyResult {
  notificationId: string | null;
  outboxId: string | null;
  emailSuppressed: boolean;
}

/**
 * True when this person may be emailed about this category right now.
 * Essential categories always return true — they are how an account is
 * operated safely, and the database refuses to switch them off.
 */
export async function emailAllowed(
  admin: SupabaseClient,
  profileId: string,
  category: NotificationCategory,
): Promise<boolean> {
  const { data, error } = await admin.rpc("notification_email_allowed", {
    p_profile_id: profileId,
    p_category: category,
  });
  if (error) throw new Error(`preference check failed: ${error.message}`);
  return data === true;
}

export async function notify(args: NotifyArgs): Promise<NotifyResult> {
  const admin = createAdminClient();
  if (!admin) return { notificationId: null, outboxId: null, emailSuppressed: false };

  const allowed = args.email ? await emailAllowed(admin, args.profileId, args.category) : false;

  let outboxId: string | null = null;
  if (args.email && allowed) {
    const { data, error } = await admin.rpc("enqueue_outbox", {
      p_topic: args.email.topic,
      p_payload: args.email.payload,
      p_dedupe_key: args.email.dedupeKey,
      ...(args.email.scheduledFor ? { p_scheduled_for: args.email.scheduledFor.toISOString() } : {}),
      p_expires_at: args.email.expiresAt ? args.email.expiresAt.toISOString() : null,
    });
    if (error) throw new Error(`could not queue ${args.email.topic}: ${error.message}`);
    outboxId = (data as string) ?? null;
  }

  const { data: notificationId, error: notifyError } = await admin.rpc("create_notification", {
    p_profile_id: args.profileId,
    p_category: args.category,
    p_title: args.title,
    p_body: args.body ?? null,
    p_path: args.path ?? null,
    p_dedupe_key: args.dedupeKey ?? null,
    p_outbox_id: outboxId,
  });
  if (notifyError) throw new Error(`could not write notification: ${notifyError.message}`);

  return {
    notificationId: (notificationId as string) ?? null,
    outboxId,
    emailSuppressed: Boolean(args.email) && !allowed,
  };
}
