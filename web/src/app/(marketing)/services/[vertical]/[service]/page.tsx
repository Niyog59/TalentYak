import Link from "next/link";
import { notFound } from "next/navigation";
import { getService, getVertical, getServicesByVertical } from "@/lib/catalog";
import { formatPrice } from "@/lib/catalog/types";
import { ButtonLink } from "@/components/button";
import { SectionLabel } from "@/components/section";

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ vertical: string; service: string }>;
}) {
  const { vertical: verticalSlug, service: serviceId } = await params;
  const [vertical, service] = await Promise.all([
    getVertical(verticalSlug),
    getService(serviceId),
  ]);
  if (!vertical || !service || service.verticalSlug !== verticalSlug) {
    notFound();
  }

  const siblings = (await getServicesByVertical(verticalSlug)).filter(
    (s) => s.id !== service.id,
  );
  const bookable = service.status === "active";

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <p className="label text-ink/50">
        <Link href="/services" className="hover:text-terracotta">
          Services
        </Link>{" "}
        /{" "}
        <Link
          href={`/services/${vertical.slug}`}
          className="hover:text-terracotta"
        >
          {vertical.name}
        </Link>
      </p>

      <div className="mt-8 grid gap-14 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <h1 className="font-display text-4xl leading-tight">
            {service.name}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink/80">
            {service.description}
          </p>

          <div className="rule mt-10 pt-8">
            <p className="label mb-3 text-ink/50">Included in every booking</p>
            <ul className="max-w-xl space-y-2 text-sm leading-relaxed text-ink/80">
              <li>A named coordinator you can reach directly, in Nepali or English</li>
              <li>Confirmation before anything is scheduled — no surprises</li>
              <li>Recordings and documentation are always included, never an upsell</li>
              <li>If anything is not done right, we make it right</li>
            </ul>
          </div>
        </div>

        <aside>
          <div className="border border-line bg-paper-raised p-7">
            <p className="font-sans text-3xl font-medium">
              {formatPrice(service)}
            </p>
            {service.priceNote && (
              <p className="mt-1 font-sans text-xs text-ink/60">
                {service.priceNote}
              </p>
            )}
            <div className="mt-6">
              {bookable ? (
                <ButtonLink href={`/book/${service.id}`} className="w-full text-center">
                  Book this service
                </ButtonLink>
              ) : (
                <p className="label text-terracotta">Coming soon</p>
              )}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-ink/60">
              Payment is taken securely by card. Nothing is charged until you
              confirm the details with us.
            </p>
          </div>
        </aside>
      </div>

      {siblings.length > 0 && (
        <section className="mt-20">
          <SectionLabel>Also in {vertical.name}</SectionLabel>
          <ul className="grid gap-x-10 sm:grid-cols-2">
            {siblings.slice(0, 4).map((s) => (
              <li key={s.id} className="rule py-4">
                <Link
                  href={`/services/${vertical.slug}/${s.id}`}
                  className="flex items-baseline justify-between gap-4 hover:text-terracotta"
                >
                  <span className="font-display">{s.name}</span>
                  <span className="font-sans text-sm">{formatPrice(s)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
