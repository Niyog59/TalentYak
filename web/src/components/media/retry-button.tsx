"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";

/** Asks for processing to be tried again. The server decides whether it may be. */
export function RetryProcessingButton({ id }: { id: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();

  async function retry() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/media/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage(body.error ?? "That couldn't be retried.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div>
      <Button variant="secondary" size="sm" onClick={retry} disabled={busy}>
        {busy ? "Retrying…" : "Try processing again"}
      </Button>
      {message ? <p role="alert" className="mt-2 text-sm text-danger">{message}</p> : null}
    </div>
  );
}
