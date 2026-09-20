import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/*
 * Shared buttons. The API (variant: primary | secondary | link) is unchanged
 * so existing founder and coach pages keep working; `quiet` and `size` are new.
 * Default size meets the 44px touch target.
 */

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg text-center font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

const sizes = {
  md: "min-h-11 px-5 text-base",
  sm: "min-h-9 px-3.5 text-sm",
} as const;

const variants = {
  primary: "bg-brand text-white hover:bg-brand-strong",
  secondary:
    "border border-line-strong bg-surface text-ink hover:border-ink hover:bg-paper-raised",
  quiet: "text-brand hover:bg-brand-tint",
  /** For dark panels. Pair the panel with the `on-dark` class for focus rings. */
  inverse: "bg-paper text-ink hover:bg-paper-raised",
  link: "min-h-0 px-0 text-brand underline decoration-1 underline-offset-4 hover:decoration-2",
} as const;

type Variant = keyof typeof variants;
type Size = keyof typeof sizes;

function classes(variant: Variant, size: Size, className: string) {
  const sizing = variant === "link" ? "text-base" : sizes[size];
  return `${base} ${sizing} ${variants[variant]} ${className}`;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link {...props} className={classes(variant, size, className)} />;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}) {
  return (
    <button {...props} className={classes(variant, size, className)}>
      {children}
    </button>
  );
}
