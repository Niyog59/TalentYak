import type { Metadata } from "next";
import Link from "next/link";
import { AuthPage } from "@/components/auth/auth-page";
import { ResendConfirmationForm } from "../auth-forms";

export const metadata: Metadata = { title: "Send a new confirmation link" };

export default function ResendConfirmationPage() {
  return (
    <AuthPage
      title="Send a new confirmation link"
      intro="Enter the email address you signed up with. We'll send a new link to confirm it."
      footer={
        <p>
          Already confirmed?{" "}
          <Link href="/account/sign-in" className="font-semibold text-brand underline underline-offset-4">
            Sign in
          </Link>
        </p>
      }
    >
      <ResendConfirmationForm />
    </AuthPage>
  );
}
