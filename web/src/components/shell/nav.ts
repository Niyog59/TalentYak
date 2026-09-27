import type { IconName } from "@/components/ui/icon";

/*
 * Navigation for the signed-in areas.
 *
 * Each area takes a base path, so the real routes (/coach, /admin) and the
 * reference screens (/preview/...) share one definition. An item whose feature
 * is not built is marked unavailable: it renders visibly disabled, never as a
 * link to a page that does not exist.
 *
 * Shared vs service-specific: the shell, account, messages and earnings items
 * belong to the TalentYak platform. Today, Training and Progress are fitness
 * items. When a customer uses more than one service, `service` becomes the
 * "My services" switcher — see docs/aafnai/M02_UI_BOUNDARIES.md.
 */

export interface NavItem {
  label: string;
  /** Shorter label for the phone tab bar. */
  shortLabel?: string;
  href: string;
  icon: IconName;
  available: boolean;
  /** Shown in the phone tab bar. At most four; the rest go under More. */
  phone?: boolean;
  /** Match only the exact path, not sub-paths. */
  exact?: boolean;
  /** Extra path prefixes that also make this item current. */
  alsoActiveFor?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface NavConfig {
  area: "customer" | "coach" | "founder";
  /** Shown under the logo, e.g. "Coach". */
  areaLabel: string;
  homeHref: string;
  items: NavItem[];
  groups?: NavGroup[];
  /** The service this area belongs to. Future home of "My services". */
  service?: string;
}

export function customerNav(base: string): NavConfig {
  return {
    area: "customer",
    areaLabel: "Your coaching",
    homeHref: base,
    service: "Fitness coaching",
    items: [
      { label: "Today", href: base, icon: "today", available: true, phone: true, exact: true },
      { label: "Training", href: `${base}/workout`, icon: "training", available: true, phone: true },
      { label: "Progress", href: `${base}/progress`, icon: "progress", available: true, phone: true },
      { label: "Messages", href: `${base}/messages`, icon: "messages", available: false, phone: true },
      { label: "Account", href: `${base}/account`, icon: "profile", available: false },
    ],
  };
}

export function coachNav(
  base: string,
  built: { clientsIndex: boolean; extras: boolean },
): NavConfig {
  return {
    area: "coach",
    areaLabel: "Coach",
    homeHref: base,
    service: "Fitness coaching",
    items: [
      {
        label: "Overview",
        href: base,
        icon: "overview",
        available: true,
        phone: true,
        exact: true,
      },
      { label: "Clients", href: `${base}/clients`, icon: "clients", available: built.clientsIndex, phone: true },
      { label: "Plans & pricing", shortLabel: "Plans", href: `${base}/plans`, icon: "plans", available: built.extras, phone: true },
      { label: "Earnings", href: `${base}/earnings`, icon: "earnings", available: built.extras, phone: true },
      { label: "Profile", href: `${base}/profile`, icon: "profile", available: built.extras },
      { label: "Welcome & expectations", shortLabel: "Expectations", href: `${base}/expectations`, icon: "check", available: built.extras },
      { label: "Payout details", href: `${base}/payouts`, icon: "lock", available: built.extras },
      { label: "Calendar", href: `${base}/calendar`, icon: "calendar", available: built.extras },
      { label: "Messages", href: `${base}/messages`, icon: "messages", available: built.extras, alsoActiveFor: [`${base}/support`] },
    ],
  };
}

export function founderNav(
  base: string,
  opts: { real: boolean; serviceTools?: { label: string; href: string }[] },
): NavConfig {
  const at = (path: string) => (opts.real ? `${base}${path}` : base);
  return {
    area: "founder",
    areaLabel: "Founder",
    homeHref: base,
    items: [
      { label: "Overview", href: base, icon: "overview", available: true, phone: true, exact: true },
      { label: "Coaches", href: at("/coaches"), icon: "coaches", available: opts.real, phone: true, alsoActiveFor: opts.real ? [`${base}/providers`] : [] },
      { label: "Customers & purchases", shortLabel: "Purchases", href: at("/purchases"), icon: "bookings", available: opts.real, phone: true },
      { label: "Finance & exceptions", shortLabel: "Finance", href: at("/finance"), icon: "alert", available: opts.real, phone: true },
      { label: "Payouts", href: at("/payouts"), icon: "earnings", available: opts.real },
      { label: "Coach changes", href: at("/coach-changes"), icon: "clients", available: opts.real },
      { label: "Support cases", shortLabel: "Support", href: at("/support"), icon: "messages", available: opts.real },
      { label: "Scheduling", href: at("/scheduling"), icon: "calendar", available: opts.real },
      { label: "Welcome & expectations", shortLabel: "Expectations", href: at("/expectations"), icon: "check", available: opts.real },
      { label: "Data and retention", shortLabel: "Retention", href: at("/retention"), icon: "lock", available: opts.real },
      { label: "Legacy bookings", href: at("/bookings"), icon: "catalog", available: opts.real },
    ],
    groups: opts.serviceTools?.length
      ? [
          {
            label: "Service tools",
            items: opts.serviceTools.map((t) => ({
              label: t.label,
              href: t.href,
              icon: "tools" as const,
              available: true,
            })),
          },
        ]
      : undefined,
  };
}
