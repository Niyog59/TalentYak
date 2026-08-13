import Link from "next/link";
import { getVerticals, getServicesByVertical } from "@/lib/catalog";
import { ButtonLink } from "@/components/button";
import { SectionLabel, PullQuote } from "@/components/section";
import { ServiceRow } from "@/components/service-row";

export default async function HomePage() {
  const verticals = await getVerticals();
  const active = verticals.filter((v) => v.status === "active");
  const comingSoon = verticals.filter((v) => v.status === "coming_soon");
  // Featured rows: the first active vertical's services lead the index.
  const featured = active[0]
    ? await getServicesByVertical(active[0].slug)
    : [];

  return (
    <div className="mx-auto max-w-6xl px-6">
      {/* Hero — asymmetric, left-aligned */}
      <section className="grid gap-12 py-20 sm:grid-cols-5 sm:py-28">
        <div className="sm:col-span-3">
          <p className="devanagari mb-4 text-ink/50">घरतिर · toward home</p>
          <h1 className="font-display text-5xl leading-[1.05] sm:text-6xl">
            Some things must still happen at home.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink/80">
            Ghartira arranges what your family needs done in Nepal — ancestral
            rites at the right temple on the right tithi, coaching from people
            who know your kitchen, help you can actually trust — handled on
            your behalf, wherever you live now.
          </p>
          <div className="mt-8 flex items-center gap-6">
            <ButtonLink href="/services">See our services</ButtonLink>
            <ButtonLink href="/how-it-works" variant="link">
              How it works
            </ButtonLink>
          </div>
        </div>
        <div className="hidden sm:col-span-2 sm:block">
          <div className="flex h-full items-center justify-center border border-line bg-paper-raised p-10">
            <div className="text-center">
              <p className="font-display text-7xl text-terracotta">
                {new Intl.NumberFormat().format(300000)}+
              </p>
              <p className="label mt-3 text-ink/60">
                Nepali households abroad
              </p>
              <p className="mt-4 max-w-[24ch] text-sm leading-relaxed text-ink/60">
                US · UK · Australia · Japan · Canada — all with family, duties,
                and roots back home.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What we do — verticals */}
      <section className="py-14">
        <SectionLabel ne="सेवाहरू">What we handle</SectionLabel>
        <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2">
          {[...active, ...comingSoon].map((v) => (
            <div key={v.slug} className="rule pt-6 first:sm:border-t-0">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-2xl">
                  {v.status === "active" ? (
                    <Link
                      href={`/services/${v.slug}`}
                      className="hover:text-terracotta"
                    >
                      {v.name}
                    </Link>
                  ) : (
                    v.name
                  )}
                </h2>
                <span className="label text-ink/40">
                  {v.status === "active" ? "Available now" : "Coming soon"}
                </span>
              </div>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-ink/70">
                {v.tagline}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Featured service index */}
      {active[0] && featured.length > 0 && (
        <section className="py-14">
          <SectionLabel ne={active[0].nameNe}>
            {active[0].name} — available now
          </SectionLabel>
          <ul>
            {featured.slice(0, 4).map((s) => (
              <ServiceRow key={s.id} service={s} />
            ))}
          </ul>
          <div className="mt-6">
            <ButtonLink href={`/services/${active[0].slug}`} variant="link">
              All {active[0].name.toLowerCase()} services
            </ButtonLink>
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="py-14">
        <SectionLabel>How it works</SectionLabel>
        <ol className="grid gap-10 sm:grid-cols-3">
          {[
            {
              n: "1",
              title: "Tell us what you need",
              body: "Choose a service and give us the details — the tithi and tradition, the goal, the deadline. Five minutes, once.",
            },
            {
              n: "2",
              title: "We arrange it in Nepal",
              body: "We match the right professional, agree the schedule, and handle everything on the ground on your behalf.",
            },
            {
              n: "3",
              title: "You see it done",
              body: "Join by video, receive the recording and photos, or get the deliverable — with a real person to call if anything needs fixing.",
            },
          ].map((step) => (
            <li key={step.n}>
              <p className="font-display text-5xl text-terracotta">{step.n}</p>
              <h3 className="mt-3 font-display text-xl">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink/70">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* Testimonial */}
      <section className="py-14">
        <PullQuote
          quote="The shraddha happened at Gokarna on the exact tithi, the way my father would have wanted. We joined from Texas and my mother cried — in a good way."
          attribution="Early family, Houston — September pilot"
        />
      </section>

      {/* Closing */}
      <section className="py-20 text-center">
        <h2 className="mx-auto max-w-2xl font-display text-3xl leading-snug">
          You left. Your responsibilities didn&rsquo;t.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-ink/70">
          Let us carry the ones that must happen at home.
        </p>
        <div className="mt-8">
          <ButtonLink href="/services">Browse services</ButtonLink>
        </div>
      </section>
    </div>
  );
}
