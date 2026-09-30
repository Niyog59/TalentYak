import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOnboarded } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/form/action-form";
import { CheckboxField, SubmitButton, TextField } from "@/components/form/fields";
import { Icon } from "@/components/ui/icon";
import { coachAgreement, coachTerms } from "@/lib/coach-agreement";
import { declineAgreementAction, signAgreementAction } from "../actions";

export const metadata: Metadata = { title: "Coach agreement", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/*
 * Shown only to an applicant TalentYak has accepted. This is where the
 * platform, the commission and the payment arrangements are explained — not
 * on the public page — and where the applicant signs or declines. Every
 * figure comes from the policy register through lib/coach-agreement.
 */
export default async function AgreementPage() {
  const session = await requireOnboarded("/account/coach-application/agreement");
  const supabase = (await createClient())!;
  const { data: app } = await supabase
    .from("coach_applications")
    .select("id, status, full_name, agreement_signed_at")
    .eq("profile_id", session.userId)
    .eq("status", "approved")
    .maybeSingle();
  if (!app) redirect("/account/coach-application");
  if (app.agreement_signed_at) redirect("/coach/profile");

  const terms = coachTerms();
  const agreement = coachAgreement();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-14">
      <p><Link href="/account/coach-application" className="text-brand underline underline-offset-4">← Your application</Link></p>
      <h1 className="mt-4 font-display text-4xl sm:text-5xl">Welcome to TalentYak</h1>
      <p className="mt-3 text-lg text-ink-muted">
        We&rsquo;d like you to coach with us. Here&rsquo;s how TalentYak works for coaches and what you&rsquo;d be agreeing to. Take your time.
      </p>

      <section aria-labelledby="how-heading" className="mt-10">
        <h2 id="how-heading" className="font-display text-3xl">How TalentYak works</h2>
        <ul className="mt-5 grid gap-5 sm:grid-cols-3">
          {[
            ["You run your coaching", "You create your plans, set your prices and write your clients' programmes."],
            ["We bring the clients", "Nepalis living abroad find you on TalentYak and pay through us."],
            ["We handle the rest", "Payment, the app, customer support and requests to change coach."],
          ].map(([title, body]) => (
            <li key={title} className="border-t-2 border-accent pt-4">
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1 text-ink-muted">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="money-heading" className="mt-12 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="money-heading" className="text-2xl font-semibold">What you earn and when</h2>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-ink-muted">Ongoing coaching</dt>
            <dd className="tabular mt-1 text-3xl font-semibold text-brand">{terms.ongoingCoachShare} <span className="text-base font-normal text-ink-muted">to you</span></dd>
          </div>
          <div>
            <dt className="text-ink-muted">One-off consultations</dt>
            <dd className="tabular mt-1 text-3xl font-semibold text-brand">{terms.oneOffCoachShare} <span className="text-base font-normal text-ink-muted">to you</span></dd>
          </div>
        </dl>
        <p className="mt-4">
          On a {terms.example.price} monthly plan you receive {terms.example.coach}; TalentYak keeps {terms.example.platform}. You&rsquo;re paid monthly, after the coaching is delivered.
        </p>
      </section>

      <section aria-labelledby="agreement-heading" className="mt-12">
        <h2 id="agreement-heading" className="font-display text-3xl">Coach agreement</h2>
        {!agreement.approved ? (
          <p role="note" className="mt-4 flex gap-3 rounded-xl border border-line-strong bg-paper-raised p-4">
            <Icon name="info" className="mt-0.5 size-5 shrink-0 text-brand" />
            <span>
              This is a <strong>draft</strong> agreement (version <span className="whitespace-nowrap">{agreement.version}</span>). It hasn&rsquo;t had a final legal review yet. If the final version changes anything, you&rsquo;ll be asked to read and accept it again.
            </span>
          </p>
        ) : null}
        <div className="mt-6 grid gap-8">
          {agreement.sections.map((s) => (
            <section key={s.heading}>
              <h3 className="text-lg font-semibold">{s.heading}</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                {s.points.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </section>
          ))}
          <section className="rounded-xl bg-paper-raised p-5">
            <h3 className="text-lg font-semibold">Still being confirmed</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-ink-muted">
              {agreement.stillBeingConfirmed.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </section>
        </div>
      </section>

      <section aria-labelledby="sign-heading" className="mt-12 rounded-2xl border border-brand/30 bg-surface p-5 sm:p-6">
        <h2 id="sign-heading" className="text-2xl font-semibold">Sign</h2>
        <p className="mt-2 text-ink-muted">
          Signing sets up your coach account on this login ({session.email}). Nothing is shown to customers until you finish your profile and TalentYak gives final approval.
        </p>
        <ActionForm action={signAgreementAction} className="mt-5 grid gap-5">
          <input type="hidden" name="application_id" value={app.id} />
          <input type="hidden" name="version" value={agreement.version} />
          <CheckboxField name="agree" required label="I've read the coach agreement above and I agree to it." />
          <TextField name="signed_name" label="Type your full name to sign" required autoComplete="name" maxLength={120} defaultValue="" help={`As on your application: ${app.full_name}`} className="sm:max-w-md" />
          <div><SubmitButton pendingLabel="Signing…">Sign and set up my coach account</SubmitButton></div>
        </ActionForm>
      </section>

      <section aria-labelledby="decline-heading" className="mt-10 border-t border-line pt-8">
        <h2 id="decline-heading" className="text-xl font-semibold">Not for you?</h2>
        <p className="mt-2 text-ink-muted">You can decline. Your application closes and your certificate files are deleted.</p>
        <ActionForm action={declineAgreementAction} className="mt-4 grid gap-4 sm:max-w-xl">
          <input type="hidden" name="application_id" value={app.id} />
          <CheckboxField name="confirm" required label="I don't want to go ahead." />
          <div><SubmitButton pendingLabel="Saving…" variant="secondary">Decline the agreement</SubmitButton></div>
        </ActionForm>
      </section>
    </div>
  );
}
