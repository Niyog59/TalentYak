import Link from "next/link";
import Image from "next/image";

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-ink-deep text-paper">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 sm:grid-cols-3">
        <div>
          <div className="flex items-center gap-3">
            <Image
              src="/logo/ghartira-mark-dark.svg"
              alt=""
              width={34}
              height={34}
            />
            <span className="font-display text-lg">Ghartira</span>
          </div>
          <p className="devanagari mt-3 text-paper/70">घरतिर — घर तिर फर्कने बाटो</p>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-paper/70">
            Some things must still happen at home. We handle them on your
            behalf, with people you can trust.
          </p>
        </div>
        <div>
          <p className="label mb-4 text-paper/50">Services</p>
          <ul className="space-y-2 text-sm">
            <li>
              <Link href="/services/pandit" className="hover:text-terracotta">
                Ceremonies &amp; Rites
              </Link>
            </li>
            <li>
              <Link href="/services/fitness" className="hover:text-terracotta">
                Fitness Coaching
              </Link>
            </li>
            <li>
              <Link href="/services" className="hover:text-terracotta">
                All services
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="label mb-4 text-paper/50">Company</p>
          <ul className="space-y-2 text-sm">
            <li>
              <Link href="/about" className="hover:text-terracotta">
                About
              </Link>
            </li>
            <li>
              <Link href="/how-it-works" className="hover:text-terracotta">
                How it works
              </Link>
            </li>
            <li>
              <Link href="/account" className="hover:text-terracotta">
                Your account
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-paper/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <p className="text-xs text-paper/50">
            © {new Date().getFullYear()} Ghartira. Houston, Texas &amp;
            Kathmandu, Nepal.
          </p>
          <p className="devanagari text-xs text-paper/40">घरतिर</p>
        </div>
      </div>
    </footer>
  );
}
