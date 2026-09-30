/**
 * Turns database refusals into words a person can act on.
 *
 * Our SQL functions raise with a machine-readable message ("coach_full") and a
 * human hint we wrote ourselves. Known codes show their hint. Anything else —
 * a constraint name, a Postgres internal — is replaced with a generic message,
 * because raw database errors describe the schema to whoever triggered them.
 */

export interface DbError {
  message?: string;
  hint?: string | null;
  code?: string;
  details?: string | null;
}

const KNOWN_CODES = new Set([
  "admin_mfa_required", "already_published", "already_subscribed", "amount_required",
  "batch_closed", "batch_not_found", "billing_structure_not_publishable", "billing_structure_not_sellable",
  "capacity_above_restriction", "capacity_below_commitments", "capacity_invalid", "coach_full",
  "coach_not_accepting", "coach_unavailable", "currency_not_offered", "destination_not_current",
  "effective_in_past", "evidence_required", "invalid_action", "invalid_channel", "invalid_currency",
  "invalid_decision", "invalid_history_scope", "invalid_reference", "invalid_state", "invalid_transition",
  "item_not_found", "mfa_required", "not_a_provider", "not_approved", "not_found", "not_owner",
  "not_refundable", "not_releasable", "not_retryable", "not_submittable", "offer_archived",
  "offer_not_found", "offer_unavailable", "offer_version_has_no_price", "own_offer", "paid_at_invalid",
  "profile_incomplete", "provider_inactive", "provider_not_approved", "provider_not_found",
  "publish_through_action", "reason_required", "reference_required", "refund_exceeds_payment",
  "relationship_ended", "request_already_open", "request_not_open", "same_coach", "self_review",
  "already_a_coach", "invalid_email", "invalid_timezone", "invitation_expired", "invitation_invalid",
  "invitation_used", "invitation_wrong_account", "policy_not_approved", "purchase_not_found",
  "expectations_changed", "expectations_missing",
  "slot_taken", "slot_required", "consultation_needs_duration",
  // M17: switches, the founder panel and coach changes.
  "feature_paused", "feature_policy_unresolved", "stale_setting", "invalid_mode", "no_change",
  "history_scope_exceeds_consent", "coach_not_eligible", "invalid_owner", "use_trusted_process",
  "use_coach_workflow", "invalid_range", "append_only", "not_applied",
  // M18: coach applications.
  "not_signed_in", "email_unconfirmed", "account_suspended", "invalid_application", "application_exists",
  "application_locked", "too_many_certificates", "signature_required",
]);

const GENERIC = "Something went wrong and nothing was saved. Please try again.";

export function friendlyError(error: DbError | null | undefined, fallback = GENERIC): string {
  if (!error) return fallback;
  if (error.message && KNOWN_CODES.has(error.message)) {
    return error.hint?.trim() || fallback;
  }
  return fallback;
}

export function errorCodeOf(error: DbError | null | undefined): string | null {
  return error?.message && KNOWN_CODES.has(error.message) ? error.message : null;
}
