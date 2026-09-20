import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthPage } from "@/components/auth/auth-page";
import { isOnboarded, requireSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/redirects";
import { DISPLAY_CURRENCIES, timezoneOptions } from "@/lib/preferences";
import { OnboardingForm } from "../auth-forms";

export const metadata: Metadata = { title: "Set up your account" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next, "/account");
  const session = await requireSession("/account/onboarding");
  if (session.profile.suspended_at) redirect("/account/suspended");
  if (isOnboarded(session)) redirect(next);

  return (
    <AuthPage
      title="A few details"
      intro="So times show in your own timezone and prices in a currency you recognise. We only ask for what we use."
    >
      <OnboardingForm
        next={next}
        timezones={timezoneOptions()}
        currencies={[...DISPLAY_CURRENCIES]}
        defaults={{
          preferred_name: session.profile.preferred_name ?? "",
          timezone: session.profile.timezone ?? "",
          display_currency: session.profile.display_currency ?? "",
        }}
      />
    </AuthPage>
  );
}
