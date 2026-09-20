import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Queueing background work.
 *
 * Work is written to the outbox in the database — durable before anything
 * tries to do it — and then the worker is nudged to run straight after the
 * current response. If that nudge never runs (the function times out, the
 * instance is recycled), the scheduled sweep picks the job up. A job cannot be
 * lost by a process dying.
 */

export async function enqueue(args: {
  topic: string;
  payload: Record<string, unknown>;
  dedupeKey?: string;
  scheduledFor?: Date;
  expiresAt?: Date;
}): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.rpc("enqueue_outbox", {
    p_topic: args.topic,
    p_payload: args.payload,
    p_dedupe_key: args.dedupeKey ?? null,
    // Omitted unless deliberately delayed: the database's own now() decides
    // when a job is due. The server's clock can run slightly ahead of the
    // database's, which left a job "not yet due" for the immediate pass.
    ...(args.scheduledFor ? { p_scheduled_for: args.scheduledFor.toISOString() } : {}),
    p_expires_at: args.expiresAt ? args.expiresAt.toISOString() : null,
  });
  if (error) throw new Error(`Could not queue ${args.topic}: ${error.message}`);
  return data as string;
}

/**
 * Runs a short worker pass after the response is sent, so queued email goes
 * out promptly without making the person wait for it.
 */
export function kickWorker(): void {
  try {
    after(async () => {
      const { runWorker } = await import("@/lib/worker/run");
      await runWorker({ limit: 10, workerName: "after-response" }).catch((err) => {
        console.error("[worker] after-response pass failed:", err instanceof Error ? err.message : err);
      });
    });
  } catch {
    // Called outside a request scope (a script, a test). The sweep will run it.
  }
}
