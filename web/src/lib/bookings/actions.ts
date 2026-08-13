"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getService, getIntakeSchema } from "@/lib/catalog";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth";
import { isStripeConfigured, isSupabaseConfigured } from "@/lib/env";
import { canTransition, type BookingStatus } from "@/lib/bookings/status";

const contactSchema = z.object({
  customerName: z.string().min(1, "Please tell us your name"),
  customerEmail: z.string().email("Please enter a valid email"),
});

export interface CreateBookingResult {
  ok: boolean;
  error?: string;
}

/**
 * Creates a booking from the intake form, then sends the customer to
 * Stripe Checkout. Guests can book (agency phase) — customer_id is
 * attached when a signed-in user books.
 */
export async function createBooking(
  serviceId: string,
  formData: FormData,
): Promise<CreateBookingResult> {
  const service = await getService(serviceId);
  if (!service || service.status !== "active") {
    return { ok: false, error: "This service is not currently bookable." };
  }

  const contact = contactSchema.safeParse({
    customerName: formData.get("customer_name"),
    customerEmail: formData.get("customer_email"),
  });
  if (!contact.success) {
    return { ok: false, error: contact.error.issues[0].message };
  }

  // Collect intake responses against the registered schema.
  const schema = getIntakeSchema(serviceId);
  const intakeResponse: Record<string, string | string[]> = {};
  for (const field of schema?.fields ?? []) {
    const values = formData.getAll(`intake_${field.key}`).map(String);
    if (field.required && values.every((v) => v.trim() === "")) {
      return { ok: false, error: `Please fill in "${field.label}".` };
    }
    intakeResponse[field.key] =
      field.type === "checkbox" ? values : (values[0] ?? "");
  }

  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error:
        "Online booking is not live yet. Email hello@ghartira.com and our concierge will arrange this for you.",
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: "Booking system unavailable. Please email us." };
  }

  const user = await getUser();
  const { data: booking, error } = await admin
    .from("bookings")
    .insert({
      service_id: service.id,
      vertical_slug: service.verticalSlug,
      customer_id: user?.id ?? null,
      customer_email: contact.data.customerEmail,
      customer_name: contact.data.customerName,
      intake_response: intakeResponse,
      intake_schema_version: schema?.version ?? 1,
    })
    .select("id")
    .single();

  if (error || !booking) {
    return { ok: false, error: "Could not create the booking. Please try again." };
  }

  await admin.from("booking_events").insert({
    booking_id: booking.id,
    to_status: "requested",
    actor: "customer",
    note: "Booking created from intake form",
  });

  const { enqueueJob } = await import("@/lib/jobs");
  await enqueueJob({
    kind: "booking_confirmation",
    recipientEmail: contact.data.customerEmail,
    subject: `We received your booking — ${service.name}`,
    payload: {
      customerName: contact.data.customerName,
      serviceName: service.name,
    },
    bookingId: booking.id,
  });

  if (isStripeConfigured()) {
    const { createCheckoutSession } = await import("@/lib/payments/checkout");
    const url = await createCheckoutSession(booking.id, service, {
      email: contact.data.customerEmail,
    });
    if (url) redirect(url);
  }

  redirect(`/book/${service.id}/received?booking=${booking.id}`);
}

/**
 * Admin-only status transition, enforcing the status machine and
 * writing the audit event.
 */
export async function transitionBooking(
  bookingId: string,
  to: BookingStatus,
  note?: string,
): Promise<CreateBookingResult> {
  const { isAdmin } = await import("@/lib/auth");
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Not configured." };

  const { data: booking } = await admin
    .from("bookings")
    .select("status")
    .eq("id", bookingId)
    .single();
  if (!booking) return { ok: false, error: "Booking not found." };

  const from = booking.status as BookingStatus;
  if (!canTransition(from, to)) {
    return { ok: false, error: `Cannot move from ${from} to ${to}.` };
  }

  await admin.from("bookings").update({ status: to }).eq("id", bookingId);
  await admin.from("booking_events").insert({
    booking_id: bookingId,
    from_status: from,
    to_status: to,
    actor: "admin",
    note: note ?? null,
  });

  return { ok: true };
}

/** Admin-only provider assignment (founder matching, agency phase). */
export async function assignProvider(
  bookingId: string,
  providerId: string | null,
): Promise<CreateBookingResult> {
  const { isAdmin } = await import("@/lib/auth");
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Not configured." };

  await admin
    .from("bookings")
    .update({ provider_id: providerId })
    .eq("id", bookingId);
  await admin.from("booking_events").insert({
    booking_id: bookingId,
    actor: "admin",
    note: providerId ? `Provider assigned: ${providerId}` : "Provider unassigned",
  });

  return { ok: true };
}
