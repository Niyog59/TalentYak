import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function CoachHomePage() {
  const supabase = await createClient();
  if (!supabase) return null;

  // RLS limits this to bookings assigned to the signed-in coach.
  const { data: clients } = await supabase
    .from("bookings")
    .select("id, customer_name, customer_email, status, created_at, services(name)")
    .in("status", ["confirmed", "scheduled", "delivered"])
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="font-display text-3xl">Your clients</h1>
      <ul className="mt-8 max-w-3xl font-sans text-sm">
        {(clients ?? []).map((c) => {
          const service = Array.isArray(c.services) ? c.services[0] : c.services;
          return (
            <li key={c.id} className="rule first:border-t-0">
              <Link
                href={`/coach/clients/${c.id}`}
                className="flex items-baseline justify-between py-4 hover:text-terracotta"
              >
                <span>
                  {c.customer_name ?? c.customer_email}
                  <span className="text-ink/50">
                    {" "}· {(service as { name: string } | null)?.name}
                  </span>
                </span>
                <span className="label text-ink/50">{c.status}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {(clients ?? []).length === 0 && (
        <p className="mt-8 text-sm text-ink/60">
          No clients assigned yet. You&rsquo;ll get an email when a client is
          matched to you.
        </p>
      )}
    </div>
  );
}
