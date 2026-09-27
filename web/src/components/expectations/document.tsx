import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { PlanInclusions } from "@/components/marketing/plan-details";
import { formatDate } from "@/lib/format";
import { paragraphs } from "@/lib/expectations/text";
import {
  ARRANGEMENT_FIELDS,
  DOCUMENT_TITLE,
  SOURCE_LABEL,
  policyLinkLabel,
  type CoachExpectationsContent,
  type Personalisation,
  type PlanFacts,
  type PlatformExpectationsContent,
} from "@/lib/expectations/types";

/**
 * The Coaching Welcome & Expectations document.
 *
 * Every piece of authored text is rendered as React text — escaped, never HTML,
 * never turned into a link. The only links are the platform policy links,
 * which come from a fixed list of our own pages.
 *
 * Three uses: the public, non-personalised version before purchase (no client
 * anywhere on it); the coach's preview; and a client's personal copy.
 */

export interface ExpectationsDocumentProps {
  platform: PlatformExpectationsContent & { version: number };
  coach: CoachExpectationsContent & { version: number };
  coachName: string;
  coachPhotoUrl?: string | null;
  plan: PlanFacts | null;
  personal?: Personalisation | null;
  /** Shown on a preview so nobody mistakes it for a published copy. */
  previewLabel?: string;
  timeZone?: string | null;
  headingLevel?: 1 | 2;
}

function Text({ text }: { text: string }) {
  return (
    <>
      {paragraphs(text).map((p, i) => (
        <p key={i} className="mt-2 whitespace-pre-line break-words first:mt-0">{p}</p>
      ))}
    </>
  );
}

export function ExpectationsDocument({
  platform,
  coach,
  coachName,
  coachPhotoUrl,
  plan,
  personal,
  previewLabel,
  timeZone,
  headingLevel = 1,
}: ExpectationsDocumentProps) {
  const H = headingLevel === 1 ? "h1" : "h2";
  const S = headingLevel === 1 ? "h2" : "h3";
  const meta: [string, string][] = [
    ["Coach", coachName],
    ...(personal ? ([["Client", personal.clientName]] as [string, string][]) : []),
    ...(plan ? ([["Plan", plan.title]] as [string, string][]) : []),
    ...(personal?.startDate ? ([["Started", formatDate(personal.startDate, timeZone)]] as [string, string][]) : []),
    ["Version", `Coach version ${coach.version} · TalentYak version ${platform.version}`],
  ];
  if (personal) {
    meta.push([
      "Status",
      personal.acknowledgedAt
        ? `Read and understood on ${formatDate(personal.acknowledgedAt, timeZone, true)}`
        : personal.acknowledgementRequested
          ? "Not yet acknowledged"
          : "For your information — no acknowledgement requested",
    ]);
  }

  return (
    <article className="expectations-document rounded-2xl border border-line bg-surface p-5 sm:p-8 print:border-0 print:p-0" aria-labelledby="expectations-title">
      <header className="flex flex-col gap-5 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <BrandLogo className="text-xl" />
          <H id="expectations-title" className="mt-4 font-display text-3xl sm:text-4xl">{DOCUMENT_TITLE}</H>
          {previewLabel ? (
            <p className="mt-2 inline-block rounded-full bg-accent-tint px-3 py-1 text-sm font-semibold">{previewLabel}</p>
          ) : null}
        </div>
        {coachPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- approved public coach photo
          <img src={coachPhotoUrl} alt={`Photo of ${coachName}`} width={96} height={96} className="size-24 shrink-0 rounded-2xl object-cover" />
        ) : null}
      </header>

      <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        {meta.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
        {personal ? (
          <div className="contents">
            <dt className="font-semibold">How it was shared</dt>
            <dd>{SOURCE_LABEL[personal.source]}</dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-5 rounded-lg bg-paper-raised p-4 text-sm">
        This sets out what you and your coach can expect from each other. It isn&rsquo;t a contract or a waiver, and it
        doesn&rsquo;t replace TalentYak&rsquo;s terms. Reading it never changes your price, adds a fee, changes refunds, or
        reduces what your plan includes — those are fixed by your purchase.
      </p>

      <section className="mt-8" aria-labelledby="exp-essentials">
        <S id="exp-essentials" className="text-2xl font-semibold">1. TalentYak essentials</S>
        <p className="mt-1 text-sm text-ink-muted">Set by TalentYak. Coaches can&rsquo;t change this section.</p>
        <h4 className="mt-4 font-semibold">Conduct</h4>
        <Text text={platform.conduct} />
        <h4 className="mt-4 font-semibold">Privacy</h4>
        <Text text={platform.privacy} />
        <h4 className="mt-4 font-semibold">Getting help</h4>
        <Text text={platform.support} />
        {platform.policy_links.length ? (
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm print:hidden">
            {platform.policy_links.map((href) => {
              const label = policyLinkLabel(href);
              return label ? (
                <li key={href}>
                  <Link href={href} className="font-semibold text-brand underline underline-offset-4">{label}</Link>
                </li>
              ) : null;
            })}
          </ul>
        ) : null}
      </section>

      <section className="mt-8" aria-labelledby="exp-arrangement">
        <S id="exp-arrangement" className="text-2xl font-semibold">2. Your coaching arrangement</S>
        <p className="mt-1 text-sm text-ink-muted">In {coachName}&rsquo;s words.</p>
        {ARRANGEMENT_FIELDS.filter((f) => coach[f.key].trim()).map((f) => (
          <div key={f.key}>
            <h4 className="mt-4 font-semibold">{f.label}</h4>
            <Text text={coach[f.key]} />
          </div>
        ))}
        {plan ? (
          <div className="mt-6 rounded-lg border border-line p-4">
            <h4 className="font-semibold">What your plan includes — {plan.title}</h4>
            <div className="mt-3"><PlanInclusions plan={plan} /></div>
            <p className="mt-3 text-sm text-ink-muted">
              If anything in this document seems to differ from these plan details, the plan details are what you bought.
            </p>
          </div>
        ) : null}
      </section>

      <section className="mt-8" aria-labelledby="exp-parts">
        <S id="exp-parts" className="text-2xl font-semibold">3. Your part as a client</S>
        <ul className="mt-3 list-disc space-y-1.5 pl-6">
          {coach.client_part.map((item, i) => <li key={i} className="break-words">{item}</li>)}
        </ul>
        <h4 className="mt-5 font-semibold">And in return, {coachName} will</h4>
        <ul className="mt-2 list-disc space-y-1.5 pl-6">
          {coach.coach_part.map((item, i) => <li key={i} className="break-words">{item}</li>)}
        </ul>
        <p className="mt-4 text-sm text-ink-muted">
          Health details, injuries and limitations are shared privately with your coach — never on your public profile or in this document.
        </p>
      </section>
    </article>
  );
}
