import "server-only";
import Stripe from "stripe";
import { env, isStripeConfigured } from "@/lib/env";

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!isStripeConfigured()) return null;
  if (!stripe) stripe = new Stripe(env.stripeSecretKey);
  return stripe;
}
