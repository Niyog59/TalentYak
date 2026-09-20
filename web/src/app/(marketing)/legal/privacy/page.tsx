import type { Metadata } from "next";
import { CURRENT_LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy notice (draft)" };

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
      <h1 className="font-display text-4xl">Privacy notice</h1>
      <p role="note" className="mt-6 rounded-xl border border-line-strong bg-paper-raised p-4 font-medium">
        Draft ({CURRENT_LEGAL.privacyVersion}). Not yet finalised or reviewed by a lawyer.
      </p>
      <div className="mt-8 space-y-4 text-lg">
        <p>How TalentYak is built to handle your information today:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Card details go to Stripe. They never reach TalentYak&rsquo;s servers.</li>
          <li>Health information you share — injuries, measurements, progress photos — is visible only to you and the coach currently coaching you. Not to other coaches, and not to TalentYak staff through the app.</li>
          <li>If you change coach, your previous coach loses access. You decide how much history your new coach sees.</li>
          <li>Photos have location and camera data removed when they are uploaded.</li>
          <li>We do not track when you open our emails or which links you click.</li>
          <li>Before any scheduled deletion of your data, we plan to email you in advance. No automatic deletion is switched on yet.</li>
        </ul>
      </div>
    </article>
  );
}
