import * as Sentry from "@sentry/nextjs";

/**
 * Server-side error reporting (Node and edge). Inactive without a DSN.
 * Settings and the privacy filter: src/lib/monitoring/.
 */
export async function register() {
  const { monitoringOptions } = await import("@/lib/monitoring/options");
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      ...monitoringOptions("server"),
      // Payment mode is a useful filter and says nothing about anyone.
      initialScope: {
        tags: {
          runtime: "server",
          payments: process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "live" : "test",
        },
      },
    });
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(monitoringOptions("edge"));
  }
}

/** Errors Next.js catches while rendering, in route handlers, actions and the proxy. */
export const onRequestError = Sentry.captureRequestError;
