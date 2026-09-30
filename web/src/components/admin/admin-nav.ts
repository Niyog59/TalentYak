import type { IconName } from "@/components/ui/icon";

/*
 * The founder panel's map. Grouped by the job being done, so every existing
 * product area is one click from anywhere. Pure data: the shell renders it.
 */

export interface AdminNavItem {
  label: string;
  href: string;
  icon: IconName;
  /** Match only this exact path. */
  exact?: boolean;
  /** Other paths that belong to this item. */
  alsoActiveFor?: string[];
  /** Opens outside the panel (analytics). */
  external?: boolean;
  /** Present but unusable, with the reason. */
  unavailable?: string;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

export function adminNav(opts: { serviceTools: { label: string; href: string }[]; analyticsUrl: string | null }): AdminNavGroup[] {
  return [
    {
      label: "Today",
      items: [{ label: "Overview", href: "/admin", icon: "overview", exact: true }],
    },
    {
      label: "People",
      items: [
        { label: "Accounts", href: "/admin/accounts", icon: "profile" },
        { label: "Coach applications", href: "/admin/coach-applications", icon: "plans" },
        { label: "Coaches", href: "/admin/coaches", icon: "coaches", alsoActiveFor: ["/admin/providers"] },
        { label: "Coach changes", href: "/admin/coach-changes", icon: "clients" },
        { label: "Support cases", href: "/admin/support", icon: "messages" },
      ],
    },
    {
      label: "Coaching",
      items: [
        { label: "Coaching operations", href: "/admin/coaching", icon: "training" },
        { label: "Check-ins", href: "/admin/check-ins", icon: "check" },
        { label: "Scheduling & calls", href: "/admin/scheduling", icon: "calendar" },
        { label: "Welcome & expectations", href: "/admin/expectations", icon: "plans" },
      ],
    },
    {
      label: "Money",
      items: [
        { label: "Purchases", href: "/admin/purchases", icon: "bookings" },
        { label: "Finance & exceptions", href: "/admin/finance", icon: "alert" },
        { label: "Payouts", href: "/admin/payouts", icon: "earnings" },
      ],
    },
    {
      label: "Website",
      items: [
        { label: "Website & launch", href: "/admin/website", icon: "globe2" },
        { label: "Waitlist", href: "/admin/waitlist", icon: "clients" },
        opts.analyticsUrl
          ? { label: "Open analytics", href: opts.analyticsUrl, icon: "external", external: true }
          : { label: "Analytics", href: "/admin/website#analytics", icon: "chart", unavailable: "Not connected" },
      ],
    },
    {
      label: "System",
      items: [
        { label: "Feature controls", href: "/admin/features", icon: "toggle" },
        { label: "Jobs & deliveries", href: "/admin/operations", icon: "tools" },
        { label: "Data & retention", href: "/admin/retention", icon: "lock" },
        { label: "Policies & launch", href: "/admin/policies", icon: "shield" },
        { label: "Change history", href: "/admin/history", icon: "history" },
      ],
    },
    {
      label: "Older tools",
      items: [
        { label: "Legacy bookings", href: "/admin/bookings", icon: "catalog" },
        { label: "Catalog", href: "/admin/catalog", icon: "catalog" },
        ...opts.serviceTools.map((t) => ({ label: t.label, href: t.href, icon: "tools" as const })),
      ],
    },
  ];
}

export function isCurrent(item: AdminNavItem, pathname: string): boolean {
  if (item.external) return false;
  const match = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (item.exact) return pathname === item.href || (item.alsoActiveFor ?? []).some(match);
  return match(item.href) || (item.alsoActiveFor ?? []).some(match);
}
