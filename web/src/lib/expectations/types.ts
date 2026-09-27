/**
 * Coaching Welcome & Expectations — shapes and field definitions shared by the
 * editors, the document renderer and the server loaders. Client-safe.
 *
 * The document is a clear statement of mutual expectations. It is not a
 * contract, a liability waiver, or a replacement for the platform terms, and
 * nothing in it can change what somebody bought.
 */

export const DOCUMENT_TITLE = "Coaching Welcome & Expectations";

/** The coach's own words: "Your coaching arrangement". */
export const ARRANGEMENT_FIELDS = [
  { key: "provides", label: "What I provide", max: 1500, required: true, rows: 4 },
  { key: "meeting_approach", label: "How we meet and work together", max: 1500, required: true, rows: 3 },
  { key: "typical_duration", label: "Typical length of a session or check-in, if it applies", max: 300, required: false, rows: 2 },
  { key: "appointments", label: "How appointments are arranged", max: 1500, required: true, rows: 3 },
  { key: "messaging_availability", label: "When I'm available on messages", max: 1000, required: true, rows: 2 },
  { key: "response_expectation", label: "How quickly I usually reply", max: 500, required: true, rows: 2 },
  { key: "changes", label: "How we discuss changes", max: 1500, required: true, rows: 3 },
] as const;

export type ArrangementKey = (typeof ARRANGEMENT_FIELDS)[number]["key"];

export const LIST_FIELDS = [
  { key: "client_part", label: "Your part as a client", max: 12, itemMax: 300 },
  { key: "coach_part", label: "What your coach commits to", max: 12, itemMax: 300 },
] as const;

export type ListKey = (typeof LIST_FIELDS)[number]["key"];

export type CoachExpectationsContent = Record<ArrangementKey, string> & Record<ListKey, string[]>;

export interface CoachExpectationsVersion extends CoachExpectationsContent {
  id: string;
  provider_id: string;
  version: number;
  material: boolean;
  change_summary: string | null;
  published_at: string | null;
  superseded_at: string | null;
  updated_at: string;
}

export const COACH_VERSION_COLUMNS =
  "id, provider_id, version, provides, meeting_approach, typical_duration, appointments, messaging_availability, response_expectation, changes, client_part, coach_part, material, change_summary, published_at, superseded_at, updated_at";

export const PLATFORM_FIELDS = [
  { key: "conduct", label: "Conduct", max: 4000, rows: 6 },
  { key: "privacy", label: "Privacy", max: 4000, rows: 6 },
  { key: "support", label: "Getting help", max: 2000, rows: 3 },
] as const;

export type PlatformKey = (typeof PLATFORM_FIELDS)[number]["key"];

export type PlatformExpectationsContent = Record<PlatformKey, string> & { policy_links: string[] };

export interface PlatformExpectationsVersion extends PlatformExpectationsContent {
  id: string;
  version: number;
  material: boolean;
  change_summary: string | null;
  published_at: string | null;
  superseded_at: string | null;
  updated_at: string;
}

export const PLATFORM_VERSION_COLUMNS =
  "id, version, conduct, privacy, support, policy_links, material, change_summary, published_at, superseded_at, updated_at";

/**
 * Pages the essentials may link to. Only these — the database additionally
 * refuses anything that isn't an internal path — so a policy link can never
 * point somewhere we don't control.
 */
export const POLICY_LINK_OPTIONS: { href: string; label: string }[] = [
  { href: "/legal/terms", label: "Terms of service" },
  { href: "/legal/privacy", label: "Privacy notice" },
  { href: "/account/support", label: "Contact support" },
  { href: "/how-it-works", label: "How TalentYak works" },
];

export function policyLinkLabel(href: string): string | null {
  return POLICY_LINK_OPTIONS.find((o) => o.href === href)?.label ?? null;
}

/** The facts of the plan, from the frozen purchase snapshot or the live offer. */
export interface PlanFacts {
  title: string;
  service_type: "recurring_coaching" | "one_off_consultation";
  calls_included_per_month: number | null;
  call_duration_minutes: number | null;
  check_in_cadence: string | null;
  response_time_hours: number | null;
  programme_included: boolean;
  programme_review_cadence: string | null;
  form_review_included: boolean;
  messaging_channel: string | null;
  additional_inclusions: string[];
}

export interface Personalisation {
  clientName: string;
  startDate: string | null;
  presentedAt: string;
  source: "purchase" | "revision" | "reassignment" | "legacy";
  acknowledgedAt: string | null;
  acknowledgementRequested: boolean;
}

export const SOURCE_LABEL: Record<Personalisation["source"], string> = {
  purchase: "Shown before purchase and recorded with it",
  revision: "An update published during the coaching",
  reassignment: "From the new coach, after a coach change",
  legacy: "Published after joining — not part of the original purchase",
};

/** What is missing before a coach version can be published. */
export function missingCoachFields(v: CoachExpectationsContent): string[] {
  const missing: string[] = ARRANGEMENT_FIELDS.filter((f) => f.required && !v[f.key].trim()).map((f) => f.label);
  for (const f of LIST_FIELDS) if (v[f.key].length === 0) missing.push(f.label);
  return missing;
}

/** What is missing before the essentials can be published. */
export function missingPlatformFields(v: PlatformExpectationsContent): string[] {
  const missing: string[] = PLATFORM_FIELDS.filter((f) => !v[f.key].trim()).map((f) => f.label);
  if (v.policy_links.length === 0) missing.push("Links to platform policies (recommended)");
  return missing;
}

export const EXPECTATIONS_ERRORS: Record<string, string> = {
  expectations_incomplete: "Fill in every required part before publishing.",
  draft_not_found: "That draft has already been published or discarded. Refresh the page.",
  not_a_coach: "Only an active coach can edit their expectations.",
  item_too_long: "Keep each point under 300 characters.",
  summary_too_long: "Keep the summary of changes under 500 characters.",
  admin_only: "Only an administrator with a verified second factor can do that.",
  not_found: "This document isn't available to you.",
  sign_in_required: "Sign in again to continue.",
};

export function expectationsError(message: string | undefined | null, fallback: string): string {
  if (!message) return fallback;
  const code = Object.keys(EXPECTATIONS_ERRORS).find((c) => message.includes(c));
  return code ? EXPECTATIONS_ERRORS[code] : fallback;
}
