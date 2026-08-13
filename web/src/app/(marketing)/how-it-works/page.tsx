import type { Metadata } from "next";
import { ButtonLink } from "@/components/button";
import { SectionLabel } from "@/components/section";

export const metadata: Metadata = { title: "How it works" };

const steps = [
  {
    n: "1",
    title: "Tell us what you need",
    body: "Choose a service and fill in the details once — the tithi and tradition for a ceremony, the goal and equipment for coaching. If anything is unclear, we call you before going further.",
  },
  {
    n: "2",
    title: "We confirm before anything happens",
    body: "A coordinator reviews your request, matches the right professional in Nepal, and confirms date, time, and scope with you directly. Nothing is scheduled until you say so.",
  },
  {
    n: "3",
    title: "It happens — properly",
    body: "The ceremony is performed at the temple, the plan is delivered, the session happens. We are on the ground making sure it is done the way your family expects.",
  },
  {
    n: "4",
    title: "You see it done",
    body: "Join live by video, receive recordings and photographs, or get your deliverable. Everything is documented and yours to keep — included, never an upsell.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <h1 className="font-display text-4xl">How it works</h1>
      <p className="mt-3 max-w-xl text-ink/70">
        One process for everything we arrange, whether it is a shraddha at
        Gokarna or a quarterly coaching plan.
      </p>

      <ol className="mt-14 max-w-3xl space-y-12">
        {steps.map((step) => (
          <li key={step.n} className="rule flex gap-8 pt-8 first:border-t-0">
            <p className="font-display text-6xl leading-none text-terracotta">
              {step.n}
            </p>
            <div>
              <h2 className="font-display text-2xl">{step.title}</h2>
              <p className="mt-2 leading-relaxed text-ink/75">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-20 max-w-3xl">
        <SectionLabel>Why families trust us</SectionLabel>
        <div className="space-y-6 leading-relaxed text-ink/80">
          <p>
            Every professional we work with is vetted in person, paid well
            above local rates, and paid fast. They do their best work because
            we treat them properly — and you feel that in the result.
          </p>
          <p>
            For ceremonies, correctness is everything. Tradition, tithi, and
            ritual detail are confirmed by a senior pandit before any ceremony
            is scheduled. We would rather delay than do it wrong.
          </p>
        </div>
        <div className="mt-10">
          <ButtonLink href="/services">Browse services</ButtonLink>
        </div>
      </section>
    </div>
  );
}
