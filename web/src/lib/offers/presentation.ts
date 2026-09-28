import type { CoachAvailability, PublicCoach, PublicPlan } from "@/lib/offers/public";
import { planPurchasable, type PurchaseMode } from "@/lib/launch";

/*
 * What the public is told about a coach and a package (M16). Pure apart from
 * the launch rule, so the pages and the tests agree on exactly the same words
 * and on when "Choose" may appear. Checkout re-checks all of it on the server.
 */

export const AVAILABILITY_LABEL: Record<CoachAvailability, string> = {
  available: "Taking new clients",
  full: "Full right now",
  away: "Away right now",
  not_accepting: "Not taking new clients",
};

export function availabilityText(c: Pick<PublicCoach, "availability" | "awayUntil">): string {
  if (c.availability === "away" && c.awayUntil) {
    return `Away until ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${c.awayUntil}T00:00:00Z`))}`;
  }
  return AVAILABILITY_LABEL[c.availability];
}

export function planCadence(plan: Pick<PublicPlan, "service_type" | "billing_interval" | "billing_interval_count">): string {
  if (plan.service_type !== "recurring_coaching") return "one payment";
  const n = plan.billing_interval_count ?? 1;
  const unit = plan.billing_interval ?? "month";
  return n === 1 ? `a ${unit}` : `every ${n} ${unit}s`;
}

export function renewalText(plan: Pick<PublicPlan, "service_type" | "billing_interval" | "billing_interval_count">): string {
  return plan.service_type === "recurring_coaching"
    ? `Renews automatically ${planCadence(plan).replace(/^a /, "every ")} until you cancel.`
    : "One payment. Nothing renews.";
}

export type PackageAction = { kind: "choose" } | { kind: "waitlist"; reason: string };

export function packageAction(args: {
  coach: Pick<PublicCoach, "availability" | "awayUntil" | "display_name">;
  plan: Pick<PublicPlan, "service_type" | "call_duration_minutes" | "programme_included" | "calls_included_per_month" | "check_in_cadence" | "messaging_channel" | "form_review_included">;
  mode: PurchaseMode;
  expectationsPublished: boolean;
}): PackageAction {
  const { coach, plan, mode } = args;
  const recurring = plan.service_type === "recurring_coaching";
  if (recurring && coach.availability !== "available") return { kind: "waitlist", reason: `${availabilityText(coach)}.` };
  if (!recurring && coach.availability === "not_accepting") return { kind: "waitlist", reason: "Not taking new clients right now." };
  if (!args.expectationsPublished) return { kind: "waitlist", reason: `${coach.display_name} hasn't published their welcome & expectations yet, so this can't be bought.` };
  if (!recurring && !plan.call_duration_minutes) return { kind: "waitlist", reason: "This session doesn't state its length yet, so it can't be booked." };
  if (!planPurchasable(mode, plan)) return { kind: "waitlist", reason: "TalentYak isn't taking payments yet." };
  return { kind: "choose" };
}
