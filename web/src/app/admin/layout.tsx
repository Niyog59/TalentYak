import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { getModules } from "@/verticals/registry";

// Admin is always rendered per-request: it reads live data and
// depends on the caller's session.
export const dynamic = "force-dynamic";

const coreLinks = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/providers", label: "Providers" },
  { href: "/admin/catalog", label: "Catalog" },
  { href: "/admin/payouts", label: "Payouts" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24">
        <h1 className="font-display text-2xl">Admin console</h1>
        <p className="mt-4 text-sm leading-relaxed text-ink/70">
          Supabase is not configured yet. Set NEXT_PUBLIC_SUPABASE_URL and
          keys in .env.local, run the migrations in supabase/migrations/,
          and set your profile role to admin.
        </p>
      </div>
    );
  }

  if (!(await isAdmin())) redirect("/account/sign-in");

  // Per-vertical admin panels plug in via the registry.
  const verticalLinks = getModules()
    .filter((m) => m.adminHref)
    .map((m) => ({ href: m.adminHref!, label: m.vertical.name }));

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-line bg-paper-raised px-5 py-8">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo/ghartira-mark.svg" alt="" width={24} height={24} />
          <span className="font-display">Ghartira</span>
          <span className="label text-ink/40">ops</span>
        </Link>
        <nav className="mt-10 space-y-1">
          {coreLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="block rounded-[3px] px-3 py-2 font-sans text-sm hover:bg-paper"
            >
              {l.label}
            </Link>
          ))}
          <p className="label px-3 pb-1 pt-6 text-ink/40">Verticals</p>
          {verticalLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="block rounded-[3px] px-3 py-2 font-sans text-sm hover:bg-paper"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 px-10 py-10">{children}</main>
    </div>
  );
}
