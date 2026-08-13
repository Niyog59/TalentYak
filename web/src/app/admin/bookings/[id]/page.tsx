import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  nextStatuses,
  statusLabels,
  type BookingStatus,
} from "@/lib/bookings/status";
import { transitionBooking, assignProvider } from "@/lib/bookings/actions";
import { Button } from "@/components/button";

export default async function AdminBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  if (!supabase) return null;

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      "*, services(name, vertical_slug), providers(id, display_name), payments(id, amount_cents, status, kind, created_at), booking_events(id, from_status, to_status, actor, note, created_at)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!booking) notFound();

  const service = Array.isArray(booking.services)
    ? booking.services[0]
    : booking.services;
  const provider = Array.isArray(booking.providers)
    ? booking.providers[0]
    : booking.providers;

  const { data: providers } = await supabase
    .from("providers")
    .select("id, display_name")
    .eq("vertical_slug", booking.vertical_slug)
    .eq("active", true)
    .order("display_name");

  const intake = (booking.intake_response ?? {}) as Record<string, unknown>;
  const events = (booking.booking_events ?? []) as {
    id: string;
    from_status: string | null;
    to_status: string | null;
    actor: string;
    note: string | null;
    created_at: string;
  }[];
  const payments = (booking.payments ?? []) as {
    id: string;
    amount_cents: number;
    status: string;
    kind: string;
    created_at: string;
  }[];

  async function doTransition(formData: FormData) {
    "use server";
    const to = formData.get("to") as BookingStatus;
    await transitionBooking(id, to);
    revalidatePath(`/admin/bookings/${id}`);
  }

  async function doAssign(formData: FormData) {
    "use server";
    const providerId = String(formData.get("provider_id") || "");
    await assignProvider(id, providerId || null);
    revalidatePath(`/admin/bookings/${id}`);
  }

  return (
    <div className="max-w-4xl">
      <p className="label text-ink/50">
        <Link href="/admin/bookings" className="hover:text-terracotta">
          ← Bookings
        </Link>
      </p>
      <div className="mt-4 flex items-baseline justify-between">
        <h1 className="font-display text-3xl">
          {(service as { name: string } | null)?.name ?? "Booking"}
        </h1>
        <span className="label border border-line px-3 py-1.5">
          {statusLabels[booking.status as BookingStatus]}
        </span>
      </div>
      <p className="mt-1 font-sans text-sm text-ink/60">
        {booking.customer_name} · {booking.customer_email} · booked{" "}
        {new Date(booking.created_at).toLocaleString()}
      </p>

      <div className="mt-10 grid gap-10 sm:grid-cols-2">
        {/* Status transitions */}
        <section className="border border-line p-6">
          <h2 className="label mb-4 text-ink/50">Move status</h2>
          <div className="flex flex-wrap gap-2">
            {nextStatuses(booking.status as BookingStatus).map((s) => (
              <form key={s} action={doTransition}>
                <input type="hidden" name="to" value={s} />
                <Button variant="secondary" type="submit">
                  → {statusLabels[s]}
                </Button>
              </form>
            ))}
            {nextStatuses(booking.status as BookingStatus).length === 0 && (
              <p className="text-sm text-ink/60">Terminal status.</p>
            )}
          </div>
        </section>

        {/* Provider matching */}
        <section className="border border-line p-6">
          <h2 className="label mb-4 text-ink/50">Provider</h2>
          <form action={doAssign} className="flex items-center gap-3">
            <select
              name="provider_id"
              defaultValue={(provider as { id: string } | null)?.id ?? ""}
              className="flex-1 rounded-[3px] border border-line bg-white/60 px-3 py-2 font-sans text-sm"
            >
              <option value="">Unassigned</option>
              {(providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
            <Button variant="secondary" type="submit">
              Assign
            </Button>
          </form>
        </section>
      </div>

      {/* Intake responses */}
      <section className="mt-10">
        <h2 className="label mb-4 text-ink/50">Intake details</h2>
        <dl className="max-w-2xl border border-line">
          {Object.entries(intake).map(([key, value]) => (
            <div key={key} className="flex border-b border-line last:border-b-0">
              <dt className="w-48 shrink-0 border-r border-line bg-paper-raised px-4 py-2.5 font-sans text-xs uppercase tracking-wide text-ink/60">
                {key.replaceAll("_", " ")}
              </dt>
              <dd className="px-4 py-2.5 font-sans text-sm">
                {Array.isArray(value) ? value.join(", ") : String(value) || "—"}
              </dd>
            </div>
          ))}
          {Object.keys(intake).length === 0 && (
            <p className="px-4 py-3 text-sm text-ink/60">No intake data.</p>
          )}
        </dl>
      </section>

      {/* Payments */}
      <section className="mt-10">
        <h2 className="label mb-4 text-ink/50">Payments</h2>
        {payments.length > 0 ? (
          <ul className="max-w-2xl font-sans text-sm">
            {payments.map((p) => (
              <li key={p.id} className="rule flex justify-between py-2.5 first:border-t-0">
                <span>
                  ${(p.amount_cents / 100).toFixed(2)} · {p.kind}
                </span>
                <span className="label text-ink/60">{p.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink/60">No payments recorded.</p>
        )}
      </section>

      {/* Audit trail */}
      <section className="mt-10">
        <h2 className="label mb-4 text-ink/50">History</h2>
        <ul className="max-w-2xl font-sans text-sm">
          {events
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((e) => (
              <li key={e.id} className="rule py-2.5 first:border-t-0">
                <span className="text-ink/60">
                  {new Date(e.created_at).toLocaleString()} · {e.actor}
                </span>{" "}
                {e.from_status && e.to_status
                  ? `${e.from_status} → ${e.to_status}`
                  : (e.note ?? "")}
                {e.from_status && e.note && (
                  <span className="text-ink/60"> — {e.note}</span>
                )}
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
