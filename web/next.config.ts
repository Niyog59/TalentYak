import type { NextConfig } from "next";

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
const securityHeaders = [
  // Never let a browser guess a response's type. A user-uploaded file served
  // with the wrong type is how an image becomes a script.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Send the full URL only to ourselves. A customer's account URL should not
  // leak to a third party through a referrer.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Belt and braces with the CSP's frame-ancestors, for older browsers.
  { key: "X-Frame-Options", value: "DENY" },

  // Deny hardware and sensitive APIs by default. Video and audio calls are a
  // later module; when they arrive, camera and microphone are widened to
  // 'self' here, deliberately and in one place.
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "autoplay=()",
      "camera=()",
      "display-capture=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "payment=()",
      "usb=()",
      "interest-cohort=()",
    ].join(", "),
  },

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

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "6mb" },
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
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

export default nextConfig;
