import Link from "next/link";
import type { Service } from "@/lib/catalog/types";
import { formatPrice } from "@/lib/catalog/types";

/**
 * Index-style service listing: name, one-line summary, right-aligned
 * price, hairline rule below. No cards, no icons.
 */
export function ServiceRow({ service }: { service: Service }) {
  const comingSoon = service.status === "coming_soon";
  const inner = (
    <div className="flex items-baseline justify-between gap-6 py-5">
      <div className="min-w-0">
        <h3 className="font-display text-lg leading-snug">
          {service.name}
          {comingSoon && (
            <span className="label ml-3 align-middle text-terracotta">
              Coming soon
            </span>
          )}
        </h3>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink/70">
          {service.summary}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-sans text-sm font-medium">{formatPrice(service)}</p>
        {service.priceNote && (
          <p className="mt-0.5 font-sans text-xs text-ink/50">
            {service.priceNote}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <li className="rule list-none first:border-t-0">
      {comingSoon ? (
        <div className="opacity-70">{inner}</div>
      ) : (
        <Link
          href={`/services/${service.verticalSlug}/${service.id}`}
          className="block transition-colors hover:text-terracotta"
        >
          {inner}
        </Link>
      )}
    </li>
  );
}
