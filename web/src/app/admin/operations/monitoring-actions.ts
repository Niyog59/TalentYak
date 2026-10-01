"use server";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { type ActionState, fail, succeed } from "@/lib/actions";
import { monitoringEnabled } from "@/lib/monitoring/options";

/**
 * Sends one deliberate, harmless server error to error reporting, so the
 * founder can confirm reports, environment, release and alert delivery after
 * a deploy. Administrators with a second factor only; recorded in the change
 * history. It carries no customer data: a fixed message and the founder's
 * action, nothing else.
 */
export async function sendMonitoringTestAction(_: ActionState): Promise<ActionState> {
  await requireAdmin("/admin/operations");
  if (!monitoringEnabled("server")) {
    return fail("Error reporting isn't configured on this deployment, so there's nowhere to send a test.");
  }
  const Sentry = await import("@sentry/nextjs");
  const eventId = Sentry.withScope((scope) => {
    scope.setTags({ area: "scheduler", test: "true" });
    scope.setLevel("error");
    return Sentry.captureException(new Error("TalentYak monitoring test (server) — deliberate, safe to resolve"));
  });
  await Sentry.flush(3000);

  try {
    const sb = await createClient();
    await sb?.rpc("admin_record_audit", {
      p_action: "operations.monitoring_test_sent", p_subject_type: "monitoring", p_subject_id: eventId?.slice(0, 80) ?? null,
      p_reason: null, p_before: null, p_after: { runtime: "server" },
    });
  } catch {
    /* the test itself stands */
  }
  return succeed(`Test error sent from the server (reference ${eventId?.slice(0, 8) ?? "unknown"}). It should appear in Sentry within a minute.`);
}
