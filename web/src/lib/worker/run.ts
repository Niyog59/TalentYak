import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { resendTransport, type EmailTransport } from "@/lib/email";
import { HANDLERS, type OutboxJob, type Outcome } from "@/lib/worker/handlers";
import { reportOperationalFailure } from "@/lib/monitoring/server";

/**
 * One pass of the outbox worker.
 *
 * Claims due jobs atomically (so two passes running at once never take the
 * same job), runs each through its handler, and records the outcome. A pass is
 * bounded — it takes a fixed number of jobs and stops — so it always finishes
 * inside a serverless time limit. Whatever it does not reach, the next pass does.
 */

export interface WorkerSummary {
  worker: string;
  claimed: number;
  done: number;
  retrying: number;
  failed: number;
  blocked: number;
}

export async function runWorker(opts: {
  limit?: number;
  workerName?: string;
  transport?: EmailTransport;
} = {}): Promise<WorkerSummary> {
  const worker = `${opts.workerName ?? "worker"}-${randomUUID().slice(0, 8)}`;
  const summary: WorkerSummary = { worker, claimed: 0, done: 0, retrying: 0, failed: 0, blocked: 0 };

  const admin = createAdminClient();
  if (!admin) return summary;

  const { data: jobs, error } = await admin.rpc("claim_outbox_jobs", {
    p_worker: worker,
    p_limit: opts.limit ?? 20,
    p_lease_seconds: 120,
  });
  if (error) throw new Error(`claim failed: ${error.message}`);

  const transport = opts.transport ?? resendTransport;

  for (const job of (jobs ?? []) as OutboxJob[]) {
    summary.claimed++;
    const handler = HANDLERS[job.topic];

    let outcome: Outcome;
    if (!handler) {
      // Unknown topics fail visibly rather than disappearing.
      outcome = { kind: "fail", error: `no handler for topic ${job.topic}` };
    } else {
      try {
        outcome = await handler(job, {
          admin,
          transport,
          enqueue: async (topic, payload, dedupeKey) => {
            const { error: enqueueError } = await admin.rpc("enqueue_outbox", {
              p_topic: topic, p_payload: payload, p_dedupe_key: dedupeKey, p_expires_at: null,
            });
            if (enqueueError) throw new Error(`fan-out failed: ${enqueueError.message}`);
          },
        });
      } catch (err) {
        outcome = { kind: "retry", error: err instanceof Error ? err.message : String(err) };
      }
    }

    if (outcome.kind === "done") {
      await admin.rpc("complete_outbox_job", { p_id: job.id, p_worker: worker, p_result: outcome.result });
      summary.done++;
    } else {
      const { data: state } = await admin.rpc("fail_outbox_job", {
        p_id: job.id,
        p_worker: worker,
        p_error: outcome.error,
        p_retryable: outcome.kind === "retry",
        p_blocked: outcome.kind === "blocked",
      });
      if (state === "blocked") summary.blocked++;
      else if (state === "failed") summary.failed++;
      else summary.retrying++;
      // Out of retries, or waiting on configuration: a person has to look.
      // The topic only — the payload and the error text stay in the panel.
      if (state === "failed" || state === "blocked") {
        await reportOperationalFailure(
          job.topic.startsWith("email.") ? "email" : "jobs",
          state === "failed" ? "Background job failed after its retries" : "Background job blocked until something is configured",
          { topic: job.topic },
          state === "failed" ? "error" : "warning",
        );
      }
    }
  }

  return summary;
}
