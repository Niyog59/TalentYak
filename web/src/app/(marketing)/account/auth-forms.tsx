"use client";

import { canonicalTimezone } from "@/lib/preferences";

import Link from "next/link";
import { useActionState, useSyncExternalStore } from "react";
import { initialActionState } from "@/lib/actions";
import { CheckboxField, FormNotice, SelectField, SubmitButton, TextField } from "@/components/form/fields";
import {
  emailLinkAction,
  forgotPasswordAction,
  onboardingAction,
  resetPasswordAction,
  signInAction,
  signUpAction,
} from "./actions";

export function SignInForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInAction, initialActionState);
  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <TextField name="email" label="Email address" type="email" autoComplete="email" inputMode="email" required
        defaultValue={state.values?.email} />
      <TextField name="password" label="Password" type="password" autoComplete="current-password" required />
      <FormNotice state={state} />
      <SubmitButton pendingLabel="Signing in…" className="w-full">Sign in</SubmitButton>
      <p className="text-center">
        <Link href="/account/forgot-password" className="text-brand underline underline-offset-4">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}

export function EmailLinkForm({ next }: { next: string }) {
  const [state, action] = useActionState(emailLinkAction, initialActionState);
  if (state.ok) return <FormNotice state={state} />;
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <TextField name="email" label="Email address" type="email" autoComplete="email" inputMode="email" required
        defaultValue={state.values?.email} help="For an existing account. We'll email you a one-time sign-in link." />
      <FormNotice state={state} />
      <SubmitButton pendingLabel="Sending…" variant="secondary" className="w-full">Email me a sign-in link</SubmitButton>
    </form>
  );
}

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, initialActionState);
  if (state.ok) return <FormNotice state={state} />;
  return (
    <form action={action} className="space-y-5" noValidate>
      <TextField name="email" label="Email address" type="email" autoComplete="email" inputMode="email" required
        defaultValue={state.values?.email} error={state.fieldErrors?.email} />
      <TextField name="password" label="Password" type="password" autoComplete="new-password" required
        help="At least 10 characters. A few unrelated words is strong and easy to remember."
        error={state.fieldErrors?.password} />
      <TextField name="confirm" label="Confirm password" type="password" autoComplete="new-password" required
        error={state.fieldErrors?.confirm} />
      <FormNotice state={state} />
      <SubmitButton pendingLabel="Creating account…" className="w-full">Create account</SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, initialActionState);
  if (state.ok) return <FormNotice state={state} />;
  return (
    <form action={action} className="space-y-5" noValidate>
      <TextField name="email" label="Email address" type="email" autoComplete="email" inputMode="email" required
        defaultValue={state.values?.email} />
      <FormNotice state={state} />
      <SubmitButton pendingLabel="Sending…" className="w-full">Send reset link</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useActionState(resetPasswordAction, initialActionState);
  return (
    <form action={action} className="space-y-5" noValidate>
      <TextField name="password" label="New password" type="password" autoComplete="new-password" required
        help="At least 10 characters." error={state.fieldErrors?.password} />
      <TextField name="confirm" label="Confirm new password" type="password" autoComplete="new-password" required
        error={state.fieldErrors?.confirm} />
      <FormNotice state={state} />
      <SubmitButton pendingLabel="Saving…" className="w-full">Save new password</SubmitButton>
    </form>
  );
}

export function OnboardingForm({
  next,
  defaults,
  timezones,
  currencies,
}: {
  next: string;
  defaults: { preferred_name: string; timezone: string; display_currency: string };
  timezones: string[];
  currencies: { code: string; label: string }[];
}) {
  const [state, action] = useActionState(onboardingAction, initialActionState);
  const v = state.values ?? defaults;
  return (
    <form action={action} className="space-y-6" noValidate>
      <input type="hidden" name="next" value={next} />
      <TextField name="preferred_name" label="What should we call you?" required autoComplete="given-name"
        maxLength={80} defaultValue={v.preferred_name} error={state.fieldErrors?.preferred_name} />
      <DetectedTimezone
        timezones={timezones}
        defaultValue={v.timezone}
        error={state.fieldErrors?.timezone}
      />
      <SelectField name="display_currency" label="Show prices in" required defaultValue={v.display_currency || "USD"}
        options={currencies.map((c) => ({ value: c.code, label: c.label }))}
        help="Only changes how prices are shown to you. Each plan is charged in the currency its coach set, and checkout always shows that currency clearly."
        error={state.fieldErrors?.display_currency} />

      <fieldset className="space-y-4 rounded-xl border border-line p-4">
        <legend className="px-1 font-semibold">Before you continue</legend>
        <CheckboxField name="terms" required error={state.fieldErrors?.terms}
          label={<>I accept the <Link href="/legal/terms" target="_blank" className="text-brand underline">terms of service</Link> (draft)</>} />
        <CheckboxField name="privacy" required error={state.fieldErrors?.privacy}
          label={<>I have read the <Link href="/legal/privacy" target="_blank" className="text-brand underline">privacy notice</Link> (draft)</>} />
        <CheckboxField name="adult" required error={state.fieldErrors?.adult} label="I am 18 or older" />
      </fieldset>

      <FormNotice state={state} />
      <SubmitButton pendingLabel="Saving…" className="w-full">Continue</SubmitButton>
    </form>
  );
}

const noSubscribe = () => () => {};
const browserZone = () => canonicalTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "";
const serverZone = () => "";

function DetectedTimezone({
  timezones,
  defaultValue,
  error,
}: {
  timezones: string[];
  defaultValue: string;
  error?: string;
}) {
  // The browser's zone is read only in the browser: the server renders "" and
  // React swaps in the real value after hydration, without a mismatch. It is a
  // suggestion the person can correct — a browser setting is not proof of where
  // someone trains.
  const zone = useSyncExternalStore(noSubscribe, browserZone, serverZone);
  const detected = timezones.includes(zone) ? zone : "";
  const initial = defaultValue || detected;

  return (
    <SelectField
      key={initial}
      name="timezone"
      label="Your timezone"
      required
      defaultValue={initial}
      options={[{ value: "", label: "Choose your timezone" }, ...timezones.map((z) => ({ value: z, label: z.replaceAll("_", " ") }))]}
      help={detected
        ? `Your browser suggests ${detected.replaceAll("_", " ")}. Change it if that isn't where you'll be training.`
        : "Used to show call times and dates in your local time."}
      error={error}
    />
  );
}
