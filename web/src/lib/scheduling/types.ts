/**
 * Scheduling (M09) — shapes, labels and words shared by the screens, the
 * conversation cards and the server actions. Client-safe.
 *
 * Times are instants. A person always sees them in their own zone, with the
 * zone named, and the other person's local time alongside — the two people on
 * a meeting are usually in Nepal and in North America or Australia.
 */

export type AppointmentState = "held" | "booked" | "tentative" | "on_hold" | "cancelled" | "replaced" | "expired";
export type ProposalState = "pending" | "accepted" | "declined" | "countered" | "withdrawn" | "expired" | "conflicted";

export const APPOINTMENT_STATE_LABEL: Record<AppointmentState, string> = {
  held: "Held while paying",
  booked: "Confirmed",
  tentative: "Tentative — confirms when the next payment goes through",
  on_hold: "On hold",
  cancelled: "Cancelled",
  replaced: "Moved",
  expired: "Released",
};

export const PROPOSAL_STATE_LABEL: Record<ProposalState, string> = {
  pending: "Waiting for an answer",
  accepted: "Accepted",
  declined: "Declined",
  countered: "Another time was suggested",
  withdrawn: "Withdrawn",
  expired: "Expired — nobody answered in time",
  conflicted: "Couldn't be confirmed",
};

export const HOLD_REASON_LABEL: Record<string, string> = {
  payment_paused: "Coaching is paused until the payment is sorted. It comes back if the payment goes through and the time is still free.",
  payment_issue: "There's a problem with the payment for this session.",
  suspended: "An account involved is suspended. TalentYak support will be in touch.",
  conflict: "Something else is booked at this time. Suggest a new time or cancel it.",
};

export const OUTCOME_LABEL: Record<string, string> = {
  attended: "Took place",
  client_did_not_attend: "Client didn't attend",
  coach_did_not_attend: "Coach didn't attend",
  technical_failure: "Technical problem",
  other: "Something else",
};

/** The meeting lengths a coach can offer. */
export const DURATION_CHOICES = [15, 20, 30, 45, 60, 75, 90, 120];

export const WEEKDAY_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface ProposalCard {
  id: string;
  state: ProposalState;
  state_reason: string | null;
  proposer_role: "customer" | "coach";
  proposed_by: string | null;
  starts_at: string;
  duration_minutes: number;
  recurrence: "none" | "weekly";
  reference_timezone: string | null;
  replaces_appointment_id: string | null;
  series_scope: "this" | "future" | null;
  expires_at: string;
  resulting_appointment_id: string | null;
}

export const PROPOSAL_COLUMNS =
  "id, state, state_reason, proposer_role, proposed_by, starts_at, duration_minutes, recurrence, reference_timezone, replaces_appointment_id, series_scope, expires_at, resulting_appointment_id";

export interface AppointmentCard {
  id: string;
  kind: "coaching" | "consultation";
  state: AppointmentState;
  state_reason: string | null;
  starts_at: string;
  ends_at: string;
  provider_timezone: string;
  customer_timezone: string;
  series_id: string | null;
  time_note: string | null;
}

export const APPOINTMENT_COLUMNS =
  "id, kind, state, state_reason, starts_at, ends_at, provider_timezone, customer_timezone, series_id, time_note";

/** "Tue 14 Oct, 18:00 EDT" in a zone. */
export function whenIn(iso: string, timeZone: string | null | undefined): string {
  const zone = timeZone || "UTC";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short", timeZone: zone,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  }
}

/** The viewer's time first, the other person's local time after it, and whether it's a different day there. */
export function bothZones(iso: string, mine: string | null | undefined, theirs: string | null | undefined, theirLabel: string): string {
  const me = whenIn(iso, mine);
  if (!theirs || theirs === mine) return me;
  return `${me} · ${whenIn(iso, theirs)} for ${theirLabel}`;
}

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} hour${h === 1 ? "" : "s"}`;
}

/** The error codes the scheduling functions raise, in words a person can act on. */
export const SCHEDULE_ERRORS: Record<string, string> = {
  in_past: "That time has already passed.",
  too_soon: "That's sooner than your coach's notice period.",
  too_far_ahead: "That's further ahead than your coach takes bookings.",
  outside_availability: "That time is outside your coach's available hours.",
  daily_limit_reached: "Your coach is fully booked that day.",
  coach_busy: "The coach already has something at that time, including the gap they keep between meetings.",
  client_busy: "The client already has something at that time.",
  relationship_paused: "Coaching is paused until the payment is sorted, so new meetings can't be arranged.",
  relationship_not_live: "Meetings can't be arranged for this coaching right now.",
  after_plan_ends: "That time is after this plan ends.",
  not_paid: "This session hasn't been paid for.",
  suspended: "An account involved is suspended, so meetings can't be arranged.",
  invalid_duration: "Choose one of the meeting lengths your coach offers.",
  invalid_time: "Choose a date and time.",
  invalid_timezone: "Choose a time zone from the list.",
  not_reschedulable: "Only an upcoming meeting can be moved.",
  proposal_closed: "That suggestion has already been answered.",
  not_your_turn: "The other person answers this suggestion.",
  consultation_already_booked: "This session already has a time. Suggest a new time for it instead.",
  already_started: "A meeting that has started can't be cancelled. Record what happened instead.",
  not_yet: "An outcome can be recorded once a confirmed meeting has started.",
  slot_taken: "That time has just been taken. Choose another time.",
  slot_required: "Choose a time for the session first.",
  consultation_needs_duration: "This session doesn't say how long it is yet, so it can't be booked.",
  not_found: "That isn't available to you.",
  sign_in_required: "Sign in again to continue.",
  request_key_required: "Something went wrong. Refresh the page and try again.",
  admin_only: "Only an administrator with a verified second factor can do that.",
  reason_required: "Give a reason.",
};

export function scheduleError(message: string | undefined | null, fallback = "That didn't work. Please try again."): string {
  if (!message) return fallback;
  if (SCHEDULE_ERRORS[message]) return SCHEDULE_ERRORS[message];
  const code = Object.keys(SCHEDULE_ERRORS).find((k) => message.includes(k));
  return code ? SCHEDULE_ERRORS[code] : fallback;
}

/** Proposal outcomes (from accept) that need explaining. */
export const CONFLICT_REASON: Record<string, string> = {
  slot_taken: "Someone else booked that time first. Suggest another time.",
  coach_busy: "The coach already has something at that time now.",
  client_busy: "The client already has something at that time now.",
  allowance_used: "All the calls included in that period are already booked.",
  allowance_period_unpaid: "That date is outside a paid period, so it can't use one of the plan's calls yet.",
  original_changed: "The meeting it would replace has changed since.",
  relationship_paused: "Coaching is paused until the payment is sorted.",
  outside_availability: "That time is no longer inside the coach's hours.",
  in_past: "That time has passed.",
};
