"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/button";

/*
 * Something failed while rendering a page. The customer is told plainly that
 * their last action may not have completed — nothing on TalentYak counts as
 * saved unless they saw a confirmation.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-20">
      <div role="alert">
        <p className="font-semibold text-danger">Something went wrong</p>
        <h1 className="mt-2 font-display text-4xl leading-tight">
          This page didn&rsquo;t load properly.
        </h1>
        <p className="mt-4 text-ink-muted">
          Your last action may not have completed. Only treat something as
          saved if you saw a confirmation.
        </p>
        {error.digest && (
          <p className="mt-4 text-sm text-ink-muted">
            Reference for support: <span className="tabular font-semibold text-ink">{error.digest}</span>
          </p>
        )}
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>
        <ButtonLink href="/" variant="secondary">
          Go to the homepage
        </ButtonLink>
      </div>
    </main>
  );
}
