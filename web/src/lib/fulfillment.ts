/**
 * What TalentYak can actually deliver today.
 *
 * Selling something is a promise to deliver it. An offer may include a weekly
 * call, a programme, check-ins, messaging, form review — and each of those
 * needs a working part of the product behind it. This register says honestly
 * which parts exist. Live billing refuses to sell an offer that includes
 * anything marked not ready, however the commercial policies are set.
 *
 * Changing a value here to `true` is a claim that the feature works end to end
 * for a paying customer. It is not a setting to flip to make a sale go through.
 */

export interface FulfillmentCapability {
  ready: boolean;
  /** The module that will deliver it. */
  module: string;
  label: string;
}

export const FULFILLMENT = {
  programme: { ready: true, module: "M11", label: "Coach-written training programmes" },
  calls: { ready: false, module: "M09/M10", label: "Scheduled video and audio calls" },
  checkIns: { ready: true, module: "M13", label: "Structured check-ins" },
  messaging: { ready: true, module: "M14", label: "In-app messaging" },
  formReview: { ready: false, module: "M12", label: "Exercise form review" },
  progressTracking: { ready: true, module: "M12", label: "Workout, weight and measurement tracking" },
} as const satisfies Record<string, FulfillmentCapability>;

export interface OfferInclusions {
  programme_included?: boolean | null;
  calls_included_per_month?: number | null;
  check_in_cadence?: string | null;
  messaging_channel?: string | null;
  form_review_included?: boolean | null;
}

/** Every capability this offer promises that cannot yet be delivered. */
export function undeliverableInclusions(offer: OfferInclusions): FulfillmentCapability[] {
  const missing: FulfillmentCapability[] = [];
  if (offer.programme_included && !FULFILLMENT.programme.ready) missing.push(FULFILLMENT.programme);
  if ((offer.calls_included_per_month ?? 0) > 0 && !FULFILLMENT.calls.ready) missing.push(FULFILLMENT.calls);
  if (offer.check_in_cadence && !FULFILLMENT.checkIns.ready) missing.push(FULFILLMENT.checkIns);
  if (offer.messaging_channel === "in_app" && !FULFILLMENT.messaging.ready) missing.push(FULFILLMENT.messaging);
  if (offer.form_review_included && !FULFILLMENT.formReview.ready) missing.push(FULFILLMENT.formReview);
  // Every coaching offer depends on the tracking the coach coaches from.
  if (!FULFILLMENT.progressTracking.ready) missing.push(FULFILLMENT.progressTracking);
  return missing;
}
