"use client";

import { useSyncExternalStore } from "react";

/*
 * Connection-loss notice.
 *
 * TalentYak has no offline support in M02: there is no service worker and no
 * cached data. Payments, bookings, calls and saving progress all need the
 * internet. This notice says so honestly instead of letting a customer type
 * into a form that cannot be saved.
 *
 * The live region is always rendered so screen readers announce the change
 * when the connection drops, not only when the notice first mounts.
 */

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const getSnapshot = () => navigator.onLine;
// Assume online during server rendering; the client corrects it on hydration.
const getServerSnapshot = () => true;

export function ConnectionStatus() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <div role="status" aria-live="polite">
      {!online && <OfflineNotice />}
    </div>
  );
}

/** Presentational notice — also rendered on the reference screens. */
export function OfflineNotice() {
  return (
    <div className="sticky top-0 z-40 bg-ink text-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 sm:px-6">
        <p className="font-semibold">You&rsquo;re offline.</p>
        <p className="text-paper/90">
          Payments, bookings, calls and saving your progress need an internet
          connection. Anything you enter now will not be saved.
        </p>
      </div>
    </div>
  );
}
