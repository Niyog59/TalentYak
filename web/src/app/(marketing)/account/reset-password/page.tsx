import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthPage } from "@/components/auth/auth-page";
import { getSession } from "@/lib/auth";
import { RESET_PASSWORD_PATH } from "@/lib/auth-links";
import { ResetPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const session = await getSession();

  if (!session) {
    return (
      <AuthPage title="Open your reset link first" intro="To choose a new password, open the link in your reset email and press Continue.">
        <Link href="/account/forgot-password" className="font-semibold text-brand underline underline-offset-4">
          Send me a new reset link
        </Link>
      </AuthPage>
    );
  }

  // Resetting a password never skips the second factor.
  if (session.hasVerifiedFactor && session.aal !== "aal2") {
    redirect(`/account/mfa?next=${encodeURIComponent(RESET_PASSWORD_PATH)}`);
  }

  return (
    <AuthPage title="Choose a new password" intro={`For ${session.email}.`}>
      <ResetPasswordForm />
    </AuthPage>
  );
}
