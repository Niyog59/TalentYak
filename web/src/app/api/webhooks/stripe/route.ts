import { NextResponse } from "next/server";

/**
 * Stripe webhook endpoint. Fleshed out in the payments module
 * (src/lib/payments) — this route only verifies and dispatches.
 */
export async function POST(req: Request) {
  const { handleStripeWebhook } = await import("@/lib/payments/webhook");
  return handleStripeWebhook(req);
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "stripe-webhook" });
}
