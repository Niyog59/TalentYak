import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthPage } from "@/components/auth/auth-page";
import { Button } from "@/components/button";
import { getSession } from "@/lib/auth";
import { authSettings } from "@/lib/auth-providers";
import { safeNextPath } from "@/lib/redirects";
import { SignUpForm } from "../auth-forms";
import { googleSignInAction } from "../actions";

export const metadata: Metadata = { title: "Create an account" };
export const dynamic = "force-dynamic";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  if (await getSession()) redirect(next);
  const settings = await authSettings();

  return (
    <AuthPage
      title="Create an account"
      intro="You'll confirm your email, then choose your coach and plan before paying anything."
      footer={
        <p>
          Already have an account?{" "}
          <Link href={`/account/sign-in?next=${encodeURIComponent(next)}`} className="font-semibold text-brand underline underline-offset-4">
            Sign in
          </Link>
        </p>
      }
    >
      {settings.signupDisabled ? (
        <p role="status" className="rounded-lg border border-line bg-paper-raised p-4">
          New accounts aren&rsquo;t open right now.
        </p>
      ) : (
        <>
          {settings.google ? (
            <>
              <form action={googleSignInAction}>
                <input type="hidden" name="next" value="/account/onboarding" />
                <Button type="submit" variant="secondary" className="w-full">
                  Continue with Google
                </Button>
              </form>
              <p className="my-6 text-center text-sm text-ink-muted">or use your email</p>
            </>
          ) : null}
          <SignUpForm />
        </>
      )}
    </AuthPage>
  );
}
