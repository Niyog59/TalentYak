import type { ReactNode } from "react";

/*
 * Honesty markers.
 *
 * Reference screens use sample data so later modules can wire real data in
 * without a redesign. Anything sample, or not built yet, must say so where it
 * appears — never look like a working feature.
 */

export function SampleBanner({ children }: { children?: ReactNode }) {
  return (
    <div
      role="note"
      aria-label="Sample data notice"
      className="border-b border-accent/50 bg-accent-tint text-ink"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2.5 text-sm sm:px-6">
        <strong className="font-semibold">Design reference with sample data.</strong>
        <span>
          {children ??
            "The people, numbers and buttons on this screen are examples. Nothing here is connected, sent or saved."}
        </span>
      </div>
    </div>
  );
}

export function SampleTag({ label = "Sample" }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-accent/60 bg-accent-tint px-2 py-0.5 text-[0.8125rem] font-semibold text-accent-text">
      {label}
    </span>
  );
}

/** For navigation items and controls whose feature is not built yet. */
export function SoonTag() {
  return (
    <span className="inline-flex items-center rounded-full bg-paper-raised px-2 py-0.5 text-[0.8125rem] font-semibold text-ink-muted">
      Soon
    </span>
  );
}
