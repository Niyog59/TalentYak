import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const HOURS_48 = 48 * 60 * 60 * 1000;

export default async function AdminFitnessPage() {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data: bookings } = await supabase
    .from("bookings")
    .select(
      "id, status, customer_name, customer_email, created_at, provider_id, services(name), providers(display_name)",
    )
    .eq("vertical_slug", "fitness")
    .not("status", "in", "(cancelled,refunded,completed)")
    .order("created_at", { ascending: false });

  const rows = (bookings ?? []).map((b) => ({
    ...b,
    service: Array.isArray(b.services) ? b.services[0] : b.services,
    provider: Array.isArray(b.providers) ? b.providers[0] : b.providers,
  }));
  const unassigned = rows.filter((b) => !b.provider_id);
  const assigned = rows.filter((b) => b.provider_id);

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-3xl">Fitness Coaching</h1>
      <p className="mt-2 max-w-xl font-sans text-sm text-ink/60">
        Every paid client must have a coach within 48 hours. Coaches work
        from their own dashboard at /coach.
      </p>

      <section className="mt-10">
        <h2 className="label mb-4 text-ink/50">
          Needs a coach ({unassigned.length})
        </h2>
        {unassigned.length > 0 ? (
          <ul className="font-sans text-sm">
            {unassigned.map((b) => {
              const ageMs = Date.now() - new Date(b.created_at).getTime();
              const overdue = ageMs > HOURS_48;
              return (
                <li key={b.id} className="rule flex items-baseline justify-between py-3 first:border-t-0">
                  <Link href={`/admin/bookings/${b.id}`} className="hover:text-terracotta">
                    {(b.service as { name: string } | null)?.name}
                    <span className="text-ink/50"> · {b.customer_name ?? b.customer_email}</span>
                  </Link>
                  <span className={`label ${overdue ? "text-terracotta" : "text-ink/50"}`}>
                    {Math.round(ageMs / 3600000)}h waiting{overdue && " — overdue"}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink/60">Everyone has a coach.</p>
        )}
      </section>

      <section className="mt-12">
        <h2 className="label mb-4 text-ink/50">
          Active clients ({assigned.length})
        </h2>
        {assigned.length > 0 ? (
          <ul className="font-sans text-sm">
            {assigned.map((b) => (
              <li key={b.id} className="rule flex items-baseline justify-between py-3 first:border-t-0">
                <Link href={`/admin/bookings/${b.id}`} className="hover:text-terracotta">
                  {b.customer_name ?? b.customer_email}
                  <span className="text-ink/50">
                    {" "}· {(b.service as { name: string } | null)?.name}
                  </span>
                </Link>
                <span className="text-ink/60">
                  Coach: {(b.provider as { display_name: string } | null)?.display_name}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink/60">No active clients yet.</p>
        )}
      </section>
    </div>
  );
}
