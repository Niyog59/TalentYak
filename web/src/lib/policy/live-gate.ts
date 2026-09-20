/**
 * The live-billing gate.
 *
 * Test-mode completion is real progress and is reported as such. It is not
 * permission to charge a person. This gate is the one place that answers
 * "may we take real money right now?", it is enforced on the server, and it is
 * off unless every condition below is explicitly satisfied.
 *
 * Two independent locks, and both must open:
 *
 * 1. `LIVE_BILLING=true` must be set in the server environment.
 * 2. No policy still carrying `sandbox_default` status may be in the set the
 *    purchase would be written under.
 *
 * The second lock is the important one. It means a working default this
 * codebase invented — a cancellation rule, a payout schedule, a grace period —
 * cannot reach a customer merely because someone flipped an environment
 * variable. Approving a policy is an edit to the register, which is reviewable.
 */

import { CURRENT_LEGAL } from "@/lib/legal";
import { undeliverableInclusions, type OfferInclusions } from "@/lib/fulfillment";
import {
  type PolicySnapshot,
  currentPolicySnapshot,
  getPolicy,
} from "@/lib/policy/registry";

export interface LiveReadiness {
  readonly ready: boolean;
  /** Human-readable reasons live billing is refused. Empty when ready. */
  readonly blockers: readonly string[];
}

/** Whether the environment flag is set. Not sufficient on its own. */
export function isLiveBillingFlagSet(): boolean {
  return process.env.LIVE_BILLING === "true";
}

/**
 * Evaluates whether real money may be taken under a given policy set.
 * Defaults to the current set.
 */
export function evaluateLiveReadiness(
  snapshot: PolicySnapshot = currentPolicySnapshot(),
): LiveReadiness {
  const blockers: string[] = [];

  if (!isLiveBillingFlagSet()) {
    blockers.push(
      "LIVE_BILLING is not set to 'true' in the server environment. Billing is in sandbox mode.",
    );
  }

  for (const [field, id] of Object.entries(snapshot)) {
    const policy = getPolicy(id);
    if (policy.status === "sandbox_default") {
      blockers.push(
        `${field} resolves to ${policy.id}, which is a sandbox default awaiting founder approval${policy.note ? ` — ${policy.note}` : "."}`,
      );
    }
  }

  return { ready: blockers.length === 0, blockers };
}

export class LiveBillingNotPermittedError extends Error {
  readonly blockers: readonly string[];
  constructor(action: string, blockers: readonly string[]) {
    super(
      `Refusing to ${action}: live billing is not permitted.\n${blockers.map((b) => `  - ${b}`).join("\n")}`,
    );
    this.name = "LiveBillingNotPermittedError";
    this.blockers = blockers;
  }
}

/**
 * Guard for any code path that would move real money. Throws unless every
 * condition is satisfied. Call this on the server, before the provider call —
 * never rely on a hidden button.
 */
export function assertLiveBillingPermitted(
  action: string,
  snapshot: PolicySnapshot = currentPolicySnapshot(),
): void {
  const readiness = evaluateLiveReadiness(snapshot);
  if (!readiness.ready) {
    throw new LiveBillingNotPermittedError(action, readiness.blockers);
  }
}

// ---------------------------------------------------------------------------
// Selling a specific offer for real money
// ---------------------------------------------------------------------------


/**
 * Whether this particular offer may be sold for real money.
 *
 * Four independent locks, all required:
 *   1. LIVE_BILLING=true
 *   2. every active policy approved (no sandbox defaults)
 *   3. final, approved legal terms — not drafts
 *   4. everything the offer promises can actually be delivered
 *
 * Lock 4 is the one approvals cannot open. A commercial policy can be signed
 * off in an afternoon; a scheduled-call system cannot. Selling a weekly call
 * before calls work would take real money for a promise the product cannot keep.
 */
export function evaluateSaleReadiness(
  offer: OfferInclusions,
  snapshot: PolicySnapshot = currentPolicySnapshot(),
): LiveReadiness {
  const base = evaluateLiveReadiness(snapshot);
  const blockers = [...base.blockers];

  if (!CURRENT_LEGAL.approved) {
    blockers.push("Terms of service and privacy notice are drafts. Final, reviewed documents are required before taking real money.");
  }

  for (const missing of undeliverableInclusions(offer)) {
    blockers.push(`This offer depends on "${missing.label}", which is not built yet (${missing.module}).`);
  }

  return { ready: blockers.length === 0, blockers };
}
