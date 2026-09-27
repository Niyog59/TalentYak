/**
 * Private calls (M10) — the time a session's room is open, and what a person
 * is told about it. Client-safe and pure, so the call screen and the tests
 * agree on exactly the same clock.
 *
 * The room opens a little before the start and closes a while after the
 * booked end. The booked end is shown but never enforced: a session that runs
 * over carries on until the room closes, with warnings first.
 */

export interface CallTimes {
  startsAt: string;
  endsAt: string;
  opensAt: string;
  closesAt: string;
}

export type CallPhase =
  /** Before the room opens. */
  | "before"
  /** The room is open; the session hasn't started. */
  | "open_early"
  /** Inside the booked time. */
  | "in_session"
  /** Past the booked end, the room still open. */
  | "overtime"
  /** The room has closed. */
  | "closed";

export interface CallClock {
  phase: CallPhase;
  /** Milliseconds until the room opens (before), the start (open_early), the booked end (in_session) or the room closes (overtime). */
  msToNext: number;
  msToClose: number;
  /** The warning currently due, in minutes before closing, or null. */
  warningMinutes: number | null;
  canJoin: boolean;
}

export function callClock(nowMs: number, t: CallTimes, warningMinutes: readonly number[] = [10, 2]): CallClock {
  const opens = Date.parse(t.opensAt);
  const starts = Date.parse(t.startsAt);
  const ends = Date.parse(t.endsAt);
  const closes = Date.parse(t.closesAt);
  const msToClose = closes - nowMs;

  let phase: CallPhase;
  let msToNext: number;
  if (nowMs >= closes) {
    phase = "closed";
    msToNext = 0;
  } else if (nowMs < opens) {
    phase = "before";
    msToNext = opens - nowMs;
  } else if (nowMs < starts) {
    phase = "open_early";
    msToNext = starts - nowMs;
  } else if (nowMs < ends) {
    phase = "in_session";
    msToNext = ends - nowMs;
  } else {
    phase = "overtime";
    msToNext = msToClose;
  }

  // The smallest threshold already reached, so the warning tightens as the
  // time runs down (10 minutes, then 2).
  let warning: number | null = null;
  if (phase !== "closed" && phase !== "before") {
    for (const w of [...warningMinutes].sort((a, b) => a - b)) {
      if (msToClose <= w * 60_000) {
        warning = w;
        break;
      }
    }
  }

  return { phase, msToNext, msToClose: Math.max(0, msToClose), warningMinutes: warning, canJoin: phase !== "before" && phase !== "closed" };
}

/** "2 h 5 min", "4 min", "less than a minute". Rounds up, so "0 min" is never shown. */
export function countdown(ms: number): string {
  if (ms < 60_000) return "less than a minute";
  const totalMin = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (h >= 48) return `${Math.round(h / 24)} days`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "18:45" in a zone. */
export function clockTime(iso: string, timeZone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timeZone || "UTC" }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(11, 16);
  }
}

/** Why a join was refused, in words a person can act on. */
export const JOIN_REFUSAL: Record<string, string> = {
  too_early: "The room isn't open yet.",
  closed: "The room for this session has closed.",
  not_booked: "This session isn't confirmed, so its call can't be joined.",
  relationship_paused: "Coaching is paused until the payment is sorted, so this call can't be joined.",
  relationship_not_live: "This coaching isn't active, so this call can't be joined.",
  not_paid: "This session hasn't been paid for, so its call can't be joined.",
  tentative: "This session is still tentative, so its call can't be joined yet.",
  after_plan_ends: "This session is after the plan ends, so its call can't be joined.",
  suspended: "An account involved is suspended. TalentYak support will be in touch.",
  coach_changed: "This session belongs to a coach who is no longer assigned, so its call can't be joined.",
  not_found: "That session isn't available to you.",
  rate_limited: "That's a lot of join attempts in a few minutes. Wait a moment and try again.",
  sign_in_required: "Sign in again to join.",
  provider_unconfigured: "Calls aren't switched on for this site yet.",
  provider_unavailable: "The call service isn't responding right now. This isn't anything you did.",
};

export function joinRefusal(reason: string | null | undefined): string {
  return (reason && JOIN_REFUSAL[reason]) || "The call couldn't be joined. Please try again.";
}
