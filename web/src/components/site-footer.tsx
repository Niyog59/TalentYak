import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";

const coaching = [
  { href: "/coaches", label: "Find a coach" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/become-a-coach", label: "Become a coach" },
];

const company = [
  { href: "/about", label: "About TalentYak" },
  { href: "/account/sign-in", label: "Log in" },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line bg-paper-raised">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.6fr_1fr_1fr]">
        <div>
          {/* The lockup, not the horizontal file: this surface is not white. */}
          <BrandLogo variant="lockup" className="text-2xl text-brand" />
          <p className="mt-3 max-w-xs text-ink-muted">
            Fitness coaching with independent coaches based in Nepal.
          </p>
        </div>
        <FooterList title="Coaching" links={coaching} />
        <FooterList title="TalentYak" links={company} />
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-5 text-sm text-ink-muted sm:px-6">
          © {new Date().getFullYear()} TalentYak
        </p>
      </div>
    </footer>
  );
}

function FooterList({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <nav aria-label={title}>
      <h2 className="font-semibold">{title}</h2>
      <ul className="mt-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="inline-flex min-h-11 min-w-11 items-center text-ink-muted underline-offset-4 hover:text-ink hover:underline"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
