import { scrubBreadcrumb, scrubEvent } from "./scrub";

/**
 * Error-reporting settings shared by the browser, the server and the edge.
 *
 * Deliberately small:
 * - errors only — no performance tracing, no profiling, no session replay;
 * - nobody identified — no IP address, no user, no cookies, no request bodies;
 * - every report filtered by `scrub.ts` in this process, before it is sent;
 * - off unless a DSN is configured, and off in local development unless
 *   explicitly asked for, so tests and laptops never report.
 *
 * Environment: `production` or `preview` from the host, `development` locally.
 * The release is the deployed commit, injected at build time by the SDK.
 */
// Server request handling (Http) stays: it keeps each request's report separate.
const DROPPED_INTEGRATIONS = new Set(["BrowserTracing", "SpanStreaming", "WebVitals", "BrowserSession"]);

export type MonitoringRuntime = "client" | "server" | "edge";

export function monitoringEnvironment(): string {
  return process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || "development";
}

export function monitoringDsn(runtime: MonitoringRuntime): string | undefined {
  // The DSN is a public, write-only ingestion address (it ships to browsers by
  // design). It is not a credential; the upload token is, and never appears here.
  const dsn = runtime === "client" ? process.env.NEXT_PUBLIC_SENTRY_DSN : process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  return dsn?.trim() || undefined;
}

export function monitoringEnabled(runtime: MonitoringRuntime): boolean {
  if (!monitoringDsn(runtime)) return false;
  if (monitoringEnvironment() !== "development") return true;
  return process.env.NEXT_PUBLIC_SENTRY_SEND_FROM_DEVELOPMENT === "true";
}

export function monitoringOptions(runtime: MonitoringRuntime) {
  return {
    dsn: monitoringDsn(runtime),
    enabled: monitoringEnabled(runtime),
    environment: monitoringEnvironment(),
    // Collect nothing about the person or the request in the first place
    // (SDK v11 collects all of these unless told not to). The filter in
    // scrub.ts then removes anything that still arrives — two layers, neither
    // trusted alone.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
    },
    // Errors only: no tracing, no web-vitals, no per-visit session pings (those
    // ask the service to record the visitor's IP address).
    integrations: <I extends { name: string }>(defaults: I[]): I[] => defaults.filter((i) => !DROPPED_INTEGRATIONS.has(i.name)),
    // Errors only. Undefined sample rates keep tracing off entirely.
    tracesSampleRate: undefined,
    sampleRate: 1,
    maxBreadcrumbs: 30,
    // A report's free text is capped; long values are cut by the filter too.
    maxValueLength: 1000,
    normalizeDepth: 4,
    initialScope: { tags: { runtime } },
    ignoreErrors: [
      // Browser noise that is never actionable.
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
    ],
    beforeSend: <T extends object>(event: T): T => scrubEvent(event as never) as T,
    beforeSendTransaction: () => null,
    beforeBreadcrumb: <T extends object>(crumb: T): T | null => scrubBreadcrumb(crumb as never) as T | null,
  };
}
