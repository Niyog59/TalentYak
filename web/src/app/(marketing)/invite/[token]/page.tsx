import type { Metadata } from "next";
import { getSession, isOnboarded } from "@/lib/auth";
import { ButtonLink } from "@/components/button";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { acceptInvitationAction } from "./actions";

export const metadata: Metadata = { title: "Coach invitation", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/*
 * The page deliberately says nothing about the invitation until the person is
 * signed in: not whether the token is valid, and not which email it was sent
 * to. A leaked link reveals nothing, and only the invited account can accept.
 */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getSession();
  const next = encodeURIComponent(`/invite/${token}`);

  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-4xl sm:text-5xl">Coach with TalentYak</h1>
      <p className="mt-4 text-lg">You&rsquo;ve been invited to join TalentYak as a coach.</p>

      {!session ? (
        <>
          <p className="mt-4 text-ink-muted">
            Sign in, or create an account, <strong>with the email address this invitation was sent to</strong>. Then you&rsquo;ll come back here to accept.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href={`/account/sign-up?next=${next}`}>Create an account</ButtonLink>
            <ButtonLink href={`/account/sign-in?next=${next}`} variant="secondary">Sign in</ButtonLink>
          </div>
        </>
      ) : session.provider ? (
        <>
          <p className="mt-4">This account is already a coach.</p>
          <ButtonLink href="/coach" className="mt-6">Go to the coach area</ButtonLink>
        </>
      ) : !isOnboarded(session) ? (
        <>
          <p className="mt-4 text-ink-muted">First, finish setting up your account.</p>
          <ButtonLink href={`/account/onboarding?next=${next}`} className="mt-6">Continue</ButtonLink>
        </>
      ) : (
        <>
          <p className="mt-4 text-ink-muted">
            Signed in as <strong>{session.email}</strong>. Accepting turns this account into a coach account. You&rsquo;ll set up your profile next;
            TalentYak reviews it once, and after approval you publish your own plans and prices. TalentYak keeps 20% of what clients pay.
          </p>
          <ActionForm action={acceptInvitationAction} className="mt-6 grid gap-3">
            <input type="hidden" name="token" value={token} />
            <div><SubmitButton pendingLabel="Accepting…">Accept invitation</SubmitButton></div>
          </ActionForm>
        </>
      )}
    </div>
  );
}
