import "server-only";
import { env, isSupabaseConfigured } from "@/lib/env";

/**
 * Which sign-in methods are actually switched on in Supabase.
 *
 * A "Continue with Google" button that fails because the provider is not
 * configured is a dead button. The auth server publishes its enabled providers
 * at a public settings endpoint, so the interface shows only what works.
 */

interface AuthSettings {
  google: boolean;
  email: boolean;
  signupDisabled: boolean;
}

let cached: { at: number; value: AuthSettings } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function authSettings(): Promise<AuthSettings> {
  const fallback: AuthSettings = { google: false, email: isSupabaseConfigured(), signupDisabled: false };
  if (!isSupabaseConfigured()) return fallback;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  try {
    const res = await fetch(`${env.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: env.supabaseAnonKey },
      cache: "no-store",
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as { external?: Record<string, boolean>; disable_signup?: boolean };
    const value: AuthSettings = {
      google: Boolean(body.external?.google),
      email: Boolean(body.external?.email),
      signupDisabled: Boolean(body.disable_signup),
    };
    cached = { at: Date.now(), value };
    return value;
  } catch {
    return fallback;
  }
}
