"use client";

import { createBrowserClient } from "@supabase/ssr";
import { env, isSupabaseConfigured } from "@/lib/env";

export function createClient() {
  if (!isSupabaseConfigured()) return null;
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}
