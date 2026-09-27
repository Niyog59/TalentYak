/**
 * Central place to check which external services are configured.
 * The app degrades gracefully: catalog falls back to local seed data,
 * checkout/auth surfaces a "not configured" state instead of crashing.
 */
/**
 * The origin this deployment serves from, as an absolute, parseable URL.
 *
 * It is used to build metadata, email links and Stripe redirect URLs, and
 * `new URL()` throws on an empty string — which would fail the build rather
 * than the request. So: the explicit setting if it is usable, else the address
 * the host tells us it is serving on (Vercel sets these), else local
 * development. Never an empty string.
 */
function resolveSiteUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.NEXT_PUBLIC_VERCEL_URL,
    process.env.VERCEL_URL,
  ];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    const absolute = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      return new URL(absolute).origin;
    } catch {
      // A malformed value is ignored rather than crashing the build.
    }
  }
  return "http://localhost:3001";
}

export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  // Sender identity for outgoing email. No default: the TalentYak sending
  // domain is not confirmed yet, and email must never go out under a
  // retired name or an address nobody has verified.
  emailFrom: process.env.EMAIL_FROM ?? "",
  // Public contact address shown to customers. Hidden until configured.
  supportEmail: process.env.SUPPORT_EMAIL ?? "",
  siteUrl: resolveSiteUrl(),
  // Private calls (M10). Server only. The API key creates rooms and join
  // passes; the webhook secret (base64, as Daily issues it) verifies Daily's
  // event deliveries. Daily webhooks need a paid Daily plan: without the
  // secret the endpoint refuses everything and attendance comes from the
  // after-call fetch alone.
  dailyApiKey: process.env.DAILY_API_KEY ?? "",
  dailyWebhookSecret: process.env.DAILY_WEBHOOK_SECRET ?? "",
};

export const isSupabaseConfigured = () =>
  Boolean(env.supabaseUrl && env.supabaseAnonKey);

export const isStripeConfigured = () => Boolean(env.stripeSecretKey);

export const isResendConfigured = () =>
  Boolean(env.resendApiKey && env.emailFrom);

export const isDailyConfigured = () => Boolean(env.dailyApiKey);
