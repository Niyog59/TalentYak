"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/*
 * The last line of defence: the root layout itself failed, so nothing from the
 * site's own layout (fonts, header, styles) can be relied on. Plain markup,
 * the same honest message as the page-level error screen, and a report to
 * error monitoring (filtered for privacy before it leaves the browser).
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#FCFCFA", color: "#182B2A" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px" }}>
          <div role="alert">
            <p style={{ fontWeight: 600, color: "#9F2D20" }}>Something went wrong</p>
            <h1 style={{ fontSize: 32, lineHeight: 1.2 }}>TalentYak didn&rsquo;t load properly.</h1>
            <p>Your last action may not have completed. Only treat something as saved if you saw a confirmation.</p>
            {error.digest && <p style={{ fontSize: 14 }}>Reference for support: <strong>{error.digest}</strong></p>}
          </div>
          <p style={{ marginTop: 32 }}>
            {/* A full reload on purpose: the app's own router is what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ color: "#124F43", fontWeight: 600 }}>Reload TalentYak</a>
          </p>
        </main>
      </body>
    </html>
  );
}
