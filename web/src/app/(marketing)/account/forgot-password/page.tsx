import type { Metadata } from "next";
import Link from "next/link";
import { AuthPage } from "@/components/auth/auth-page";
import { ForgotPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthPage
      title="Reset your password"
      intro="Enter the email address for your account and we'll send you a link to choose a new password."
      footer={
        <p>
          Remembered it?{" "}
          <Link href="/account/sign-in" className="font-semibold text-brand underline underline-offset-4">
            Sign in
          </Link>
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthPage>
  );
}
