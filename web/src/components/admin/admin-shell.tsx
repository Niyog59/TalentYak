"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { isCurrent, type AdminNavGroup, type AdminNavItem } from "@/components/admin/admin-nav";

/*
 * The founder panel's frame: a deep forest-green sidebar on large screens, a
 * slim top bar with a menu drawer on phones, and a workspace header carrying
 * the environment labels and the global search on every page.
 */

export interface EnvironmentLabel {
  label: string;
  value: string;
  tone: "live" | "test" | "warn" | "neutral";
}

const TONE: Record<EnvironmentLabel["tone"], string> = {
  live: "border-emerald-700/40 bg-emerald-50 text-emerald-900",
  test: "border-amber-700/30 bg-amber-50 text-amber-900",
  warn: "border-danger/40 bg-danger-tint text-danger",
  neutral: "border-line bg-paper-raised text-ink",
};

export function AdminShell({
  groups,
  identity,
  environment,
  children,
}: {
  groups: AdminNavGroup[];
  identity: { name: string; email: string };
  environment: EnvironmentLabel[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  // The drawer belongs to the page it was opened on: following a link closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (value: boolean) => setOpenOn(value ? pathname : null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawerHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!open) return;
    drawerHeading.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenOn(null);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="min-h-dvh bg-[#f4f5f2] lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="on-dark sticky top-0 hidden h-dvh flex-col bg-[#0b3a31] text-white lg:flex print:hidden">
        <Brand />
        <SideNav groups={groups} pathname={pathname} />
        <Identity identity={identity} />
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Phone and tablet bar */}
        <div className="on-dark sticky top-0 z-30 flex h-14 items-center justify-between bg-[#0b3a31] px-3 text-white lg:hidden print:hidden">
          <Link href="/admin" className="flex min-h-11 items-center gap-2 rounded-md px-1 font-semibold">
            <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-white/10 font-display text-lg">T</span>
            TalentYak · Founder
          </Link>
          <button
            ref={menuButton}
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="flex min-h-11 items-center gap-2 rounded-lg px-3 font-semibold hover:bg-white/10"
          >
            <Icon name="menu" className="size-6" />
            Menu
          </button>
        </div>

        <header className="border-b border-line bg-surface px-4 py-3 sm:px-6 lg:px-10 print:hidden">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3">
            <form action="/admin/search" method="get" role="search" className="flex w-full max-w-md items-center gap-2 sm:w-auto sm:flex-1">
              <label htmlFor="admin-search" className="sr-only">Search accounts, coaches, purchases and cases</label>
              <div className="relative flex-1">
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-ink-muted" />
                <input
                  id="admin-search"
                  name="q"
                  type="search"
                  minLength={2}
                  maxLength={100}
                  placeholder="Search name, email, coach or record ID"
                  className="min-h-11 w-full rounded-lg border border-line-strong bg-paper pl-10 pr-3 text-base"
                />
              </div>
              <button type="submit" className="min-h-11 rounded-lg bg-brand px-4 font-semibold text-white hover:bg-brand-strong">
                Search
              </button>
            </form>
            <ul aria-label="Environment" className="flex flex-wrap gap-2">
              {environment.map((e) => (
                <li key={e.label} className={`rounded-full border px-3 py-1 text-[0.8125rem] font-semibold ${TONE[e.tone]}`}>
                  <span className="font-medium opacity-80">{e.label}:</span> {e.value}
                </li>
              ))}
            </ul>
          </div>
        </header>

        <main id="main" className="flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close menu" tabIndex={-1} onClick={() => setOpen(false)} className="absolute inset-0 bg-ink/50" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-menu-title"
            className="on-dark absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col bg-[#0b3a31] text-white"
          >
            <div className="flex items-center justify-between px-4 pt-4">
              <h2 id="admin-menu-title" ref={drawerHeading} tabIndex={-1} className="text-lg font-semibold">
                Founder panel
              </h2>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  menuButton.current?.focus();
                }}
                className="flex size-11 items-center justify-center rounded-lg hover:bg-white/10"
              >
                <Icon name="close" className="size-6" />
                <span className="sr-only">Close menu</span>
              </button>
            </div>
            <SideNav groups={groups} pathname={pathname} />
            <Identity identity={identity} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Brand() {
  return (
    <div className="px-5 pb-4 pt-6">
      <Link href="/admin" className="flex min-h-11 items-center gap-3 rounded-md">
        <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-white/10 font-display text-2xl">T</span>
        <span>
          <span className="block font-display text-xl leading-tight">TalentYak</span>
          <span className="block text-[0.8125rem] font-medium text-white/70">Founder panel</span>
        </span>
      </Link>
    </div>
  );
}

function SideNav({ groups, pathname }: { groups: AdminNavGroup[]; pathname: string }) {
  return (
    <nav aria-label="Founder panel" className="flex-1 overflow-y-auto px-3 pb-6">
      {groups.map((g) => (
        <div key={g.label} className="mt-4 first:mt-0">
          <p className="px-3 pb-1 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-white/55">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map((item) => (
              <li key={item.label}>
                <NavLink item={item} current={isCurrent(item, pathname)} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function NavLink({ item, current }: { item: AdminNavItem; current: boolean }) {
  const shared = "relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-[0.9375rem]";
  if (item.unavailable) {
    return (
      <Link href={item.href} className={`${shared} text-white/55 hover:bg-white/5`}>
        <Icon name={item.icon} className="size-[1.125rem]" />
        <span className="flex-1">{item.label}</span>
        <span className="rounded-full border border-white/25 px-2 text-[0.75rem]">{item.unavailable}</span>
      </Link>
    );
  }
  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={`${shared} text-white/85 hover:bg-white/10`}>
        <Icon name={item.icon} className="size-[1.125rem]" />
        <span className="flex-1">{item.label}</span>
        <span className="sr-only">(opens PostHog in a new tab)</span>
      </a>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={current ? "page" : undefined}
      className={`${shared} ${current ? "bg-white/12 font-semibold text-white before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-[#8fd3b6]" : "text-white/85 hover:bg-white/10 hover:text-white"}`}
    >
      <Icon name={item.icon} className="size-[1.125rem]" />
      {item.label}
    </Link>
  );
}

function Identity({ identity }: { identity: { name: string; email: string } }) {
  return (
    <div className="border-t border-white/10 px-5 py-4">
      <p className="truncate font-semibold">{identity.name}</p>
      <p className="truncate text-[0.8125rem] text-white/70">{identity.email}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/account/security" className="flex min-h-10 items-center rounded-lg border border-white/20 px-3 text-[0.875rem] font-medium hover:bg-white/10">
          Sign-in security
        </Link>
        <form action="/auth/signout" method="post">
          <button type="submit" className="flex min-h-10 items-center rounded-lg border border-white/20 px-3 text-[0.875rem] font-medium hover:bg-white/10">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
