import { safeNextPath } from "@/lib/redirects";

/**
 * Emailed account links: confirming an email address, resetting a password,
 * and signing in by link.
 *
 * WHY NOT THE CALLBACK. Supabase's default link verifies on the first GET and
 * then hands /auth/callback a code that only the browser that asked for the
 * email can redeem. Opened on a phone, in another browser, or after a mail
 * scanner has visited it, that link fails. These links instead carry a token
 * hash that /auth/confirm verifies on the server when the person presses
 * Continue — in any browser, and never on a page load.
 *
 * The token hash travels in the URL fragment, which browsers never send to a
 * server, so it stays out of request logs and referrers. Only the button's
 * POST carries it.
 */

/** The link kinds TalentYak sends. "email" covers sign-up confirmation and sign-in links. */
export const EMAIL_LINK_TYPES = ["email", "recovery"] as const;
export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

/** Where a successful reset link always lands, whatever the link says. */
export const RESET_PASSWORD_PATH = "/account/reset-password";

export function parseLinkType(input: unknown): EmailLinkType | null {
  return typeof input === "string" && (EMAIL_LINK_TYPES as readonly string[]).includes(input)
    ? (input as EmailLinkType)
    : null;
}

/** Shape only — the auth server decides whether it is real. Keeps junk off the wire. */
export function isPlausibleTokenHash(input: unknown): input is string {
  return typeof input === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(input);
}

/**
 * Where to go after the link works. The email template passes Supabase's
 * `RedirectTo` — the address the request was made with, normally
 * `<site>/auth/callback?next=<path>` — so the person's destination (such as
 * the package they chose before signing up) survives into any browser. Only
 * the `next` path of a same-site address is used, and it is re-checked.
 */
export function nextFromRedirectTo(type: EmailLinkType, redirectTo: unknown, siteOrigin: string): string {
  if (type === "recovery") return RESET_PASSWORD_PATH;
  if (typeof redirectTo !== "string" || !redirectTo || redirectTo.length > 2048) return "/account";
  try {
    const url = new URL(redirectTo);
    if (url.origin !== new URL(siteOrigin).origin) return "/account";
    return safeNextPath(url.searchParams.get("next"));
  } catch {
    return "/account";
  }
}

/** What went wrong, in terms a person can act on. */
export type LinkFailure = "used_or_expired" | "incomplete" | "rate_limited" | "unavailable";

/**
 * Supabase answers an unknown, already-used or expired token the same way
 * (`otp_expired`), so those can't be told apart honestly — and shouldn't be,
 * or a guessed token would learn something.
 */
export function classifyVerifyError(error: { code?: string; status?: number; name?: string } | null | undefined): LinkFailure {
  if (!error) return "unavailable";
  if (error.status === 429 || error.code === "over_request_rate_limit") return "rate_limited";
  if (error.code === "otp_expired") return "used_or_expired";
  if (error.code === "validation_failed" || error.code === "bad_json") return "incomplete";
  if (error.name === "AuthRetryableFetchError" || !error.status || error.status >= 500) return "unavailable";
  // 4xx without a recognised code: the token was refused.
  return "used_or_expired";
}

export function failureMessage(type: EmailLinkType, failure: LinkFailure): string {
  switch (failure) {
    case "used_or_expired":
      return type === "recovery"
        ? "This reset link has already been used or is too old. Each link works once, for a limited time. Ask for a new one below."
        : "This link has already been used or is too old. If you already confirmed your email, just sign in. Otherwise ask for a new link below.";
    case "incomplete":
      return "This link is incomplete. Open it straight from the email, or copy the whole link into your browser.";
    case "rate_limited":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "unavailable":
      return "We couldn't check your link just now, so it hasn't been used. Please try again in a minute.";
  }
}
