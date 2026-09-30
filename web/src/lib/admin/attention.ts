import "server-only";
import { createClient } from "@/lib/supabase/server";
import { attempt, attemptCount, failed, loaded, type Loaded } from "@/lib/admin/loaded";

/*
 * Everything that is waiting on a person, in one list. Every count is read
 * through the founder's own session (the database's admin rules apply), and a
 * count that can't be read is shown as unavailable — never as zero.
 */

export interface AttentionItem {
  group: "Support" | "Payments" | "Payouts" | "Coaching" | "Coaches" | "Technical";
  label: string;
  href: string;
  count: Loaded<number>;
  /** Items that affect money or a customer right now sort first. */
  urgent?: boolean;
}

export async function loadAttention(): Promise<AttentionItem[]> {
  const sb = await createClient();
  if (!sb) return [];
  const head = { count: "exact" as const, head: true };
  const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  const [
    casesOpen, casesUnowned, changes, coachReview, destinations, photos,
    pastDue, needsReview, disputes, exceptions, failedEvents,
    batchesOpen, held, checkinAttention, sessionsOnHold, interruptedCalls,
    jobs, deliveries, deletions, ops, applications,
  ] = await Promise.all([
    attemptCount(() => sb.from("support_cases").select("id", head).neq("state", "resolved")),
    attemptCount(() => sb.from("support_cases").select("id", head).neq("state", "resolved").is("owner_id", null)),
    attemptCount(() => sb.from("coach_change_requests").select("id", head).eq("state", "requested")),
    attemptCount(() => sb.from("providers").select("id", head).in("status", ["submitted", "in_review"])),
    attempt(() => sb.rpc("admin_payout_destinations", { p_provider_id: null })).then((r) =>
      r.ok ? loaded((r.value as { review_state: string; superseded_at: string | null }[]).filter((d) => d.review_state === "pending_review" && !d.superseded_at).length) : failed<number>(),
    ),
    attemptCount(() => sb.from("provider_public_profiles").select("provider_id", head).not("photo_pending_path", "is", null)),
    attemptCount(() => sb.from("purchases").select("id", head).eq("state", "past_due")),
    attemptCount(() => sb.from("purchases").select("id", head).eq("requires_review", true)),
    attemptCount(() => sb.from("disputes").select("id", head).in("state", ["open", "under_review"])),
    attemptCount(() => sb.from("reconciliation_exceptions").select("id", head).in("state", ["open", "investigating"])),
    attemptCount(() => sb.from("provider_events").select("id", head).eq("processing_state", "failed")),
    attemptCount(() => sb.from("payout_batches").select("id", head).in("state", ["prepared", "exported", "submitted"])),
    attemptCount(() => sb.from("earning_states").select("ledger_entry_id", head).eq("state", "held")),
    attempt(() => sb.rpc("admin_checkin_attention")).then((r) => (r.ok ? loaded((r.value as unknown[]).length) : failed<number>())),
    attemptCount(() => sb.from("appointments").select("id", head).eq("state", "on_hold")),
    attemptCount(() => sb.from("appointment_outcomes").select("id", head).eq("outcome", "technical_failure").gte("recorded_at", since(14))),
    attemptCount(() => sb.from("outbox").select("id", head).in("state", ["failed", "blocked"])),
    attemptCount(() => sb.from("notification_deliveries").select("id", head).in("state", ["bounced", "complained", "failed", "uncertain"]).gte("created_at", since(30))),
    attemptCount(() => sb.from("deletion_requests").select("id", head).in("state", ["received", "in_review"])),
    attempt(() => sb.rpc("admin_coaching_operations")),
    attemptCount(() => sb.from("coach_applications").select("id", head).in("status", ["new", "reviewing", "interview"])),
  ]);

  const opsCount = (key: string): Loaded<number> => (ops.ok ? loaded(Number((ops.value as Record<string, number>)[key] ?? 0)) : failed());

  return [
    { group: "Support", label: "Support cases open", href: "/admin/support", count: casesOpen, urgent: true },
    { group: "Support", label: "…of which nobody owns yet", href: "/admin/support?owner=none", count: casesUnowned },
    { group: "Support", label: "Coach change requests to decide", href: "/admin/coach-changes", count: changes, urgent: true },
    { group: "Support", label: "Deletion requests to handle", href: "/admin/retention#requests", count: deletions },
    { group: "Payments", label: "Renewals past due", href: "/admin/purchases?state=past_due", count: pastDue, urgent: true },
    { group: "Payments", label: "Purchases needing review", href: "/admin/finance#review", count: needsReview, urgent: true },
    { group: "Payments", label: "Open card disputes", href: "/admin/finance#disputes", count: disputes, urgent: true },
    { group: "Payments", label: "Finance exceptions open", href: "/admin/finance#exceptions", count: exceptions },
    { group: "Payments", label: "Stripe events that failed", href: "/admin/finance#events", count: failedEvents, urgent: true },
    { group: "Payouts", label: "Payout batches not yet recorded as paid", href: "/admin/payouts", count: batchesOpen },
    { group: "Payouts", label: "Coach earnings on hold", href: "/admin/finance#held", count: held },
    { group: "Payouts", label: "Payout details to check", href: "/admin/coaches", count: destinations },
    { group: "Coaches", label: "Coach applications waiting for a decision", href: "/admin/coach-applications", count: applications },
    { group: "Coaches", label: "Coach profiles waiting for final approval", href: "/admin/coaches?status=submitted", count: coachReview },
    { group: "Coaches", label: "Profile photos to check", href: "/admin/coaches", count: photos },
    { group: "Coaching", label: "Check-in reviews waiting (coach away or flagged)", href: "/admin/check-ins", count: checkinAttention },
    { group: "Coaching", label: "Sessions on hold (unresolved bookings)", href: "/admin/scheduling", count: sessionsOnHold },
    { group: "Coaching", label: "Calls with a technical failure (14 days)", href: "/admin/scheduling", count: interruptedCalls },
    { group: "Technical", label: "Emails and jobs failed or blocked", href: "/admin/operations#jobs", count: jobs, urgent: true },
    { group: "Technical", label: "Emails that bounced or may not have arrived (30 days)", href: "/admin/operations#deliveries", count: deliveries },
    { group: "Technical", label: "Uploads that failed processing (30 days)", href: "/admin/operations#media", count: opsCount("media_failed_30d") },
  ];
}
