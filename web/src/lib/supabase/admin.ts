import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role client for trusted server contexts only
 * (webhooks, admin server actions). Bypasses RLS — never import
 * from client components.
 */
export function createAdminClient() {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  return createSupabaseClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
}
