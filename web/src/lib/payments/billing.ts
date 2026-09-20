import "server-only";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/payments/stripe";
import { env } from "@/lib/env";
import { syncRefundsFromStripe, syncSubscriptionFromStripe } from "@/lib/payments/webhook";

/**
 * Customer billing and admin refunds.
 *
 * Every function here verifies ownership or admin reach BEFORE calling Stripe,
 * using the caller's own database session, and then reads the outcome back from
 * Stripe rather than assuming the call did what was asked.
 */

export class BillingError extends Error {}

async function stripeCustomerId(profileId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin!.from("billing_customers").select("stripe_customer_id").eq("profile_id", profileId).maybeSingle();
  return data?.stripe_customer_id ?? null;
}

/** Cancel at the end of the paid period. Not a refund, not an account deletion. */
export async function setCancelAtPeriodEnd(profileId: string, purchaseId: string, cancel: boolean): Promise<void> {
  const admin = createAdminClient();
  const stripe = getStripe();
  if (!admin || !stripe) throw new BillingError("Billing isn't available right now.");

  const { data: row } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id, purchases!inner(customer_id, state)")
    .eq("purchase_id", purchaseId)
    .maybeSingle();

  const purchase = row && (Array.isArray(row.purchases) ? row.purchases[0] : row.purchases) as { customer_id: string; state: string } | null;
  // Ownership is checked against the database, not trusted from the form.
  if (!row || !purchase || purchase.customer_id !== profileId) throw new BillingError("That plan wasn't found.");
  if (!["active", "cancelling", "past_due"].includes(purchase.state)) throw new BillingError("This plan can't be changed now.");

  await stripe.subscriptions.update(
    row.stripe_subscription_id,
    { cancel_at_period_end: cancel },
    { idempotencyKey: `cancel:${row.stripe_subscription_id}:${cancel}:${new Date().toISOString().slice(0, 16)}` },
  );
  await syncSubscriptionFromStripe(row.stripe_subscription_id);
}

export interface InvoiceSummary {
  id: string;
  number: string | null;
  created: string;
  amountPaidMinor: number;
  currency: string;
  status: string | null;
  hostedUrl: string | null;
}

export async function listInvoices(profileId: string): Promise<InvoiceSummary[]> {
  const stripe = getStripe();
  const customerId = await stripeCustomerId(profileId);
  if (!stripe || !customerId) return [];
  const invoices = await stripe.invoices.list({ customer: customerId, limit: 24 });
  return invoices.data.map((inv) => ({
    id: inv.id!,
    number: inv.number,
    created: new Date(inv.created * 1000).toISOString(),
    amountPaidMinor: inv.amount_paid,
    currency: inv.currency.toUpperCase(),
    status: inv.status,
    hostedUrl: inv.hosted_invoice_url ?? null,
  }));
}

let portalConfigId: string | null = null;

/**
 * A Billing Portal configuration that can update a card and show invoices —
 * and nothing else. It cannot switch plans, change coach, change price, or
 * cancel (cancellation goes through TalentYak, which records it the same way
 * every time). A portal that could switch plans would create contracts the
 * application cannot represent.
 */
async function restrictedPortalConfiguration(stripe: Stripe): Promise<string> {
  if (portalConfigId) return portalConfigId;

  const existing = await stripe.billingPortal.configurations.list({ limit: 20, active: true });
  const ours = existing.data.find((c) => c.metadata?.talentyak === "restricted-v1");
  if (ours) {
    portalConfigId = ours.id;
    return ours.id;
  }

  const created = await stripe.billingPortal.configurations.create({
    business_profile: { headline: "TalentYak billing" },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: false },
      subscription_update: { enabled: false },
      customer_update: { enabled: false },
    },
    metadata: { talentyak: "restricted-v1" },
  });
  portalConfigId = created.id;
  return created.id;
}

export async function billingPortalUrl(profileId: string): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new BillingError("Billing isn't available right now.");
  const customerId = await stripeCustomerId(profileId);
  if (!customerId) throw new BillingError("There's no billing account yet — it's created with your first purchase.");

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    configuration: await restrictedPortalConfiguration(stripe),
    return_url: `${env.siteUrl}/account/billing`,
  });
  return session.url;
}

/**
 * An admin refund. The request is recorded first (with who and why), Stripe
 * performs it with an idempotency key tied to that request, and the outcome is
 * read back from Stripe. A label saying "refunded" is never written by hand.
 */
export async function issueRefund(
  adminSupabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; hint?: string } | null }> },
  args: { purchaseId: string; billingCycleId: string; amountMinor: number; reason: string },
): Promise<{ requestId: string }> {
  const stripe = getStripe();
  const service = createAdminClient();
  if (!stripe || !service) throw new BillingError("Refunds aren't available right now.");

  // Called with the ADMIN'S OWN session: the database checks aal2 and the amount.
  const { data: requestId, error } = await adminSupabase.rpc("admin_request_refund", {
    p_purchase_id: args.purchaseId,
    p_billing_cycle_id: args.billingCycleId,
    p_amount_minor: args.amountMinor,
    p_reason: args.reason,
  });
  if (error || !requestId) throw new BillingError(error?.hint || "That refund couldn't be requested.");

  const { data: cycle } = await service
    .from("billing_cycles").select("stripe_payment_intent_id").eq("id", args.billingCycleId).single();
  if (!cycle?.stripe_payment_intent_id) {
    await service.from("refunds").update({ state: "failed" }).eq("id", requestId);
    throw new BillingError("This payment has no Stripe reference to refund against.");
  }

  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: cycle.stripe_payment_intent_id,
        amount: args.amountMinor,
        reason: "requested_by_customer",
        metadata: { refund_request_id: String(requestId) },
      },
      { idempotencyKey: `refund:${requestId}` },
    );
    await service.from("refunds").update({ stripe_refund_id: refund.id, state: "pending" }).eq("id", requestId);
  } catch (err) {
    await service.from("refunds").update({ state: "failed" }).eq("id", requestId);
    throw new BillingError(`Stripe refused the refund: ${err instanceof Error ? err.message : String(err)}`);
  }

  await syncRefundsFromStripe(cycle.stripe_payment_intent_id);
  return { requestId: String(requestId) };
}
