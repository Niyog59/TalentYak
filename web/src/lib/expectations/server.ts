import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { coachPhotoUrl } from "@/lib/storage/photos";
import {
  COACH_VERSION_COLUMNS,
  PLATFORM_VERSION_COLUMNS,
  type CoachExpectationsVersion,
  type PlanFacts,
  type PlatformExpectationsVersion,
  type Personalisation,
} from "@/lib/expectations/types";

/*
 * Every read here goes through the signed-in person's own session, so
 * row-level security decides what they may see. The single exception is the
 * coach's display name and approved public photo for a document the person has
 * ALREADY been allowed to read — public facts, looked up by id only after the
 * access check has passed.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LiveExpectations {
  platform: PlatformExpectationsVersion | null;
  coach: CoachExpectationsVersion | null;
}

/** The live, non-personalised versions for a public coach. Safe for anyone. */
export async function getLiveExpectations(providerId: string): Promise<LiveExpectations> {
  const supabase = await createClient();
  if (!supabase || !UUID.test(providerId)) return { platform: null, coach: null };
  const [{ data: platform }, { data: coach }] = await Promise.all([
    supabase.from("platform_expectation_versions").select(PLATFORM_VERSION_COLUMNS)
      .not("published_at", "is", null).is("superseded_at", null).maybeSingle(),
    supabase.from("coach_expectation_versions").select(COACH_VERSION_COLUMNS)
      .eq("provider_id", providerId).not("published_at", "is", null).is("superseded_at", null).maybeSingle(),
  ]);
  return {
    platform: (platform as PlatformExpectationsVersion | null) ?? null,
    coach: (coach as CoachExpectationsVersion | null) ?? null,
  };
}

export async function getLivePlatform(): Promise<PlatformExpectationsVersion | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data } = await supabase.from("platform_expectation_versions").select(PLATFORM_VERSION_COLUMNS)
    .not("published_at", "is", null).is("superseded_at", null).maybeSingle();
  return (data as PlatformExpectationsVersion | null) ?? null;
}

/** The signed-in coach's versions: draft, live and history. */
export async function getMyCoachVersions(providerId: string): Promise<{
  draft: CoachExpectationsVersion | null;
  live: CoachExpectationsVersion | null;
  history: CoachExpectationsVersion[];
}> {
  const supabase = await createClient();
  if (!supabase) return { draft: null, live: null, history: [] };
  const { data } = await supabase.from("coach_expectation_versions").select(COACH_VERSION_COLUMNS)
    .eq("provider_id", providerId).order("version", { ascending: false }).limit(50);
  const rows = (data ?? []) as CoachExpectationsVersion[];
  return {
    draft: rows.find((r) => !r.published_at) ?? null,
    live: rows.find((r) => r.published_at && !r.superseded_at) ?? null,
    history: rows.filter((r) => r.published_at),
  };
}

export function planFactsFromSnapshot(serviceType: string, snapshot: Record<string, unknown> | null): PlanFacts | null {
  if (!snapshot) return null;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    title: str(snapshot.title) ?? "Your plan",
    service_type: serviceType === "one_off_consultation" ? "one_off_consultation" : "recurring_coaching",
    calls_included_per_month: num(snapshot.calls_included_per_month),
    call_duration_minutes: num(snapshot.call_duration_minutes),
    check_in_cadence: str(snapshot.check_in_cadence),
    response_time_hours: num(snapshot.response_time_hours),
    programme_included: snapshot.programme_included === true,
    programme_review_cadence: str(snapshot.programme_review_cadence),
    form_review_included: snapshot.form_review_included === true,
    messaging_channel: str(snapshot.messaging_channel),
    additional_inclusions: Array.isArray(snapshot.additional_inclusions)
      ? snapshot.additional_inclusions.filter((x): x is string => typeof x === "string")
      : [],
  };
}

export interface Presentation {
  id: string;
  source: Personalisation["source"];
  acknowledgement_requested: boolean;
  presented_at: string;
  previous_id: string | null;
  provider_id: string;
  coach: CoachExpectationsVersion | null;
  platform: PlatformExpectationsVersion | null;
  acknowledged_at: string | null;
  coachName: string;
  coachPhotoUrl: string | null;
}

export interface EnrollmentDocument {
  enrollmentId: string;
  customerId: string;
  state: string;
  startedAt: string | null;
  plan: PlanFacts | null;
  /** True when the purchase predates this feature: nothing was shown before it. */
  purchasedWithout: boolean;
  /** Newest first. */
  presentations: Presentation[];
}

/**
 * Everything one relationship's document needs, read as the viewer. Returns
 * null when the viewer may not see this relationship at all — the database
 * decides, and another client's relationship reads as not found.
 */
export async function getEnrollmentDocument(enrollmentId: string): Promise<EnrollmentDocument | null> {
  if (!UUID.test(enrollmentId)) return null;
  const supabase = await createClient();
  if (!supabase) return null;

  const { data: enrollment } = await supabase.from("enrollments")
    .select("id, customer_id, state, started_at, purchase_id").eq("id", enrollmentId).maybeSingle();

  const { data: rows, error } = await supabase.from("enrollment_expectations")
    .select("id, source, acknowledgement_requested, presented_at, previous_id, provider_id, coach_version_id, platform_version_id, expectation_acknowledgements(acknowledged_at)")
    .eq("enrollment_id", enrollmentId)
    .order("presented_at", { ascending: false })
    .limit(50);
  if (error) return null;
  // Neither the relationship nor any presentation is visible: not theirs.
  if (!enrollment && (rows ?? []).length === 0) return null;

  let plan: PlanFacts | null = null;
  let purchasedWithout = false;
  if (enrollment?.purchase_id) {
    const { data: purchase } = await supabase.from("purchases")
      .select("service_type, inclusions_snapshot, expectations_coach_version_id").eq("id", enrollment.purchase_id).maybeSingle();
    if (purchase) {
      plan = planFactsFromSnapshot(purchase.service_type as string, purchase.inclusions_snapshot as Record<string, unknown>);
      purchasedWithout = !purchase.expectations_coach_version_id;
    }
  }

  const list = (rows ?? []) as {
    id: string; source: Presentation["source"]; acknowledgement_requested: boolean; presented_at: string; previous_id: string | null;
    provider_id: string; coach_version_id: string; platform_version_id: string;
    expectation_acknowledgements: { acknowledged_at: string }[] | { acknowledged_at: string } | null;
  }[];

  const coachIds = [...new Set(list.map((r) => r.coach_version_id))];
  const platformIds = [...new Set(list.map((r) => r.platform_version_id))];
  const [{ data: coachVersions }, { data: platformVersions }] = await Promise.all([
    coachIds.length ? supabase.from("coach_expectation_versions").select(COACH_VERSION_COLUMNS).in("id", coachIds) : Promise.resolve({ data: [] }),
    platformIds.length ? supabase.from("platform_expectation_versions").select(PLATFORM_VERSION_COLUMNS).in("id", platformIds) : Promise.resolve({ data: [] }),
  ]);

  // Public facts about coaches, after access has been decided above.
  const providerIds = [...new Set(list.map((r) => r.provider_id))];
  const names = new Map<string, { name: string; photo: string | null }>();
  const admin = createAdminClient();
  if (admin && providerIds.length) {
    const { data: providers } = await admin.from("providers").select("id, display_name, provider_public_profiles(photo_path)").in("id", providerIds);
    for (const p of (providers ?? []) as { id: string; display_name: string; provider_public_profiles: { photo_path: string | null } | { photo_path: string | null }[] | null }[]) {
      const pp = Array.isArray(p.provider_public_profiles) ? p.provider_public_profiles[0] : p.provider_public_profiles;
      names.set(p.id, { name: p.display_name, photo: coachPhotoUrl(pp?.photo_path ?? null) });
    }
  }

  const presentations: Presentation[] = list.map((r) => {
    const ack = Array.isArray(r.expectation_acknowledgements) ? r.expectation_acknowledgements[0] : r.expectation_acknowledgements;
    const who = names.get(r.provider_id);
    return {
      id: r.id,
      source: r.source,
      acknowledgement_requested: r.acknowledgement_requested,
      presented_at: r.presented_at,
      previous_id: r.previous_id,
      provider_id: r.provider_id,
      coach: ((coachVersions ?? []) as CoachExpectationsVersion[]).find((v) => v.id === r.coach_version_id) ?? null,
      platform: ((platformVersions ?? []) as PlatformExpectationsVersion[]).find((v) => v.id === r.platform_version_id) ?? null,
      acknowledged_at: ack?.acknowledged_at ?? null,
      coachName: who?.name ?? "Your coach",
      coachPhotoUrl: who?.photo ?? null,
    };
  });

  return {
    enrollmentId,
    customerId: (enrollment?.customer_id as string) ?? "",
    state: (enrollment?.state as string) ?? "ended",
    startedAt: (enrollment?.started_at as string) ?? null,
    plan,
    purchasedWithout,
    presentations,
  };
}
