import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role client for trusted server contexts only — webhooks, background
 * jobs, and server actions that have already authorised the caller themselves.
 * It bypasses RLS entirely, which means every guarantee the database makes
 * about who can see what stops applying to anything that goes through here.
 *
 * Guarded three ways, per the project rules → Security operating rules:
 *
 *   1. `import "server-only"` makes the bundler fail the build if a client
 *      component ever imports this file.
 *   2. The runtime `window` check below catches anything that slips past the
 *      bundler and refuses loudly rather than continuing.
 *   3. The key is read from a non-NEXT_PUBLIC_ variable, so it is never inlined
 *      into a browser bundle in the first place.
 *
 * Three guards for one secret is not excess. This key can read every customer's
 * grief data, every progress photo, and every payout detail in the system.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "The Supabase service-role client was constructed in a browser context. This is a serious defect, not a configuration problem: the key must never leave the server.",
    );
  }

  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;

  return createSupabaseClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
}
