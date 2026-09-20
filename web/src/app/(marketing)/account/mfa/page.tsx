import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthPage } from "@/components/auth/auth-page";
import { MfaChallenge } from "@/components/auth/mfa";
import { requireSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/redirects";

export const metadata: Metadata = { title: "Enter your code" };
export const dynamic = "force-dynamic";

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next);
  const session = await requireSession(`/account/mfa?next=${encodeURIComponent(next)}`);
  if (session.aal === "aal2" || !session.hasVerifiedFactor) redirect(next);

  return (
    <AuthPage title="Enter your code" intro="Open your authenticator app and enter the current 6-digit code for TalentYak.">
      <MfaChallenge next={next} />
    </AuthPage>
  );
}
