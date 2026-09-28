"use client";

import type { FormEvent, ReactNode } from "react";
import { clearDevice, countUnsavedOnDevice } from "@/lib/tracking/device";

/*
 * Signing out clears everything TalentYak kept in this browser — tracking
 * drafts and unsent messages — so the next person to use the device finds
 * none of it. If some of it never reached the server, the person is told
 * first and can stay signed in to save it.
 */
export function SignOutForm({
  action = "/auth/signout",
  children,
  className,
}: {
  action?: string | ((form: FormData) => void | Promise<void>);
  children: ReactNode;
  className?: string;
}) {
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const unsaved = countUnsavedOnDevice();
    if (
      unsaved > 0 &&
      !window.confirm(
        `${unsaved === 1 ? "One entry on this device hasn't" : `${unsaved} entries on this device haven't`} been saved yet. Signing out removes ${unsaved === 1 ? "it" : "them"} from this device. Sign out anyway?`,
      )
    ) {
      event.preventDefault();
      return;
    }
    clearDevice();
  }
  return typeof action === "string" ? (
    <form action={action} method="post" onSubmit={onSubmit} className={className}>
      {children}
    </form>
  ) : (
    <form action={action} onSubmit={onSubmit} className={className}>
      {children}
    </form>
  );
}
