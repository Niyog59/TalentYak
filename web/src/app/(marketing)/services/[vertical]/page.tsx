import { notFound } from "next/navigation";
import { getVertical, getServicesByVertical } from "@/lib/catalog";
import { ServiceRow } from "@/components/service-row";

export default async function VerticalPage({
  params,
}: {
  params: Promise<{ vertical: string }>;
}) {
  const { vertical: slug } = await params;
  const vertical = await getVertical(slug);
  if (!vertical) notFound();

  const services = await getServicesByVertical(slug);

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="flex items-baseline gap-4">
        <h1 className="font-display text-4xl">{vertical.name}</h1>
        {vertical.nameNe && (
          <span className="devanagari text-xl text-ink/40">
            {vertical.nameNe}
          </span>
        )}
      </div>
      <p className="mt-4 max-w-2xl leading-relaxed text-ink/80">
        {vertical.description}
      </p>

      {vertical.status === "coming_soon" && (
        <p className="label mt-6 text-terracotta">
          Coming soon — services listed for reference
        </p>
      )}

      <ul className="mt-12">
        {services.map((s) => (
          <ServiceRow key={s.id} service={s} />
        ))}
      </ul>
    </div>
  );
}
