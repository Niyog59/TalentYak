/*
 * The coach's "who needs my attention?" queue, and the client's notices.
 * Pure: the dashboards, the tests and nothing else.
 *
 * Every task is derived from the record it is about — a check-in waiting for
 * feedback, a client message nobody has answered, a booking request, a plan
 * not yet written — so it disappears when that record changes, never because
 * someone opened it. A person's own marks only change what THEY see:
 *
 *   · snoozed   hidden until the snooze ends, or until the item falls due,
 *               whichever is first. An item that is due or overdue is always
 *               shown, snoozed or not, and its deadline is never moved.
 *   · handled   only for a conversation that needs no reply; it covers the
 *               client's messages up to that point, so a new message brings
 *               the conversation straight back.
 *   · dismissed only for a client's notices; never acknowledges or accepts
 *               anything, and never hides a step they still need to take.
 */

export type TaskKind = "checkin" | "message" | "booking" | "plan";

export type TaskFilter = "all" | "checkins" | "rereview" | "form" | "messages" | "bookings" | "plans";

export const TASK_FILTERS: { id: TaskFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "checkins", label: "Check-ins" },
  { id: "rereview", label: "Updated check-ins" },
  { id: "form", label: "Form checks" },
  { id: "messages", label: "Messages" },
  { id: "bookings", label: "Booking requests" },
  { id: "plans", label: "Plans" },
];

export interface CoachTask {
  /** Also the mark key: `checkin:<id>`, `msg:<id>`, `proposal:<id>`, `plan:<enrollment id>`. */
  key: string;
  kind: TaskKind;
  enrollmentId: string | null;
  clientName: string;
  title: string;
  detail: string | null;
  href: string;
  /** A deadline someone was promised, or a request's expiry. Never moved by a mark. */
  dueAt: string | null;
  /** What "due" means for this item, for the label. */
  dueLabel: "reply_by" | "expires" | null;
  /** When the thing started waiting for the coach. */
  since: string | null;
  /** A check-in the client changed substantively after feedback. */
  rereview?: boolean;
  /** A check-in carrying a form-check clip the coach may watch. */
  formReview?: boolean;
  /** Paid access has ended; finishing this review is the approved exception. */
  afterPaidAccess?: boolean;
  /** For conversations: the client's latest message, and unread messages. */
  lastClientSeq?: number;
  unread?: number;
  snoozable: boolean;
}

export interface Mark {
  item_key: string;
  action: "snoozed" | "handled" | "dismissed";
  snoozed_until: string | null;
  through_seq: number | null;
}

export function matchesFilter(t: CoachTask, f: TaskFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "checkins":
      return t.kind === "checkin";
    case "rereview":
      return t.kind === "checkin" && Boolean(t.rereview);
    case "form":
      return t.kind === "checkin" && Boolean(t.formReview);
    case "messages":
      return t.kind === "message";
    case "bookings":
      return t.kind === "booking";
    case "plans":
      return t.kind === "plan";
  }
}

export function isFilter(v: unknown): v is TaskFilter {
  return TASK_FILTERS.some((f) => f.id === v);
}

export const isDue = (t: Pick<CoachTask, "dueAt">, nowMs: number) => t.dueAt !== null && Date.parse(t.dueAt) <= nowMs;

export interface Queue {
  /** Shown now: overdue first, then by deadline, then longest waiting. */
  open: CoachTask[];
  /** Snoozed and not yet due, with when they come back. */
  snoozed: { task: CoachTask; until: string }[];
  /** Conversations marked as needing no reply (until the client writes again). */
  handled: CoachTask[];
  /** Per filter, counted over `open` — the list a filter shows is exactly its count. */
  counts: Record<TaskFilter, number>;
}

export function buildQueue(tasks: CoachTask[], marks: Mark[], nowMs: number): Queue {
  const byKey = new Map(marks.map((m) => [m.item_key, m]));
  const open: CoachTask[] = [];
  const snoozed: Queue["snoozed"] = [];
  const handled: CoachTask[] = [];
  for (const t of tasks) {
    const m = byKey.get(t.key);
    if (m?.action === "handled" && t.kind === "message" && m.through_seq !== null && (t.lastClientSeq ?? 0) <= m.through_seq) {
      handled.push(t);
      continue;
    }
    if (m?.action === "snoozed" && m.snoozed_until && t.snoozable && Date.parse(m.snoozed_until) > nowMs && !isDue(t, nowMs)) {
      // Back at the end of the snooze or when it falls due, whichever is first.
      const back = t.dueAt && Date.parse(t.dueAt) < Date.parse(m.snoozed_until) ? t.dueAt : m.snoozed_until;
      snoozed.push({ task: t, until: back });
      continue;
    }
    open.push(t);
  }
  open.sort((a, b) => {
    const ad = isDue(a, nowMs) ? 0 : 1;
    const bd = isDue(b, nowMs) ? 0 : 1;
    if (ad !== bd) return ad - bd;
    if (a.dueAt && b.dueAt && a.dueAt !== b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    if (a.dueAt && !b.dueAt) return -1;
    if (!a.dueAt && b.dueAt) return 1;
    return (a.since ?? "9").localeCompare(b.since ?? "9");
  });
  snoozed.sort((a, b) => a.until.localeCompare(b.until));
  const counts = Object.fromEntries(TASK_FILTERS.map((f) => [f.id, open.filter((t) => matchesFilter(t, f.id)).length])) as Record<TaskFilter, number>;
  return { open, snoozed, handled, counts };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** "3 days", "5 hours", "20 minutes", "a moment". Always rounded down. */
export function span(ms: number): string {
  const m = Math.floor(Math.abs(ms) / 60_000);
  if (m < 1) return "a moment";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/** "Waiting 2 days", "Reply by … (in 5 hours)", "Past your reply time by 1 day". */
export function timing(t: Pick<CoachTask, "dueAt" | "dueLabel" | "since">, nowMs: number): { text: string; overdue: boolean } {
  if (t.dueAt) {
    const d = Date.parse(t.dueAt) - nowMs;
    if (t.dueLabel === "expires") {
      return d <= 0 ? { text: "This request has expired", overdue: true } : { text: `Expires in ${span(d)}`, overdue: false };
    }
    return d <= 0 ? { text: `Past your reply time by ${span(d)}`, overdue: true } : { text: `Your reply time ends in ${span(d)}`, overdue: false };
  }
  if (t.since) return { text: `Waiting ${span(nowMs - Date.parse(t.since))}`, overdue: false };
  return { text: "", overdue: false };
}

/** Factual last activity: "Logged a workout 2 days ago" — never a judgement. */
export function ago(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const ms = nowMs - Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (iso.length === 10) {
    const days = Math.round(ms / 86_400_000);
    return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  }
  return ms < 60_000 ? "just now" : `${span(ms)} ago`;
}

// ---------------------------------------------------------------------------
// The client's notices
// ---------------------------------------------------------------------------

export interface ClientNotice {
  key: string;
  enrollmentId: string;
  coachName: string;
  title: string;
  detail: string | null;
  href: string;
  at: string;
  /** Still needs something from the client (e.g. an acknowledgement they were asked for). */
  actionNeeded: boolean;
}

/**
 * Dismissing a notice hides the notice — but one that still needs something
 * from the client stays, because hiding it would hide the step itself.
 */
export function visibleNotices(notices: ClientNotice[], marks: Mark[]): ClientNotice[] {
  const dismissed = new Set(marks.filter((m) => m.action === "dismissed").map((m) => m.item_key));
  return notices.filter((n) => n.actionNeeded || !dismissed.has(n.key)).sort((a, b) => b.at.localeCompare(a.at));
}

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

export interface BalanceRow {
  currency: string;
  pending_minor: number | string | null;
  held_minor: number | string | null;
  eligible_minor: number | string | null;
  batched_minor: number | string | null;
  paid_minor: number | string | null;
}

/**
 * One row per currency, never a total across currencies: there is no
 * approved conversion rule, so adding NPR to USD would be a made-up number.
 */
export function earningsByCurrency(rows: BalanceRow[]): { currency: string; earnedUnpaid: number; pending: number; held: number; ready: number; inPayout: number; paid: number }[] {
  const n = (v: number | string | null) => Number(v ?? 0);
  return rows
    .map((r) => ({
      currency: r.currency,
      pending: n(r.pending_minor),
      held: n(r.held_minor),
      ready: n(r.eligible_minor),
      inPayout: n(r.batched_minor),
      paid: n(r.paid_minor),
      // Earned (the coaching it pays for was delivered) but not yet paid out:
      // ready to be paid, or already in a payout being prepared. Paid is its
      // own figure, counted only once a transfer is recorded as sent.
      earnedUnpaid: n(r.eligible_minor) + n(r.batched_minor),
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}
