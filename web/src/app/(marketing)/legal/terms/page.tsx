import type { Metadata } from "next";
import { CURRENT_LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of service (draft)" };

/*
 * Deliberately NOT written as final legal terms. No lawyer has reviewed
 * anything here, and invented terms that look binding would be worse than an
 * honest draft notice. Live billing stays blocked while CURRENT_LEGAL.approved
 * is false.
 */
export default function TermsPage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
      <h1 className="font-display text-4xl">Terms of service</h1>
      <p role="note" className="mt-6 rounded-xl border border-line-strong bg-paper-raised p-4 font-medium">
        Draft ({CURRENT_LEGAL.termsVersion}). These terms have not been finalised or reviewed by a lawyer.
        TalentYak is not taking real payments yet, and no real money can be charged while these are drafts.
      </p>
      <div className="mt-8 space-y-4 text-lg">
        <p>What these terms will cover once final:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>You buy coaching from TalentYak. The independent coach you choose delivers it.</li>
          <li>Coaches set their own plans, prices and what each plan includes. You see all of it before you pay.</li>
          <li>Ongoing plans renew monthly until you cancel. Cancelling stops future charges; the time you&rsquo;ve paid for continues.</li>
          <li>Refunds are reviewed case by case. There is no automatic refund and no no-refunds rule until final terms say otherwise.</li>
          <li>TalentYak coaching is for adults aged 18 or over.</li>
        </ul>
      </div>
    </article>
  );
}
