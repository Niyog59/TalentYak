"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/button";
import { Icon } from "@/components/ui/icon";

/*
 * Two-factor authentication with an authenticator app (TOTP).
 *
 * Runs in the browser against the person's own session: enrolling and
 * verifying a factor is something only the account holder can do, and the
 * resulting assurance level (aal2) is what the database checks before granting
 * admin reach or accepting a payout-destination change.
 */

const CODE_PATTERN = /^\d{6}$/;

function CodeInput({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block font-semibold">
        6-digit code from your authenticator app
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="mt-2 block min-h-12 w-40 rounded-lg border border-line-strong bg-surface px-4 text-center text-2xl tracking-[0.3em] tabular aria-[invalid=true]:border-danger"
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-2 flex gap-1.5 font-semibold text-danger">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function MfaEnrol({ next }: { next?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"start" | "scan" | "done">("start");
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(undefined);
    const supabase = createClient();
    if (!supabase) {
      setError("Two-factor setup isn't available right now.");
      setBusy(false);
      return;
    }
    // Clear any half-finished setup from an earlier attempt so it cannot block this one.
    const existing = await supabase.auth.mfa.listFactors();
    for (const f of existing.data?.all ?? []) {
      if (f.factor_type === "totp" && f.status !== "verified") {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
    }
    const { data, error: enrolError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)} ${Math.random().toString(36).slice(2, 6)}`,
    });
    setBusy(false);
    if (enrolError || !data) {
      setError("We couldn't start setup. Please try again.");
      return;
    }
    setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setStep("scan");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factor) return;
    if (!CODE_PATTERN.test(code)) {
      setError("Enter the 6 digits shown in your app.");
      return;
    }
    setBusy(true);
    setError(undefined);
    const supabase = createClient()!;
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    setBusy(false);
    if (verifyError) {
      setError("That code didn't match. Codes change every 30 seconds — try the current one.");
      return;
    }
    setStep("done");
    router.refresh();
    if (next) router.push(next);
  }

  if (step === "done") {
    return (
      <p role="status" className="flex gap-2 rounded-lg border border-line bg-brand-tint p-4 font-medium">
        <Icon name="check" className="mt-0.5 size-5 shrink-0 text-success" />
        Two-factor authentication is on.
      </p>
    );
  }

  if (step === "scan" && factor) {
    return (
      <form onSubmit={verify} className="space-y-6">
        <ol className="list-decimal space-y-2 pl-6">
          <li>Open an authenticator app (for example Google Authenticator, Microsoft Authenticator, 1Password).</li>
          <li>Scan this code, or type the setup key below.</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        {/* eslint-disable-next-line @next/next/no-img-element -- a one-off data URI QR, not an optimisable asset */}
        <img src={factor.qr} alt="QR code for adding TalentYak to your authenticator app" width={180} height={180}
          className="rounded-lg border border-line bg-white p-2" />
        <div>
          <p className="font-semibold">Setup key</p>
          <code className="mt-1 block break-all rounded-lg bg-paper-raised p-3 text-sm tabular">{factor.secret}</code>
        </div>
        <CodeInput value={code} onChange={setCode} error={error} />
        <Button type="submit" disabled={busy}>
          {busy ? "Checking…" : "Turn on two-factor"}
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="font-semibold text-danger">
          {error}
        </p>
      ) : null}
      <Button onClick={start} disabled={busy}>
        {busy ? "Starting…" : "Set up two-factor authentication"}
      </Button>
    </div>
  );
}

export function MfaChallenge({ next }: { next: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase?.auth.mfa.listFactors().then(({ data }) => {
      setFactorId(data?.totp.find((f) => f.status === "verified")?.id ?? null);
    });
  }, []);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    if (!CODE_PATTERN.test(code)) {
      setError("Enter the 6 digits shown in your app.");
      return;
    }
    setBusy(true);
    setError(undefined);
    const { error: verifyError } = await createClient()!.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (verifyError) {
      setError("That code didn't match. Codes change every 30 seconds — try the current one.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={verify} className="space-y-6">
      <CodeInput value={code} onChange={setCode} error={error} />
      <Button type="submit" disabled={busy || !factorId}>
        {busy ? "Checking…" : "Verify"}
      </Button>
    </form>
  );
}

export function RemoveFactorButton({ factorId }: { factorId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function remove() {
    if (!window.confirm("Remove this authenticator? You'll no longer be asked for a code when you sign in.")) return;
    setBusy(true);
    const { error: removeError } = await createClient()!.auth.mfa.unenroll({ factorId });
    setBusy(false);
    if (removeError) {
      setError("Couldn't remove it. You may need to verify a code first.");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <Button variant="secondary" size="sm" onClick={remove} disabled={busy}>
        {busy ? "Removing…" : "Remove"}
      </Button>
      {error ? (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
