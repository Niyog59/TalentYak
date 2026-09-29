import type { Metadata } from "next";
import Link from "next/link";
import { AuthPage } from "@/components/auth/auth-page";
import { FormNotice } from "@/components/form/fields";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { nextFromRedirectTo, parseLinkType } from "@/lib/auth-links";
import { ConfirmLinkForm } from "./confirm-form";

export const metadata: Metadata = {
  title: "Continue to TalentYak",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

const COPY = {
  recovery: {
    title: "Reset your password",
    intro: "Press the button to continue and choose a new password.",
    cta: "Continue to choose a new password",
  },
  email: {
    title: "Confirm your email",
    intro: "Press the button to confirm your email address and sign in to TalentYak.",
    cta: "Continue",
  },
} as const;

/**
 * Where emailed account links land. Opening this page verifies nothing — it
 * works the same for a person, a mail scanner and a link preview — so the
 * link is used only when someone presses the button. See lib/auth-links.ts.
 */
export default async function ConfirmEmailLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; redirect_to?: string }>;
}) {
  const params = await searchParams;
  const type = parseLinkType(params.type);

  if (!type) {
    return (
      <AuthPage title="This link isn't complete" intro="Open it straight from the email, or copy the whole link into your browser.">
        <FormNotice state={{ ok: false, message: "We couldn't read this link." }} />
        <p className="mt-6">
          <Link href="/account/sign-in" className="font-semibold text-brand underline underline-offset-4">Go to sign in</Link>
        </p>
      </AuthPage>
    );
  }

  const copy = COPY[type];
  const next = nextFromRedirectTo(type, params.redirect_to, env.siteUrl);
  const session = await getSession();

  return (
    <AuthPage title={copy.title} intro={copy.intro}>
      {session ? (
        <p className="mb-6 rounded-lg border border-line bg-surface p-3">
          You&rsquo;re signed in as <strong>{session.email}</strong>. If this link was sent to a different address,
          continuing signs you out of {session.email} and into that account.
        </p>
      ) : null}
      <ConfirmLinkForm type={type} next={next} cta={copy.cta} />
    </AuthPage>
  );
}
