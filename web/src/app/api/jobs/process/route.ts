import { NextResponse } from "next/server";
import { processDueJobs } from "@/lib/jobs";

/**
 * Job processor endpoint, hit by Vercel Cron (see vercel.json).
 * Protected by CRON_SECRET when set (Vercel sends it automatically).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const result = await processDueJobs();
  return NextResponse.json(result);
}
