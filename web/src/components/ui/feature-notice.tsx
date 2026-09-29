import Link from "next/link";
import type { ReactNode } from "react";

/*
 * Shown where a feature has been paused or switched off by TalentYak. It says
 * what still works and where to get help, rather than pretending the screen is
 * empty or broken.
 */
export function FeaturePausedNotice({
  title,
  children,
  supportHref,
  className = "",
}: {
  title: string;
  children: ReactNode;
  supportHref?: string;
  className?: string;
}) {
  return (
    <div role="status" className={`rounded-xl border border-line-strong bg-paper-raised p-4 ${className}`}>
      <p className="font-semibold">{title}</p>
      <div className="mt-1 text-ink-muted">{children}</div>
      {supportHref ? (
        <Link href={supportHref} className="mt-2 inline-block text-brand underline underline-offset-4">
          Contact support
        </Link>
      ) : null}
    </div>
  );
}
