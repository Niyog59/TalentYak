import { NextResponse } from "next/server";

/**
 * Stripe webhook endpoint.
 *
 * This route does nothing but hand the request to the payments module, which
 * verifies the signature against the RAW body before anything else happens.
 *
 * `force-dynamic` matters here: a cached or statically-optimised response would
 * mean a real event never reaching the handler at all.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { handleStripeWebhook } = await import("@/lib/payments/webhook");
  return handleStripeWebhook(req);
}

/**
 * A liveness probe only. It reports that the route exists and nothing about the
 * account, the mode, or whether any key is configured — an unauthenticated
 * endpoint should not confirm which Stripe account it belongs to.
 */
export function GET() {
  return NextResponse.json({ ok: true, endpoint: "stripe-webhook" });
}
