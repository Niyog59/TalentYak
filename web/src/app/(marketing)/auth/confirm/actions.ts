"use server";

import { redirect } from "next/navigation";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { afterSignIn } from "@/lib/auth";
import { safeNextPath } from "@/lib/redirects";
import { clientIp, rateLimit, tooMany } from "@/lib/rate-limit";
import { type ActionState, fail, field } from "@/lib/actions";
import {
  RESET_PASSWORD_PATH,
  classifyVerifyError,
  failureMessage,
  isPlausibleTokenHash,
  parseLinkType,
} from "@/lib/auth-links";

/**
 * Runs only when the person presses Continue on /auth/confirm. Opening the
 * link, a mail scanner fetching it, or a browser prefetching it verifies
 * nothing, so none of them can use it up.
 *
 * The token is checked on a throwaway client first. Only a link that worked
 * replaces whoever is signed in on this browser, so a bad or used link never
 * signs anyone out. The token is never logged or passed on.
 */
export async function confirmEmailLinkAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const type = parseLinkType(field(form, "type", 20));
  const tokenHash = field(form, "token_hash", 200);
  if (!type || !isPlausibleTokenHash(tokenHash)) return fail(failureMessage(type ?? "email", "incomplete"));

  const limited = await rateLimit("email_link_confirm", `ip:${await clientIp()}`, 30, 900);
  if (!limited.allowed) return fail(tooMany(limited));

  const supabase = await createClient();
  if (!supabase) return fail(failureMessage(type, "unavailable"));

  const probe = createSupabaseClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await probe.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.session || !data.user) return fail(failureMessage(type, classifyVerifyError(error)));

  // Whoever was signed in on this browser — another account, or an older
  // session of this one — is signed out first (revoked, not just forgotten).
  const { data: current } = await supabase.auth.getUser();
  if (current.user) await supabase.auth.signOut({ scope: "local" });

  const { error: setError } = await supabase.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (setError) return fail("Your link worked, but we couldn't sign you in on this browser. Please sign in with your email and password.");

  await afterSignIn(data.user.id, Boolean(data.user.email_confirmed_at));

  const next = type === "recovery" ? RESET_PASSWORD_PATH : safeNextPath(field(form, "next", 512));

  // A second factor still guards everything, a password reset included.
  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.data?.nextLevel === "aal2" && aal.data.currentLevel !== "aal2") {
    redirect(`/account/mfa?next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}
