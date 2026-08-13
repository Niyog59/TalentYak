import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="mx-auto max-w-md px-6 py-20">
      <h1 className="font-display text-3xl">Sign in</h1>
      <p className="mt-2 text-sm text-ink/70">
        We&rsquo;ll email you a sign-in link — no password to remember.
      </p>
      <div className="mt-8">
        <SignInForm />
      </div>
    </div>
  );
}
