import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Coach dashboard: for signed-in users with a provider record. */
export default async function CoachLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24">
        <h1 className="font-display text-2xl">Coach dashboard</h1>
        <p className="mt-4 text-sm text-ink/70">
          Not available yet — Supabase is not configured.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase!.auth.getUser();
  if (!user) redirect("/account/sign-in");

  const { data: provider } = await supabase!
    .from("providers")
    .select("id, display_name")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!provider) redirect("/account");

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-paper-raised">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/coach" className="flex items-center gap-2">
            <Image src="/logo/ghartira-mark.svg" alt="" width={24} height={24} />
            <span className="font-display">Ghartira</span>
            <span className="label text-ink/40">coach</span>
          </Link>
          <p className="font-sans text-sm text-ink/60">{provider.display_name}</p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
    </div>
  );
}
