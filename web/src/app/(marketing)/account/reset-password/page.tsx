import type { Metadata } from "next";
import Link from "next/link";
import { AuthPage } from "@/components/auth/auth-page";
import { getSession } from "@/lib/auth";
import { ResetPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const session = await getSession();

  if (!session) {
    return (
      <AuthPage title="This link has expired" intro="Reset links work once, and only in the browser that asked for them.">
        <Link href="/account/forgot-password" className="font-semibold text-brand underline underline-offset-4">
          Request a new reset link
        </Link>
      </AuthPage>
    );
  }

  return (
    <AuthPage title="Choose a new password" intro={`For ${session.email}.`}>
      <ResetPasswordForm />
    </AuthPage>
  );
}
