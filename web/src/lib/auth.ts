import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeNextPath } from "@/lib/redirects";
import { CURRENT_LEGAL } from "@/lib/legal";

/**
 * Who is making this request, and what they may do.
 *
 * Every protected page and action starts here. Two rules shape it:
 *
 * 1. **Nothing trusts the client about identity or role.** The user comes from
 *    Supabase's own `getUser()` (which verifies the token with the auth server,
 *    unlike `getSession()`), the role and suspension come from the database, and
 *    the assurance level comes from the MFA API. Editable auth metadata is
 *    never consulted for anything privileged.
 *
 * 2. **These checks are a convenience, not the security boundary.** The
 *    database enforces the same rules through row-level security and function
 *    checks (an admin without MFA has no admin reach in SQL at all). A page that
 *    forgot to call requireAdmin() would still show nothing it should not.
 */

export type Role = "customer" | "provider" | "admin";
export type Aal = "aal1" | "aal2";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  preferred_name: string | null;
  phone: string | null;
  role: Role;
  timezone: string | null;
  locale: string;
  display_currency: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
  privacy_version: string | null;
  suspended_at: string | null;
}

export interface ProviderSummary {
  id: string;
  status: string;
  slug: string | null;
  display_name: string;
  published_at: string | null;
  suspended_at: string | null;
  accepting_new_clients: boolean;
  max_active_clients: number | null;
  capacity_ceiling: number | null;
  timezone: string | null;
  vertical_slug: string;
}

export interface SessionContext {
  userId: string;
  email: string;
  emailConfirmed: boolean;
  profile: Profile;
  provider: ProviderSummary | null;
  aal: Aal;
  /** The level this user COULD reach — aal2 once they have a verified factor. */
  nextAal: Aal;
  hasVerifiedFactor: boolean;
}

const PROFILE_COLUMNS =
  "id, email, full_name, preferred_name, phone, role, timezone, locale, display_currency, terms_version, terms_accepted_at, privacy_version, suspended_at";

const PROVIDER_COLUMNS =
  "id, status, slug, display_name, published_at, suspended_at, accepting_new_clients, max_active_clients, capacity_ceiling, timezone, vertical_slug";

/** Per-request memo: several components may ask; the auth server is asked once. */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: provider }, aalResult, factors] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle(),
    supabase.from("providers").select(PROVIDER_COLUMNS).eq("profile_id", user.id).maybeSingle(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);

  // A signed-in user with no profile row means the signup trigger failed.
  // Refuse rather than inventing a profile.
  if (!profile) return null;

  return {
    userId: user.id,
    email: user.email ?? profile.email,
    emailConfirmed: Boolean(user.email_confirmed_at),
    profile: profile as Profile,
    provider: (provider as ProviderSummary | null) ?? null,
    aal: (aalResult.data?.currentLevel as Aal) ?? "aal1",
    nextAal: (aalResult.data?.nextLevel as Aal) ?? "aal1",
    hasVerifiedFactor: (factors.data?.totp ?? []).some((f) => f.status === "verified"),
  };
});

/** Back-compat for existing pages. */
export async function getProfile(): Promise<Profile | null> {
  return (await getSession())?.profile ?? null;
}

export async function getUser() {
  const session = await getSession();
  return session ? { id: session.userId, email: session.email } : null;
}

export async function isAdmin(): Promise<boolean> {
  const session = await getSession();
  return session?.profile.role === "admin" && session.aal === "aal2" && !session.profile.suspended_at;
}

function signInUrl(next: string) {
  return `/account/sign-in?next=${encodeURIComponent(safeNextPath(next))}`;
}

export async function requireSession(next = "/account"): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect(signInUrl(next));
  return session;
}

/** Has accepted the current terms and privacy notice and set up the basics. */
export function isOnboarded(session: SessionContext): boolean {
  const p = session.profile;
  return (
    p.terms_version === CURRENT_LEGAL.termsVersion &&
    p.privacy_version === CURRENT_LEGAL.privacyVersion &&
    Boolean(p.timezone)
  );
}

export async function requireOnboarded(next = "/account"): Promise<SessionContext> {
  const session = await requireSession(next);
  if (session.profile.suspended_at) redirect("/account/suspended");
  if (!isOnboarded(session)) {
    redirect(`/account/onboarding?next=${encodeURIComponent(safeNextPath(next))}`);
  }
  return session;
}

export async function requireCoach(next = "/coach"): Promise<SessionContext & { provider: ProviderSummary }> {
  const session = await requireOnboarded(next);
  if (!session.provider || session.provider.status === "retired") redirect("/account");
  return session as SessionContext & { provider: ProviderSummary };
}

/**
 * Admin pages. An admin who has not completed MFA in this session is sent to
 * verify it — or to set it up — before anything else loads. The database would
 * refuse them anyway; this makes the refusal a helpful redirect rather than an
 * empty screen.
 */
export async function requireAdmin(next = "/admin"): Promise<SessionContext> {
  const session = await requireSession(next);
  if (session.profile.role !== "admin" || session.profile.suspended_at) redirect("/account");
  if (session.aal !== "aal2") {
    redirect(`/account/security?next=${encodeURIComponent(safeNextPath(next))}&reason=admin`);
  }
  return session;
}

/**
 * Runs after any successful sign-in. If this account's email is the one the
 * founder recorded for the first admin, and it has not been claimed, promote
 * it — once. Requires a confirmed email, so an unverified signup with the
 * founder's address can never claim it.
 */
export async function afterSignIn(userId: string, emailConfirmed: boolean): Promise<void> {
  if (!emailConfirmed) return;
  const admin = createAdminClient();
  if (!admin) return;
  await admin.rpc("claim_admin_bootstrap", { claimant: userId });
}
