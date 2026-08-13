import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { statusLabels, type BookingStatus } from "@/lib/bookings/status";

const filters: (BookingStatus | "all")[] = [
  "all",
  "requested",
  "confirmed",
  "scheduled",
  "delivered",
  "completed",
  "cancelled",
  "refunded",
];

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const supabase = await createClient();
  if (!supabase) return null;

  let query = supabase
    .from("bookings")
    .select(
      "id, status, vertical_slug, customer_name, customer_email, created_at, scheduled_at, services(name), providers(display_name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (status && status !== "all") query = query.eq("status", status);
  const { data: bookings } = await query;

  return (
    <div>
      <h1 className="font-display text-3xl">Bookings</h1>

      <div className="mt-6 flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/admin/bookings" : `/admin/bookings?status=${f}`}
            className={`label rounded-[3px] border px-3 py-1.5 ${
              (status ?? "all") === f
                ? "border-ink bg-ink text-paper"
                : "border-line text-ink/60 hover:border-ink"
            }`}
          >
            {f === "all" ? "All" : statusLabels[f as BookingStatus]}
          </Link>
        ))}
      </div>

      <table className="mt-8 w-full max-w-5xl border-collapse font-sans text-sm">
        <thead>
          <tr className="rule border-b border-line text-left">
            <th className="label py-3 pr-4 font-medium text-ink/50">Service</th>
            <th className="label py-3 pr-4 font-medium text-ink/50">Customer</th>
            <th className="label py-3 pr-4 font-medium text-ink/50">Provider</th>
            <th className="label py-3 pr-4 font-medium text-ink/50">Status</th>
            <th className="label py-3 font-medium text-ink/50">Created</th>
          </tr>
        </thead>
        <tbody>
          {(bookings ?? []).map((b) => {
            const service = Array.isArray(b.services) ? b.services[0] : b.services;
            const provider = Array.isArray(b.providers) ? b.providers[0] : b.providers;
            return (
              <tr key={b.id} className="border-b border-line hover:bg-paper-raised">
                <td className="py-3 pr-4">
                  <Link href={`/admin/bookings/${b.id}`} className="hover:text-terracotta">
                    {(service as { name: string } | null)?.name ?? b.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="py-3 pr-4">{b.customer_name ?? b.customer_email}</td>
                <td className="py-3 pr-4 text-ink/60">
                  {(provider as { display_name: string } | null)?.display_name ?? "—"}
                </td>
                <td className="py-3 pr-4">
                  <span className="label">{b.status}</span>
                </td>
                <td className="py-3 text-ink/60">
                  {new Date(b.created_at).toLocaleDateString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(bookings ?? []).length === 0 && (
        <p className="mt-6 text-sm text-ink/60">No bookings match.</p>
      )}
    </div>
  );
}
