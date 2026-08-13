import type { ReactNode } from "react";

export function SectionLabel({
  children,
  ne,
}: {
  children: ReactNode;
  ne?: string;
}) {
  return (
    <div className="mb-8 flex items-baseline gap-4">
      <p className="label text-terracotta">{children}</p>
      {ne && <p className="devanagari text-sm text-ink/40">{ne}</p>}
      <div className="rule flex-1 self-center" />
    </div>
  );
}

export function PullQuote({
  quote,
  attribution,
}: {
  quote: string;
  attribution: string;
}) {
  return (
    <figure className="rule border-b border-line py-12">
      <blockquote className="mx-auto max-w-3xl text-center font-display text-2xl leading-relaxed sm:text-3xl">
        &ldquo;{quote}&rdquo;
      </blockquote>
      <figcaption className="label mt-6 text-center text-ink/60">
        {attribution}
      </figcaption>
    </figure>
  );
}
