/*
 * What a check-in's state means to each person. Pure.
 *
 * The client's flow is four steps — answer, send, waiting for feedback,
 * feedback received — plus "sent again" when a correction reopened it. A
 * missed check-in is described plainly and never counted against anyone.
 */

export type CheckinStatus = "open" | "submitted" | "reviewed" | "reopened" | "missed" | "cancelled";

export interface CheckinRow {
  id: string;
  enrollment_id: string;
  period_start: string;
  period_end: string;
  due_at: string;
  timezone: string;
  status: CheckinStatus;
  status_reason: string | null;
  first_submitted_at: string | null;
  last_submitted_at: string | null;
  current_revision: number;
  review_revision: number | null;
  needs_resolution: string | null;
  completed_at: string | null;
  responsible_provider_id: string;
  template_version_id: string;
  created_at: string;
}

export type ClientStage =
  | "awaiting_submission"
  | "draft"
  | "awaiting_feedback"
  | "feedback_received"
  | "reopened"
  | "missed"
  | "closed";

export const CLIENT_STAGE_LABEL: Record<ClientStage, string> = {
  awaiting_submission: "Ready for you",
  draft: "Draft saved",
  awaiting_feedback: "Sent — waiting for feedback",
  feedback_received: "Feedback received",
  reopened: "Updated — your coach will take another look",
  missed: "Not sent",
  closed: "Closed",
};

/**
 * `feedbackCoversLatest`: published feedback exists for the latest version
 * the coach must review.
 */
export function clientStage(c: Pick<CheckinRow, "status">, hasDraft: boolean, feedbackCoversLatest: boolean, anyFeedback: boolean): ClientStage {
  switch (c.status) {
    case "open":
      return hasDraft ? "draft" : "awaiting_submission";
    case "submitted":
      return feedbackCoversLatest ? "feedback_received" : "awaiting_feedback";
    case "reviewed":
      return "feedback_received";
    case "reopened":
      return feedbackCoversLatest ? "feedback_received" : anyFeedback ? "reopened" : "awaiting_feedback";
    case "missed":
      return "missed";
    default:
      return "closed";
  }
}

export const CLOSED_REASON: Record<string, string> = {
  schedule_paused: "Check-ins were paused before this one was started.",
  planned_break: "This fell inside a planned break.",
  coach_changed: "Your coach changed before this was sent. Your new coach will set up check-ins with you.",
  closed_after_coach_change: "Closed after your coach changed. You can share anything important in your next check-in or in messages.",
  next_period_began: "The next check-in began before this one was started. Nothing is lost, and it doesn't count against you.",
};

export type CoachGroup = "awaiting" | "overdue" | "feedback_sent" | "reopened" | "reviewed";

export const COACH_GROUP_LABEL: Record<CoachGroup, string> = {
  awaiting: "Awaiting your review",
  overdue: "Past your stated reply time",
  feedback_sent: "Feedback sent — not marked complete",
  reopened: "Reopened by a correction",
  reviewed: "Reviewed",
};

export function coachGroup(
  row: { status: CheckinStatus; feedback_published: boolean; review_due: string | null },
  now: Date,
): CoachGroup {
  if (row.status === "reviewed") return "reviewed";
  if (row.feedback_published) return "feedback_sent";
  if (row.status === "reopened") return "reopened";
  if (row.review_due && Date.parse(row.review_due) < now.getTime()) return "overdue";
  return "awaiting";
}

/** A submission after the due time is late — shown as a fact, never a failure. */
export function wasLate(c: Pick<CheckinRow, "due_at" | "first_submitted_at">): boolean {
  return Boolean(c.first_submitted_at && Date.parse(c.first_submitted_at) > Date.parse(c.due_at));
}

const MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "22–28 Sep", "29 Sep – 5 Oct", with the year when it spans two. */
export function periodLabel(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  if (from === to) return MONTH_YEAR.format(b);
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${MONTH_YEAR.format(a)} – ${MONTH_YEAR.format(b)}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}–${MONTH_YEAR.format(b)}`;
  return `${MONTH.format(a)} – ${MONTH_YEAR.format(b)}`;
}

export const DAY_NAMES_ISO = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export function cadenceLabel(intervalWeeks: number, weekday: number, time: string): string {
  const every = intervalWeeks === 1 ? "Every week" : intervalWeeks === 2 ? "Every two weeks" : "Every four weeks";
  return `${every}, due ${DAY_NAMES_ISO[weekday] ?? ""} at ${time.slice(0, 5)}`;
}
