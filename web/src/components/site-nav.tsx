import Link from "next/link";
import Image from "next/image";

const links = [
  { href: "/services", label: "Services" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About" },
];

export function SiteNav() {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo/ghartira-mark.svg"
            alt="Ghartira"
            width={30}
            height={30}
            priority
          />
          <span className="font-display text-xl tracking-tight">Ghartira</span>
          <span className="devanagari mt-1 hidden text-sm text-ink/60 sm:inline">
            घरतिर
          </span>
        </Link>
        <nav className="flex items-center gap-8">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="label hidden text-ink/80 transition-colors hover:text-terracotta sm:inline"
            >
              {l.label}
            </Link>
          ))}
          <Link href="/account" className="label text-ink/80 transition-colors hover:text-terracotta">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
