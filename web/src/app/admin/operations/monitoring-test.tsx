"use client";

import { useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/button";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { sendMonitoringTestAction } from "./monitoring-actions";

/**
 * Two deliberate test errors — one from the server, one from this browser —
 * to confirm error reporting end to end. Shown only to administrators with a
 * second factor (the page itself requires it).
 */
export function MonitoringTest({ browserEnabled }: { browserEnabled: boolean }) {
  const [browserResult, setBrowserResult] = useState<string | null>(null);

  function sendFromBrowser() {
    const id = Sentry.withScope((scope) => {
      scope.setTags({ area: "scheduler", test: "true" });
      return Sentry.captureException(new Error("TalentYak monitoring test (browser) — deliberate, safe to resolve"));
    });
    void Sentry.flush(3000).then((sent) =>
      setBrowserResult(sent ? `Test error sent from this browser (reference ${id.slice(0, 8)}).` : "The browser couldn't confirm sending. An ad blocker may be stopping it."),
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <ActionForm action={sendMonitoringTestAction}>
        <SubmitButton pendingLabel="Sending…" variant="secondary">Send a test error from the server</SubmitButton>
      </ActionForm>
      <div>
        <Button type="button" variant="secondary" onClick={sendFromBrowser} disabled={!browserEnabled}>
          Send a test error from this browser
        </Button>
        {browserResult && <p role="status" className="mt-2 text-[0.9375rem] text-ink-muted">{browserResult}</p>}
      </div>
    </div>
  );
}
