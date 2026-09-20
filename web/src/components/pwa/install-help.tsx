import { Icon } from "@/components/ui/icon";

/*
 * Optional "add to home screen" explanation. It never pops up on its own —
 * it sits closed in the account area until someone chooses to open it.
 * It is honest that installing does not make TalentYak work offline.
 */
export function InstallHelp({ className = "" }: { className?: string }) {
  return (
    <details className={`group rounded-xl border border-line bg-surface ${className}`}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 font-semibold [&::-webkit-details-marker]:hidden">
        Add TalentYak to your home screen
        <Icon name="plus" className="size-5 shrink-0 transition-transform group-open:rotate-45" />
      </summary>
      <div className="border-t border-line px-4 pb-4 pt-3 text-ink-muted">
        <p>
          You can open TalentYak like an app, without the browser bar. This is
          optional.
        </p>
        <dl className="mt-4 space-y-3">
          <div>
            <dt className="font-semibold text-ink">iPhone or iPad (Safari)</dt>
            <dd>Tap Share, then Add to Home Screen.</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Android (Chrome)</dt>
            <dd>Open the browser menu, then Install app or Add to Home screen.</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Computer (Chrome or Edge)</dt>
            <dd>Use the install button at the right of the address bar.</dd>
          </div>
        </dl>
        <p className="mt-4">
          Installing doesn&rsquo;t make TalentYak work offline. Payments,
          bookings, calls and saving your progress still need an internet
          connection.
        </p>
      </div>
    </details>
  );
}
