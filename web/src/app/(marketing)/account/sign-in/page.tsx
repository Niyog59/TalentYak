import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthMessage, AuthPage } from "@/components/auth/auth-page";
import { Button } from "@/components/button";
import { getSession } from "@/lib/auth";
import { authSettings } from "@/lib/auth-providers";
import { safeNextPath } from "@/lib/redirects";
import { isSupabaseConfigured } from "@/lib/env";
import { EmailLinkForm, SignInForm } from "../auth-forms";
import { googleSignInAction } from "../actions";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);

  if (!isSupabaseConfigured()) {
    return (
      <AuthPage title="Sign in" intro="Accounts aren't available right now.">
        <p>Please check back soon.</p>
      </AuthPage>
    );
  }

  if (await getSession()) redirect(next);
  const settings = await authSettings();

  return (
    <AuthPage
      title="Sign in"
      footer={
        <p>
          New to TalentYak?{" "}
          <Link href={`/account/sign-up?next=${encodeURIComponent(next)}`} className="font-semibold text-brand underline underline-offset-4">
            Create an account
          </Link>
          <br />
          Confirmation link not working?{" "}
          <Link href="/account/confirm-email" className="font-semibold text-brand underline underline-offset-4">
            Send a new one
          </Link>
        </p>
      }
    >
      <AuthMessage error={params.error} notice={params.notice} />

      {settings.google ? (
        <>
          <form action={googleSignInAction}>
            <input type="hidden" name="next" value={next} />
            <Button type="submit" variant="secondary" className="w-full">
              Continue with Google
            </Button>
          </form>
          <p className="my-6 text-center text-sm text-ink-muted">or use your email</p>
        </>
      ) : null}

      <SignInForm next={next} />

      <details className="mt-8 rounded-xl border border-line p-4">
        <summary className="cursor-pointer font-semibold">Sign in with an emailed link instead</summary>
        <div className="mt-4">
          <EmailLinkForm next={next} />
        </div>
      </details>
    </AuthPage>
  );
}
