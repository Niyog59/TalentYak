import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { OfflineNotice } from "@/components/pwa/connection-status";
import { Icon } from "@/components/ui/icon";
import { SampleBanner } from "@/components/ui/sample";

const groups = [
  {
    title: "Public",
    screens: [
      { href: "/preview/home", label: "Homepage", note: "With sample coaches and offers" },
      { href: "/preview/coaches", label: "Coach directory", note: "Sample coaches" },
      { href: "/preview/coaches/sample-coach-a", label: "Coach profile", note: "Coach-created plans and a one-off consultation" },
    ],
  },
  {
    title: "Customer",
    screens: [
      { href: "/preview/customer", label: "Today", note: "Workout, next call, quick weight, feedback" },
      { href: "/preview/customer/workout", label: "Workout logging", note: "Includes a real validation error state" },
      { href: "/preview/customer/progress", label: "Progress", note: "Neutral weight trend, history, feedback" },
    ],
  },
  {
    title: "Coach",
    screens: [
      { href: "/preview/coach", label: "Overview", note: "Needs review, upcoming calls, clients" },
      { href: "/preview/coach/clients/client-a", label: "Client detail", note: "Programme, progress, check-ins, media" },
    ],
  },
  {
    title: "Founder",
    screens: [{ href: "/preview/founder", label: "Operations layout", note: "Compact navigation, responsive tables" }],
  },
  {
    title: "Live states",
    screens: [
      { href: "/coaches", label: "Empty state", note: "The real coach directory before any coach joins" },
      { href: "/preview/this-page-does-not-exist", label: "Page not found", note: "The real not-found page" },
    ],
  },
];

export default function PreviewIndexPage() {
  return (
    <>
      <SampleBanner>
        These screens set the layout and shared components. Buttons that
        aren&rsquo;t built are marked &ldquo;Soon&rdquo;.
      </SampleBanner>
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 md:py-14">
        <Link href="/" aria-label="TalentYak home" className="inline-flex min-h-11 items-center rounded-md">
          <Logo decorative className="text-2xl" />
        </Link>
        <h1 className="mt-8 font-display text-5xl">Reference screens</h1>
        <p className="mt-3 max-w-2xl text-lg text-ink-muted">
          Module M02 design references. Every screen uses sample data and is
          hidden from search engines.
        </p>

        <div className="mt-12 grid gap-10 md:grid-cols-2">
          {groups.map((group) => (
            <section key={group.title} aria-labelledby={`group-${group.title}`}>
              <h2 id={`group-${group.title}`} className="text-xl font-semibold">
                {group.title}
              </h2>
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {group.screens.map((screen) => (
                  <li key={screen.href}>
                    <Link
                      href={screen.href}
                      className="flex min-h-14 items-center justify-between gap-4 py-3 hover:bg-paper-raised"
                    >
                      <span>
                        <span className="block font-semibold">{screen.label}</span>
                        <span className="block text-sm text-ink-muted">{screen.note}</span>
                      </span>
                      <Icon name="arrowRight" className="size-5 shrink-0 text-brand" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section aria-labelledby="offline-heading" className="mt-14">
          <h2 id="offline-heading" className="text-xl font-semibold">
            Connection-loss notice
          </h2>
          <p className="mt-1 text-ink-muted">
            Appears automatically at the top of every page when the device goes
            offline. Shown here as a static example.
          </p>
          <div className="mt-4 overflow-hidden rounded-xl border border-line">
            <OfflineNotice />
          </div>
        </section>
      </main>
    </>
  );
}
