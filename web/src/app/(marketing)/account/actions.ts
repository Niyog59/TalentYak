"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { afterSignIn, getSession, requireSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/redirects";
import { rateLimit, clientIp, tooMany } from "@/lib/rate-limit";
import { authSettings } from "@/lib/auth-providers";
import { CURRENT_LEGAL } from "@/lib/legal";
import { MIN_PASSWORD_LENGTH, canonicalTimezone, isDisplayCurrency, isValidTimezone } from "@/lib/preferences";
import { type ActionState, echo, fail, field, succeed } from "@/lib/actions";

/*
 * Account actions.
 *
 * ENUMERATION. Sign-up, password reset and email-link requests answer the same
 * way whether or not an account exists, so none of them can be used to test
 * which email addresses are customers.
 *
 * REDIRECTS. Every return address is built from NEXT_PUBLIC_SITE_URL, never
 * from the request's Host header, which a client controls. Every `next` passes
 * through safeNextPath().
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function callbackUrl(next: string) {
  return `${env.siteUrl}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`;
}

async function limitBoth(action: string, email: string, perIp: number, perEmail: number, windowSeconds: number) {
  const ip = await rateLimit(action, `ip:${await clientIp()}`, perIp, windowSeconds);
  if (!ip.allowed) return ip;
  if (email) {
    const byEmail = await rateLimit(action, `email:${email}`, perEmail, windowSeconds);
    if (!byEmail.allowed) return byEmail;
  }
  return null;
}

export async function signUpAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = field(form, "email", 254).toLowerCase();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const values = echo(form, ["email"]);

  const fieldErrors: Record<string, string> = {};
  if (!EMAIL_RE.test(email)) fieldErrors.email = "Enter a valid email address.";
  if (password.length < MIN_PASSWORD_LENGTH) fieldErrors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 128) fieldErrors.password = "Use at most 128 characters.";
  if (password !== confirm) fieldErrors.confirm = "The passwords do not match.";
  if (Object.keys(fieldErrors).length) return fail("Check the highlighted fields.", { fieldErrors, values });

  const limited = await limitBoth("signup", email, 5, 3, 3600);
  if (limited) return fail(tooMany(limited), { values });

  const settings = await authSettings();
  if (settings.signupDisabled) return fail("New accounts are not open right now.", { values });

  const supabase = await createClient();
  if (!supabase) return fail("Accounts are not available right now.", { values });

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: callbackUrl("/account/onboarding") },
  });

  // A weak or breached password is the one error worth reporting precisely:
  // it is about what the person typed, not about whether the account exists.
  if (error && /password/i.test(error.message)) {
    return fail("Choose a stronger password.", { fieldErrors: { password: error.message }, values });
  }
  if (error && error.status && error.status >= 500) {
    return fail("We couldn't create the account just now. Please try again.", { values });
  }

  return succeed(
    `If ${email} can be registered, we've sent a confirmation link to it. Open it on this device to finish creating your account.`,
  );
}

export async function signInAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = field(form, "email", 254).toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNextPath(field(form, "next", 512));
  const values = echo(form, ["email"]);

  if (!EMAIL_RE.test(email) || !password) {
    return fail("Enter your email and password.", { values });
  }

  const limited = await limitBoth("signin", email, 30, 8, 900);
  if (limited) return fail(tooMany(limited), { values });

  const supabase = await createClient();
  if (!supabase) return fail("Sign-in is not available right now.", { values });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.code === "email_not_confirmed") {
      return fail("Confirm your email address first — check your inbox for the link we sent.", { values });
    }
    return fail("That email and password don't match an account.", { values });
  }

  await afterSignIn(data.user.id, Boolean(data.user.email_confirmed_at));
  await redirectAfterSignIn(next);
  return succeed();
}

/** Sends a person with a second factor to verify it before anything else. */
async function redirectAfterSignIn(next: string): Promise<never> {
  const supabase = await createClient();
  const aal = await supabase?.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.data && aal.data.nextLevel === "aal2" && aal.data.currentLevel !== "aal2") {
    redirect(`/account/mfa?next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export async function emailLinkAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = field(form, "email", 254).toLowerCase();
  const next = safeNextPath(field(form, "next", 512));
  if (!EMAIL_RE.test(email)) return fail("Enter a valid email address.", { values: { email } });

  const limited = await limitBoth("emaillink", email, 10, 3, 3600);
  if (limited) return fail(tooMany(limited), { values: { email } });

  const supabase = await createClient();
  if (!supabase) return fail("Sign-in is not available right now.");

  // shouldCreateUser: false — an email link signs in an EXISTING account. It
  // never silently creates one, so an account always has a deliberate sign-up.
  await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: callbackUrl(next) },
  });

  return succeed(`If ${email} has an account, we've sent a sign-in link to it.`);
}

export async function googleSignInAction(form: FormData): Promise<void> {
  const next = safeNextPath(field(form, "next", 512));
  const settings = await authSettings();
  if (!settings.google) redirect(`/account/sign-in?error=google_unavailable&next=${encodeURIComponent(next)}`);

  const limited = await rateLimit("oauth", `ip:${await clientIp()}`, 30, 900);
  if (!limited.allowed) redirect(`/account/sign-in?error=rate_limited&next=${encodeURIComponent(next)}`);

  const supabase = await createClient();
  if (!supabase) redirect("/account/sign-in?error=unavailable");

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl(next),
      // Identity only. No Calendar, no Drive, nothing TalentYak has no use for.
      scopes: "openid email profile",
    },
  });
  if (error || !data.url) redirect(`/account/sign-in?error=oauth&next=${encodeURIComponent(next)}`);
  redirect(data.url);
}

export async function forgotPasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = field(form, "email", 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return fail("Enter a valid email address.", { values: { email } });

  const limited = await limitBoth("reset", email, 5, 3, 3600);
  if (limited) return fail(tooMany(limited), { values: { email } });

  const supabase = await createClient();
  if (!supabase) return fail("Password reset is not available right now.");

  await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl("/account/reset-password") });

  return succeed(
    `If ${email} has an account, we've sent a link to reset the password. Open it on this device; it expires after one use.`,
  );
}

export async function resetPasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await getSession();
  if (!session) {
    return fail("This reset link has expired or was opened on a different device. Request a new one.");
  }

  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
    return fail(`Use between ${MIN_PASSWORD_LENGTH} and 128 characters.`, { fieldErrors: { password: "Too short or too long." } });
  }
  if (password !== confirm) return fail("The passwords do not match.", { fieldErrors: { confirm: "Does not match." } });

  const supabase = await createClient();
  const { error } = await supabase!.auth.updateUser({ password });
  if (error) {
    return fail(/password/i.test(error.message) ? "Choose a stronger password." : "We couldn't update your password. Request a new reset link.");
  }

  redirect("/account?notice=password_updated");
}

export async function onboardingAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession("/account/onboarding");
  const next = safeNextPath(field(form, "next", 512));

  const preferredName = field(form, "preferred_name", 80);
  const timezone = canonicalTimezone(field(form, "timezone", 64)) ?? "";
  const displayCurrency = field(form, "display_currency", 3).toUpperCase();
  const values = echo(form, ["preferred_name", "timezone", "display_currency"]);

  const fieldErrors: Record<string, string> = {};
  if (!preferredName) fieldErrors.preferred_name = "Tell us what to call you.";
  if (!isValidTimezone(timezone)) fieldErrors.timezone = "Choose your timezone from the list.";
  if (!isDisplayCurrency(displayCurrency)) fieldErrors.display_currency = "Choose a currency from the list.";
  if (form.get("terms") !== "on") fieldErrors.terms = "You need to accept the terms to continue.";
  if (form.get("privacy") !== "on") fieldErrors.privacy = "You need to acknowledge the privacy notice to continue.";
  if (form.get("adult") !== "on") fieldErrors.adult = "TalentYak coaching is for adults aged 18 or over.";
  if (Object.keys(fieldErrors).length) return fail("Check the highlighted fields.", { fieldErrors, values });

  const admin = createAdminClient();
  if (!admin) return fail("Setup is not available right now.", { values });

  const { error } = await admin.rpc("complete_onboarding", {
    p: {
      user_id: session.userId,
      preferred_name: preferredName,
      timezone,
      display_currency: displayCurrency,
      terms_version: CURRENT_LEGAL.termsVersion,
      privacy_version: CURRENT_LEGAL.privacyVersion,
    },
  });
  if (error) return fail("We couldn't save your details. Please try again.", { values });

  // Link any bookings made as a guest before accounts existed — but only to an
  // email the auth server has confirmed belongs to this person.
  if (session.emailConfirmed) {
    await admin.rpc("claim_guest_bookings", { p_user_id: session.userId, p_verified_email: session.email });
  }

  redirect(next === "/account/onboarding" ? "/account" : next);
}

export async function signOutEverywhereAction(): Promise<void> {
  const supabase = await createClient();
  await supabase?.auth.signOut({ scope: "global" });
  redirect("/account/sign-in?notice=signed_out_everywhere");
}
