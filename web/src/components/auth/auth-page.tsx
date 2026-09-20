import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand/logo";

/** The frame every sign-in, sign-up and recovery screen shares. */
export function AuthPage({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:px-6 md:py-16">
      <BrandLogo variant="symbol" decorative className="text-4xl text-brand" />
      <h1 className="mt-6 font-display text-4xl sm:text-5xl">{title}</h1>
      {intro ? <div className="mt-3 text-lg text-ink-muted">{intro}</div> : null}
      <div className="mt-8">{children}</div>
      {footer ? <div className="mt-8 border-t border-line pt-6 text-ink-muted">{footer}</div> : null}
    </div>
  );
}

const LINK_ERRORS: Record<string, string> = {
  link: "That link has expired, was already used, or was opened in a different browser from the one that asked for it. If you were confirming your email, it is probably confirmed — try signing in.",
  cancelled: "Google sign-in was cancelled. Nothing was changed.",
  oauth: "Google sign-in didn't complete. Please try again.",
  google_unavailable: "Google sign-in isn't switched on yet. Use your email and password.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  unavailable: "Sign-in isn't available right now.",
};

const NOTICES: Record<string, string> = {
  signed_out_everywhere: "You've been signed out on every device.",
  signed_out: "You've been signed out.",
};

export function AuthMessage({ error, notice }: { error?: string; notice?: string }) {
  const errorText = error ? LINK_ERRORS[error] : undefined;
  const noticeText = notice ? NOTICES[notice] : undefined;
  if (errorText) {
    return (
      <p role="alert" className="mb-6 rounded-lg border border-danger bg-danger-tint p-3 font-medium">
        {errorText}
      </p>
    );
  }
  if (noticeText) {
    return (
      <p role="status" className="mb-6 rounded-lg border border-line bg-brand-tint p-3 font-medium">
        {noticeText}
      </p>
    );
  }
  return null;
}
