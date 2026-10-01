import * as Sentry from "@sentry/nextjs";
import { monitoringOptions } from "@/lib/monitoring/options";

/**
 * Browser error reporting. Inactive without NEXT_PUBLIC_SENTRY_DSN.
 * No session replay and no tracing: only the default error handlers, and
 * every report passes the privacy filter before it leaves the browser.
 */
Sentry.init(monitoringOptions("client"));
