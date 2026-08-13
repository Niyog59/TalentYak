import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { SectionLabel } from "@/components/section";
import { Button } from "@/components/button";

export const metadata: Metadata = { title: "Your account" };

interface BookingRow {
  id: string;
  status: string;
  created_at: string;
  scheduled_at: string | null;
  services: { name: string } | null;
}

export default async function AccountPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="font-display text-3xl">Your account</h1>
        <p className="mt-4 leading-relaxed text-ink/75">
          Accounts are not live yet. Bookings currently run through our
          concierge — email{" "}
          <a href="mailto:hello@ghartira.com" className="text-terracotta">
            hello@ghartira.com
          </a>{" "}
          and a coordinator will take care of you.
        </p>
      </div>
    );
  }

  const profile = await getProfile();
  if (!profile) redirect("/account/sign-in");

  const supabase = await createClient();
  const { data: bookings } = await supabase!
    .from("bookings")
    .select("id, status, created_at, scheduled_at, services(name)")
    .eq("customer_id", profile.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-3xl">
            {profile.full_name || profile.email}
          </h1>
          <p className="mt-1 text-sm text-ink/60">{profile.email}</p>
        </div>
        <form action="/auth/signout" method="post">
          <Button variant="link" type="submit">
            Sign out
          </Button>
        </form>
      </div>

      <section className="mt-14">
        <SectionLabel>Your bookings</SectionLabel>
        {bookings && bookings.length > 0 ? (
          <ul>
            {(bookings as unknown as BookingRow[]).map((b) => (
              <li key={b.id} className="rule flex items-baseline justify-between py-4 first:border-t-0">
                <div>
                  <p className="font-display">{b.services?.name ?? "Service"}</p>
                  <p className="mt-0.5 text-xs text-ink/50">
                    Booked {new Date(b.created_at).toLocaleDateString()}
                    {b.scheduled_at &&
                      ` · scheduled ${new Date(b.scheduled_at).toLocaleDateString()}`}
                  </p>
                </div>
                <span className="label text-ink/60">{b.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink/60">
            No bookings yet.{" "}
            <Link href="/services" className="text-terracotta">
              Browse services
            </Link>{" "}
            to get started.
          </p>
        )}
      </section>
    </div>
  );
}
