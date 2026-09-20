import type { ReactNode } from "react";

/*
 * Section heading used by existing pages.
 *
 * The PullQuote component that lived here was removed: its only use was a
 * testimonial whose truth could not be established. Quotes may return only
 * with a verified, consented source.
 */
export function SectionLabel({
  children,
  ne,
}: {
  children: ReactNode;
  ne?: string;
}) {
  return (
    <div className="mb-6 flex items-baseline gap-3">
      <h2 className="text-lg font-semibold text-ink">{children}</h2>
      {ne && <p className="devanagari text-sm text-ink-muted">{ne}</p>}
    </div>
  );
}
