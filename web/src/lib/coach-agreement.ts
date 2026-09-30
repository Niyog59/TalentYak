import { formatMoney } from "@/lib/format";
import { money } from "@/lib/money/money";
import {
  commissionBasisPointsFor,
  currentCommissionPolicy,
  currentPolicySnapshot,
  getPolicy,
  previewEarnings,
  type PayoutPolicy,
} from "@/lib/policy";

/**
 * The coach agreement an accepted applicant reads and signs.
 *
 * THIS IS A DRAFT. It was written from the founder's confirmed decisions
 * (docs/aafnai/DECISION_REGISTER.md §K, §L) and has not been reviewed by a
 * lawyer. Signing it is recorded honestly as signing this draft version, the
 * same way the draft terms and privacy notice are (lib/legal.ts). Anything the
 * founder has not decided is listed under "Still being confirmed", never
 * written in as if it were settled.
 *
 * Every rate and date is READ from the policy register — never typed here —
 * so the agreement and the ledger cannot drift apart (invariant 8).
 *
 * Changing the wording means a new version string. A coach who signed an
 * earlier version keeps that record.
 */

export const COACH_AGREEMENT_VERSION = "coach-agreement.draft.2026-09";

/** False until the founder and an adviser approve final text. */
export const COACH_AGREEMENT_APPROVED = false;

export interface AgreementSection {
  heading: string;
  points: string[];
}

export interface CoachAgreement {
  version: string;
  approved: boolean;
  sections: AgreementSection[];
  stillBeingConfirmed: string[];
}

const percent = (basisPoints: number) => `${basisPoints / 100}%`;

function ordinal(n: number): string {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** The commercial figures, for the welcome page and the agreement alike. */
export function coachTerms() {
  const commission = currentCommissionPolicy();
  const ongoing = commissionBasisPointsFor(commission, "recurring_coaching");
  const oneOff = commissionBasisPointsFor(commission, "one_off_consultation");
  const payout = getPolicy(currentPolicySnapshot().payoutPolicyId) as PayoutPolicy;
  const example = previewEarnings({ price: money(10_000, "USD"), serviceType: "recurring_coaching" });
  return {
    ongoingCommission: percent(ongoing),
    ongoingCoachShare: percent(10_000 - ongoing),
    oneOffCommission: percent(oneOff),
    oneOffCoachShare: percent(10_000 - oneOff),
    payoutByDay: payout.batchPreparedByDayOfMonth,
    automatedTransfers: payout.automatedTransfersEnabled,
    example: {
      price: formatMoney(example.customerPays.minor, example.customerPays.currency),
      coach: formatMoney(example.coachShare.minor, example.coachShare.currency),
      platform: formatMoney(example.platformCommission.minor, example.platformCommission.currency),
    },
  };
}

export function coachAgreement(): CoachAgreement {
  const t = coachTerms();
  return {
    version: COACH_AGREEMENT_VERSION,
    approved: COACH_AGREEMENT_APPROVED,
    sections: [
      {
        heading: "1. Who we each are",
        points: [
          "You coach as an independent contractor, not as an employee of TalentYak. You decide how, when and where you do your work, within what you have promised your clients.",
          "Customers buy coaching from TalentYak and choose you as their coach. You deliver that coaching.",
          "TalentYak finds and signs up customers, takes payment, runs the website and app, provides customer support, and handles requests to change coach.",
        ],
      },
      {
        heading: "2. Your coaching, your decisions",
        points: [
          "You create your own plans, decide what each one includes and set your own prices. TalentYak does not impose a standard package and does not approve your prices.",
          "You write your clients' programmes and decide when to change them. TalentYak does not approve workouts.",
          "You choose how many clients you take and when you accept new ones.",
        ],
      },
      {
        heading: "3. What you agree to do",
        points: [
          "Deliver the coaching each plan says it includes, and keep any response times you publish.",
          "Keep your profile truthful: only qualifications you actually hold, only experience you actually have. Tell TalentYak if a qualification lapses or is withdrawn.",
          "Coach fitness and healthy habits only. Don't diagnose, treat or give medical advice. When a client reports pain, injury, a medical condition, pregnancy, disordered eating or anything else outside safe coaching, pause the relevant training and ask them to see a qualified healthcare professional.",
          "Keep clients' information private. Progress photos, measurements, health details and messages are used only to coach that client, and never shared, posted or kept outside TalentYak.",
          "Treat clients with respect. No harassment, discrimination or pressure to buy.",
          "Work with clients TalentYak has sold coaching to through TalentYak, and take payment for that coaching only through TalentYak.",
        ],
      },
      {
        heading: "4. What you earn",
        points: [
          `For ongoing coaching (including multi-month packages paid upfront) you receive ${t.ongoingCoachShare} and TalentYak keeps ${t.ongoingCommission}.`,
          `For one-off consultations you receive ${t.oneOffCoachShare} and TalentYak keeps ${t.oneOffCommission}.`,
          `This is worked out on the coaching amount, not including separately collected taxes. For example, on a ${t.example.price} monthly plan you receive ${t.example.coach} and TalentYak keeps ${t.example.platform}. TalentYak's share is rounded to the currency's smallest unit (such as a cent) first, and you receive the exact remainder.`,
          "There is no separate fee charged to customers on top of your price.",
          "TalentYak pays ordinary card-processing and payout fees out of its own share. They are not taken from yours.",
          "A discount TalentYak pays for never reduces what you earn. A discount you pay for only happens if you agree to it first.",
          "If a customer is refunded, the refunded amount and TalentYak's share of it are both reversed, and the change is recorded as a new entry you can see.",
          "The rate that applied when a customer bought your coaching stays with that purchase. A later change to TalentYak's rates does not change what you are owed for it.",
        ],
      },
      {
        heading: "5. When you are paid",
        points: [
          `Monthly, after the coaching is delivered. By the ${ordinal(t.payoutByDay)} day of each month, you are paid for coaching you delivered up to the end of the previous month.`,
          "A customer paying doesn't make the whole amount payable at once. A package paid upfront is paid out month by month as you deliver it.",
          "Your earnings, what is waiting to be paid and what has been paid are shown in your coach area.",
          t.automatedTransfers
            ? "Payouts are sent to the payout details you give and TalentYak checks."
            : "Until the payment route to Nepal is confirmed, payouts are made and recorded by hand, with evidence of each transfer.",
        ],
      },
      {
        heading: "6. Before you can take clients",
        points: [
          "Signing this agreement sets up your coach account. It does not make you visible to customers yet.",
          "You then complete your profile, plans and prices, availability and payout details, and send them for review.",
          "TalentYak gives final approval before you can publish your profile and take clients. Being approved doesn't guarantee you any clients.",
        ],
      },
      {
        heading: "7. Changes and ending",
        points: [
          "If TalentYak changes this agreement, you'll be shown the new version and asked to accept it. The version you signed is kept on record.",
          "TalentYak can pause or end your coach account if you break this agreement or put a client at risk. Customers already paying are looked after through support and the coach-change process.",
        ],
      },
    ],
    stillBeingConfirmed: [
      "How payouts reach you in Nepal, and the exact transfer and currency costs.",
      "How much notice you or TalentYak must give to stop coaching, and what happens to clients part-way through a paid period.",
      "Cancellation and refund rules for packages paid upfront (these packages stay switched off until they are decided).",
      "Final legal review of this agreement.",
    ],
  };
}
