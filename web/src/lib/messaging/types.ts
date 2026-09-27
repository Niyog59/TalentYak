/**
 * Shapes shared by the messaging server actions and the conversation screen.
 * Client-safe: no server imports.
 */

import type { AppointmentCard, ProposalCard } from "@/lib/scheduling/types";

export type ConversationRole = "customer" | "coach";
export type ConversationState = "active" | "paused" | "pending" | "ended" | "reassigned" | "suspended";

/**
 * Message kinds the database accepts. The structured ones are system messages
 * written by the database: `expectations_link` (Batch 3) points at one
 * presented welcome document; `appointment_proposal` and `appointment_link`
 * (Batch 4) are cards for a suggested time and a booked session. Only their
 * explicit buttons change the calendar — never a text message. An unknown kind
 * is shown as a neutral placeholder rather than a button that does nothing.
 */
export type MessageKind = "text" | "attachment" | "system" | "expectations_link" | "appointment_proposal" | "appointment_link";

/** Integrations recorded as pending, not built. None remain after Batch 4. */
export const PENDING_STRUCTURED_KINDS = [] as const;

export interface MessageAttachment {
  id: string;
  media_kind: "image" | "video";
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
}

export interface Message {
  id: string;
  seq: number;
  sender_profile_id: string | null;
  sender_role: "customer" | "coach" | "system";
  kind: MessageKind | string;
  body: string | null;
  client_message_id: string;
  created_at: string;
  /** Set only on an `expectations_link` message. */
  expectations_presentation_id: string | null;
  /** The suggestion an `appointment_proposal` card is about, as it is NOW. */
  proposal: ProposalCard | null;
  /** The session an `appointment_link` card is about, as it is NOW. */
  appointment: AppointmentCard | null;
  /** Null when there is none, or when the viewer may no longer see it. */
  attachment: MessageAttachment | null;
  has_attachment: boolean;
}

export interface WorkingHours {
  day: number;
  start: string;
  end: string;
}

export interface ConversationStatus {
  id: string;
  role: ConversationRole;
  state: ConversationState;
  can_send: boolean;
  reason: string | null;
  last_seq: number;
  my_last_read_seq: number;
  their_last_read_seq: number;
  client_name: string;
  coach_name: string;
  coach_timezone: string | null;
  working_hours: WorkingHours[];
  response_expectation: string | null;
  away_until: string | null;
  away_note: string | null;
  assigned_from: string;
  assigned_to: string | null;
  ended_at: string | null;
  paid_through: string | null;
  purchase_state: string | null;
}

export interface ConversationSummary {
  conversation_id: string;
  role: ConversationRole;
  state: ConversationState;
  can_send: boolean;
  other_name: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_mine: boolean | null;
  unread_count: number;
  assigned_from: string;
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

/** Database error codes → words a person can act on. */
export const SEND_ERRORS: Record<string, string> = {
  sign_in_required: "You've been signed out. Sign in again to send.",
  suspended: "Your account is paused, so messages can't be sent. Contact support.",
  not_found: "This conversation isn't available to you any more.",
  conversation_closed: "Messages can't be sent in this conversation right now.",
  too_long: "That message is too long. Split it into shorter messages.",
  empty: "Write a message or add a photo or clip first.",
  rate_limited: "You're sending messages very quickly. Wait a moment and try again.",
  attachment_not_ready: "That file isn't ready yet, or it couldn't be processed. Nothing was sent.",
  attachment_used: "That file has already been sent.",
  client_id_reused: "Something went wrong sending that. Try writing it again.",
};

export function errorCode(message: string | undefined | null): string {
  if (!message) return "unknown";
  const known = Object.keys(SEND_ERRORS).find((code) => message.includes(code));
  return known ?? "unknown";
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
