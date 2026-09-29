/**
 * Product analytics through PostHog — deliberate events only, sent from the
 * server.
 *
 * No PostHog script runs in the browser, so there are no cookies, no device
 * identifiers, no session recordings and no automatic click capture. Each
 * event is anonymous (a fresh id, no person profile, no location lookup) and
 * carries at most one public reference: a page kind, a coach's public slug or
 * an offer id. Never an email, a name, a health detail, a message, a form
 * answer, a media address or a query string.
 *
 * Only real production activity is sent: not local or preview deployments,
 * not staff, not test accounts, not test-mode payments. Nothing is sent until
 * POSTHOG_PROJECT_KEY is set. Money is never reported from here: financial
 * figures come from the payment and ledger records.
 *
 * The pure parts are exported for tests; `captureProductEvent` never throws.
 */

export const PRODUCT_EVENTS = [
  "public_visit",
  "coach_profile_view",
  "package_selected",
  "signed_up",
  "signed_in",
  "checkout_started",
  "purchase_confirmed",
  "waitlist_registered",
] as const;

export type ProductEvent = (typeof PRODUCT_EVENTS)[number];

const ALLOWED_PROPERTIES: Record<ProductEvent, readonly string[]> = {
  public_visit: ["page_kind"],
  coach_profile_view: ["coach_slug"],
  package_selected: ["offer_ref"],
  signed_up: [],
  signed_in: [],
  checkout_started: ["offer_version_ref"],
  purchase_confirmed: ["service_type"],
  waitlist_registered: [],
};

/** A public slug, a page kind, an id or a fixed word. Nothing else survives. */
const SAFE_VALUE = /^[a-z0-9_-]{1,64}$/;

export interface PostHogConfig {
  key: string;
  host: string;
  appUrl: string | null;
}

export function posthogConfig(env: Record<string, string | undefined> = process.env): PostHogConfig | null {
  const key = (env.POSTHOG_PROJECT_KEY ?? "").trim();
  if (!/^phc_[A-Za-z0-9]{10,}$/.test(key)) return null;
  const host = safeOrigin(env.POSTHOG_HOST) ?? "https://us.i.posthog.com";
  return { key, host, appUrl: analyticsAppUrl(env) };
}

/** Where the founder reads the reports. Shown as a link; nothing is embedded. */
export function analyticsAppUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = (env.POSTHOG_APP_URL ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && /(^|\.)posthog\.com$/.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function sanitizeProperties(event: ProductEvent, props: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ALLOWED_PROPERTIES[event]) {
    const value = props[key];
    if (typeof value === "string" && SAFE_VALUE.test(value.toLowerCase())) out[key] = value.toLowerCase();
  }
  return out;
}

/** A stable id from a stable key, so a retried send is recognised as the same event. */
async function uuidFrom(key: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`talentyak:${key}`))).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function buildPayload(
  config: PostHogConfig,
  event: ProductEvent,
  props: Record<string, unknown>,
  opts: { dedupeKey?: string; now?: Date } = {},
): Promise<Record<string, unknown>> {
  const id = opts.dedupeKey ? await uuidFrom(opts.dedupeKey) : crypto.randomUUID();
  return {
    api_key: config.key,
    event,
    // Anonymous: the same id as the event itself, never a person's.
    distinct_id: `anon-${id}`,
    uuid: id,
    timestamp: (opts.now ?? new Date()).toISOString(),
    properties: {
      ...sanitizeProperties(event, props),
      $process_person_profile: false,
      $geoip_disable: true,
      $lib: "talentyak-server",
    },
  };
}

export type CaptureResult = "sent" | "skipped" | "failed";

export async function captureProductEvent(
  event: ProductEvent,
  props: Record<string, unknown>,
  opts: { live: boolean; dedupeKey?: string; fetcher?: typeof fetch; env?: Record<string, string | undefined> },
): Promise<CaptureResult> {
  if (!opts.live) return "skipped";
  const config = posthogConfig(opts.env);
  if (!config) return "skipped";
  try {
    const body = await buildPayload(config, event, props, { dedupeKey: opts.dedupeKey });
    const res = await (opts.fetcher ?? fetch)(`${config.host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2500),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}
