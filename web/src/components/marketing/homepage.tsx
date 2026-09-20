import { ButtonLink } from "@/components/button";
import { CoachCard } from "@/components/fitness/coach-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, type IconName } from "@/components/ui/icon";
import { PhotoPlaceholder } from "@/components/ui/photo-placeholder";
import { SampleTag } from "@/components/ui/sample";
import { formatMoney } from "@/lib/format";
import { sampleCoaches } from "@/lib/sample/fitness";

/*
 * The public homepage, in the founder's required order:
 *   1 introduction · 2 how TalentYak works · 3 coaches · 4 what you do together
 *   5 ongoing vs one-off · 6 common questions
 *
 * `live` is the real site: honest about what isn't open yet, no example
 * coaches. `sample` is the reference version with clearly marked sample
 * coaches and offers, used only under /preview.
 */

export type HomepageMode = "live" | "sample";

export function Homepage({ mode }: { mode: HomepageMode }) {
  const coachesHref = mode === "live" ? "/coaches" : "/preview/coaches";
  return (
    <>
      <Hero mode={mode} coachesHref={coachesHref} />
      <HowItWorks mode={mode} />
      <CoachPreviews mode={mode} />
      <WorkTogether mode={mode} />
      <OfferComparison mode={mode} />
      <CommonQuestions mode={mode} />
    </>
  );
}

/* ------------------------------ 1 Hero ------------------------------ */

function Hero({ mode, coachesHref }: { mode: HomepageMode; coachesHref: string }) {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:gap-14 md:pb-24 md:pt-16">
      <div>
        {mode === "live" && (
          <p className="inline-flex rounded-full bg-brand-tint px-3 py-1 text-sm font-semibold text-brand">
            Opening soon · not taking payments yet
          </p>
        )}
        <h1 className="mt-5 font-display text-[2.6rem] leading-[1.04] sm:text-6xl">
          A personal fitness coach, planned around your life.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-ink-muted">
          Work one-to-one with an independent coach based in Nepal. Your coach
          builds a training plan around your goals, schedule and equipment, and
          changes it as you progress.
        </p>
        <div className="mt-8">
          <ButtonLink href={coachesHref} className="min-h-12 px-6 text-lg">
            Find your coach
            <Icon name="arrowRight" />
          </ButtonLink>
        </div>
        <p className="mt-4 max-w-md text-ink-muted">
          You see each coach&rsquo;s plans, what&rsquo;s included and the price
          with its currency before you pay.
        </p>
      </div>
      <PhotoPlaceholder
        className="aspect-[4/3] w-full md:aspect-[4/5]"
        label="Real photography of a TalentYak coach goes here."
      />
    </section>
  );
}

/* ------------------------ 2 How TalentYak works ------------------------ */

const steps = [
  {
    title: "Choose your coach",
    body: "Compare coaches and pick a plan that suits you.",
  },
  {
    title: "Make a plan together",
    body: "Share your goals, schedule and available equipment. Your coach builds your training plan.",
  },
  {
    title: "Train and track",
    body: "Follow your workouts and record your progress in TalentYak.",
  },
  {
    title: "Get feedback and adjust",
    body: "Your coach reviews your progress and changes your plan when needed. Calls and check-ins depend on your chosen plan.",
  },
];

export function HowItWorks({
  mode,
  headingLevel = "h2",
}: {
  mode: HomepageMode;
  headingLevel?: "h1" | "h2";
}) {
  const Heading = headingLevel;
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-heading"
      className="scroll-mt-20 bg-paper-raised"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <div className="max-w-2xl">
          {mode === "live" && (
            <p className="font-semibold text-accent-text">
              Launching soon — this is how TalentYak will work
            </p>
          )}
          <Heading id="how-heading" className="mt-2 font-display text-4xl sm:text-5xl">
            How TalentYak works
          </Heading>
          <p className="mt-4 text-lg text-ink-muted">
            You work with a coach. TalentYak keeps your plan, progress and
            conversations in one place.
          </p>
        </div>

        <ol className="mt-12 grid gap-x-14 gap-y-9 md:grid-cols-2">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-5">
              <span
                aria-hidden="true"
                className="tabular w-8 shrink-0 font-display text-4xl leading-none text-accent"
              >
                {index + 1}
              </span>
              <div>
                <h3 className="text-xl font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-ink-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-12 max-w-2xl border-l-4 border-accent pl-4">
          A one-off consultation is a single paid session. It doesn&rsquo;t
          include an ongoing training programme.
        </p>
      </div>
    </section>
  );
}

/* --------------------------- 3 Coaches --------------------------- */

function CoachPreviews({ mode }: { mode: HomepageMode }) {
  return (
    <section aria-labelledby="coaches-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h2 id="coaches-heading" className="font-display text-4xl sm:text-5xl">
            Coaches
          </h2>
          <p className="mt-3 text-lg text-ink-muted">
            Each coach sets their own plans and prices. You compare what&rsquo;s
            included before you choose.
          </p>
        </div>
        {mode === "sample" && (
          <ButtonLink href="/preview/coaches" variant="secondary">
            See all coaches
          </ButtonLink>
        )}
      </div>

      {mode === "live" ? (
        <EmptyState
          className="mt-10"
          icon="coaches"
          title="Coach profiles aren't listed yet"
          actions={
            <ButtonLink href="/become-a-coach" variant="secondary">
              Become a coach
            </ButtonLink>
          }
        >
          When coaches join, their profiles, plans and prices will appear here.
          We don&rsquo;t show example coaches as if they were real.
        </EmptyState>
      ) : (
        <ul className="mt-10 grid gap-5 md:grid-cols-2">
          {sampleCoaches.map((coach) => (
            <li key={coach.slug}>
              <CoachCard coach={coach} href={`/preview/coaches/${coach.slug}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ----------------------- 4 Working together ----------------------- */

const together: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "training",
    title: "Training plan",
    body: "Your coach writes your programme. When it changes, earlier versions stay in your history.",
  },
  {
    icon: "check",
    title: "Workout records",
    body: "Record the sets, reps and weights you actually did, with notes for your coach.",
  },
  {
    icon: "progress",
    title: "Progress tracking",
    body: "Body weight, measurements and private progress photos, shown as plain trends — no scores or judgements.",
  },
  {
    icon: "messages",
    title: "Feedback",
    body: "Your coach reviews your workouts and form videos and tells you what to change. What's included depends on your plan.",
  },
];

function WorkTogether({ mode }: { mode: HomepageMode }) {
  return (
    <section aria-labelledby="together-heading" className="on-dark bg-ink text-paper">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-[0.8fr_1.2fr] md:gap-16 md:py-20">
        <div>
          <h2 id="together-heading" className="font-display text-4xl sm:text-5xl">
            What you and your coach do together
          </h2>
          {mode === "live" && (
            <p className="mt-4 text-paper/85">These tools are being built for launch.</p>
          )}
        </div>
        <ul className="divide-y divide-paper/20 border-y border-paper/20">
          {together.map((item) => (
            <li key={item.title} className="flex gap-4 py-5">
              <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-paper/10">
                <Icon name={item.icon} />
              </span>
              <div>
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="mt-1 text-paper/85">{item.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* --------------------- 5 Ongoing vs one-off --------------------- */

function OfferComparison({ mode }: { mode: HomepageMode }) {
  const example = sampleCoaches[0];
  const ongoing = example.plans[0];
  const consult = example.consultation;

  return (
    <section aria-labelledby="offers-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
      <div className="max-w-2xl">
        <h2 id="offers-heading" className="font-display text-4xl sm:text-5xl">
          Ongoing coaching or a one-off consultation
        </h2>
        <p className="mt-4 text-lg text-ink-muted">
          Coaches can offer both. Choose ongoing coaching for a plan that
          changes with you, or a single paid session for advice.
        </p>
      </div>

      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <OfferColumn
          title="Ongoing coaching"
          highlighted
          rows={[
            ["What you get", "A personal training plan that your coach reviews and changes over time."],
            ["Calls and check-ins", "Included when the plan lists them. Each plan shows how often and for how long."],
            ["How you pay", "Set by the coach, usually monthly. The price and currency are shown before you pay."],
          ]}
          example={
            mode === "sample"
              ? `${formatMoney(ongoing.priceMinor, ongoing.currency)} ${ongoing.billing} — ${example.name}, “${ongoing.name}”`
              : undefined
          }
        />
        <OfferColumn
          title="One-off consultation"
          rows={[
            ["What you get", "One call to talk through your goals, your training or a specific problem."],
            ["Training programme", "Not included. A consultation doesn't come with an ongoing plan."],
            ["How you pay", "A single paid session. The coach sets the price and length, shown before you book."],
          ]}
          example={
            mode === "sample"
              ? `${formatMoney(consult.priceMinor, consult.currency)} for ${consult.durationMinutes} minutes — ${example.name}`
              : undefined
          }
        />
      </div>
    </section>
  );
}

function OfferColumn({
  title,
  rows,
  example,
  highlighted = false,
}: {
  title: string;
  rows: [string, string][];
  example?: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border bg-surface p-6 sm:p-7 ${
        highlighted ? "border-brand border-t-4" : "border-line"
      }`}
    >
      <h3 className="text-2xl font-semibold">{title}</h3>
      <dl className="mt-5 space-y-4">
        {rows.map(([term, detail]) => (
          <div key={term}>
            <dt className="font-semibold">{term}</dt>
            <dd className="mt-0.5 text-ink-muted">{detail}</dd>
          </div>
        ))}
      </dl>
      {example && (
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <SampleTag label="Sample offer" />
          <p className="tabular">{example}</p>
        </div>
      )}
    </div>
  );
}

/* ----------------------- 6 Common questions ----------------------- */

export function CommonQuestions({ mode }: { mode: HomepageMode }) {
  const questions: [string, string][] = [
    [
      "How much does coaching cost?",
      "Each coach sets their own prices. You see the price, the currency and how often you're charged on the coach's plan before you pay.",
    ],
    [
      "What does a plan include?",
      "Every plan lists what's included — for example calls, check-ins, messaging and form-video reviews — and how often. If a plan doesn't list something, it isn't included.",
    ],
    [
      "Which timezone are calls in?",
      "Coaches set their availability in their own timezone. You see times in yours, with the timezone shown, and you can change it if it's wrong.",
    ],
    ["Can I change my coach?", "Yes. Ask TalentYak and we handle the change for you."],
    [
      "Is a one-off consultation free?",
      "No. It's a paid session, and the price is shown before you book. It doesn't include an ongoing training programme.",
    ],
    ...(mode === "live"
      ? ([["Can I sign up now?", "Not yet. TalentYak isn't taking payments or bookings for coaching yet."]] as [string, string][])
      : []),
  ];

  return (
    <section aria-labelledby="faq-heading" className="border-t border-line">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 md:py-20">
        <h2 id="faq-heading" className="font-display text-4xl sm:text-5xl">
          Common questions
        </h2>
        <div className="mt-8 divide-y divide-line border-y border-line">
          {questions.map(([question, answer]) => (
            <details key={question} className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                {question}
                <Icon name="plus" className="size-5 shrink-0 text-brand transition-transform group-open:rotate-45" />
              </summary>
              <p className="pb-5 pr-9 text-ink-muted">{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
