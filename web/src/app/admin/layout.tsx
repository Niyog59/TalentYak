import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { stripeMode } from "@/lib/payments/stripe";
import { isLiveBillingFlagSet } from "@/lib/policy/live-gate";
import { getModules } from "@/verticals/registry";
import { analyticsAppUrl } from "@/lib/analytics/posthog";
import { Logo } from "@/components/brand/logo";
import { AdminShell, type EnvironmentLabel } from "@/components/admin/admin-shell";
import { adminNav } from "@/components/admin/admin-nav";

// Admin is always rendered per-request: it reads live data and
// depends on the caller's session.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Founder panel", template: "%s · Founder · TalentYak" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-20">
        <Logo className="self-start text-2xl" />
        <h1 className="mt-12 font-display text-4xl">Founder panel</h1>
        <p className="mt-3 text-ink-muted">The database isn&rsquo;t connected in this environment.</p>
      </main>
    );
  }

  // Admin role AND a completed second factor in this session, or a redirect to
  // verify. Every page and action checks again, and the database enforces the
  // same rule on every admin function and table.
  const session = await requireAdmin("/admin");

  const serviceTools = getModules()
    .filter((m) => m.adminHref)
    .map((m) => ({ label: m.vertical.name, href: m.adminHref! }));

  return (
    <AdminShell
      groups={adminNav({ serviceTools, analyticsUrl: analyticsAppUrl() })}
      identity={{ name: session.profile.full_name || "Founder", email: session.email }}
      environment={await environmentLabels()}
    >
      {children}
    </AdminShell>
  );
}

/**
 * Where this is running, stated plainly: the website deployment, the
 * database it talks to, and whether payments are real. A production website
 * on the shared test database is shown as a warning, because it is one.
 */
async function environmentLabels(): Promise<EnvironmentLabel[]> {
  const site = process.env.VERCEL_ENV === "production" ? "Production" : process.env.VERCEL_ENV === "preview" ? "Preview" : "Local";
  const supabase = await createClient();
  const { data } = supabase ? await supabase.from("platform_environment").select("kind").maybeSingle() : { data: null };
  const db = (data?.kind as "test" | "production" | undefined) ?? null;
  const stripe = stripeMode();

  return [
    { label: "Site", value: site, tone: site === "Production" ? "live" : "neutral" },
    {
      label: "Database",
      value: db === "production" ? "Production" : db === "test" ? "Test (shared)" : "Unknown",
      tone: db === "production" ? "live" : site === "Production" ? "warn" : "test",
    },
    {
      label: "Payments",
      value: stripe === "live" ? (isLiveBillingFlagSet() ? "Live" : "Live keys, sales locked") : stripe === "test" ? "Test mode" : "Not configured",
      tone: stripe === "live" ? "live" : stripe === "test" ? "test" : "warn",
    },
  ];
}
