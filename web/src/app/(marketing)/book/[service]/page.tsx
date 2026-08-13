import Link from "next/link";
import { notFound } from "next/navigation";
import { getService, getIntakeSchema } from "@/lib/catalog";
import { formatPrice } from "@/lib/catalog/types";
import { BookingForm } from "./booking-form";

export default async function BookServicePage({
  params,
}: {
  params: Promise<{ service: string }>;
}) {
  const { service: serviceId } = await params;
  const service = await getService(serviceId);
  if (!service || service.status !== "active") notFound();

  const schema = getIntakeSchema(serviceId);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="label text-ink/50">
        <Link
          href={`/services/${service.verticalSlug}/${service.id}`}
          className="hover:text-terracotta"
        >
          ← {service.name}
        </Link>
      </p>
      <h1 className="mt-4 font-display text-3xl">Book: {service.name}</h1>
      <p className="mt-2 font-sans text-sm text-ink/70">
        {formatPrice(service)}
        {service.priceNote && ` · ${service.priceNote}`}
      </p>
      <p className="mt-4 text-sm leading-relaxed text-ink/70">
        Fill in the details below. We review every booking personally and
        confirm with you before anything is scheduled.
      </p>

      <div className="mt-10">
        <BookingForm
          serviceId={service.id}
          fields={schema?.fields ?? []}
        />
      </div>
    </div>
  );
}
