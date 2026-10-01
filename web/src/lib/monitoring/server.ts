import "server-only";

/**
 * Server-side reporting of operational failures that are handled, recorded and
 * therefore never thrown: a background job that ran out of retries, a payment
 * notification that could not be applied, a media file that could not be
 * processed, a scheduled sweep that hit an error.
 *
 * The record of each stays where it already is (Jobs & deliveries in the
 * founder panel). This only raises a flag in error reporting so the founder is
 * alerted. A report carries the KIND of failure and an identifier — never the
 * payload, the recipient or the provider's error text.
 *
 * Every function is a no-op when error reporting isn't configured, and never
 * throws: monitoring must not be the thing that breaks a job.
 */

type Area = "jobs" | "payments" | "media" | "scheduler" | "email";

async function sentry() {
  try {
    const { monitoringEnabled } = await import("./options");
    if (!monitoringEnabled("server")) return null;
    return await import("@sentry/nextjs");
  } catch {
    return null;
  }
}

export async function reportOperationalFailure(
  area: Area,
  summary: string,
  tags: Record<string, string> = {},
  level: "error" | "warning" = "error",
): Promise<void> {
  const Sentry = await sentry();
  if (!Sentry) return;
  try {
    Sentry.withScope((scope) => {
      scope.setLevel(level);
      scope.setTags({ area, ...tags });
      // One issue per kind of failure, not one per occurrence.
      scope.setFingerprint(["operational", area, summary, ...Object.values(tags)]);
      Sentry.captureMessage(summary);
    });
    await Sentry.flush(2000);
  } catch {
    // Never let reporting break the work it reports on.
  }
}

/**
 * Scheduled-worker heartbeat. Each run reports "in progress" then "ok" or
 * "error"; a run that never arrives is what the monitor alerts on, which is how
 * a stopped schedule is noticed (an error report alone can't see silence).
 */
const MONITOR_SLUG = "scheduled-worker";
const MONITOR_CONFIG = {
  schedule: { type: "crontab" as const, value: "*/5 * * * *" },
  checkinMargin: 10,
  maxRuntime: 6,
  timezone: "Etc/UTC",
  failureIssueThreshold: 2,
  recoveryThreshold: 1,
};

export async function schedulerCheckInStart(): Promise<string | null> {
  const Sentry = await sentry();
  if (!Sentry || process.env.VERCEL_ENV !== "production") return null;
  try {
    return Sentry.captureCheckIn({ monitorSlug: MONITOR_SLUG, status: "in_progress" }, MONITOR_CONFIG);
  } catch {
    return null;
  }
}

export async function schedulerCheckInFinish(checkInId: string | null, ok: boolean): Promise<void> {
  if (!checkInId) return;
  const Sentry = await sentry();
  if (!Sentry) return;
  try {
    Sentry.captureCheckIn({ checkInId, monitorSlug: MONITOR_SLUG, status: ok ? "ok" : "error" });
    await Sentry.flush(2000);
  } catch {
    // As above.
  }
}
