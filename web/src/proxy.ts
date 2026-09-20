import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs on every page request. Two jobs:
 *
 * 1. Issue the Content Security Policy. It lives here rather than in
 *    `next.config.ts` because it carries a fresh nonce per request, which a
 *    static header cannot do.
 * 2. Refresh the Supabase session cookie, so a signed-in person is not silently
 *    logged out mid-visit.
 *
 * A note on `style-src`. Scripts get a strict nonce, which is what actually
 * stops cross-site scripting. Styles get `'unsafe-inline'` instead, because
 * React writes `style` attributes and a nonce cannot cover an attribute — under
 * CSP level 3 a nonce on `style-src` would silently override `'unsafe-inline'`
 * and break the page. This is the deliberate, narrower trade-off: strict where
 * it matters, permissive only for styling.
 */

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";

  // The browser Supabase client talks directly to the project over HTTPS and
  // websockets, so its origin has to be allowed or every signed-in page breaks.
  const supabaseOrigin = (() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return [];
    try {
      const { origin, host } = new URL(url);
      return [origin, `wss://${host}`];
    } catch {
      return [];
    }
  })();

  return [
    "default-src 'self'",
    // 'strict-dynamic' lets a nonced script load the chunks it needs without
    // every chunk URL being listed. 'unsafe-eval' is development only: React
    // uses eval to rebuild server stack traces for the error overlay.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // Approved coach photos are served from the public storage bucket.
    `img-src 'self' blob: data: ${supabaseOrigin[0] ?? ""}`.trim(),
    "font-src 'self' data:",
    `connect-src 'self' ${supabaseOrigin.join(" ")}`.trim(),
    // Stripe Checkout is a full redirect, not an embedded frame, so nothing
    // needs to be framed by us.
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = buildCsp(nonce);

  // Next reads the nonce back out of the request's CSP header and applies it to
  // the scripts it renders, so both the request and the response carry it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  await supabase.auth.getUser();

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon|logo|brand|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
