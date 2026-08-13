import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { statusLabels, type BookingStatus } from "@/lib/bookings/status";

export default async function AdminOverviewPage() {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, status, customer_name, customer_email, created_at, services(name)")
    .order("created_at", { ascending: false })
    .limit(10);

  const counts: Record<string, number> = {};
  const { data: allStatuses } = await supabase.from("bookings").select("status");
  for (const row of allStatuses ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }

  const statusOrder: BookingStatus[] = [
    "requested",
    "confirmed",
    "scheduled",
    "delivered",
    "completed",
  ];

  return (
    <div>
      <h1 className="font-display text-3xl">Overview</h1>

      <div className="mt-8 grid max-w-3xl grid-cols-5 gap-px border border-line bg-line">
        {statusOrder.map((s) => (
          <Link
            key={s}
            href={`/admin/bookings?status=${s}`}
            className="bg-paper p-4 hover:bg-paper-raised"
          >
            <p className="font-display text-3xl">{counts[s] ?? 0}</p>
            <p className="label mt-1 text-ink/50">{statusLabels[s]}</p>
          </Link>
        ))}
      </div>

      <h2 className="label mt-12 mb-4 text-ink/50">Latest bookings</h2>
      <ul className="max-w-3xl">
        {(bookings ?? []).map((b) => {
          const service = Array.isArray(b.services) ? b.services[0] : b.services;
          return (
            <li key={b.id} className="rule first:border-t-0">
              <Link
                href={`/admin/bookings/${b.id}`}
                className="flex items-baseline justify-between gap-4 py-3 hover:text-terracotta"
              >
                <span className="font-sans text-sm">
                  {(service as { name: string } | null)?.name ?? b.id.slice(0, 8)}
                  <span className="text-ink/50"> · {b.customer_name ?? b.customer_email}</span>
                </span>
                <span className="label text-ink/50">{b.status}</span>
              </Link>
            </li>
          );
        })}
        {(bookings ?? []).length === 0 && (
          <p className="text-sm text-ink/60">No bookings yet.</p>
        )}
      </ul>
    </div>
  );
}
