import "server-only";
import Stripe from "stripe";
import { env, isStripeConfigured } from "@/lib/env";

let stripe: Stripe | null = null;

/**
 * The Stripe client, pinned to the API version the installed SDK was built
 * against. Pinning matters: field names moved between versions (an invoice no
 * longer carries `payment_intent`; subscription period dates moved onto the
 * subscription items), and code written against one shape silently reads
 * `undefined` from another.
 */
export function getStripe(): Stripe | null {
  if (!isStripeConfigured()) return null;
  if (!stripe) {
    stripe = new Stripe(env.stripeSecretKey, {
      maxNetworkRetries: 2,
      appInfo: { name: "TalentYak" },
    });
  }
  return stripe;
}

/** Test mode or live mode, derived from the key actually configured. */
export function stripeMode(): "test" | "live" | "unconfigured" {
  const key = env.stripeSecretKey;
  if (!key) return "unconfigured";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  return "test";
}
