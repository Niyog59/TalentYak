"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { ActionPendingContext, ActionStateContext, FormNotice } from "@/components/form/fields";
import { initialActionState, type ActionState } from "@/lib/actions";

/*
 * A form wired to a server action, with the outcome announced beside it.
 *
 * Every mutation in the coach, customer and founder areas goes through one of
 * these, so every screen behaves the same way: the button disables while the
 * action runs, the result is read out to screen readers, a refusal from the
 * server is shown in words, and a failed save is never silent. Fields inside
 * pick up their own error messages from the result by name.
 *
 * KEEPING WHAT WAS TYPED. A plain `<form action={...}>` is reset by React when
 * the action finishes — including when the server refused it — which would
 * wipe a coach's half-written profile because one field was wrong. This form
 * submits through a transition instead, so nothing is cleared. Small "add"
 * forms can opt back in to clearing after a success.
 */
export function ActionForm({
  action,
  children,
  className = "",
  noticeFirst = false,
  resetOnSuccess = false,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  /** Put the notice above the fields — for long forms. */
  noticeFirst?: boolean;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state.ok) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(data));
  }

  return (
    <ActionStateContext.Provider value={state}>
      <ActionPendingContext.Provider value={pending}>
        <form ref={formRef} action={formAction} onSubmit={onSubmit} className={className} aria-busy={pending}>
          {noticeFirst ? <FormNotice state={state} /> : null}
          {children}
          {noticeFirst ? null : <FormNotice state={state} />}
        </form>
      </ActionPendingContext.Provider>
    </ActionStateContext.Provider>
  );
}
