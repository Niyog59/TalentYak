import { commissionBasisPointsFor, getCommissionPolicy } from "@/lib/policy/registry";
import { splitCommission } from "@/lib/money/split";
import { money } from "@/lib/money/money";
import { formatMinor } from "@/lib/format";

/**
 * What a coach receives from one payment, computed by the same function the
 * ledger uses, under the commission policy that would govern the purchase.
 * Invariant 8: the coach is told their share, never left to work it out.
 */
export function EarningsPreview({
  amountMinor,
  currency,
  serviceType,
  commissionPolicyId,
  recurring,
}: {
  amountMinor: number;
  currency: string;
  serviceType: "recurring_coaching" | "one_off_consultation";
  commissionPolicyId: string;
  recurring: boolean;
}) {
  const policy = getCommissionPolicy(commissionPolicyId);
  const basisPoints = commissionBasisPointsFor(policy, serviceType);
  const split = splitCommission({ serviceAmount: money(amountMinor, currency), commissionBasisPoints: basisPoints });
  const percent = basisPoints / 100;

  return (
    <p className="text-sm">
      Client pays <strong>{formatMinor(split.customerPays.minor, currency)}</strong>
      {recurring ? " a month" : ""} · TalentYak keeps {percent}% ({formatMinor(split.platformCommission.minor, currency)}) ·{" "}
      <strong>you receive {formatMinor(split.coachEntitlement.minor, currency)}</strong>
      {recurring ? " a month" : ""}. Card fees come out of TalentYak&rsquo;s share, not yours. If tax is ever charged, it isn&rsquo;t part of either share.
    </p>
  );
}
