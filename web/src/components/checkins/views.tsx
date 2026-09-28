import Link from "next/link";
import { Paragraphs } from "@/components/programmes/workout-view";
import { StatusPill } from "@/components/ui/panel";
import { formatDate } from "@/lib/format";
import { answerText, type Answers, type Question } from "@/lib/checkins/questions";
import { describeSnapshot, snapshotChanges, type ProgressSnapshot } from "@/lib/checkins/snapshot";
import type { Feedback, Submission } from "@/lib/checkins/server";

/* Read-only pieces shared by the client's and the coach's check-in pages. */

export function AnswersView({ questions, answers, previous }: { questions: Question[]; answers: Answers; previous?: Answers | null }) {
  return (
    <dl className="space-y-4">
      {questions.map((q) => {
        const a = answers[q.key];
        const text = answerText(q, a);
        const before = previous ? previous[q.key] : undefined;
        const changed = previous !== undefined && previous !== null && JSON.stringify(before ?? null) !== JSON.stringify(a ?? null);
        return (
          <div key={q.key} className="rounded-lg border border-line p-3">
            <dt className="font-semibold">
              {q.label} {changed ? <StatusPill tone="warn">Changed</StatusPill> : null}
            </dt>
            <dd className="mt-1">
              {a === undefined ? (
                <span className="text-ink-muted">{q.sensitive || q.kind === "photo" || q.kind === "video" ? "Skipped (optional)" : "Not answered"}</span>
              ) : Array.isArray(a) ? (
                <ul className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {a.map((id) => (
                    <li key={id}>
                      {q.kind === "photo" ? (
                        <a href={`/api/media/${id}`} className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/media/${id}?variant=preview`} alt={`Photo for: ${q.label}`} className="aspect-[3/4] w-full rounded-lg bg-brand-tint object-contain" />
                        </a>
                      ) : (
                        <video controls preload="none" className="aspect-video w-full rounded-lg bg-brand-tint" poster={`/api/media/${id}?variant=preview`}>
                          <source src={`/api/media/${id}`} />
                          <a href={`/api/media/${id}`}>Open the clip</a>
                        </video>
                      )}
                    </li>
                  ))}
                </ul>
              ) : q.kind === "long_text" && text ? (
                <Paragraphs text={text} />
              ) : (
                text
              )}
              {changed && before !== undefined ? (
                <p className="mt-2 text-sm text-ink-muted">Before: {Array.isArray(before) ? `${before.length} file${before.length === 1 ? "" : "s"}` : answerText(q, before)}</p>
              ) : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function SnapshotView({ snapshot, current, timeZone }: { snapshot: ProgressSnapshot | null; current?: ProgressSnapshot | null; timeZone?: string | null }) {
  if (!snapshot) {
    return <p className="text-ink-muted">The progress summary wasn&rsquo;t available when this was sent. The records themselves are on the progress pages.</p>;
  }
  const lines = describeSnapshot(snapshot);
  const changes = current ? snapshotChanges(snapshot, current) : [];
  return (
    <div>
      <p className="text-sm text-ink-muted">As recorded when it was sent ({formatDate(snapshot.capturedAt, timeZone, true)}), from the progress records. Nothing here was typed into the check-in.</p>
      <ul className="mt-3 space-y-2">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className={`mt-2 size-2 shrink-0 rounded-full ${l.incomplete ? "border border-ink-muted" : "bg-brand"}`} />
            <span>
              {l.text}
              {l.incomplete ? <span className="sr-only"> (incomplete records)</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {snapshot.workouts.logged.length ? (
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">Workouts in this period</summary>
          <ul className="mt-1 space-y-1 text-sm">
            {snapshot.workouts.logged.map((w, i) => (
              <li key={i}>{w.date} · {w.label} · {w.status === "in_progress" ? "not finished" : w.status}{w.planned ? "" : " (extra)"}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {changes.length ? (
        <div className="mt-4 rounded-lg border border-line-strong bg-paper-raised p-3">
          <p className="font-semibold">Added or corrected since it was sent</p>
          <ul className="mt-1 list-disc pl-5">{changes.map((c) => <li key={c}>{c}</li>)}</ul>
          <p className="mt-1 text-sm text-ink-muted">The summary above is what was sent, and what any feedback refers to. The progress pages show the records as they are now.</p>
        </div>
      ) : null}
    </div>
  );
}

export function RevisionList({ submissions, timeZone }: { submissions: Submission[]; timeZone?: string | null }) {
  if (submissions.length < 2) return null;
  return (
    <ol className="space-y-1 text-sm">
      {submissions.map((s) => (
        <li key={s.id}>
          Version {s.revision} · sent {formatDate(s.submitted_at, timeZone, true)}
          {s.revision > 1 ? (s.substantive ? " · a change for the coach to look at" : " · a small correction") : " · the original"}
          {s.change_note ? ` · “${s.change_note}”` : ""}
        </li>
      ))}
    </ol>
  );
}

export interface PlanLink {
  versionId: string;
  label: string;
  href: string | null;
}

/**
 * Feedback as published, with next steps. A promised plan change says
 * "promised" until the coach links a version that was actually published.
 */
export function FeedbackView({
  feedback,
  timeZone,
  planLabel,
  planHref,
  conversationHref,
  versionLink,
  submissions,
}: {
  feedback: Feedback;
  timeZone?: string | null;
  planLabel?: string | null;
  planHref?: string | null;
  conversationHref?: string | null;
  versionLink: (versionId: string) => PlanLink | null;
  submissions: Submission[];
}) {
  const refersTo = submissions.find((s) => s.revision === feedback.refers_to_revision);
  const later = submissions.filter((s) => s.revision > feedback.refers_to_revision);
  return (
    <article className="rounded-xl border border-brand bg-brand-tint p-4 sm:p-5">
      <p className="text-sm text-ink-muted">
        {feedback.published_at ? `Published ${formatDate(feedback.published_at, timeZone, true)}` : "Draft — not visible to your client"}
        {refersTo ? ` · about version ${refersTo.revision} of the answers` : ""}
      </p>
      {feedback.body ? <Paragraphs text={feedback.body} className="mt-2" /> : null}
      {feedback.next_steps.length ? (
        <div className="mt-4">
          <h4 className="font-semibold">Next steps</h4>
          <ul className="mt-2 space-y-2">
            {feedback.next_steps.map((s) => {
              const link = feedback.links.find((l) => l.step_key === s.key);
              const delivered = link ? versionLink(link.plan_version_id) : null;
              return (
                <li key={s.key} className="rounded-lg border border-line bg-surface p-3">
                  <p>{s.text}</p>
                  {s.kind === "plan_change" ? (
                    delivered ? (
                      <p className="mt-1 text-sm">
                        <StatusPill tone="good">Plan update published</StatusPill>{" "}
                        {delivered.href ? <Link href={delivered.href} className="text-brand underline underline-offset-4">{delivered.label}</Link> : delivered.label}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm"><StatusPill tone="warn">Plan change promised — not published yet</StatusPill></p>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {(planHref && planLabel) || conversationHref ? (
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
          {planHref && planLabel ? <Link href={planHref} className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">{planLabel}</Link> : null}
          {conversationHref ? <Link href={conversationHref} className="inline-flex min-h-11 items-center text-brand underline underline-offset-4">Follow up in messages</Link> : null}
        </p>
      ) : null}
      {later.length && feedback.published_at ? (
        <p className="mt-3 text-sm text-ink-muted">The answers were changed after this feedback (version {later.at(-1)!.revision}). This feedback still refers to version {feedback.refers_to_revision}.</p>
      ) : null}
    </article>
  );
}
