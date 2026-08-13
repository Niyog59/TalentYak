import type { Metadata } from "next";
import Link from "next/link";
import { getVerticals, getServicesByVertical } from "@/lib/catalog";
import { ServiceRow } from "@/components/service-row";
import { SectionLabel } from "@/components/section";

export const metadata: Metadata = { title: "Services" };

export default async function ServicesPage() {
  const verticals = await getVerticals();

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <h1 className="font-display text-4xl">Services</h1>
      <p className="mt-3 max-w-xl text-ink/70">
        Everything we arrange, in one index. Active services can be booked
        today; the rest are on their way.
      </p>

      <div className="mt-14 space-y-16">
        {await Promise.all(
          verticals.map(async (v) => {
            const services = await getServicesByVertical(v.slug);
            return (
              <section key={v.slug}>
                <SectionLabel ne={v.nameNe}>
                  {v.status === "active" ? (
                    <Link
                      href={`/services/${v.slug}`}
                      className="hover:underline"
                    >
                      {v.name}
                    </Link>
                  ) : (
                    <>{v.name} — coming soon</>
                  )}
                </SectionLabel>
                {services.length > 0 ? (
                  <ul>
                    {services.map((s) => (
                      <ServiceRow key={s.id} service={s} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink/60">{v.tagline}</p>
                )}
              </section>
            );
          }),
        )}
      </div>
    </div>
  );
}
