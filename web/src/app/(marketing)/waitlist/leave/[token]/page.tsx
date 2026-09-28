import type { Metadata } from "next";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { leaveWaitlistAction } from "@/lib/waitlist/actions";

export const metadata: Metadata = { title: "Leave the waitlist", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LeaveWaitlistPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="font-display text-4xl">Leave the waitlist</h1>
      <p className="mt-3 text-lg text-ink-muted">This deletes your email and anything you told us on the waitlist. You can join again any time.</p>
      <ActionForm action={leaveWaitlistAction} className="mt-6 grid gap-3">
        <input type="hidden" name="token" value={token.slice(0, 80)} />
        <div><SubmitButton pendingLabel="Removing…" variant="secondary">Remove me from the list</SubmitButton></div>
      </ActionForm>
    </div>
  );
}
