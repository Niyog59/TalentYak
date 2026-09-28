import type { Metadata } from "next";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { confirmWaitlistAction } from "@/lib/waitlist/actions";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** A person presses the button; opening the link alone confirms nothing. */
export default async function ConfirmWaitlistPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-4xl">Confirm your email</h1>
      <p className="mt-3 text-lg text-ink-muted">
        Confirm to join the TalentYak waitlist. We&rsquo;ll only email you when coaching you asked about can be bought — never marketing.
      </p>
      <ActionForm action={confirmWaitlistAction} className="mt-6 grid gap-3">
        <input type="hidden" name="token" value={token.slice(0, 80)} />
        <div><SubmitButton pendingLabel="Confirming…">Confirm my email</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
