import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runWorker } from "@/lib/worker/run";
import { runSweeps } from "@/lib/worker/sweeps";
import { reportOperationalFailure, schedulerCheckInFinish, schedulerCheckInStart } from "@/lib/monitoring/server";

/**
 * Scheduled job endpoint: one worker pass plus the housekeeping sweep.
 *
 * FAILS CLOSED. With no CRON_SECRET configured it refuses outright, rather than
 * serving an unauthenticated endpoint that sends mail and moves payment state.
 *
 * SCHEDULING. Work is normally processed straight after the request that
 * created it (see kickWorker). This endpoint is the safety net that catches
 * anything that missed that pass. vercel.json schedules it daily, which every
 * Vercel plan allows; a paid plan can run it every few minutes, and any external
 * scheduler that can send the Authorization header can call it too.
 */
export const dynamic = "force-dynamic";
// Long enough for one clip at the size cap to be re-encoded by the media
// safety net below; everything else here finishes in seconds.
export const maxDuration = 300;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function handle(req: Request) {
  if (!process.env.CRON_SECRET) {
    console.error("[jobs] CRON_SECRET is not set. Refusing to run.");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Heartbeat for error reporting's schedule monitor: a missing run is how a
  // stopped schedule is noticed. Production only.
  const checkIn = await schedulerCheckInStart();
  try {
    const result = await runAll();
    await schedulerCheckInFinish(checkIn, result.sweeps.errors.length === 0);
    if (result.sweeps.errors.length) {
      // Area names only ("checkout <id>: …" → "checkout"), never the detail.
      const areas = [...new Set(result.sweeps.errors.map((e) => e.split(/[:\s]/, 1)[0].slice(0, 40)))].sort();
      await reportOperationalFailure("scheduler", "Scheduled sweep reported errors", { topic: areas.join(", ") }, "warning");
    }
    return NextResponse.json(result);
  } catch (err) {
    await schedulerCheckInFinish(checkIn, false);
    throw err;
  }
}

async function runAll() {
  const sweeps = await runSweeps();

  // Uploads that finished but were never processed — the function that should
  // have processed them died, or a processing claim expired. Bounded to two per
  // run so a backlog cannot push this past its time limit.
  let mediaProcessed = 0;
  try {
    const { processPendingMedia } = await import("@/lib/media/process");
    mediaProcessed = await processPendingMedia(2);
  } catch (err) {
    sweeps.errors.push(`media processing: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Two passes: the sweep can itself queue work (e.g. notifications).
  const first = await runWorker({ limit: 25, workerName: "scheduled" });
  const second = first.claimed === 25 ? await runWorker({ limit: 25, workerName: "scheduled" }) : null;

  return { sweeps, mediaProcessed, worker: [first, second].filter(Boolean) };
}

export async function POST(req: Request) {
  return handle(req);
}

/** Vercel Cron issues GET. Same authentication, no exceptions. */
export async function GET(req: Request) {
  return handle(req);
}
