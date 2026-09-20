import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

/** Shown when there is honestly nothing to display yet. */
export function EmptyState({
  icon,
  title,
  children,
  actions,
  className = "",
  headingLevel = "h2",
}: {
  icon?: IconName;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  headingLevel?: "h2" | "h3";
}) {
  const Heading = headingLevel;
  return (
    <div
      className={`rounded-2xl border border-dashed border-line-strong bg-surface px-6 py-10 text-center sm:px-10 ${className}`}
    >
      {icon && (
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-tint text-brand">
          <Icon name={icon} className="size-6" />
        </span>
      )}
      <Heading className="mt-4 text-xl font-semibold">{title}</Heading>
      <div className="mx-auto mt-2 max-w-md text-ink-muted">{children}</div>
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  );
}
