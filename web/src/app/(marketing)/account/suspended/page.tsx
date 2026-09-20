import type { Metadata } from "next";
import { AuthPage } from "@/components/auth/auth-page";
import { Button } from "@/components/button";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Account paused" };

export default function SuspendedPage() {
  return (
    <AuthPage
      title="This account is paused"
      intro="Access has been paused while something is looked into. Nothing has been deleted."
    >
      {env.supportEmail ? (
        <p>
          Contact{" "}
          <a href={`mailto:${env.supportEmail}`} className="font-semibold text-brand underline underline-offset-4">
            {env.supportEmail}
          </a>{" "}
          if you have questions.
        </p>
      ) : null}
      <form action="/auth/signout" method="post" className="mt-8">
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
    </AuthPage>
  );
}
