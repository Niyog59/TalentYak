import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isReservedTestAddress } from "@/lib/email";
import { isPublicVertical } from "@/verticals/registry";

/**
 * Reading what the public may see: approved, published coaches in a public
 * service, and the live version of each plan they have on sale. Row-level
 * security already limits every query here to public rows; the vertical check
 * is a second, independent gate so a hidden service can never be listed even
 * if a row were misconfigured.
 */

export interface PublicPrice {
  currency: string;
  amount_minor: number;
}

export interface PublicPlan {
  offer_id: string;
  version_id: string;
  version: number;
  title: string;
  description: string;
  service_type: "recurring_coaching" | "one_off_consultation";
  billing_structure: string;
  billing_interval: string | null;
  billing_interval_count: number | null;
  intended_client: string | null;
  calls_included_per_month: number | null;
  call_duration_minutes: number | null;
  check_in_cadence: string | null;
  response_time_hours: number | null;
  programme_included: boolean;
  programme_review_cadence: string | null;
  form_review_included: boolean;
  messaging_channel: string | null;
  additional_inclusions: string[];
  cancellation_policy_id: string;
  prices: PublicPrice[];
}

export type CoachAvailability = "available" | "full" | "away" | "not_accepting";

export interface PublicCredential {
  title: string;
  issuing_body: string | null;
  issued_year: number | null;
  verified_detail: string | null;
  verified_on: string;
}

export interface PublicCoach {
  provider_id: string;
  slug: string;
  vertical_slug: string;
  accepting_new_clients: boolean;
  timezone: string | null;
  display_name: string;
  headline: string | null;
  bio: string | null;
  approach: string | null;
  specialties: string[];
  languages: string[];
  experience_since: string | null;
  photo_path: string | null;
  /** Whether a new client could start now — a state, never a client count. */
  availability: CoachAvailability;
  awayUntil: string | null;
  /** Only qualifications TalentYak has checked. */
  credentials: PublicCredential[];
}

const PLAN_COLUMNS =
  "id, provider_id, status, offer_versions(id, version, title, description, service_type, billing_structure, billing_interval, billing_interval_count, intended_client, calls_included_per_month, call_duration_minutes, check_in_cadence, response_time_hours, programme_included, programme_review_cadence, form_review_included, messaging_channel, additional_inclusions, cancellation_policy_id, published_at, superseded_at, offer_prices(currency, amount_minor))";

type OfferRow = {
  id: string;
  provider_id: string;
  status: string;
  offer_versions: (Omit<PublicPlan, "offer_id" | "version_id" | "prices"> & { id: string; published_at: string | null; superseded_at: string | null; offer_prices: PublicPrice[] })[];
};

function livePlans(offers: OfferRow[]): PublicPlan[] {
  const plans: PublicPlan[] = [];
  for (const offer of offers) {
    if (offer.status !== "published") continue;
    const live = offer.offer_versions.find((v) => v.published_at && !v.superseded_at);
    if (!live || live.offer_prices.length === 0) continue;
    const { id, published_at: _p, superseded_at: _s, offer_prices, ...rest } = live;
    plans.push({ ...rest, offer_id: offer.id, version_id: id, prices: [...offer_prices].sort((a, b) => a.currency.localeCompare(b.currency)) });
  }
  return plans.sort((a, b) => (a.service_type === b.service_type ? a.title.localeCompare(b.title) : a.service_type === "recurring_coaching" ? -1 : 1));
}

type Supabase = NonNullable<Awaited<ReturnType<typeof createClient>>>;
type DirectoryRow = Omit<PublicCoach, "availability" | "awayUntil" | "credentials">;

/**
 * The production site never shows a test account as a coach (invariant 9).
 * The hosted project doubles as the test environment, so automated tests
 * create real, published coach rows while they run; here, on the production
 * deployment only, any coach whose account uses a reserved test address (or
 * has no account at all) is left out. Emails are read server-side for this
 * check and never leave this function. Locally and on previews they show,
 * so walkthroughs can use them.
 */
async function withoutTestAccounts(rows: DirectoryRow[]): Promise<DirectoryRow[]> {
  if (process.env.VERCEL_ENV !== "production" || rows.length === 0) return rows;
  const admin = createAdminClient();
  if (!admin) return [];
  const { data, error } = await admin.from("providers").select("id, profiles(email)").in("id", rows.map((r) => r.provider_id));
  if (error) return [];
  const real = new Set(
    ((data ?? []) as unknown as { id: string; profiles: { email: string | null } | { email: string | null }[] | null }[])
      .filter((p) => {
        const email = (Array.isArray(p.profiles) ? p.profiles[0] : p.profiles)?.email;
        return Boolean(email) && !isReservedTestAddress(email!);
      })
      .map((p) => p.id),
  );
  return rows.filter((r) => real.has(r.provider_id));
}

/** Availability and checked qualifications for directory rows. Unknown availability reads as not accepting. */
async function enrich(supabase: Supabase, input: DirectoryRow[]): Promise<PublicCoach[]> {
  const rows = await withoutTestAccounts(input);
  if (!rows.length) return [];
  const [{ data: avail }, { data: creds }] = await Promise.all([
    supabase.rpc("coach_public_availability"),
    supabase.rpc("public_coach_credentials"),
  ]);
  const a = new Map(((avail ?? []) as { provider_id: string; state: CoachAvailability; away_until: string | null }[]).map((r) => [r.provider_id, r]));
  const c = (creds ?? []) as (PublicCredential & { provider_id: string })[];
  return rows.map((r) => ({
    ...r,
    // If availability can't be read, nobody is invited to buy.
    availability: a.get(r.provider_id)?.state ?? "not_accepting",
    awayUntil: a.get(r.provider_id)?.away_until ?? null,
    credentials: c.filter((x) => x.provider_id === r.provider_id).map(({ provider_id: _p, ...rest }) => rest),
  }));
}

export async function listPublicCoaches(): Promise<{ coach: PublicCoach; plans: PublicPlan[] }[] | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: coaches, error } = await supabase.from("public_coach_directory").select("*").order("display_name").limit(50);
  if (error) return null;
  const visible = await enrich(supabase, ((coaches ?? []) as DirectoryRow[]).filter((c) => isPublicVertical(c.vertical_slug) && c.slug));
  if (visible.length === 0) return [];

  const { data: offers, error: offersError } = await supabase.from("offers").select(PLAN_COLUMNS).in("provider_id", visible.map((c) => c.provider_id));
  if (offersError) return null;
  return visible.map((coach) => ({
    coach,
    plans: livePlans(((offers ?? []) as unknown as OfferRow[]).filter((o) => o.provider_id === coach.provider_id)),
  }));
}

export async function getPublicCoach(slug: string): Promise<{ coach: PublicCoach; plans: PublicPlan[] } | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: row } = await supabase.from("public_coach_directory").select("*").eq("slug", slug).maybeSingle();
  if (!row || !isPublicVertical((row as DirectoryRow).vertical_slug)) return null;
  const [coach] = await enrich(supabase, [row as DirectoryRow]);
  if (!coach) return null;
  const { data: offers } = await supabase.from("offers").select(PLAN_COLUMNS).eq("provider_id", coach.provider_id);
  return { coach, plans: livePlans((offers ?? []) as unknown as OfferRow[]) };
}

/** A plan by its live version id, with its coach — for checkout. */
export async function getPublicPlan(versionId: string): Promise<{ coach: PublicCoach; plan: PublicPlan } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: version } = await supabase.from("offer_versions").select("offer_id, offers(provider_id)").eq("id", versionId).maybeSingle();
  const providerId = (Array.isArray(version?.offers) ? version?.offers[0] : version?.offers) as { provider_id: string } | undefined;
  if (!version || !providerId) return null;
  const { data: row } = await supabase.from("public_coach_directory").select("*").eq("provider_id", providerId.provider_id).maybeSingle();
  if (!row || !isPublicVertical((row as DirectoryRow).vertical_slug)) return null;
  const [coach] = await enrich(supabase, [row as DirectoryRow]);
  if (!coach) return null;
  const { data: offers } = await supabase.from("offers").select(PLAN_COLUMNS).eq("id", version.offer_id);
  const plan = livePlans((offers ?? []) as unknown as OfferRow[]).find((p) => p.version_id === versionId);
  return plan ? { coach, plan } : null;
}
