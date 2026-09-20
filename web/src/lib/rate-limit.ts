import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Rate limits that work on serverless hosting, backed by an atomic database
 * counter (migration 0018). An in-memory counter would reset on every cold
 * start and differ between instances.
 *
 * Keys never contain a raw IP address or email: they are HMACed with a server
 * secret first, so the counter table cannot be read back into a list of who
 * tried to sign in.
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

function hashKey(value: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CRON_SECRET || "";
  return createHmac("sha256", secret).update(value.toLowerCase()).digest("hex").slice(0, 32);
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/**
 * `onUnavailable` decides what happens if the counter cannot be reached:
 * sensitive actions fail closed; the caller must opt in to failing open.
 */
export async function rateLimit(
  action: string,
  identity: string,
  limit: number,
  windowSeconds: number,
  onUnavailable: "allow" | "deny" = "deny",
): Promise<RateLimitResult> {
  const admin = createAdminClient();
  if (!admin) return { allowed: onUnavailable === "allow", retryAfterSeconds: 60 };

  const { data, error } = await admin.rpc("hit_rate_limit", {
    p_bucket: `${action}:${hashKey(identity)}`,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error || !data) return { allowed: onUnavailable === "allow", retryAfterSeconds: 60 };

  return { allowed: Boolean(data.allowed), retryAfterSeconds: Number(data.retry_after_seconds) || 60 };
}

export function tooMany(result: RateLimitResult): string {
  const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
  return `Too many attempts. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`;
}
