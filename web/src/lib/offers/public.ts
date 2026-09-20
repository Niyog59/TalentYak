import "server-only";
import { createClient } from "@/lib/supabase/server";
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

export async function listPublicCoaches(): Promise<{ coach: PublicCoach; plans: PublicPlan[] }[] | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: coaches, error } = await supabase.from("public_coach_directory").select("*").order("display_name").limit(200);
  if (error) return null;
  const visible = ((coaches ?? []) as PublicCoach[]).filter((c) => isPublicVertical(c.vertical_slug) && c.slug);
  if (visible.length === 0) return [];

  const { data: offers } = await supabase.from("offers").select(PLAN_COLUMNS).in("provider_id", visible.map((c) => c.provider_id));
  return visible.map((coach) => ({
    coach,
    plans: livePlans(((offers ?? []) as unknown as OfferRow[]).filter((o) => o.provider_id === coach.provider_id)),
  }));
}

export async function getPublicCoach(slug: string): Promise<{ coach: PublicCoach; plans: PublicPlan[] } | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: coach } = await supabase.from("public_coach_directory").select("*").eq("slug", slug).maybeSingle();
  if (!coach || !isPublicVertical((coach as PublicCoach).vertical_slug)) return null;
  const { data: offers } = await supabase.from("offers").select(PLAN_COLUMNS).eq("provider_id", (coach as PublicCoach).provider_id);
  return { coach: coach as PublicCoach, plans: livePlans((offers ?? []) as unknown as OfferRow[]) };
}

/** A plan by its live version id, with its coach — for checkout. */
export async function getPublicPlan(versionId: string): Promise<{ coach: PublicCoach; plan: PublicPlan } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: version } = await supabase.from("offer_versions").select("offer_id, offers(provider_id)").eq("id", versionId).maybeSingle();
  const providerId = (Array.isArray(version?.offers) ? version?.offers[0] : version?.offers) as { provider_id: string } | undefined;
  if (!version || !providerId) return null;
  const { data: coach } = await supabase.from("public_coach_directory").select("*").eq("provider_id", providerId.provider_id).maybeSingle();
  if (!coach || !isPublicVertical((coach as PublicCoach).vertical_slug)) return null;
  const { data: offers } = await supabase.from("offers").select(PLAN_COLUMNS).eq("id", version.offer_id);
  const plan = livePlans((offers ?? []) as unknown as OfferRow[]).find((p) => p.version_id === versionId);
  return plan ? { coach: coach as PublicCoach, plan } : null;
}
