/**
 * Privacy filter for error reports.
 *
 * Every error report passes through here in the process that produced it,
 * BEFORE it leaves for the monitoring service. Nothing relies on the service's
 * own scrubbing or on a default setting: what isn't on an allowlist is dropped,
 * and what is kept has its free text redacted.
 *
 * What must never leave: passwords, tokens, cookies, authorization headers,
 * payment details, message text, health and intake answers, food entries,
 * private media links, request bodies and query strings. Those live in request
 * bodies, headers, query strings, local variables and console output — all of
 * which are dropped wholesale — or occasionally inside an exception message,
 * which is redacted by pattern.
 *
 * Pure: no SDK import, so it is unit-tested directly.
 */

const MAX_TEXT = 1000;

/** Routes whose path segment after the prefix is itself a secret. */
const TOKEN_PATHS = /\/(invite|waitlist\/confirm|waitlist\/leave)\/[^/?#\s]+/gi;

const PATTERNS: Array<[RegExp, string]> = [
  // Private storage links first, whole: the path names the file and the query
  // carries the signature.
  [/https?:\/\/[^\s"'<>]*\/storage\/v1\/object\/(sign|authenticated|upload\/sign)\/[^\s"'<>]*/gi, "[private-media-url]"],
  // JSON web tokens (Supabase sessions, signed links, call passes).
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "[token]"],
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [token]"],
  // Service keys by their published prefixes: Stripe secret/restricted keys and
  // webhook secrets, Supabase access tokens, Resend keys, Sentry auth tokens.
  [/\b(sk|rk)_(live|test)_[A-Za-z0-9]{8,}/g, "[secret]"],
  [/\b(whsec|sbp|sntrys|sntryu)_[A-Za-z0-9_]{8,}/g, "[secret]"],
  [/\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/g, "[secret]"],
  // Query strings and fragments on any URL — tokens, codes, search text.
  [/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi, "$1"],
  // key=value pairs that commonly hold secrets, wherever they appear.
  [/\b(access_token|refresh_token|token|code|password|passwd|secret|api_key|apikey|signature|sig)=([^&\s"'<>]+)/gi, "$1=[redacted]"],
  [/("?(password|passwd|token|secret|authorization|cookie|api_key|card|cvc|cvv)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi, "$1[redacted]"],
  // Email addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
];

/**
 * Long digit runs — card, phone and account numbers. Nine digits or more, so a
 * date or a time survives; identifiers are protected before this runs.
 */
const DIGITS = /\+?\d[\d -]{7,}\d/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function redactDigits(text: string): string {
  const kept: string[] = [];
  const protectedText = text.replace(UUID, (id) => `\u0000${kept.push(id) - 1}\u0000`);
  const redacted = protectedText.replace(DIGITS, (run) => {
    if (/^\d{4}-\d{2}-\d{2}/.test(run)) return run;
    return run.replace(/\D/g, "").length >= 9 ? "[number]" : run;
  });
  return redacted.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => kept[Number(i)]);
}

export function redactText(input: unknown): string {
  if (input === undefined || input === null) return "";
  let text = typeof input === "string" ? input : String(input);
  text = text.replace(TOKEN_PATHS, (_m, prefix: string) => `/${prefix}/[token]`);
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  text = redactDigits(text);
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

/** A URL or path reduced to its path, with secret segments masked. */
export function redactUrl(input: unknown): string {
  if (typeof input !== "string" || !input) return "";
  const withoutQuery = input.split(/[?#]/, 1)[0];
  return redactText(withoutQuery);
}

/* ------------------------------------------------------------------------- */
/* Events                                                                    */
/* ------------------------------------------------------------------------- */

// Shapes kept minimal and structural so this file needs no SDK types.
type Json = Record<string, unknown>;

interface StackFrame extends Json { vars?: unknown }
interface ExceptionValue extends Json {
  value?: string;
  stacktrace?: { frames?: StackFrame[] };
}
interface Breadcrumb extends Json {
  category?: string;
  message?: string;
  data?: Json;
}
export interface ScrubbableEvent extends Json {
  message?: string;
  transaction?: string;
  request?: Json;
  user?: unknown;
  extra?: unknown;
  contexts?: Json;
  tags?: Record<string, unknown>;
  breadcrumbs?: Breadcrumb[];
  exception?: { values?: ExceptionValue[] };
  logentry?: { message?: string; params?: unknown };
}

/** Context blocks that describe the runtime, never the person or the request. */
const CONTEXT_ALLOW = new Set(["runtime", "os", "browser", "device", "app", "trace", "cloud_resource", "culture"]);

/** Tags we set ourselves, plus the SDK's own runtime tags. */
const TAG_ALLOW = new Set([
  "area", "topic", "event_type", "runtime", "database", "payments", "test", "handled", "mechanism", "level",
]);

const BREADCRUMB_DATA_ALLOW = new Set(["method", "status_code", "url", "from", "to"]);

/** Breadcrumb categories that can carry anything a person typed or a page logged. */
const BREADCRUMB_DROP = new Set(["console", "ui.input", "ui.keypress", "sentry.event"]);

export function scrubBreadcrumb<T extends Breadcrumb>(crumb: T): T | null {
  if (!crumb || (crumb.category && BREADCRUMB_DROP.has(crumb.category))) return null;
  const out = { ...crumb } as T;
  if (out.message !== undefined) out.message = redactText(out.message);
  if (out.data) {
    const data: Json = {};
    for (const [key, value] of Object.entries(out.data)) {
      if (!BREADCRUMB_DATA_ALLOW.has(key)) continue;
      data[key] = typeof value === "string" ? redactUrl(value) : value;
    }
    out.data = data;
  }
  return out;
}

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const out = { ...event } as T;

  // Nobody is identified in an error report.
  delete out.user;
  delete out.extra;

  // The request is reduced to its method and its path.
  if (out.request) {
    const { method, url } = out.request as { method?: unknown; url?: unknown };
    out.request = {
      ...(typeof method === "string" ? { method } : {}),
      ...(typeof url === "string" ? { url: redactUrl(url) } : {}),
    };
  }

  if (out.transaction) out.transaction = redactUrl(out.transaction);
  if (out.message) out.message = redactText(out.message);
  if (out.logentry) out.logentry = { message: redactText(out.logentry.message) };

  if (out.contexts) {
    const contexts: Json = {};
    for (const [key, value] of Object.entries(out.contexts)) if (CONTEXT_ALLOW.has(key)) contexts[key] = value;
    out.contexts = contexts;
  }

  if (out.tags) {
    const tags: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(out.tags)) {
      if (TAG_ALLOW.has(key)) tags[key] = typeof value === "string" ? redactText(value) : value;
    }
    out.tags = tags;
  }

  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((value) => ({
        ...value,
        ...(value.value !== undefined ? { value: redactText(value.value) } : {}),
        ...(value.stacktrace?.frames
          ? {
              stacktrace: {
                ...value.stacktrace,
                // Local variables can hold anything: a request body, a message.
                frames: value.stacktrace.frames.map(({ vars: _vars, ...frame }) => frame),
              },
            }
          : {}),
      })),
    };
  }

  if (out.breadcrumbs) {
    out.breadcrumbs = out.breadcrumbs
      .map((crumb) => scrubBreadcrumb(crumb))
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
  }

  return out;
}
