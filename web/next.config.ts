import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

/**
 * Security headers.
 *
 * Everything that is the same on every response lives here. The Content
 * Security Policy is the one exception and lives in `src/proxy.ts`, because it
 * carries a per-request nonce and therefore cannot be a static header.
 *
 * Per CLAUDE.md → Security operating rules, these are not removed. If one of
 * them blocks a feature, the feature is adjusted or the header is narrowed
 * deliberately and the reason recorded — it is not deleted to make something
 * work.
 */
/**
 * Hardware and sensitive browser features. Everything is denied everywhere,
 * except that a session page — where the private call runs — may use the
 * camera, the microphone and autoplay (to play the other person's audio),
 * for this site only. Screen capture stays denied: calls
 * have no screen sharing.
 */
function permissionsPolicy(call: boolean): string {
  const self = (feature: string) => (call ? `${feature}=(self)` : `${feature}=()`);
  return [
    "accelerometer=()",
    self("autoplay"),
    self("camera"),
    "display-capture=()",
    "geolocation=()",
    "gyroscope=()",
    "magnetometer=()",
    self("microphone"),
    "payment=()",
    "usb=()",
    "interest-cohort=()",
  ].join(", ");
}

/** The session pages. Kept in step with CALL_PAGES in src/proxy.ts. */
const CALL_PAGES = ["/account/appointments/:id", "/coach/calendar/appointments/:id"];

const securityHeaders = [
  // Never let a browser guess a response's type. A user-uploaded file served
  // with the wrong type is how an image becomes a script.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Send the full URL only to ourselves. A customer's account URL should not
  // leak to a third party through a referrer.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Belt and braces with the CSP's frame-ancestors, for older browsers.
  { key: "X-Frame-Options", value: "DENY" },

  // Deny hardware and sensitive APIs by default. Camera, microphone and
  // autoplay are widened to 'self' on the two session pages only, below —
  // deliberately and in one place.
  { key: "Permissions-Policy", value: permissionsPolicy(false) },

  // Isolate our browsing context from anything that opens us or that we open.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },

  // Two years, subdomains included. Ignored on http://localhost, which is why
  // it is safe to set unconditionally.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

/**
 * The routes that run media processing, and therefore need the ffmpeg binary
 * and the HEIC decoder in their deployed bundle. Both are loaded by file path
 * at runtime (ffmpeg as a process, libheif-js inside a worker thread), which
 * the build's file tracing cannot follow on its own — so they are included
 * explicitly, and ONLY here: ~55 MB added to every function would slow every
 * cold start for no reason.
 */
const MEDIA_PROCESSING_ROUTES = ["/api/media/complete", "/api/media/retry", "/api/jobs/process"];

const nextConfig: NextConfig = {
  // Error reports name the environment they came from: production, preview, or
  // development on a laptop. Fixed at build time for the browser bundle.
  env: {
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || "",
  },

  experimental: {
    serverActions: { bodySizeLimit: "6mb" },
  },

  // Resolved at runtime from node_modules rather than bundled, so the path it
  // returns points at the real binary.
  serverExternalPackages: ["ffmpeg-static", "libheif-js"],

  outputFileTracingIncludes: Object.fromEntries(
    MEDIA_PROCESSING_ROUTES.map((route) => [
      route,
      [
        "./node_modules/ffmpeg-static/ffmpeg",
        "./node_modules/libheif-js/package.json",
        "./node_modules/libheif-js/wasm-bundle.js",
        "./node_modules/libheif-js/libheif-wasm/libheif-bundle.js",
      ],
    ]),
  ),

  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Later entries override earlier ones for the same header name.
      ...CALL_PAGES.map((source) => ({ source, headers: [{ key: "Permissions-Policy", value: permissionsPolicy(true) }] })),
    ];
  },

  async redirects() {
    return [
      // The platform-defined service catalog is superseded by coach-created
      // offers, and only fitness is public at launch. The catalog pages stay in
      // the codebase; their public URLs point to the coach directory instead.
      // Temporary rather than permanent: M05 decides the final offer URLs.
      { source: "/services", destination: "/coaches", permanent: false },
      { source: "/services/:path*", destination: "/coaches", permanent: false },
      // The retired booking path. Coaching is bought from a coach's own offer.
      { source: "/book", destination: "/coaches", permanent: false },
      { source: "/book/:path*", destination: "/coaches", permanent: false },
    ];
  },
};

/**
 * Error reporting (src/instrumentation*.ts, src/lib/monitoring/).
 *
 * Source maps are uploaded only when SENTRY_AUTH_TOKEN is present in the BUILD
 * environment, and are deleted from the build output after upload, so no map
 * is ever served publicly. Without the token nothing is generated or uploaded.
 * The token is a build secret: never NEXT_PUBLIC_, never in the repository.
 *
 * No tunnel route: the SDK's tunnel forwards to any Sentry organisation, which
 * would make this site an open relay. Browsers report to the configured host,
 * allowed narrowly in the CSP (src/proxy.ts).
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
  widenClientFileUpload: false,
  suppressOnRouterTransitionStartWarning: true,
});
