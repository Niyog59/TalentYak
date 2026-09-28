import Link from "next/link";
import { formatDate } from "@/lib/format";
import type { ReviewExpectation } from "@/lib/checkins/server";

/*
 * When a reply can be expected: only ever the coach's own published words
 * and working days. With no stated review time, nothing is promised. When the
 * coach is away, the expectation moves past their return and the support
 * route is offered, so no one is left waiting on a date that no longer holds.
 */

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ExpectationNote({ e, viewer, timeZone, supportHref }: { e: ReviewExpectation; viewer: "client" | "coach"; timeZone: string | null; supportHref: string }) {
  const days = [...new Set(e.working_hours.map((h) => h.day))].sort().map((d) => DAY[d]).join(", ");
  const who = viewer === "client" ? e.coach_name : "You";
  return (
    <div className={`mt-4 rounded-lg border p-4 ${e.away_until ? "border-danger bg-danger-tint" : "border-line-strong bg-paper-raised"}`} role={e.away_until ? "alert" : "note"}>
      {e.away_until ? (
        <p className="font-semibold">
          {viewer === "client" ? `${e.coach_name} is away until ${formatDate(e.away_until, timeZone)}.` : `You're marked away until ${formatDate(e.away_until, timeZone)}.`}
          {e.away_note ? ` “${e.away_note}”` : ""}
        </p>
      ) : null}
      {e.review_due ? (
        <p className={e.away_until ? "mt-1" : ""}>
          {viewer === "client" ? "Expect feedback by" : "Your stated reply time: by"} <strong>{formatDate(e.review_due, timeZone, true)}</strong>
          {" "}— {e.response_days} working {e.response_days === 1 ? "day" : "days"}{days ? ` (${days}, ${e.coach_timezone ?? "coach's time"})` : ""}{e.away_until ? ", counted from their return" : ""}.
        </p>
      ) : (
        <p className={e.away_until ? "mt-1" : ""}>
          {who} {viewer === "client" ? "hasn't" : "haven't"} set a reply time for check-ins{e.response_expectation ? `. ${viewer === "client" ? "Their" : "Your"} usual reply time: “${e.response_expectation}”` : ""}. TalentYak doesn&rsquo;t set one on {viewer === "client" ? "a coach's" : "your"} behalf.
        </p>
      )}
      {viewer === "client" ? (
        <p className="mt-2 text-sm">
          Waiting longer than expected? <Link href={supportHref} className="text-brand underline underline-offset-4">Contact TalentYak support</Link> — we can check in with your coach.
        </p>
      ) : null}
      {e.may_finish_after_paid_time && viewer === "coach" ? (
        <p className="mt-2 text-sm">This client&rsquo;s paid time has run out. You can still finish this review because it was sent while coaching was paid; new check-ins, messages and plan changes wait until they renew.</p>
      ) : null}
      {e.may_finish_after_paid_time && viewer === "client" ? (
        <p className="mt-2 text-sm">Your coach can still reply to this check-in because you sent it while coaching was paid.</p>
      ) : null}
    </div>
  );
}
