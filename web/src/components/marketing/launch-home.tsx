import Link from "next/link";
import { ButtonLink } from "@/components/button";
import { Icon, type IconName } from "@/components/ui/icon";
import type { PublicCoach, PublicPlan } from "@/lib/offers/public";
import { availabilityText } from "@/lib/offers/presentation";
import { coachPhotoUrl } from "@/lib/storage/photos";
import type { PurchaseMode } from "@/lib/launch";

/*
 * The public launch site's building blocks (M16). Every claim here is true of
 * the product today, or is the coach's own published words. No example
 * coaches, reviews, customer counts, results or guarantees.
 */

export { AVAILABILITY_LABEL, availabilityText } from "@/lib/offers/presentation";

/* ------------------------------ Hero ------------------------------ */

export function Hero({ mode, hasCoaches }: { mode: PurchaseMode; hasCoaches: boolean }) {
  const open = mode === "live";
  return (
    <section className="mx-auto max-w-6xl px-4 pb-14 pt-10 sm:px-6 md:pb-20 md:pt-16">
      <div className="max-w-3xl">
        <p className="inline-flex rounded-full bg-brand-tint px-3 py-1 text-sm font-semibold text-brand">
          {open ? "Now taking clients" : "Founding coaches · not taking payments yet"}
        </p>
        <h1 className="mt-5 font-display text-[2.5rem] leading-[1.05] sm:text-6xl">
          Fitness coaching from a Nepali coach, planned around your life abroad.
        </h1>
        <p className="mt-6 text-lg text-ink-muted sm:text-xl">
          For Nepalis living abroad. Your coach, based in Nepal, writes a training
          plan around your goals, your working week, the equipment you have and the food you actually eat — then checks
          your progress and adjusts it.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {open ? (
            <ButtonLink href="/coaches" className="min-h-12 px-6 text-lg">
              Start coaching <Icon name="arrowRight" />
            </ButtonLink>
          ) : (
            <ButtonLink href="/waitlist" className="min-h-12 px-6 text-lg">
              Join the waitlist <Icon name="arrowRight" />
            </ButtonLink>
          )}
          {hasCoaches ? (
            <ButtonLink href="#coaches-heading" variant="secondary" className="min-h-12 px-6 text-lg">Meet the coaches</ButtonLink>
          ) : null}
        </div>
        <p className="mt-4 max-w-xl text-ink-muted">
          {open
            ? "You see each coach's packages, what's included and the price in its currency before you pay."
            : "We'll email you once coaching can be booked. No marketing, and you can leave the list any time."}
        </p>
      </div>
    </section>
  );
}

/* --------------------------- Coaches --------------------------- */

export function CoachCardPublic({ coach, plans }: { coach: PublicCoach; plans: PublicPlan[] }) {
  const photo = coachPhotoUrl(coach.photo_path);
  const ongoing = plans.filter((p) => p.service_type === "recurring_coaching").length;
  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start gap-4">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="" width={80} height={80} className="size-20 shrink-0 rounded-xl object-cover" />
        ) : (
          <span aria-hidden className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-brand-tint font-display text-3xl text-brand">
            {coach.display_name.slice(0, 1)}
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-xl font-semibold">
            <Link href={`/coaches/${coach.slug}`} className="underline-offset-4 hover:underline">{coach.display_name}</Link>
          </h3>
          {coach.headline ? <p className="text-ink-muted">{coach.headline}</p> : null}
          <p className={`mt-1 text-sm font-semibold ${coach.availability === "available" ? "text-brand" : "text-ink-muted"}`}>{availabilityText(coach)}</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-ink-muted">
        Coaches in {coach.languages.join(", ") || "—"}
        {coach.credentials.length ? ` · ${coach.credentials.length} qualification${coach.credentials.length === 1 ? "" : "s"} checked by TalentYak` : ""}
        {ongoing ? ` · ${ongoing} coaching package${ongoing === 1 ? "" : "s"}` : ""}
      </p>
      <div className="mt-auto pt-4">
        <ButtonLink href={`/coaches/${coach.slug}`} variant="secondary">
          Meet {coach.display_name}
        </ButtonLink>
      </div>
    </article>
  );
}

export function MeetCoaches({ listing, failed }: { listing: { coach: PublicCoach; plans: PublicPlan[] }[]; failed: boolean }) {
  return (
    <section aria-labelledby="coaches-heading" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6 md:py-20">
      <h2 id="coaches-heading" className="font-display text-4xl sm:text-5xl">Meet your coaches</h2>
      <p className="mt-3 max-w-2xl text-lg text-ink-muted">
        A small group of founding coaches, each approved by TalentYak. Each sets their own packages and prices.
      </p>
      {failed ? (
        <p role="alert" className="mt-8 rounded-lg border border-line-strong bg-paper-raised p-4">
          The coaches couldn&rsquo;t be loaded just now. Please refresh in a moment.
        </p>
      ) : listing.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line-strong bg-surface p-6 sm:p-8">
          <p className="text-lg font-semibold">Our founding coaches are being confirmed.</p>
          <p className="mt-2 max-w-2xl text-ink-muted">
            Their profiles appear here once TalentYak has approved them. We don&rsquo;t show example coaches as if they were real.
          </p>
          <ButtonLink href="/waitlist" variant="secondary" className="mt-5">Tell me when coaches are listed</ButtonLink>
        </div>
      ) : (
        <ul className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {listing.slice(0, 6).map(({ coach, plans }) => (
            <li key={coach.provider_id}><CoachCardPublic coach={coach} plans={plans} /></li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------- How coaching works ------------------------- */

const steps = [
  { title: "Choose your coach and package", body: "Read each coach's profile, packages and prices. You see what's included and how billing works before you pay." },
  { title: "Tell your coach about you", body: "Your goals, your week, your equipment, the foods you eat and anything to work around. Your coach uses it to write your plan." },
  { title: "Train on your own schedule", body: "You follow your programme yourself, when it suits you, and log what you did in the app. Workouts are not live sessions with your coach." },
  { title: "Your coach checks in and adjusts", body: "Your coach reviews your logs and check-ins and changes the plan when needed. Messaging, check-ins and calls happen as your package describes." },
];

export function HowCoachingWorks({ headingLevel = "h2" }: { headingLevel?: "h1" | "h2" }) {
  const Heading = headingLevel;
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-20 bg-paper-raised">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 md:py-20">
        <Heading id="how-heading" className="font-display text-4xl sm:text-5xl">How coaching works</Heading>
        <p className="mt-3 max-w-2xl text-lg text-ink-muted">
          Your coach plans; you train. TalentYak keeps your plan, logs, check-ins and messages in one place.
        </p>
        <ol className="mt-10 grid gap-x-14 gap-y-8 md:grid-cols-2">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-5">
              <span aria-hidden className="tabular w-8 shrink-0 font-display text-4xl leading-none text-accent">{i + 1}</span>
              <div>
                <h3 className="text-xl font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-ink-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* -------------------------- Package benefits -------------------------- */

const benefits: { icon: IconName; title: string; body: string }[] = [
  { icon: "training", title: "A written training programme", body: "Sessions, sets, reps and rest, written for you. When it changes, earlier versions stay in your history." },
  { icon: "plans", title: "Nutrition guidance, if included", body: "Built around your preferences and the food you can get — dal bhat included. Some packages don't include it." },
  { icon: "check", title: "Check-ins", body: "A short regular form — energy, sleep, what was hard — with your logged progress attached. Your coach replies with next steps." },
  { icon: "messages", title: "Messaging", body: "Private messages with your coach, answered within the times they publish. Not a 24/7 service." },
  { icon: "video", title: "Calls, if included", body: "Video or audio calls, booked in your own time zone. Each package states how many and how long." },
  { icon: "progress", title: "Progress you can see", body: "Workouts, weight, measurements and private photos as plain records — no scores, no verdicts." },
];

export function PackageBenefits() {
  return (
    <section aria-labelledby="packages-heading" className="mx-auto max-w-6xl px-4 py-14 sm:px-6 md:py-20">
      <h2 id="packages-heading" className="font-display text-4xl sm:text-5xl">What a package can include</h2>
      <p className="mt-3 max-w-2xl text-lg text-ink-muted">
        Each coach&rsquo;s package lists exactly which of these it includes, the price and currency, and how often you&rsquo;re
        charged. If a package doesn&rsquo;t list something, it isn&rsquo;t included.
      </p>
      <ul className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
        {benefits.map((b) => (
          <li key={b.title} className="flex gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand"><Icon name={b.icon} /></span>
            <div>
              <h3 className="text-lg font-semibold">{b.title}</h3>
              <p className="mt-1 text-ink-muted">{b.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------ FAQs ------------------------------ */

export function faqs(mode: PurchaseMode): [string, string][] {
  return [
    ["Who is TalentYak for?", "Nepalis living abroad who want a personal fitness coach who understands their food, their schedule and their language. Coaching is for adults aged 18 or over."],
    ["Are my workouts live sessions with the coach?", "No. You follow your programme on your own, whenever suits you, and record what you did. Your coach reviews it and adjusts your plan. Calls happen only if your package includes them."],
    ["How much does it cost?", "Each coach sets their own prices. You see the price, the currency and how often you're charged on the package before you pay. You're charged in that currency; if your card is in another currency, your bank converts it at its own rate."],
    ["Does it renew automatically?", "Ongoing packages renew every billing period until you cancel. You can cancel any time from your account: you keep access until the end of the period you've paid for and aren't charged again."],
    ["Can I get a refund?", "There's no automatic refund when you cancel. If something has gone wrong, contact TalentYak and we review each refund request individually."],
    ["Can my coach work with my food and routine?", "Yes — that's the point. You tell your coach what you eat, what equipment you have and how your week looks, and the plan is built around it. Nutrition guidance is only part of packages that list it."],
    ["What if my coach is away or doesn't reply?", "Coaches publish when they're available and how quickly they usually reply. If that isn't happening, contact TalentYak — we can follow up or help you change coach."],
    ["Can I change coach?", "Yes. Ask TalentYak from your account and we handle the change. Your previous conversations stay private to you and your earlier coach."],
    ["Can I message a coach before buying?", "No — messaging opens once you've bought coaching. Questions before then go to TalentYak."],
    ["Is my progress private?", "Yes. Your records, photos and messages are visible only to you and your current coach. They're never used in marketing."],
    ["Can I sign up now?", mode === "live" ? "Yes. Choose a coach and package, create an account and pay securely through Stripe." : "Not yet — TalentYak isn't taking payments yet. Join the waitlist and we'll email you when coaching can be booked."],
  ];
}

export function Faqs({ mode }: { mode: PurchaseMode }) {
  return (
    <section aria-labelledby="faq-heading" className="scroll-mt-20 border-t border-line" id="faq">
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 md:py-20">
        <h2 id="faq-heading" className="font-display text-4xl sm:text-5xl">Common questions</h2>
        <div className="mt-8 divide-y divide-line border-y border-line">
          {faqs(mode).map(([q, a]) => (
            <details key={q} className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                {q}
                <Icon name="plus" className="size-5 shrink-0 text-brand transition-transform group-open:rotate-45" />
              </summary>
              <p className="pb-5 pr-9 text-ink-muted">{a}</p>
            </details>
          ))}
        </div>
        <p className="mt-6 text-ink-muted">
          More: <Link href="/about#selection-heading" className="underline">how coaches are selected</Link> ·{" "}
          <Link href="/legal/terms" className="underline">terms</Link> · <Link href="/legal/privacy" className="underline">privacy</Link> ·{" "}
          <Link href="/about#support-heading" className="underline">contact TalentYak</Link>
        </p>
      </div>
    </section>
  );
}

/* --------------------------- Next action --------------------------- */

export function NextAction({ mode }: { mode: PurchaseMode }) {
  const open = mode === "live";
  return (
    <section aria-labelledby="next-heading" className="on-dark bg-ink text-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-12 sm:px-6">
        <div className="max-w-xl">
          <h2 id="next-heading" className="font-display text-3xl sm:text-4xl">{open ? "Ready to start?" : "Be first to know"}</h2>
          <p className="mt-2 text-paper/85">
            {open ? "Choose a coach and package. You'll see everything before you pay." : "We'll email you when coaching can be booked — nothing else."}
          </p>
        </div>
        <ButtonLink href={open ? "/coaches" : "/waitlist"} variant="inverse" className="min-h-12 px-6 text-lg">
          {open ? "Start coaching" : "Join the waitlist"}
        </ButtonLink>
      </div>
    </section>
  );
}
