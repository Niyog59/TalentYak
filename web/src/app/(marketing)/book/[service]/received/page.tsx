import { notFound } from "next/navigation";
import { getPublicService } from "@/lib/catalog";
import { ButtonLink } from "@/components/button";

export default async function BookingReceivedPage({
  params,
}: {
  params: Promise<{ service: string }>;
}) {
  const { service: serviceId } = await params;
  // Same launch gate as the booking page: only public services exist here.
  const service = await getPublicService(serviceId);
  if (!service) notFound();

  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <p className="text-sm font-semibold text-brand">Request received</p>
      <h1 className="mt-3 font-display text-4xl">Your request is with us.</h1>
      <p className="mt-4 text-ink-muted">
        We&rsquo;ve received your booking for{" "}
        <span className="font-semibold text-ink">{service.name}</span>. A
        coordinator will review the details and contact you within 24 hours to
        confirm everything before anything is scheduled.
      </p>
      <div className="mt-10">
        <ButtonLink href="/account" variant="secondary">
          Go to your account
        </ButtonLink>
      </div>
    </div>
  );
}
