import "server-only";
import { stripeMode } from "@/lib/payments/stripe";

/**
 * Says plainly that this is a test site.
 *
 * Shown on every public page whenever payments are not in live mode, which is
 * exactly the condition under which nobody should mistake this for the real
 * service. It is not a decoration and it is not dismissible: a person who lands
 * on a deployment of an unfinished product should be told before they read a
 * coach's profile or start a checkout.
 */
export function TestSiteBanner() {
  if (stripeMode() === "live") return null;

  return (
    <p className="border-b border-line-strong bg-paper-raised px-4 py-2 text-center text-sm">
      <strong>Test site.</strong> TalentYak isn&rsquo;t open yet and takes no real payments — anything bought here is a
      test with a test card.
    </p>
  );
}
