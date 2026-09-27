"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { Icon } from "@/components/ui/icon";
import { SoonTag } from "@/components/ui/sample";
import type { NavConfig, NavItem } from "@/components/shell/nav";

/*
 * Signed-in shell shared by customers, coaches and the founder.
 *
 * Desktop (≥1024px): a left sidebar listing every destination.
 * Phone and tablet: a slim top bar and a bottom tab bar of at most five
 * items — up to four destinations plus More, which opens a sheet with the rest.
 */

function isCurrent(item: NavItem, pathname: string) {
  const match = (prefix: string) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (item.exact) {
    return pathname === item.href || (item.alsoActiveFor ?? []).some(match);
  }
  return match(item.href) || (item.alsoActiveFor ?? []).some(match);
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function AppShell({
  nav,
  identity,
  banner,
  children,
}: {
  nav: NavConfig;
  identity: { name: string; detail?: string };
  /** Rendered above everything — sample-data or status notices. */
  banner?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const sheetHeading = useRef<HTMLHeadingElement>(null);

  const phoneItems = nav.items.filter((i) => i.phone).slice(0, 4);
  const overflow = [
    ...nav.items.filter((i) => !phoneItems.includes(i)),
    ...(nav.groups ?? []).flatMap((g) => g.items),
  ];
  const moreIsCurrent = overflow.some((i) => i.available && isCurrent(i, pathname));

  function closeMore() {
    setMoreOpen(false);
    moreButton.current?.focus();
  }

  useEffect(() => {
    if (!moreOpen) return;
    sheetHeading.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      {banner}
      <div className="flex flex-1 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex print:hidden">
          <div className="px-5 pb-5 pt-6">
            <Link href={nav.homeHref} aria-label="TalentYak home" className="inline-flex min-h-11 items-center rounded-md">
              <Logo decorative className="text-2xl" />
            </Link>
            <p className="mt-2 text-sm font-semibold text-ink-muted">{nav.areaLabel}</p>
          </div>

          {nav.service && <ServiceContext service={nav.service} />}

          <nav aria-label={`${nav.areaLabel} navigation`} className="flex-1 overflow-y-auto px-3 pb-4">
            <ul className="space-y-0.5">
              {nav.items.map((item) => (
                <li key={item.label}>
                  <SidebarLink item={item} current={isCurrent(item, pathname)} />
                </li>
              ))}
            </ul>
            {nav.groups?.map((group) => (
              <div key={group.label} className="mt-6">
                <p className="px-3 pb-1.5 text-sm font-semibold text-ink-muted">{group.label}</p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.label}>
                      <SidebarLink item={item} current={isCurrent(item, pathname)} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="flex items-center gap-3 border-t border-line px-5 py-4">
            <Avatar name={identity.name} />
            <div className="min-w-0">
              <p className="truncate font-semibold">{identity.name}</p>
              {identity.detail && (
                <p className="truncate text-sm text-ink-muted">{identity.detail}</p>
              )}
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Phone and tablet top bar */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-paper px-4 lg:hidden print:hidden">
            <Link href={nav.homeHref} aria-label="TalentYak home" className="flex min-h-11 items-center gap-2.5 rounded-md">
              <Logo decorative className="text-xl" />
              <span className="text-sm font-semibold text-ink-muted">{nav.areaLabel}</span>
            </Link>
            <Avatar name={identity.name} />
          </header>

          <main id="main" className="flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-14 lg:pt-10">
            <div className="mx-auto w-full max-w-5xl">{children}</div>
          </main>

          {/* Phone and tablet tab bar */}
          <nav
            aria-label={`${nav.areaLabel} navigation`}
            className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden"
          >
            <ul className="mx-auto grid max-w-xl grid-cols-5">
              {phoneItems.map((item) => (
                <li key={item.label}>
                  <TabLink item={item} current={isCurrent(item, pathname)} />
                </li>
              ))}
              {overflow.length > 0 && (
                <li>
                  <button
                    ref={moreButton}
                    type="button"
                    onClick={() => setMoreOpen(true)}
                    aria-haspopup="dialog"
                    aria-expanded={moreOpen}
                    className={`flex min-h-14 w-full flex-col items-center justify-center gap-1 px-1 text-[0.8125rem] font-semibold ${
                      moreIsCurrent ? "text-brand" : "text-ink-muted"
                    }`}
                  >
                    <Icon name="more" className="size-6" />
                    More
                  </button>
                </li>
              )}
            </ul>
          </nav>
        </div>
      </div>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={closeMore}
            className="absolute inset-0 bg-ink/40"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="more-sheet-title"
            className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 id="more-sheet-title" ref={sheetHeading} tabIndex={-1} className="text-lg font-semibold">
                More
              </h2>
              <button
                type="button"
                onClick={closeMore}
                className="flex size-11 items-center justify-center rounded-lg text-ink hover:bg-paper-raised"
              >
                <Icon name="close" className="size-6" />
                <span className="sr-only">Close</span>
              </button>
            </div>
            {nav.service && <ServiceContext service={nav.service} />}
            <ul className="px-3 pb-4">
              {overflow.map((item) => (
                <li key={item.label}>
                  <SidebarLink
                    item={item}
                    current={isCurrent(item, pathname)}
                    onNavigate={() => setMoreOpen(false)}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Which service this area belongs to. Today there is only fitness, so it is a
 * plain label — no chooser. It becomes "My services" when a customer or
 * provider has more than one.
 */
function ServiceContext({ service }: { service: string }) {
  return (
    <div className="mx-3 mb-3 rounded-lg bg-paper-raised px-3 py-2.5">
      <p className="text-[0.8125rem] font-semibold text-ink-muted">Service</p>
      <p className="font-semibold">{service}</p>
    </div>
  );
}

function SidebarLink({
  item,
  current,
  onNavigate,
}: {
  item: NavItem;
  current: boolean;
  onNavigate?: () => void;
}) {
  const shared = "flex min-h-11 items-center gap-3 rounded-lg px-3 font-medium";
  if (!item.available) {
    return (
      <span aria-disabled="true" className={`${shared} text-ink-muted`}>
        <Icon name={item.icon} />
        <span className="flex-1">{item.label}</span>
        <SoonTag />
        <span className="sr-only">(not available yet)</span>
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={current ? "page" : undefined}
      className={`${shared} ${
        current ? "bg-brand-tint font-semibold text-brand" : "text-ink hover:bg-paper-raised"
      }`}
    >
      <Icon name={item.icon} />
      {item.label}
    </Link>
  );
}

function TabLink({ item, current }: { item: NavItem; current: boolean }) {
  const shared =
    "flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-center text-[0.8125rem] font-semibold";
  const label = item.shortLabel ?? item.label;
  if (!item.available) {
    return (
      <span aria-disabled="true" className={`${shared} text-ink-muted/70`}>
        <Icon name={item.icon} className="size-6" />
        {label}
        <span className="sr-only">(not available yet)</span>
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={`${shared} ${current ? "text-brand" : "text-ink-muted hover:text-ink"}`}
    >
      <Icon name={item.icon} className="size-6" />
      {label}
    </Link>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-sm font-semibold text-brand"
    >
      {initials(name)}
    </span>
  );
}
