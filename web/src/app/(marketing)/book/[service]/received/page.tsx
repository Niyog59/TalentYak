import Link from "next/link";
import { notFound } from "next/navigation";
import { getService } from "@/lib/catalog";

export default async function BookingReceivedPage({
  params,
}: {
  params: Promise<{ service: string }>;
}) {
  const { service: serviceId } = await params;
  const service = await getService(serviceId);
  if (!service) notFound();

  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <p className="devanagari text-ink/40">धन्यवाद</p>
      <h1 className="mt-3 font-display text-3xl">Your request is with us.</h1>
      <p className="mt-4 leading-relaxed text-ink/75">
        We&rsquo;ve received your booking for{" "}
        <span className="font-medium">{service.name}</span>. A coordinator
        will review the details and contact you within 24 hours to confirm
        everything before anything is scheduled.
      </p>
      <div className="mt-10">
        <Link href="/services" className="label text-terracotta">
          Back to services
        </Link>
      </div>
    </div>
  );
}
