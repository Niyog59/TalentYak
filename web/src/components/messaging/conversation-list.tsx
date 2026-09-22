import Link from "next/link";
import type { ConversationSummary } from "@/lib/messaging/types";

const STATE_LABEL: Record<string, string> = {
  active: "",
  paused: "Paused — payment needed",
  pending: "Not started",
  ended: "Ended",
  reassigned: "Previous coach",
  suspended: "Unavailable",
};

function when(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone }).format(d) === new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  return new Intl.DateTimeFormat("en-GB", sameDay ? { timeZone, hour: "2-digit", minute: "2-digit" } : { timeZone, day: "numeric", month: "short" }).format(d);
}

/** A list of conversations, newest activity first, with unread counts. */
export function ConversationList({
  conversations,
  hrefBase,
  timeZone,
}: {
  conversations: ConversationSummary[];
  hrefBase: string;
  timeZone: string;
}) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {conversations.map((c) => (
        <li key={c.conversation_id}>
          <Link href={`${hrefBase}/${c.conversation_id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-paper-raised">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-2">
                <span className={`truncate ${c.unread_count ? "font-bold" : "font-semibold"}`}>{c.other_name}</span>
                {STATE_LABEL[c.state] ? (
                  <span className="rounded-full bg-paper-raised px-2 py-0.5 text-xs font-semibold text-ink-muted">{STATE_LABEL[c.state]}</span>
                ) : null}
              </p>
              <p className="truncate text-sm text-ink-muted">
                {c.last_message_preview ? `${c.last_message_mine ? "You: " : ""}${c.last_message_preview}` : "No messages yet"}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs text-ink-muted">{when(c.last_message_at, timeZone)}</p>
              {c.unread_count ? (
                <p className="mt-1 inline-block rounded-full bg-brand px-2 text-sm font-semibold text-white">
                  {c.unread_count}
                  <span className="sr-only"> unread</span>
                </p>
              ) : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
