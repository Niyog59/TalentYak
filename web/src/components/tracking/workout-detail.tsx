import { StatusPill } from "@/components/ui/panel";
import { Paragraphs } from "@/components/programmes/workout-view";
import { formatDate, formatDay } from "@/lib/format";
import type { Session } from "@/lib/programmes/content";
import { entryName, prescribedFor, setText, STATUS_LABEL, targetText, type WorkoutDoc } from "@/lib/tracking/workout";
import type { WeightUnit } from "@/lib/tracking/units";

/*
 * A recorded workout, read-only: what the client did beside what the coach
 * prescribed in the version it was performed against. A record changed after
 * it was finished says so — nothing is rewritten silently.
 */
export function WorkoutDetail({
  doc,
  session,
  versionLabel,
  finishedAt,
  updatedAt,
  timeZone,
  showUnit,
}: {
  doc: WorkoutDoc;
  session: Session | null;
  versionLabel: string | null;
  finishedAt: string | null;
  updatedAt: string;
  timeZone: string | null;
  showUnit?: WeightUnit;
}) {
  const corrected = finishedAt && Date.parse(updatedAt) - Date.parse(finishedAt) > 60_000;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={doc.status === "completed" ? "good" : "neutral"}>{STATUS_LABEL[doc.status]}</StatusPill>
        <span className="text-ink-muted">{formatDay(doc.performedOn, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
      </div>
      {versionLabel ? <p className="mt-2 text-sm text-ink-muted">{versionLabel}</p> : <p className="mt-2 text-sm text-ink-muted">Unplanned workout.</p>}
      {corrected ? <p className="mt-1 text-sm text-ink-muted">Changed by the client after it was finished — last on {formatDate(updatedAt, timeZone, true)}.</p> : null}

      <ol className="mt-4 space-y-3">
        {doc.exercises.map((e, i) => {
          const { name, insteadOf } = entryName(e, session);
          const p = prescribedFor(e, session);
          return (
            <li key={e.id} className="rounded-xl border border-line bg-surface p-4">
              <p className="font-semibold">
                <span className="text-ink-muted">{i + 1}. </span>
                {name}
                {e.exerciseKey === null && session ? <span className="font-normal text-ink-muted"> · added</span> : null}
              </p>
              {insteadOf ? <p className="text-sm text-ink-muted">Instead of {insteadOf}{e.performedName ? " (own substitute)" : " (coach's alternative)"}</p> : null}
              {p ? <p className="mt-1 text-sm"><span className="text-ink-muted">Target: </span>{targetText(p)}</p> : null}
              {e.status === "skipped" ? (
                <p className="mt-2 font-medium">Skipped</p>
              ) : e.sets.length ? (
                <ol className="tabular mt-2 space-y-0.5">
                  {e.sets.map((s) => (
                    <li key={s.id}>
                      <span className="text-ink-muted">Set {s.setIndex}{s.extra ? " (extra)" : ""}:</span> {setText(e, s, showUnit)}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 text-ink-muted">No sets recorded.</p>
              )}
              {e.notes ? <Paragraphs text={e.notes} className="mt-2 rounded-lg bg-paper-raised p-2" /> : null}
            </li>
          );
        })}
      </ol>
      {doc.notes ? (
        <div className="mt-4">
          <p className="font-semibold">Notes</p>
          <Paragraphs text={doc.notes} className="mt-1" />
        </div>
      ) : null}
    </div>
  );
}
