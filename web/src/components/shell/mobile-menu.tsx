"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";

/** Public site menu for screens narrower than the desktop header. */
export function MobileMenu({
  links,
}: {
  links: { href: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 items-center gap-2 rounded-lg px-3 font-semibold text-ink hover:bg-paper-raised"
      >
        <Icon name={open ? "close" : "menu"} className="size-6" />
        Menu
      </button>
      {open && (
        <nav
          id={panelId}
          aria-label="Main"
          className="absolute inset-x-0 top-16 z-40 border-b border-line bg-paper"
        >
          <ul className="mx-auto max-w-6xl px-4 py-3">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-12 items-center rounded-lg px-3 text-lg font-medium text-ink hover:bg-paper-raised"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
