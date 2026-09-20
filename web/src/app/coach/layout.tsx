import type { Metadata } from "next";
import { requireCoach } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { Logo } from "@/components/brand/logo";
import { AppShell } from "@/components/shell/app-shell";
import { coachNav } from "@/components/shell/nav";
import { PROVIDER_STATUS_LABEL } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Coach area", template: "%s · Coach · TalentYak" },
  robots: { index: false },
};

/** Coach area: signed in, onboarded, with a coach record that is not retired. */
export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-20">
        <Logo className="self-start text-2xl" />
        <h1 className="mt-12 font-display text-4xl">Coach area</h1>
        <p className="mt-3 text-ink-muted">This area needs the database to be connected.</p>
      </main>
    );
  }

  const session = await requireCoach("/coach");
  const { provider } = session;
  const suspended = provider.status === "suspended" || Boolean(provider.suspended_at);

  return (
    <AppShell
      nav={coachNav("/coach", { clientsIndex: true, extras: true })}
      identity={{ name: provider.display_name, detail: PROVIDER_STATUS_LABEL[provider.status] ?? "Coach" }}
      banner={
        suspended ? (
          <p role="alert" className="bg-danger-tint px-4 py-3 text-center font-medium">
            Your coach account is suspended. Your profile is hidden and you can&rsquo;t take new clients. Contact TalentYak support for details.
          </p>
        ) : null
      }
    >
      {children}
    </AppShell>
  );
}
