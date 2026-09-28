import Link from "next/link";
import { ActionForm } from "@/components/form/action-form";
import { SubmitButton } from "@/components/form/fields";
import { StatusPill } from "@/components/ui/panel";
import { clearMarkAction, markHandledAction, snoozeTaskAction } from "@/lib/dashboard/actions";
import { SOURCE_LABEL, type SourceName } from "@/lib/dashboard/coach";
import { TASK_FILTERS, matchesFilter, timing, type CoachTask, type Queue, type TaskFilter } from "@/lib/dashboard/tasks";
import { formatDate } from "@/lib/format";

const KIND_LABEL: Record<CoachTask["kind"], string> = {
  checkin: "Check-in",
  message: "Message",
  booking: "Booking request",
  plan: "Plan",
};

/**
 * The coach's queue. Opening an item goes to the real record; nothing here
 * completes a review, answers a request or publishes a plan. Snoozing only
 * tidies this list, and an item that is due is shown whatever its snooze.
 */
export function TaskQueue({
  queue,
  filter,
  failed,
  marksFailed,
  nowMs,
  tz,
}: {
  queue: Queue;
  filter: TaskFilter;
  failed: SourceName[];
  marksFailed: boolean;
  nowMs: number;
  tz: string | null;
}) {
  const shown = queue.open.filter((t) => matchesFilter(t, filter));
  const incomplete = failed.length > 0;
  // A count is "or more" only where a source it counts couldn't be read.
  const SOURCES: Record<TaskFilter, SourceName[]> = {
    all: ["checkins", "messages", "bookings", "plans"],
    checkins: ["checkins"], rereview: ["checkins"], form: ["checkins"],
    messages: ["messages"], bookings: ["bookings"], plans: ["plans"],
  };
  const partial = (f: TaskFilter) => SOURCES[f].some((s) => failed.includes(s));
  return (
    <div>
      <nav aria-label="Filter tasks" className="relative -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {TASK_FILTERS.map((f) => (
          <Link
            key={f.id}
            href={f.id === "all" ? "/coach#attention" : `/coach?task=${f.id}#attention`}
            aria-current={filter === f.id ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${filter === f.id ? "border-brand bg-brand text-white" : "border-line-strong bg-surface hover:border-ink"}`}
          >
            {f.label}
            <span className={`tabular rounded-full px-1.5 ${filter === f.id ? "bg-white/20" : "bg-paper-raised"}`}>
              {queue.counts[f.id]}
              {partial(f.id) ? "+" : ""}
            </span>
            <span className="sr-only">{partial(f.id) ? " or more — some items couldn't be loaded" : ""}</span>
          </Link>
        ))}
      </nav>

      {incomplete ? (
        <p role="alert" className="mt-4 rounded-lg border border-line-strong bg-paper-raised p-3">
          Your {failed.map((f) => SOURCE_LABEL[f]).join(", ")} couldn&rsquo;t be loaded just now, so this list and its counts may be missing items. Refresh to try again, or open{" "}
          {failed.map((f, i) => (
            <span key={f}>
              {i ? ", " : ""}
              <Link className="font-semibold text-brand underline underline-offset-4" href={{ checkins: "/coach/check-ins", messages: "/coach/messages", bookings: "/coach/calendar", plans: "/coach/programmes" }[f]}>
                {SOURCE_LABEL[f]}
              </Link>
            </span>
          ))}{" "}
          directly.
        </p>
      ) : null}
      {marksFailed ? <p className="mt-3 text-sm text-ink-muted">Your snoozes couldn&rsquo;t be read, so everything is shown.</p> : null}

      {shown.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-line-strong p-5 text-center">
          {partial(filter) ? "Nothing else to show from what loaded." : filter === "all" ? "Nothing is waiting for you right now." : "Nothing of this kind is waiting for you."}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {shown.map((t) => (
            <TaskRow key={t.key} task={t} nowMs={nowMs} />
          ))}
        </ul>
      )}

      {queue.snoozed.length ? (
        <details className="mt-5">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand underline underline-offset-4">
            Snoozed ({queue.snoozed.length})
          </summary>
          <ul className="mt-2 divide-y divide-line">
            {queue.snoozed.map(({ task, until }) => (
              <li key={task.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link href={task.href} className="font-semibold underline-offset-4 hover:underline">{task.title}</Link>
                  <p className="text-sm text-ink-muted">Back {formatDate(until, tz, true)}{task.dueAt ? ` · deadline unchanged: ${formatDate(task.dueAt, tz, true)}` : ""}</p>
                </div>
                <ActionForm action={clearMarkAction}>
                  <input type="hidden" name="area" value="coach" />
                  <input type="hidden" name="item" value={task.key} />
                  <SubmitButton variant="quiet" pendingLabel="…">Show now</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {queue.handled.length ? (
        <details className="mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-brand underline underline-offset-4">
            Marked as needing no reply ({queue.handled.length})
          </summary>
          <p className="mt-1 text-sm text-ink-muted">They come back as soon as the client writes again.</p>
          <ul className="mt-2 divide-y divide-line">
            {queue.handled.map((t) => (
              <li key={t.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <Link href={t.href} className="font-semibold underline-offset-4 hover:underline">{t.clientName}</Link>
                <ActionForm action={clearMarkAction}>
                  <input type="hidden" name="area" value="coach" />
                  <input type="hidden" name="item" value={t.key} />
                  <SubmitButton variant="quiet" pendingLabel="…">Undo</SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function TaskRow({ task: t, nowMs }: { task: CoachTask; nowMs: number }) {
  const when = timing(t, nowMs);
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-muted">{KIND_LABEL[t.kind]}</p>
          <Link href={t.href} className="text-lg font-semibold underline-offset-4 hover:underline">
            {t.title}
          </Link>
          {t.detail ? <p className="text-ink-muted">{t.detail}</p> : null}
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {when.text ? <span className={when.overdue ? "font-semibold text-danger" : "text-ink-muted"}>{when.text}</span> : null}
            {t.rereview ? <StatusPill>Changed after your feedback</StatusPill> : null}
            {t.formReview ? <StatusPill tone="good">Form-check clip</StatusPill> : null}
            {t.afterPaidAccess ? <StatusPill>Coaching paused or ended — you can still finish this review</StatusPill> : null}
          </p>
        </div>
        <Link
          href={t.href}
          className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-brand px-4 font-semibold text-white hover:bg-brand-strong"
        >
          Open<span className="sr-only">: {t.title}</span>
        </Link>
      </div>
      {t.snoozable ? (
        <details className="mt-2">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-brand underline underline-offset-4">
            Not now<span className="sr-only">: {t.title}</span>
          </summary>
          <div className="mt-2 flex flex-wrap items-start gap-3">
            <ActionForm action={snoozeTaskAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="item" value={t.key} />
              <span className="text-sm">Snooze for</span>
              <SubmitButton variant="secondary" name="hours" value="4" pendingLabel="…">4 hours</SubmitButton>
              <SubmitButton variant="secondary" name="hours" value="24" pendingLabel="…">1 day</SubmitButton>
              <SubmitButton variant="secondary" name="hours" value="72" pendingLabel="…">3 days</SubmitButton>
            </ActionForm>
            {t.kind === "message" ? (
              <ActionForm action={markHandledAction}>
                <input type="hidden" name="item" value={t.key} />
                <SubmitButton variant="secondary" pendingLabel="Saving…">No reply needed</SubmitButton>
              </ActionForm>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {t.dueAt ? "The deadline doesn't move, and it's shown again once it's due. " : ""}
            This only tidies your list — {t.kind === "message" ? "the client isn't told anything." : "nothing is marked done."}
          </p>
        </details>
      ) : null}
    </li>
  );
}
