import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { stripeMode } from "@/lib/payments/stripe";
import { getModules } from "@/verticals/registry";
import { Logo } from "@/components/brand/logo";
import { AppShell } from "@/components/shell/app-shell";
import { founderNav } from "@/components/shell/nav";

// Admin is always rendered per-request: it reads live data and
// depends on the caller's session.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Founder console", template: "%s · Founder · TalentYak" },
  robots: { index: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-20">
        <Logo className="self-start text-2xl" />
        <h1 className="mt-12 font-display text-4xl">Founder console</h1>
        <p className="mt-3 text-ink-muted">The database isn&rsquo;t connected in this environment.</p>
      </main>
    );
  }

  // Admin role AND a completed second factor in this session, or a redirect to
  // verify. The database enforces the same rule on every admin function.
  const session = await requireAdmin("/admin");

  const serviceTools = getModules()
    .filter((m) => m.adminHref)
    .map((m) => ({ label: m.vertical.name, href: m.adminHref! }));

  const mode = stripeMode();

  return (
    <AppShell
      nav={founderNav("/admin", { real: true, serviceTools })}
      identity={{ name: session.profile.full_name || session.email, detail: "Founder" }}
      banner={
        <p className="bg-paper-raised px-4 py-2 text-center text-sm font-medium">
          {mode === "live"
            ? "Stripe LIVE key configured. Real sales still need every launch lock open."
            : mode === "test"
              ? "Stripe test mode — no real money moves."
              : "Stripe not configured."}
        </p>
      }
    >
      {children}
    </AppShell>
  );
}
