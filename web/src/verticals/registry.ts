import type { Vertical, Service, IntakeSchema } from "@/lib/catalog/types";
import type { PayoutRule } from "@/lib/payouts/types";
import { panditVertical, panditServices } from "@/verticals/pandit/catalog";
import { panditPayoutRule } from "@/verticals/pandit/payout";
import { panditIntakeSchemas } from "@/verticals/pandit/intake";
import { fitnessVertical, fitnessServices } from "@/verticals/fitness/catalog";
import { fitnessPayoutRule } from "@/verticals/fitness/payout";
import { fitnessIntakeSchemas } from "@/verticals/fitness/intake";
import { tutoringVertical, bookkeepingVertical } from "@/verticals/future";

/**
 * The plug-in contract. A vertical node provides:
 *  - catalog: its vertical row + service SKUs (seed data, mirrored in DB)
 *  - intakeSchemas: per-service booking forms, rendered generically
 *  - payoutRule: how provider earnings are computed for its bookings
 *  - adminHref: optional path to its panel inside the admin console
 *
 * This file is the single composition root. Core code never imports
 * from src/verticals/<slug>/ directly — it goes through the registry.
 */
export interface VerticalModule {
  vertical: Vertical;
  services: Service[];
  intakeSchemas: IntakeSchema[];
  payoutRule?: PayoutRule;
  adminHref?: string;
}

const modules: VerticalModule[] = [
  {
    vertical: panditVertical,
    services: panditServices,
    intakeSchemas: panditIntakeSchemas,
    payoutRule: panditPayoutRule,
    adminHref: "/admin/pandit",
  },
  {
    vertical: fitnessVertical,
    services: fitnessServices,
    intakeSchemas: fitnessIntakeSchemas,
    payoutRule: fitnessPayoutRule,
    adminHref: "/admin/fitness",
  },
  // Catalog-only future nodes: visible as coming soon, nothing behind them.
  { vertical: tutoringVertical, services: [], intakeSchemas: [] },
  { vertical: bookkeepingVertical, services: [], intakeSchemas: [] },
];

export function getModules(): VerticalModule[] {
  return modules;
}

export function getModule(slug: string): VerticalModule | undefined {
  return modules.find((m) => m.vertical.slug === slug);
}
