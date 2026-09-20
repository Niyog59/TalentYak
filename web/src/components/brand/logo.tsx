import Image from "next/image";
import Link from "next/link";

/*
 * The TalentYak logo, in one place.
 *
 * The approved pack is raster only — there are no SVG files in it, and the two
 * horizontal files are NOT transparent: the light one carries an opaque white
 * background and the dark one an opaque forest-green background. Only the
 * standalone symbol has real transparency.
 *
 * That fact drives the whole design of this component:
 *
 *   horizontal  the light PNG. Only on a white surface, or the white rectangle
 *               shows. Used in the public header.
 *   inverse     the dark PNG. Only on the matching forest green in --brand-deep,
 *               which was sampled from the file itself so the edges disappear.
 *   lockup      the transparent symbol beside live TalentYak text. Safe on any
 *               surface, scales without blurring, and the name is real text a
 *               screen reader and a zoomed page both handle properly. This is
 *               the default, and the right choice when in doubt.
 *   symbol      the transparent symbol alone, for collapsed navigation.
 *   wordmark    live text alone.
 *
 * On a dark surface the symbol is drawn as a silhouette filled with
 * currentColor through a CSS mask, rather than a brightness filter, which keeps
 * the edges clean and lets it inherit whatever the surrounding text colour is.
 */

const SYMBOL_SRC = "/brand/talentyak/website/talentyak-symbol-transparent.png";
const HORIZONTAL_LIGHT_SRC =
  "/brand/talentyak/website/talentyak-horizontal-light-600.png";
const HORIZONTAL_DARK_SRC =
  "/brand/talentyak/website/talentyak-horizontal-dark-600.png";

/** The horizontal artwork is 600 × 200. Its ratio is fixed and must not change. */
const HORIZONTAL_RATIO = 3;

export type BrandLogoVariant =
  | "horizontal"
  | "inverse"
  | "lockup"
  | "symbol"
  | "wordmark";

export interface BrandLogoProps {
  variant?: BrandLogoVariant;
  /**
   * Rendered width in CSS pixels, for `horizontal` and `inverse`.
   * The pack recommends starting at 150–180.
   */
  width?: number;
  /**
   * Hides the logo from assistive technology. Use this whenever the element
   * around it is already announced — a link labelled "TalentYak home", or a
   * heading that already says the name — so it is not read out twice.
   */
  decorative?: boolean;
  className?: string;
}

export function BrandLogo({
  variant = "lockup",
  width = 168,
  decorative = false,
  className = "",
}: BrandLogoProps) {
  const label = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": "TalentYak" } as const);

  if (variant === "horizontal" || variant === "inverse") {
    const src = variant === "horizontal" ? HORIZONTAL_LIGHT_SRC : HORIZONTAL_DARK_SRC;
    return (
      <Image
        src={src}
        // The accessible name comes from the wrapper, so the image itself is
        // always decorative. An empty alt is correct here, not an omission.
        alt={decorative ? "" : "TalentYak"}
        width={width}
        height={Math.round(width / HORIZONTAL_RATIO)}
        priority
        className={`block h-auto ${className}`}
        sizes={`${width}px`}
      />
    );
  }

  const mark = <SymbolMark />;
  const word = (
    <span className="font-semibold leading-none tracking-tight">TalentYak</span>
  );

  return (
    <span
      className={`inline-flex items-center gap-[0.38em] ${className}`}
      {...label}
    >
      {variant !== "wordmark" && mark}
      {variant !== "symbol" && word}
    </span>
  );
}

/**
 * The symbol, sized in ems so it tracks the surrounding type, drawn as a
 * silhouette in currentColor. A mask rather than an <img> means one asset
 * serves both a green-on-white and a white-on-green surface.
 */
function SymbolMark() {
  return (
    <span
      aria-hidden
      className="inline-block size-[1.05em] shrink-0 bg-current"
      style={{
        maskImage: `url(${SYMBOL_SRC})`,
        WebkitMaskImage: `url(${SYMBOL_SRC})`,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}

/**
 * The logo as a link to the homepage.
 *
 * The link carries the accessible name, so the logo inside it is marked
 * decorative — otherwise a screen reader announces "TalentYak, TalentYak home".
 */
export function BrandLogoLink({
  variant = "lockup",
  width,
  className = "",
  logoClassName = "",
}: Omit<BrandLogoProps, "decorative"> & {
  logoClassName?: string;
}) {
  return (
    <Link
      href="/"
      aria-label="TalentYak home"
      className={`inline-flex min-h-11 items-center rounded-md ${className}`}
    >
      <BrandLogo
        variant={variant}
        width={width}
        decorative
        className={logoClassName}
      />
    </Link>
  );
}

/** Retained so existing call sites keep working. Prefer BrandLogo in new code. */
export const Logo = BrandLogo;
