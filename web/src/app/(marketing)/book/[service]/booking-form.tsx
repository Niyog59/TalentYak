"use client";

import { useActionState } from "react";
import type { IntakeField } from "@/lib/catalog/types";
import { createBooking } from "@/lib/bookings/actions";
import { IntakeFields } from "@/components/intake-form";
import { Button } from "@/components/button";

const inputClass =
  "w-full rounded-[3px] border border-line bg-white/60 px-4 py-3 font-sans text-sm outline-none focus:border-ink";

export function BookingForm({
  serviceId,
  fields,
}: {
  serviceId: string;
  fields: IntakeField[];
}) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string } | null, formData: FormData) => {
      const result = await createBooking(serviceId, formData);
      return result.ok ? null : { error: result.error };
    },
    null,
  );

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <label className="block">
          <span className="label mb-2 block text-ink/60">
            Your name <span className="text-terracotta">*</span>
          </span>
          <input
            type="text"
            name="customer_name"
            required
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="label mb-2 block text-ink/60">
            Email <span className="text-terracotta">*</span>
          </span>
          <input
            type="email"
            name="customer_email"
            required
            className={inputClass}
          />
        </label>
      </div>

      {fields.length > 0 && (
        <div className="rule space-y-6 pt-6">
          <IntakeFields fields={fields} />
        </div>
      )}

      <div className="rule pt-6">
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Submitting…" : "Continue to payment"}
        </Button>
        <p className="mt-3 text-center text-xs text-ink/50">
          Secure card payment. Fully refundable until we confirm your booking.
        </p>
      </div>

      {state?.error && (
        <p className="border border-terracotta/40 bg-paper-raised p-4 text-sm text-terracotta-dark">
          {state.error}
        </p>
      )}
    </form>
  );
}
