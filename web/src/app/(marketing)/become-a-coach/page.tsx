import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { formatMoney } from "@/lib/format";
import { money } from "@/lib/money/money";
import {
  commissionBasisPointsFor,
  currentCommissionPolicy,
  previewEarnings,
} from "@/lib/policy";

export const metadata: Metadata = {
  title: "Become a coach",
  description:
    "Coach on TalentYak: set your own plans and prices, make the training decisions, and get paid monthly for coaching you deliver.",
};

/*
 * Every term on this page is a confirmed founder decision. Anything not yet
 * decided is labelled as such. There is no application form: applications are
 * not open.
 *
 * The shares below are READ FROM the policy register, never typed in. Invariant
 * 8 says payout economics are disclosed by us and never discovered — and a
 * percentage hardcoded into a marketing page is exactly how the page and the
 * ledger quietly drift apart until a coach finds the difference themselves.
 */

const commissionPolicy = currentCommissionPolicy();

const percent = (basisPoints: number) => `${basisPoints / 100}%`;

const shares = [
  {
    label: "Ongoing coaching",
    detail: "Including multi-month packages paid upfront",
    coachPercent: percent(
      10_000 - commissionBasisPointsFor(commissionPolicy, "recurring_coaching"),
    ),
    platformPercent: percent(
      commissionBasisPointsFor(commissionPolicy, "recurring_coaching"),
    ),
  },
  {
    label: "One-off consultation",
    detail: null,
    coachPercent: percent(
      10_000 - commissionBasisPointsFor(commissionPolicy, "one_off_consultation"),
    ),
    platformPercent: percent(
      commissionBasisPointsFor(commissionPolicy, "one_off_consultation"),
    ),
  },
];

/** The worked example, computed by the same code that computes real money. */
const example = previewEarnings({
  price: money(10_000, "USD"),
  serviceType: "recurring_coaching",
});

const autonomy = [
  {
    title: "You set your plans and prices",
    body: "Create your own plans, decide what each one includes and set the price. TalentYak doesn't impose a standard package or approve your prices.",
  },
  {
    title: "You make the training decisions",
    body: "You write the programme and decide when to change it. TalentYak doesn't approve workouts.",
  },
  {
    title: "TalentYak handles the rest",
    body: "Customers find you through TalentYak. We take payment, run the platform and support, and handle requests to change coach.",
  },
];

export default function BecomeACoachPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 md:py-20">
      <h1 className="font-display text-5xl">Become a coach</h1>
      <p className="mt-4 max-w-2xl text-xl text-ink-muted">
        Coach Nepalis living abroad, on your own terms, without chasing
        payments from overseas.
      </p>

      <div
        role="note"
        className="mt-8 flex gap-3 rounded-xl border border-line-strong bg-surface p-4"
      >
        <Icon name="info" className="mt-0.5 size-5 shrink-0 text-brand" />
        <p>
          <span className="font-semibold">Applications aren&rsquo;t open yet.</span>{" "}
          We aren&rsquo;t collecting coach applications through this website.
        </p>
      </div>

      <section aria-labelledby="terms-heading" className="mt-14">
        <h2 id="terms-heading" className="text-2xl font-semibold">
          How it works for coaches
        </h2>
        <ul className="mt-6 grid gap-6 md:grid-cols-3">
          {autonomy.map((item) => (
            <li key={item.title} className="border-t-2 border-accent pt-4">
              <h3 className="text-lg font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-ink-muted">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="earnings-heading" className="mt-14">
        <h2 id="earnings-heading" className="text-2xl font-semibold">
          What you earn
        </h2>
        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[28rem] text-left">
            <caption className="sr-only">Coach and TalentYak share by type of service</caption>
            <thead className="border-b border-line bg-paper-raised">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Type of service</th>
                <th scope="col" className="px-4 py-3 font-semibold">You receive</th>
                <th scope="col" className="px-4 py-3 font-semibold">TalentYak</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shares.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="px-4 py-4 font-normal">
                    {row.label}
                    {row.detail ? (
                      <span className="block text-sm text-ink-muted">{row.detail}</span>
                    ) : null}
                  </th>
                  <td className="tabular px-4 py-4 text-xl font-semibold text-brand">
                    {row.coachPercent}
                  </td>
                  <td className="tabular px-4 py-4 text-xl">{row.platformPercent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-5 space-y-2 text-ink-muted">
          <li>
            Worked out on the coaching amount, not including separately
            collected taxes. For example, on a{" "}
            {formatMoney(example.customerPays.minor, example.customerPays.currency)}{" "}
            monthly plan you receive{" "}
            {formatMoney(example.coachShare.minor, example.coachShare.currency)} and
            TalentYak receives{" "}
            {formatMoney(
              example.platformCommission.minor,
              example.platformCommission.currency,
            )}
            .
          </li>
          <li>TalentYak pays ordinary card-processing and payout fees from its own share.</li>
          <li>
            A discount TalentYak pays for never reduces what you earn. A discount
            you pay for only happens if you agree to it first.
          </li>
        </ul>
      </section>

      <section aria-labelledby="payout-heading" className="mt-14">
        <h2 id="payout-heading" className="text-2xl font-semibold">
          When you&rsquo;re paid
        </h2>
        <p className="mt-4 text-lg">
          Monthly, after the coaching is delivered. In the first seven days of
          each month, you&rsquo;re paid for coaching you delivered up to the
          end of the previous month.
        </p>
        <p className="mt-3 text-ink-muted">
          A customer paying doesn&rsquo;t make the whole amount payable at
          once. A six-month package paid upfront is still ongoing coaching at{" "}
          {shares[0].coachPercent}, and it&rsquo;s paid out month by month as
          you deliver it.
        </p>
      </section>

      <section aria-labelledby="pending-heading" className="mt-14 rounded-xl bg-paper-raised p-6">
        <h2 id="pending-heading" className="text-lg font-semibold">
          Still being confirmed
        </h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-ink-muted">
          <li>How payments reach you in Nepal, and the exact payout fees.</li>
          <li>The full coach agreement. These are planned terms; the agreement will set them out in full.</li>
        </ul>
      </section>
    </div>
  );
}
