import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/button";
import { Icon } from "@/components/ui/icon";
import { featureOnForEveryone } from "@/lib/features/server";

export const metadata: Metadata = {
  title: "Become a coach",
  description:
    "Apply to coach on TalentYak: help busy Nepalis living abroad get fit and stay consistent, with your own plans, your own prices and your own programming.",
};

export const dynamic = "force-dynamic";

/*
 * The public recruitment page. It says who we're looking for, who they'd
 * coach and how applying works — and nothing it can't keep: no review
 * deadline, no promise of clients.
 *
 * Commission, payouts and the coach agreement are deliberately NOT here. The
 * founder decided (2026-09-29) they're explained after acceptance, on the
 * welcome page, where every figure is read from the policy register
 * (invariant 8: disclosed by us, never discovered).
 *
 * Whether applications are open is the founder's "Accept coach applications"
 * switch, independent of whether coaches are shown publicly.
 */

const lookingFor = [
  "You're a qualified or experienced fitness coach or personal trainer.",
  "You explain things simply and kindly, in Nepali, English or both.",
  "You can build realistic plans for beginners with busy lives.",
  "You know when something needs a doctor or physiotherapist, not a coach.",
  "You're reliable online: you reply when you say you will.",
];

const steps = [
  { title: "Create an account", body: "Sign up and confirm your email address. It only takes a minute." },
  { title: "Apply", body: "Answer a few questions about your coaching and add any qualifications. It's free." },
  { title: "Review", body: "We review applications when we have openings. We may email you to arrange a short call." },
  { title: "Decision", body: "We email you whether you've been accepted, waitlisted or not accepted this time." },
  { title: "Get set up", body: "If you're accepted, we explain how TalentYak works and what you'd earn, and you sign the coach agreement before setting up your profile." },
];

export default async function BecomeACoachPage() {
  const open = await featureOnForEveryone("coach_applications");
  const apply = "/account/coach-application";

  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 md:py-20">
      <h1 className="font-display text-5xl">Become a coach</h1>
      <p className="mt-4 max-w-2xl text-xl text-ink-muted">
        Help Nepalis living abroad get fitter and feel better — with your own plans, your own prices and your own way of coaching.
      </p>

      {open ? (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <ButtonLink href={apply}>Apply to coach</ButtonLink>
          <ButtonLink href={`/account/sign-up?next=${encodeURIComponent(apply)}`} variant="secondary">New here? Create an account</ButtonLink>
        </div>
      ) : (
        <div role="note" className="mt-8 flex gap-3 rounded-xl border border-line-strong bg-surface p-4">
          <Icon name="info" className="mt-0.5 size-5 shrink-0 text-brand" />
          <p>
            <span className="font-semibold">Applications are closed right now.</span> We&rsquo;re not taking new coach applications at the moment. Please check back later.{" "}
            <Link href={apply} className="text-brand underline underline-offset-4">Already applied? See your application.</Link>
          </p>
        </div>
      )}

      <section aria-labelledby="who-heading" className="mt-14 grid gap-10 md:grid-cols-2">
        <div>
          <h2 id="who-heading" className="text-2xl font-semibold">Who we&rsquo;re looking for</h2>
          <ul className="mt-5 grid gap-3">
            {lookingFor.map((item) => (
              <li key={item} className="flex gap-3">
                <Icon name="check" className="mt-1 size-5 shrink-0 text-brand" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-ink-muted">Your social media following doesn&rsquo;t matter to us. How you coach does.</p>
        </div>
        <div>
          <h2 className="text-2xl font-semibold">Who you&rsquo;d coach</h2>
          <p className="mt-5">
            Nepalis living abroad who want to get fitter but are short on time. Many are beginners, and many would rather be coached in Nepali.
          </p>
          <p className="mt-3 text-ink-muted">
            You&rsquo;d coach online: programmes, check-ins and messages through TalentYak, with calls where your plan includes them.
          </p>
        </div>
      </section>

      <section aria-labelledby="steps-heading" className="mt-14">
        <h2 id="steps-heading" className="text-2xl font-semibold">How applying works</h2>
        <ol className="mt-6 grid gap-6 md:grid-cols-5">
          {steps.map((s, i) => (
            <li key={s.title} className="border-t-2 border-accent pt-4">
              <p className="text-sm font-semibold text-brand">Step {i + 1}</p>
              <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-ink-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="know-heading" className="mt-14 rounded-xl bg-paper-raised p-6">
        <h2 id="know-heading" className="text-lg font-semibold">Good to know</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li>Applying is free, and we never ask you to pay anything to join.</li>
          <li>We review applications when we have openings, so there&rsquo;s no fixed timeline for a reply.</li>
          <li>Being accepted doesn&rsquo;t guarantee you clients. Customers choose their own coach.</li>
          <li>You can correct your application until we decide, and withdraw it at any time.</li>
        </ul>
      </section>

      <section id="privacy" aria-labelledby="privacy-heading" className="mt-14 scroll-mt-24">
        <h2 id="privacy-heading" className="text-2xl font-semibold">How we use your application</h2>
        <div className="mt-4 grid gap-3 text-ink-muted">
          <p>
            <strong className="text-ink">What we collect:</strong> your answers, the qualifications you add and any certificate files, and the email address on your TalentYak account.
            We don&rsquo;t ask for bank details, identity documents, photos of clients or anyone&rsquo;s health records — please don&rsquo;t include them.
          </p>
          <p>
            <strong className="text-ink">Why:</strong> only to review your application, contact you about it and, if you&rsquo;re accepted, set up your coach account.
          </p>
          <p>
            <strong className="text-ink">Who sees it:</strong> only the people at TalentYak who review applications. Certificate files are stored privately and are never public. Photos are cleaned of hidden details such as location.
          </p>
          <p>
            <strong className="text-ink">Your choices:</strong> you can correct your application until we decide, withdraw it at any time, and delete it and everything in it from your application page.
            If you&rsquo;re accepted and sign the coach agreement, your details become part of your coach account.
          </p>
          <p>
            <strong className="text-ink">How long we keep it:</strong> while it&rsquo;s being considered. For closed applications we haven&rsquo;t set a fixed period yet; until we do, you can delete yours whenever you like.
          </p>
        </div>
      </section>

      {open ? (
        <div className="mt-14 flex flex-wrap items-center gap-3">
          <ButtonLink href={apply}>Apply to coach</ButtonLink>
          <ButtonLink href={`/account/sign-up?next=${encodeURIComponent(apply)}`} variant="secondary">New here? Create an account</ButtonLink>
        </div>
      ) : null}
    </div>
  );
}
