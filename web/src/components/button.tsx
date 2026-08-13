import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const styles = {
  primary:
    "inline-block rounded-[3px] bg-ink px-6 py-3 font-sans text-sm font-medium text-paper transition-colors hover:bg-ink-deep",
  secondary:
    "inline-block rounded-[3px] border border-ink px-6 py-3 font-sans text-sm font-medium text-ink transition-colors hover:border-terracotta hover:text-terracotta",
  link: "label text-terracotta underline-offset-4 hover:underline",
} as const;

type Variant = keyof typeof styles;

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...props} className={`${styles[variant]} ${className}`} />;
}

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; children: ReactNode }) {
  return (
    <button {...props} className={`${styles[variant]} ${className}`}>
      {children}
    </button>
  );
}
