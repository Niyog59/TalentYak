import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/button";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-20">
      <Link href="/" aria-label="TalentYak home" className="inline-flex min-h-11 items-center self-start rounded-md">
        <Logo decorative className="text-2xl" />
      </Link>
      <p className="mt-14 font-semibold text-accent-text">Page not found</p>
      <h1 className="mt-2 font-display text-4xl leading-tight">
        We couldn&rsquo;t find that page.
      </h1>
      <p className="mt-4 text-ink-muted">
        It may have moved, or the link may be incomplete.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/">Go to the homepage</ButtonLink>
        <ButtonLink href="/coaches" variant="secondary">
          Find a coach
        </ButtonLink>
      </div>
    </main>
  );
}
