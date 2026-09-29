import "server-only";
import type { SessionContext } from "@/lib/auth";
import { stripeMode } from "@/lib/payments/stripe";
import { evaluateSaleReadiness, isLiveBillingFlagSet } from "@/lib/policy/live-gate";
import type { OfferInclusions } from "@/lib/fulfillment";

/*
 * Two launch states, kept apart.
 *
 *   · Public information and the waitlist are always available.
 *   · Buying is available only when it is real and ready (live mode, the
 *     live-billing flag, and the offer passing every sale lock), or — in test
 *     mode — to a protected set of testers: a local development server, a
 *     signed-in administrator, or an address on TEST_CHECKOUT_EMAILS.
 *
 * Everyone else meets honest "join the waitlist" actions instead of a
 * checkout they can't use, and a test transaction is never presented as a
 * sale. The checkout page and the checkout action both ask here, on the
 * server; hiding a button is never the control.
 */

export type PurchaseMode = "live" | "test" | "closed";

function testerEmails(): string[] {
  return (process.env.TEST_CHECKOUT_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Pure: exported for tests. */
export function decidePurchaseMode(args: {
  stripe: "live" | "test" | "unconfigured";
  liveFlag: boolean;
  development: boolean;
  isAdmin: boolean;
  email: string | null;
  testers: string[];
}): PurchaseMode {
  if (args.stripe === "live") return args.liveFlag ? "live" : "closed";
  if (args.stripe !== "test") return "closed";
  if (args.development || args.isAdmin) return "test";
  if (args.email && args.testers.includes(args.email.toLowerCase())) return "test";
  return "closed";
}

/**
 * Who may buy right now: the launch rules above, narrowed by the founder's
 * switches (new purchases, and the public profiles buying starts from). A
 * switch can only close buying further; it never opens live payments.
 */
export async function purchaseMode(session: SessionContext | null): Promise<PurchaseMode> {
  const base = basePurchaseMode(session);
  if (base === "closed") return base;
  // Loaded here, not at the top: the pure rules above stay importable by tests.
  const { featureAllowsMe, getFeatureStates } = await import("@/lib/features/server");
  const { modes, ok } = await getFeatureStates();
  if (!ok || modes.public_profiles !== "on") return "closed";
  if (modes.new_sales === "on") return base;
  if (modes.new_sales === "test_only" && session && (await featureAllowsMe("new_sales"))) return base;
  return "closed";
}

function basePurchaseMode(session: SessionContext | null): PurchaseMode {
  return decidePurchaseMode({
    stripe: stripeMode(),
    liveFlag: isLiveBillingFlagSet(),
    development: process.env.NODE_ENV !== "production",
    isAdmin: Boolean(session && session.profile.role === "admin" && session.aal === "aal2" && !session.profile.suspended_at),
    email: session?.email ?? null,
    testers: testerEmails(),
  });
}

/** Whether this plan can be bought right now, in this mode. */
export function planPurchasable(mode: PurchaseMode, offer: OfferInclusions): boolean {
  if (mode === "closed") return false;
  if (mode === "live") return evaluateSaleReadiness(offer).ready;
  return true;
}

/** Public, production traffic — the only activity counted as real. */
export function isProductionSite(): boolean {
  return process.env.VERCEL_ENV === "production";
}
