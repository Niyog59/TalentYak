/**
 * Versions of the legal documents a person accepts at onboarding.
 *
 * These documents are DRAFTS. No lawyer has reviewed them, and nothing in this
 * codebase claims otherwise. Accepting a draft is recorded honestly as
 * accepting a draft, and live billing refuses to run while they are drafts
 * (see evaluateLiveReadiness). Changing a version sends every existing user
 * back through acceptance of the new text.
 */
export const CURRENT_LEGAL = {
  termsVersion: "terms.draft.2026-09",
  privacyVersion: "privacy.draft.2026-09",
  /** False until the founder and an adviser approve final text. */
  approved: false,
} as const;
