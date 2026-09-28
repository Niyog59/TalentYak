import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/payments/stripe";
import { currentCheckinReminderPolicy } from "@/lib/policy";

/**
 * Time-based housekeeping, run by the scheduled job endpoint.
 *
 * Each step is idempotent: running the sweep twice in a row changes nothing the
 * second time. That is what makes it safe to run from more than one scheduler,
 * or to re-run by hand after an outage.
 */

export interface SweepSummary {
  checkoutsExpired: number;
  checkoutsSkippedComplete: number;
  earningsRecognised: number;
  enrollmentsEnded: number;
  eventsRecovered: number;
  rateLimitRowsPruned: number;
  conversationSignalsPruned: number;
  abandonedMediaCleared: number;
  mediaRequeued: number;
  retentionCancelled: number;
  /** Counts from reconcile_appointments(): proposals expired, holds released, meetings held, confirmed, occurrences created. */
  appointments: Record<string, number>;
  /** Session call rooms whose window ended, queued to be emptied and deleted. */
  callRoomsClosed: number;
  /** Gentle in-app "a workout is planned today" notices. */
  logReminders: number;
  /** Check-in requests made for the period now running. */
  checkinsCreated: number;
  /** Check-in notices queued (each once only; re-checked before sending). */
  checkinNotices: number;
  errors: string[];
}

export async function runSweeps(): Promise<SweepSummary> {
  const summary: SweepSummary = {
    checkoutsExpired: 0,
    checkoutsSkippedComplete: 0,
    earningsRecognised: 0,
    enrollmentsEnded: 0,
    eventsRecovered: 0,
    rateLimitRowsPruned: 0,
    conversationSignalsPruned: 0,
    abandonedMediaCleared: 0,
    mediaRequeued: 0,
    retentionCancelled: 0,
    appointments: {},
    callRoomsClosed: 0,
    logReminders: 0,
    checkinsCreated: 0,
    checkinNotices: 0,
    errors: [],
  };
  const admin = createAdminClient();
  if (!admin) return summary;

  // 1. Abandoned checkouts: expire the Stripe session FIRST, then release the
  //    hold. If Stripe says the session actually completed, leave it alone — the
  //    payment webhook owns that outcome, and releasing the place under a paying
  //    customer is exactly the race this ordering prevents.
  const { data: stale } = await admin
    .from("checkout_attempts")
    .select("id, stripe_checkout_session_id")
    .in("state", ["created", "redirected"])
    .lt("expires_at", new Date(Date.now() - 60_000).toISOString())
    .limit(50);

  const stripe = getStripe();
  for (const attempt of stale ?? []) {
    try {
      if (attempt.stripe_checkout_session_id && stripe) {
        const session = await stripe.checkout.sessions.retrieve(attempt.stripe_checkout_session_id);
        if (session.status === "complete") {
          summary.checkoutsSkippedComplete++;
          continue;
        }
        if (session.status === "open") {
          await stripe.checkout.sessions.expire(session.id);
        }
      }
      const { data: closed } = await admin.rpc("close_checkout_attempt", {
        p_attempt_id: attempt.id, p_state: "expired", p_reason: "checkout_expired",
      });
      if (closed) summary.checkoutsExpired++;
    } catch (err) {
      summary.errors.push(`checkout ${attempt.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Delivered service periods become payable.
  const recognised = await admin.rpc("recognise_delivered_cycles");
  if (recognised.error) summary.errors.push(`recognise: ${recognised.error.message}`);
  else summary.earningsRecognised = Number(recognised.data) || 0;

  // 3. Relationships whose paid time has run out.
  const ended = await admin.rpc("end_lapsed_enrollments");
  if (ended.error) summary.errors.push(`enrollments: ${ended.error.message}`);
  else summary.enrollmentsEnded = Number(ended.data) || 0;

  // 4. Payment events that were received but never finished processing — a
  //    crash, a timeout, a database error. Reprocessed from Stripe's own copy.
  try {
    const { recoverStuckEvents } = await import("@/lib/payments/webhook");
    summary.eventsRecovered = await recoverStuckEvents(20);
  } catch (err) {
    summary.errors.push(`event recovery: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. Old rate-limit windows.
  const pruned = await admin.rpc("prune_rate_limits");
  if (!pruned.error) summary.rateLimitRowsPruned = Number(pruned.data) || 0;

  // 5b. Realtime prompts older than a day. They carry no content and are not a
  //     record of anything; the messages themselves are untouched.
  const signals = await admin.rpc("prune_conversation_signals");
  if (signals.error) summary.errors.push(`signals: ${signals.error.message}`);
  else summary.conversationSignalsPruned = Number(signals.data) || 0;

  // 6. Uploads that were started and never finished — a closed laptop, a
  //    dropped connection. The row is marked failed and the bytes are removed
  //    together, so the bucket never holds a file no record points at.
  //
  //    This is housekeeping, not retention. It only ever touches uploads that
  //    never became anything. The retention policies in 0022 remain PROPOSED
  //    and their destructive execution remains switched OFF; nothing in this
  //    sweep deletes material a person actually has.
  try {
    const { sweepAbandonedMedia } = await import("@/lib/media");
    const swept = await sweepAbandonedMedia();
    summary.abandonedMediaCleared = swept.abandoned + swept.released;
    summary.mediaRequeued = swept.requeued;
  } catch (err) {
    summary.errors.push(`abandoned media: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 7. Retention candidates whose reason for deletion has gone away — a hold,
  //    a lapsed customer who came back, a file already deleted by its owner —
  //    are cancelled, and their pending notices with them. This step can only
  //    ever LET SOMETHING OFF. Nothing here deletes, and no executor exists:
  //    `retention_settings.destructive_execution_enabled` stays false.
  const rechecked = await admin.rpc("recheck_retention_candidates");
  if (rechecked.error) summary.errors.push(`retention recheck: ${rechecked.error.message}`);
  else {
    summary.retentionCancelled = ((rechecked.data ?? []) as { outcome: string }[])
      .filter((r) => r.outcome.startsWith("cancelled")).length;
  }

  // Scheduling: lapse unanswered proposals, release lapsed holds, put meetings
  // on hold or cancel them when a relationship pauses, ends or is suspended,
  // confirm tentative ones once paid, and extend weekly series. Runs AFTER
  // end_lapsed_enrollments above, so it sees today's relationship states.
  const scheduling = await admin.rpc("reconcile_appointments");
  if (scheduling.error) summary.errors.push(`appointments: ${scheduling.error.message}`);
  else summary.appointments = (scheduling.data ?? {}) as Record<string, number>;

  // Calls: rooms whose window is over are closed at the provider, so a
  // session's room can never outlive it. Rooms of sessions that were cancelled
  // or put on hold above were already queued by the database.
  const rooms = await admin.rpc("close_due_call_rooms");
  if (rooms.error) summary.errors.push(`call rooms: ${rooms.error.message}`);
  else summary.callRoomsClosed = Number(rooms.data) || 0;

  // Logging reminders: one gentle in-app notice on a planned day with nothing
  // logged, in the client's evening. Idempotent by a per-day dedupe key.
  try {
    const { sendLogReminders } = await import("@/lib/tracking/reminders");
    summary.logReminders = await sendLogReminders();
  } catch (err) {
    summary.errors.push(`log reminders: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Check-ins: the request for the period running now (never a past one,
  // never while coaching is paused, never inside a break), then due-soon,
  // late and unanswered-review notices. Runs after end_lapsed_enrollments, so
  // a relationship paused this minute asks nothing new.
  const made = await admin.rpc("materialize_checkins");
  if (made.error) summary.errors.push(`checkins: ${made.error.message}`);
  else summary.checkinsCreated = Number(made.data) || 0;
  const timings = currentCheckinReminderPolicy();
  const notices = await admin.rpc("queue_checkin_reminders", {
    p_due_soon_hours: timings.dueSoonHours,
    p_late_after_hours: timings.lateAfterHours,
    p_late_window_hours: timings.lateWindowHours,
    p_review_default_hours: timings.reviewWithoutStatedTimeHours,
  });
  if (notices.error) summary.errors.push(`checkin notices: ${notices.error.message}`);
  else summary.checkinNotices = Number(notices.data) || 0;

  return summary;
}
