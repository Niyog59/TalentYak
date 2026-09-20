import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/redirects";
import { MfaChallenge, MfaEnrol, RemoveFactorButton } from "@/components/auth/mfa";
import { SubmitButton } from "@/components/form/fields";
import { signOutEverywhereAction } from "../actions";

export const metadata: Metadata = { title: "Sign-in security" };
export const dynamic = "force-dynamic";

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  const session = await requireSession("/account/security");
  const next = params.next ? safeNextPath(params.next) : undefined;
  const supabase = await createClient();
  const { data } = await supabase!.auth.mfa.listFactors();
  const verified = (data?.totp ?? []).filter((f) => f.status === "verified");
  const isAdmin = session.profile.role === "admin";
  const needsVerification = verified.length > 0 && session.aal !== "aal2";

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 md:py-16">
      <h1 className="font-display text-4xl sm:text-5xl">Sign-in security</h1>

      {params.reason === "admin" ? (
        <p role="alert" className="mt-6 rounded-lg border border-line-strong bg-paper-raised p-4 font-medium">
          The founder console needs two-factor authentication.{" "}
          {verified.length ? "Enter a code to continue." : "Set it up below to continue."}
        </p>
      ) : null}
      {params.reason === "payouts" ? (
        <p role="alert" className="mt-6 rounded-lg border border-line-strong bg-paper-raised p-4 font-medium">
          Changing where you are paid needs two-factor authentication, so nobody who got hold of your password alone could redirect your earnings.
        </p>
      ) : null}

      <section aria-labelledby="mfa-heading" className="mt-10">
        <h2 id="mfa-heading" className="text-2xl font-semibold">
          Two-factor authentication
        </h2>
        <p className="mt-2 text-ink-muted">
          {isAdmin
            ? "Required for the founder console. It protects coach payout details and customer records."
            : "Adds a code from an app on your phone when you sign in. Required for coaches before changing payout details."}
        </p>

        {needsVerification ? (
          <div className="mt-6">
            <p className="mb-4">You&rsquo;ve set this up. Enter a code to confirm it&rsquo;s you for this session.</p>
            <MfaChallenge next={next ?? "/account/security"} />
          </div>
        ) : null}

        {verified.length > 0 ? (
          <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
            {verified.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold">{f.friendly_name || "Authenticator app"}</p>
                  <p className="text-sm text-ink-muted">Added {new Date(f.created_at).toLocaleDateString()}</p>
                </div>
                {/* An admin cannot remove their last factor: it would lock them out of the console. */}
                {!(isAdmin && verified.length === 1) && session.aal === "aal2" ? <RemoveFactorButton factorId={f.id} /> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {!needsVerification ? (
          <div className="mt-6">
            {verified.length > 0 ? <p className="mb-3 font-semibold">Add another device</p> : null}
            <MfaEnrol next={next} />
          </div>
        ) : null}

        <div className="mt-8 rounded-xl border border-line bg-paper-raised p-4">
          <h3 className="font-semibold">If you lose your phone</h3>
          <p className="mt-1 text-ink-muted">
            There are no printable backup codes. The reliable safeguard is to add a second device now — a tablet, or
            a password manager that stores authenticator codes — so losing one never locks you out.
            {isAdmin
              ? " If every device is lost, the founder account's factor can only be removed from the Supabase dashboard by the project owner."
              : " If you lose every device, contact support to verify your identity."}
          </p>
        </div>
      </section>

      <section aria-labelledby="sessions-heading" className="mt-12">
        <h2 id="sessions-heading" className="text-2xl font-semibold">
          Signed-in devices
        </h2>
        <p className="mt-2 text-ink-muted">Sign out everywhere, including this device — useful if a phone or laptop is lost.</p>
        <form action={signOutEverywhereAction} className="mt-4">
          <SubmitButton variant="secondary" pendingLabel="Signing out…">
            Sign out on all devices
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}
