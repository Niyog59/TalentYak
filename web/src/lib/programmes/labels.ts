import type { PlanKind } from "@/lib/programmes/content";

export const KIND_LABEL: Record<PlanKind, string> = {
  workout: "Workout plan",
  nutrition: "Nutrition plan",
};

export const EXPERIENCE_LABEL: Record<string, string> = {
  new: "New to training",
  some: "Some experience (under 2 years)",
  experienced: "Experienced (2 years or more)",
};

export const EQUIPMENT_LABEL: Record<string, string> = {
  gym: "Full gym",
  dumbbells: "Dumbbells",
  barbell: "Barbell and plates",
  kettlebells: "Kettlebells",
  bands: "Resistance bands",
  pullup_bar: "Pull-up bar",
  bench: "Bench",
  cardio_machine: "Treadmill, bike or rower",
  none: "No equipment (bodyweight)",
};

/** What the database says, in words a coach or client can act on. */
const ERRORS: Record<string, string> = {
  plan_not_permitted: "You can't change this plan. Coaching may be paused or ended, or this client may no longer be assigned to you.",
  plan_no_draft: "There's no draft to publish. Save your changes first.",
  plan_not_publishable: "This plan needs more before it can be published.",
  plan_effective_too_far: "Choose a start date within the next year.",
  plan_summary_required: "Say briefly what changed, so your client knows — or mark it as a minor correction.",
  plan_summary_too_long: "Keep the summary to 500 characters.",
  plan_draft_exists: "You already have a draft. Publish or discard it first.",
  plan_source_unavailable: "That plan or template isn't available to copy.",
  plan_source_required: "Choose what to start from.",
  plan_version_in_effect: "That update has already started, so it can't be cancelled. Publish a new version instead.",
  plan_version_published: "A published version can't be changed. Publish a new version instead.",
  plan_session_unknown: "That session isn't in this plan any more. Refresh the page.",
  plan_week_invalid: "Sessions can be moved within this week or a future week.",
  plan_content_invalid: "Something in the plan isn't valid. Check each section and try again.",
  plan_kind_invalid: "That didn't work. Reload the page and try again.",
};

export function planError(message: string | undefined | null, fallback: string): string {
  if (!message) return fallback;
  for (const [code, words] of Object.entries(ERRORS)) if (message.includes(code)) return words;
  if (message.includes("row-level security")) return ERRORS.plan_not_permitted;
  return fallback;
}
