import { SoonTag } from "@/components/ui/sample";

/*
 * An action whose feature is not built yet. It looks unmistakably inactive
 * and says why, so a sample screen never pretends a button works. It is not
 * a button: there is nothing to press.
 */
export function UnavailableAction({
  label,
  reason,
  className = "",
}: {
  label: string;
  reason: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <span className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-4 font-semibold text-ink-muted">
        {label}
        <SoonTag />
      </span>
      <p className="mt-2 text-center text-sm text-ink-muted">{reason}</p>
    </div>
  );
}
