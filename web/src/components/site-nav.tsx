import Link from "next/link";
import { BrandLogoLink } from "@/components/brand/logo";
import { MobileMenu } from "@/components/shell/mobile-menu";

/*
 * Public header. Fitness coaching is the only public service, so there is
 * no service chooser here — see docs/aafnai/M02_UI_BOUNDARIES.md.
 */
const links = [
  { href: "/coaches", label: "Find a coach" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/become-a-coach", label: "Become a coach" },
];

export function SiteNav() {
  return (
    // White, not --paper: the horizontal logo file has an opaque white
    // background, and on the warm ground it would show as a rectangle.
    <header className="relative border-b border-line bg-surface">
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

        <div className="hidden md:block">
          <Link
            href="/account/sign-in"
            className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-brand hover:bg-brand-tint"
          >
            Log in
          </Link>
        </div>

        <MobileMenu links={[...links, { href: "/account/sign-in", label: "Log in" }]} />
      </div>
    </header>
  );
}
