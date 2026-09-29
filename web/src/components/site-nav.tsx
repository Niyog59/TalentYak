import Link from "next/link";
import { BrandLogoLink } from "@/components/brand/logo";
import { MobileMenu } from "@/components/shell/mobile-menu";
import { purchaseMode } from "@/lib/launch";

/*
 * Public header. Fitness coaching is the only public service, so there is
 * no service chooser here — see docs/aafnai/M02_UI_BOUNDARIES.md.
 */
const links = [
  { href: "/coaches", label: "Coaches" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About" },
];

export async function SiteNav() {
  // What the public can do right now: buy, or register interest.
  const open = await purchaseMode(null) === "live";
  const primary = open ? { href: "/coaches", label: "Start coaching" } : { href: "/waitlist", label: "Join the waitlist" };
  return (
    // White, not --paper: the horizontal logo file has an opaque white
    // background, and on the warm ground it would show as a rectangle.
    <header className="relative border-b border-line bg-surface print:hidden">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <BrandLogoLink variant="horizontal" width={160} />

        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex min-h-11 items-center rounded-lg px-3 font-medium text-ink hover:bg-paper-raised"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="/account/sign-in"
            className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-brand hover:bg-brand-tint"
          >
            Log in
          </Link>
          <Link href={primary.href} className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 font-semibold text-white hover:bg-brand-strong">
            {primary.label}
          </Link>
        </div>

        <MobileMenu links={[primary, ...links, { href: "/account/sign-in", label: "Log in" }]} />
      </div>
    </header>
  );
}
