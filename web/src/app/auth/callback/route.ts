import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { afterSignIn } from "@/lib/auth";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/redirects";

/**
 * Where Supabase sends a person back after Google sign-in, an email
 * confirmation, a sign-in link, or a password-reset link.
 *
 * Redirects are built from NEXT_PUBLIC_SITE_URL rather than the request origin,
 * and `next` is checked by safeNextPath(), so this route cannot be used to
 * bounce someone to another site.
 */
export const dynamic = "force-dynamic";

function to(path: string) {
  return NextResponse.redirect(new URL(path, env.siteUrl));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const providerError = url.searchParams.get("error");

  if (providerError) {
    // "access_denied" means the person cancelled at Google. Not an error to
    // alarm them about.
    const reason = providerError === "access_denied" ? "cancelled" : "oauth";
    return to(`/account/sign-in?error=${reason}&next=${encodeURIComponent(next)}`);
  }

  if (!code) return to(`/account/sign-in?error=link&next=${encodeURIComponent(next)}`);

  const supabase = await createClient();
  if (!supabase) return to("/account/sign-in?error=unavailable");

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    // Most often: the link was opened on a different device or browser from
    // the one that asked for it, or it was already used. For an email
    // confirmation, Supabase has usually confirmed the address anyway.
    return to(`/account/sign-in?error=link&next=${encodeURIComponent(next)}`);
  }

  await afterSignIn(data.user.id, Boolean(data.user.email_confirmed_at));

  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.data?.nextLevel === "aal2" && aal.data.currentLevel !== "aal2") {
    return to(`/account/mfa?next=${encodeURIComponent(next)}`);
  }

  return to(next);
}
