"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { canTransition, type BookingStatus } from "@/lib/bookings/status";


export interface CreateBookingResult {
  ok: boolean;
  error?: string;
}

/**
 * RETIRED purchase path.
 *
 * Bookings used to be created here and sent straight to a Stripe Checkout
 * built by the old `createCheckoutSession`, which applied a three-month billing
 * interval to every subscription regardless of what was being sold, and
 * accepted guests with no account. Coaching is now bought from a coach's own
 * published offer through `startCheckout`, with server pricing, capacity holds,
 * and an account.
 *
 * Kept as a function that refuses, because server actions can be invoked
 * directly: removing the export would not remove old client bundles that still
 * reference it. The `bookings` table and its history are untouched.
 */
export async function createBooking(
  _serviceId: string,
  _formData: FormData,
): Promise<CreateBookingResult> {
  return {
    ok: false,
    error: "Booking through this form has closed. Choose a coach and one of their plans instead.",
  };
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
