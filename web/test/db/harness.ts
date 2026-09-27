/**
 * Harness for tests that run against the real hosted Supabase project.
 *
 * Three things this deliberately does NOT do:
 *
 * 1. **It does not run unless it is told to.** Two separate conditions must
 *    hold: credentials must exist, and `TALENTYAK_DB_TESTS=confirmed` must be
 *    set. The second one is a human saying "yes, this project is safe to write
 *    to". Credentials appearing in a file is not that statement, and a test
 *    suite that starts creating rows the moment a key shows up is a test suite
 *    that will one day do it to production.
 *
 * 2. **It does not reset anything.** No truncate, no drop, no delete of rows it
 *    did not create. Every fixture it makes is namespaced and torn down
 *    individually.
 *
 * 3. **It does not test through the service key alone.** The service role
 *    bypasses row-level security entirely, so a suite written against it proves
 *    the tables exist and nothing about who can read them. Every access
 *    assertion here runs through a real signed-in user with a real token.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { totp } from "./totp.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const confirmed = process.env.TALENTYAK_DB_TESTS === "confirmed";

/** Everything this suite creates carries this prefix, so cleanup is exact. */
export const FIXTURE_PREFIX = "talentyak-test";

export interface DbAvailability {
  readonly ready: boolean;
  readonly reason: string;
}

export function dbAvailability(): DbAvailability {
  if (!url || !anonKey) {
    return {
      ready: false,
      reason:
        "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set in web/.env.local.",
    };
  }
  if (!serviceKey) {
    return {
      ready: false,
      reason: "SUPABASE_SERVICE_ROLE_KEY is not set in web/.env.local.",
    };
  }
  if (!confirmed) {
    return {
      ready: false,
      reason:
        "TALENTYAK_DB_TESTS is not 'confirmed'. The founder must confirm this project is safe to write to before any test creates a row in it.",
    };
  }
  return { ready: true, reason: "" };
}

/** The project reference, for reporting which project we are about to touch. */
export function projectRef(): string {
  try {
    return new URL(url).hostname.split(".")[0];
  } catch {
    return "unknown";
  }
}

/** Service-role client. Bypasses RLS — use it to SET UP, never to ASSERT access. */
export function adminClient(): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A client with no session at all: what an anonymous visitor gets. */
export function anonymousClient(): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  /** A client carrying this user's real access token. */
  readonly client: SupabaseClient;
}

/**
 * Creates a confirmed user and returns a client signed in as them.
 *
 * The email is namespaced and randomised so it cannot collide with a real
 * account, and `example.test` is a reserved TLD that cannot receive mail —
 * nothing here can reach a real person's inbox.
 */
export async function createTestUser(label: string): Promise<TestUser> {
  const admin = adminClient();
  const email = `${FIXTURE_PREFIX}-${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `Pw-${randomUUID()}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Could not create test user ${label}: ${error?.message}`);
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) {
    throw new Error(`Could not sign in test user ${label}: ${signIn.error.message}`);
  }

  return { id: data.user.id, email, password, client };
}

/** Promotes a user to a role. Uses the service role, as the real bootstrap would. */
export async function setRole(
  userId: string,
  role: "customer" | "provider" | "admin",
): Promise<void> {
  const admin = adminClient();
  const { error } = await admin.from("profiles").update({ role }).eq("id", userId);
  if (error) throw new Error(`Could not set role ${role}: ${error.message}`);
}

export async function suspendUser(userId: string): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from("profiles")
    .update({ suspended_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error(`Could not suspend user: ${error.message}`);
}

/**
 * Deletes only the users this suite created, by id.
 *
 * Deliberately not a sweep by email pattern: a pattern match is one typo away
 * from deleting somebody real.
 */
export async function deleteTestUsers(ids: readonly string[]): Promise<void> {
  const admin = adminClient();
  for (const id of ids) {
    await admin.auth.admin.deleteUser(id).catch(() => {
      /* Best effort. A leftover namespaced test user is untidy; a failed
         cleanup that masks a real test failure is worse. */
    });
  }
}

/**
 * Reports whether a query was refused by row-level security.
 *
 * Postgres does not error when RLS hides a row — the query succeeds and returns
 * nothing. So "denied" means an error OR an empty result, and a test that only
 * checks for an error would pass while the data was in fact readable.
 */
export function wasDenied(result: { data: unknown; error: unknown }): boolean {
  if (result.error) return true;
  if (result.data === null) return true;
  if (Array.isArray(result.data)) return result.data.length === 0;
  return false;
}

// ---------------------------------------------------------------------------
// MFA
// ---------------------------------------------------------------------------


/**
 * Enrols a TOTP factor for the user and completes a challenge, upgrading the
 * user's own client session to aal2. This is the real Supabase MFA flow — the
 * same one an admin completes with an authenticator app — not a bypass.
 */
export async function upgradeToAal2(user: TestUser): Promise<void> {
  const enrol = await user.client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `test-${randomUUID().slice(0, 6)}`,
  });
  if (enrol.error || !enrol.data) {
    throw new Error(`MFA enrol failed: ${enrol.error?.message}`);
  }
  const factorId = enrol.data.id;
  const secret = enrol.data.totp.secret;

  const verify = await user.client.auth.mfa.challengeAndVerify({
    factorId,
    code: totp(secret),
  });
  if (verify.error) {
    throw new Error(`MFA verify failed: ${verify.error.message}`);
  }
  (user as { totpSecret?: string; factorId?: string }).totpSecret = secret;
  (user as { totpSecret?: string; factorId?: string }).factorId = factorId;
}

// ---------------------------------------------------------------------------
// Direct SQL — for inspection and for moving the clock in fixtures only
// ---------------------------------------------------------------------------

/**
 * Runs SQL through the Management API as the database owner. Used to read
 * state and to age fixtures (e.g. make a hold expire). Never used to assert
 * access: that always goes through a real user's session.
 */
export async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const ref = projectRef();
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is required for fixture SQL.");
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL failed (${res.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text) as T[];
}

/** Escapes a value for a SQL string literal in fixture queries. */
export const lit = (value: string) => `'${value.replaceAll("'", "''")}'`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const RUN_ID = randomUUID().slice(0, 8);

export interface CoachFixture {
  user: TestUser;
  providerId: string;
}

/** A coach at a given lifecycle stage, with a public profile row. */
export async function makeCoach(
  label: string,
  opts: { status?: string; published?: boolean; max?: number | null; accepting?: boolean } = {},
): Promise<CoachFixture> {
  const user = await createTestUser(label);
  await setRole(user.id, "provider");
  const sb = adminClient();
  const { data, error } = await sb
    .from("providers")
    .insert({
      profile_id: user.id,
      display_name: `Fixture ${label}`,
      vertical_slug: "fitness",
      status: opts.status ?? "approved",
      slug: `talentyak-test-${RUN_ID}-${label}`,
      timezone: "Asia/Kathmandu",
      accepting_new_clients: opts.accepting ?? true,
      max_active_clients: opts.max === undefined ? 5 : opts.max,
      published_at: opts.published === false ? null : new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`makeCoach ${label}: ${error.message}`);

  await sb.from("provider_public_profiles").insert({
    provider_id: data.id,
    display_name: `Fixture ${label}`,
    bio: "A fixture coach used by the automated test suite. Not a real person.",
    languages: ["English"],
  });

  return { user, providerId: data.id as string };
}

export interface OfferFixture {
  offerId: string;
  versionId: string;
}

/**
 * A draft offer version with a USD price, created as the coach through their
 * own session (RLS), NOT published. Publishing is what the tests exercise.
 */
export async function makeDraftOffer(
  coach: CoachFixture,
  opts: {
    slug?: string;
    serviceType?: "recurring_coaching" | "one_off_consultation";
    billing?: "monthly_recurring" | "monthly_under_commitment" | "prepaid_term" | "single_payment";
    priceMinor?: number;
    currency?: string;
    termMonths?: number;
  } = {},
): Promise<OfferFixture> {
  const serviceType = opts.serviceType ?? "recurring_coaching";
  const billing = opts.billing ?? (serviceType === "recurring_coaching" ? "monthly_recurring" : "single_payment");
  const recurring = serviceType === "recurring_coaching";

  const { data: offer, error: offerError } = await coach.user.client
    .from("offers")
    .insert({
      provider_id: coach.providerId,
      vertical_slug: "fitness",
      slug: opts.slug ?? `plan-${randomUUID().slice(0, 6)}`,
      status: "draft",
    })
    .select("id")
    .single();
  if (offerError) throw new Error(`makeDraftOffer offer: ${offerError.message}`);

  const { data: version, error: versionError } = await coach.user.client
    .from("offer_versions")
    .insert({
      offer_id: offer.id,
      version: 1,
      title: "Fixture plan",
      description: "Fixture",
      service_type: serviceType,
      billing_structure: billing,
      billing_interval: recurring ? "month" : null,
      billing_interval_count: recurring ? 1 : null,
      term_months: billing === "prepaid_term" || billing === "monthly_under_commitment" ? (opts.termMonths ?? 6) : null,
      // Deliberately NOT the current policy: publishing must overwrite these.
      commission_policy_id: "commission.coaching.v1",
      cancellation_policy_id: "cancellation.v1",
      payment_failure_policy_id: "payment_failure.v1",
      recognition_policy_id: "recognition.v1",
      billing_terms_policy_id: "billing_terms.v1",
    })
    .select("id")
    .single();
  if (versionError) throw new Error(`makeDraftOffer version: ${versionError.message}`);

  if (opts.priceMinor !== 0) {
    const { error: priceError } = await coach.user.client.from("offer_prices").insert({
      offer_version_id: version.id,
      currency: opts.currency ?? "USD",
      amount_minor: opts.priceMinor ?? 10000,
    });
    if (priceError) throw new Error(`makeDraftOffer price: ${priceError.message}`);
  }

  return { offerId: offer.id as string, versionId: version.id as string };
}

/** Machine code from a Postgres exception raised by our functions. */
export function errorCode(error: { message?: string } | null | undefined): string | null {
  return error?.message ?? null;
}

// ---------------------------------------------------------------------------
// Coaching Welcome & Expectations (Batch 3)
// ---------------------------------------------------------------------------

/** Fixture wording. Clearly synthetic; never shown to a real person. */
export const FIXTURE_EXPECTATIONS = {
  provides: "Fixture: what this test coach provides.",
  meeting_approach: "Fixture: how we meet.",
  typical_duration: "",
  appointments: "Fixture: how appointments are arranged.",
  messaging_availability: "Fixture: messaging hours.",
  response_expectation: "Fixture: usually within a day.",
  changes: "Fixture: we talk changes through in messages.",
  client_part: ["Fixture: share goals privately."],
  coach_part: ["Fixture: review check-ins."],
};

/**
 * Publishes a coach's expectations through the coach's own session, exactly
 * as the editor does. Returns the live version id.
 */
export async function publishCoachExpectations(
  coach: CoachFixture,
  content: Partial<typeof FIXTURE_EXPECTATIONS> = {},
  opts: { material?: boolean; summary?: string } = {},
): Promise<string> {
  const { data: draft, error } = await coach.user.client.rpc("save_my_expectations_draft", { p: { ...FIXTURE_EXPECTATIONS, ...content } });
  if (error || !draft) throw new Error(`save expectations: ${error?.message}`);
  const { data, error: publishError } = await coach.user.client.rpc("publish_my_expectations", {
    p_draft: draft, p_material: opts.material ?? true, p_summary: opts.summary ?? null,
  });
  if (publishError) throw new Error(`publish expectations: ${publishError.message}`);
  return (data as { version_id: string }).version_id;
}

/**
 * The live TalentYak section. If the project has none yet, publishes one
 * through a real admin session at aal2 — the same path the admin page uses —
 * and says so, because that is a visible change to the test project.
 */
export async function ensurePlatformExpectations(): Promise<string> {
  const sb = adminClient();
  const { data: live } = await sb.from("platform_expectation_versions").select("id")
    .not("published_at", "is", null).is("superseded_at", null).maybeSingle();
  if (live) return live.id as string;

  const founder = await createTestUser("expectations-publisher");
  try {
    await setRole(founder.id, "admin");
    await upgradeToAal2(founder);
    const { data: draft, error } = await founder.client.rpc("admin_save_platform_expectations_draft", {
      p: {
        conduct: "Test project wording — conduct. Not approved policy.",
        privacy: "Test project wording — privacy. Not approved policy.",
        support: "Test project wording — open a case from Support in your account.",
        policy_links: ["/legal/terms", "/legal/privacy", "/account/support"],
      },
    });
    if (error) throw new Error(`platform draft: ${error.message}`);
    const { data, error: publishError } = await founder.client.rpc("admin_publish_platform_expectations", {
      p_draft: draft, p_material: true, p_summary: "First version, published for the test project.",
    });
    if (publishError) throw new Error(`platform publish: ${publishError.message}`);
    console.log("  (published a first TalentYak expectations section in the test project)");
    return (data as { version_id: string }).version_id;
  } finally {
    await deleteTestUsers([founder.id]);
  }
}

/** The versions a checkout page would display for this coach right now. */
export async function liveExpectationIds(providerId: string): Promise<{ coach: string | null; platform: string | null }> {
  const sb = adminClient();
  const [{ data: c }, { data: p }] = await Promise.all([
    sb.from("coach_expectation_versions").select("id").eq("provider_id", providerId)
      .not("published_at", "is", null).is("superseded_at", null).maybeSingle(),
    sb.from("platform_expectation_versions").select("id").not("published_at", "is", null).is("superseded_at", null).maybeSingle(),
  ]);
  return { coach: (c?.id as string) ?? null, platform: (p?.id as string) ?? null };
}
