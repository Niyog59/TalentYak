"use client";

import Link from "next/link";
import { useActionState, useSyncExternalStore } from "react";
import { initialActionState } from "@/lib/actions";
import { FormNotice, SubmitButton } from "@/components/form/fields";
import type { EmailLinkType } from "@/lib/auth-links";
import { confirmEmailLinkAction } from "./actions";

// The token is in the URL fragment, which only the browser can read. Opening
// the page sends nothing; pressing Continue posts it once.
const noSubscribe = () => () => {};
function linkToken(): string {
  const fromFragment = new URLSearchParams(window.location.hash.slice(1)).get("token_hash");
  const fromQuery = new URLSearchParams(window.location.search).get("token_hash");
  return fromFragment ?? fromQuery ?? "";
}
const beforeHydration = () => null;

export function ConfirmLinkForm({ type, next, cta }: { type: EmailLinkType; next: string; cta: string }) {
  const [state, action] = useActionState(confirmEmailLinkAction, initialActionState);
  const token = useSyncExternalStore(noSubscribe, linkToken, beforeHydration);
  const incomplete = token === "";

  return (
    <div className="space-y-6">
      {incomplete ? (
        <FormNotice state={{ ok: false, message: "This link is incomplete. Open it straight from the email, or copy the whole link into your browser." }} />
      ) : (
        <form action={action} className="space-y-5">
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="token_hash" value={token ?? ""} />
          <FormNotice state={state} />
          {token === null ? (
            <p role="status" className="text-ink-muted">Getting your link ready…</p>
          ) : (
            <SubmitButton pendingLabel="Checking your link…" className="w-full">{cta}</SubmitButton>
          )}
        </form>
      )}

      {incomplete || state.message ? <NewLinkOptions type={type} /> : null}
    </div>
  );
}

function NewLinkOptions({ type }: { type: EmailLinkType }) {
  const link = "font-semibold text-brand underline underline-offset-4";
  return type === "recovery" ? (
    <p>
      <Link href="/account/forgot-password" className={link}>Send me a new reset link</Link>
    </p>
  ) : (
    <ul className="space-y-2">
      <li><Link href="/account/sign-in" className={link}>Sign in</Link></li>
      <li><Link href="/account/confirm-email" className={link}>Send me a new confirmation link</Link></li>
    </ul>
  );
}
