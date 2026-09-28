import type { ReactNode } from "react";
import {
  DAY_NAMES,
  DAY_SHORT,
  loadText,
  prescription,
  safeUrl,
  seconds,
  type Alternative,
  type Exercise,
  type ExerciseCore,
  type Session,
  type WorkoutContent,
} from "@/lib/programmes/content";
import { paragraphs } from "@/lib/expectations/text";

/*
 * How a prescription reads. Shared by the client's plan, the coach's preview
 * and the version history, so what the coach previews is exactly what the
 * client gets. Everything the coach wrote is rendered as text; a demonstration
 * link is a link only when it is http(s), and always opens away from the site.
 */

export function Paragraphs({ text, className = "" }: { text: string; className?: string }) {
  if (!text) return null;
  return (
    <div className={`space-y-2 ${className}`}>
      {paragraphs(text).map((p, i) => (
        <p key={i} className="whitespace-pre-line">{p}</p>
      ))}
    </div>
  );
}

function DemoLink({ url, name }: { url: string; name: string }) {
  const safe = safeUrl(url);
  if (!safe) return null;
  let host = "";
  try {
    host = new URL(safe).hostname.replace(/^www\./, "");
  } catch {
    /* safeUrl already parsed it */
  }
  return (
    <p>
      <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-11 items-center font-semibold text-brand underline underline-offset-4">
        Watch a demonstration of {name}
        <span className="sr-only"> (opens {host || "another site"} in a new tab)</span>
      </a>
      {host ? <span className="text-sm text-ink-muted"> · {host}</span> : null}
    </p>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="font-semibold">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

function CoreDetails({ e }: { e: ExerciseCore }) {
  const rx = prescription(e);
  const load = loadText(e);
  return (
    <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
      {rx ? <Detail label="Do">{rx}</Detail> : null}
      {e.restSeconds !== null ? <Detail label="Rest">{e.restSeconds ? `${seconds(e.restSeconds)} between sets` : "No set rest"}</Detail> : null}
      {load ? <Detail label="Weight">{load}</Detail> : null}
      {e.effort ? <Detail label="Effort">{e.effort}</Detail> : null}
    </dl>
  );
}

function AlternativeCard({ a, index }: { a: Alternative; index: number }) {
  return (
    <li className="rounded-lg border border-line bg-paper-raised p-3">
      <p className="font-semibold">
        <span className="sr-only">Alternative {index + 1}: </span>
        {a.name}
        {prescription(a) ? <span className="font-normal text-ink-muted"> · {prescription(a)}</span> : null}
      </p>
      <div className="mt-2 space-y-2">
        <CoreDetails e={a} />
        <Paragraphs text={a.notes} />
        <DemoLink url={a.demoUrl} name={a.name} />
      </div>
    </li>
  );
}

export function ExerciseCard({ e, index }: { e: Exercise; index: number }) {
  const rx = prescription(e);
  return (
    <li className="rounded-xl border border-line bg-surface">
      <details className="group">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block font-semibold">
              <span className="text-ink-muted">{index + 1}. </span>
              {e.name}
            </span>
            <span className="block text-ink-muted">
              {[rx, loadText(e)].filter(Boolean).join(" · ") || "Details inside"}
              {e.alternatives.length ? ` · ${e.alternatives.length} alternative${e.alternatives.length === 1 ? "" : "s"}` : ""}
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-brand transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div className="space-y-3 border-t border-line px-4 py-4">
          <CoreDetails e={e} />
          {e.notes ? (
            <div>
              <p className="font-semibold">How to do it</p>
              <Paragraphs text={e.notes} className="mt-1" />
            </div>
          ) : null}
          {e.progression ? (
            <div>
              <p className="font-semibold">How to progress</p>
              <Paragraphs text={e.progression} className="mt-1" />
            </div>
          ) : null}
          <DemoLink url={e.demoUrl} name={e.name} />
          {e.alternatives.length ? (
            <div>
              <p className="font-semibold">If you can&rsquo;t do this one</p>
              <p className="text-sm text-ink-muted">Your coach&rsquo;s alternatives, each with its own instructions.</p>
              <ul className="mt-2 space-y-2">
                {e.alternatives.map((a, i) => <AlternativeCard key={a.key} a={a} index={i} />)}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
    </li>
  );
}

export function SessionCard({
  session,
  heading = "h3",
  badge,
  footer,
}: {
  session: Session;
  heading?: "h2" | "h3" | "h4";
  badge?: ReactNode;
  footer?: ReactNode;
}) {
  const H = heading;
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <H className="text-lg font-semibold">{session.title}</H>
        <span className="flex flex-wrap items-center gap-2 text-ink-muted">
          {session.minutes ? <span>About {session.minutes} min</span> : null}
          {badge}
        </span>
      </div>
      <Paragraphs text={session.notes} className="mt-2" />
      {session.exercises.length ? (
        <ol className="mt-3 space-y-2">
          {session.exercises.map((e, i) => <ExerciseCard key={e.key} e={e} index={i} />)}
        </ol>
      ) : (
        <p className="mt-2 text-ink-muted">No exercises listed — follow your coach&rsquo;s notes above.</p>
      )}
      {footer}
    </section>
  );
}

/** The plan as the coach wrote it: a Monday–Sunday template week, or sessions in order. */
export function PlanWeek({ content }: { content: WorkoutContent }) {
  return (
    <div className="space-y-4">
      <Paragraphs text={content.overview} />
      {content.schedule === "in_order" ? (
        <>
          <p className="rounded-lg border border-line-strong bg-paper-raised p-3">
            Do these sessions <strong>in order</strong>, one after another, on the days that suit you. After the last one, start again from the first.
          </p>
          <ol className="space-y-4">
            {content.sessions.map((s, i) => (
              <li key={s.key}>
                <SessionCard session={s} badge={<span className="font-semibold text-ink">Session {i + 1}</span>} />
              </li>
            ))}
          </ol>
        </>
      ) : (
        <ol className="space-y-3">
          {DAY_NAMES.map((name, day) => {
            const sessions = content.sessions.filter((s) => s.day === day);
            const rest = content.restNotes.find((r) => r.day === day)?.note;
            return (
              <li key={day}>
                <h3 className="font-semibold">{name}</h3>
                {sessions.length ? (
                  <div className="mt-2 space-y-3">
                    {sessions.map((s) => <SessionCard key={s.key} session={s} heading="h4" />)}
                  </div>
                ) : (
                  <p className="mt-1 rounded-lg border border-dashed border-line-strong px-4 py-3 text-ink-muted">
                    Rest day{rest ? <> — <span className="text-ink">{rest}</span></> : null}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** A compact Mon–Sun strip: which days train, which rest. */
export function WeekStrip({ content }: { content: WorkoutContent }) {
  if (content.schedule !== "weekly") return null;
  return (
    <ul className="grid grid-cols-7 gap-1 text-center text-sm" aria-label="Training days this week">
      {DAY_SHORT.map((d, day) => {
        const n = content.sessions.filter((s) => s.day === day).length;
        return (
          <li key={d} className={`rounded-md border px-1 py-2 ${n ? "border-brand bg-brand-tint font-semibold" : "border-line text-ink-muted"}`}>
            <span className="block">{d}</span>
            <span className="block">{n ? "Train" : "Rest"}</span>
          </li>
        );
      })}
    </ul>
  );
}
