import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/ui/panel";
import { formatDate } from "@/lib/format";
import { VERSION_STATUS_LABEL, versionStatus, type VersionStatus } from "@/lib/programmes/content";
import type { PlanVersion } from "@/lib/programmes/server";

const TONE: Record<VersionStatus, "good" | "neutral" | "warn" | "bad"> = {
  current: "good",
  scheduled: "warn",
  draft: "neutral",
  earlier: "neutral",
  cancelled: "neutral",
};

/** Every version of one plan, newest first, each with where it stands and what changed. */
export function VersionHistory({
  versions,
  timeZone,
  hrefFor,
  actionsFor,
}: {
  versions: PlanVersion[];
  timeZone: string | null;
  hrefFor: (v: PlanVersion) => string;
  actionsFor?: (v: PlanVersion, status: VersionStatus) => ReactNode;
}) {
  const now = new Date();
  if (!versions.length) return <p className="text-ink-muted">Nothing yet.</p>;
  return (
    <ol className="divide-y divide-line">
      {versions.map((v) => {
        const status = versionStatus(v, versions, now);
        return (
          <li key={v.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={hrefFor(v)} className="font-semibold text-brand underline underline-offset-4">
                Version {v.version}: {v.title}
              </Link>
              <StatusPill tone={TONE[status]}>{VERSION_STATUS_LABEL[status]}</StatusPill>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {v.published_at
                ? status === "scheduled"
                  ? `Published ${formatDate(v.published_at, timeZone)} · starts ${formatDate(v.effective_from, timeZone)}`
                  : `Started ${formatDate(v.effective_from, timeZone, true)}`
                : `Last saved ${formatDate(v.updated_at, timeZone, true)}`}
              {v.withdrawn_at ? ` · cancelled ${formatDate(v.withdrawn_at, timeZone)}` : ""}
              {v.published_at && !v.notified ? " · minor correction, no notice sent" : ""}
            </p>
            {v.change_summary ? <p className="mt-1 whitespace-pre-line">&ldquo;{v.change_summary}&rdquo;</p> : null}
            {actionsFor ? <div className="mt-2">{actionsFor(v, status)}</div> : null}
          </li>
        );
      })}
    </ol>
  );
}
