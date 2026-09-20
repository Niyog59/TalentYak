#!/usr/bin/env node
/*
 * Aafnai brand asset builder.
 *
 * One hand-drawn master — brand/aafnai/source/geometry.mjs — produces every
 * logo file: SVG masters in each tone, transparent PNGs, favicons, PWA and
 * Apple icons, the social avatar and share template, the email logo, review
 * sheets, the copies the website serves, and the path data the React <Logo>
 * renders. Nothing is traced from a raster image.
 *
 * Run from the repository root:
 *   node brand/aafnai/scripts/build-brand.mjs
 *
 * Uses sharp from web/node_modules and Pillow (python3) for favicon.ico.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { geometry } from "../source/geometry.mjs";

const BRAND = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(BRAND, "..", "..");
const WEB = join(REPO, "web");
const sharp = createRequire(join(WEB, "package.json"))("sharp");

const EXPORTS = join(BRAND, "exports");
const REVIEW = join(BRAND, "review");
const SOURCE = join(BRAND, "source");
const PUBLIC = join(WEB, "public", "brand");
const APP = join(WEB, "src", "app");

const C = geometry.colors;
const TONES = {
  color: { symbol: C.primary, inset: C.accent, word: C.ink, label: "Two-colour master" },
  dark: { symbol: C.ink, inset: C.ink, word: C.ink, label: "One-colour dark" },
  reversed: { symbol: C.white, inset: C.white, word: C.white, label: "Reversed white" },
};
const TONE_BACKGROUND = { color: C.paper, dark: C.white, reversed: C.ink };
const LAYOUTS = ["horizontal", "stacked", "symbol", "wordmark"];
/** Width in px of each layout's 1x PNG. */
const PNG_WIDTH = { horizontal: 320, stacked: 220, symbol: 128, wordmark: 240 };

const written = [];
const n = (value) => Number(value.toFixed(3));
const write = (path, contents) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  written.push(relative(REPO, path));
};

/* ------------------------------ Drawing ------------------------------ */

function symbolMarkup(tone, { x = 0, y = 0, size, small = false } = {}) {
  const g = small && geometry.symbolSmall ? geometry.symbolSmall : geometry.symbol;
  const k = (size ?? g.size) / g.size;
  return (
    `<g transform="translate(${n(x)} ${n(y)}) scale(${n(k)})">` +
    `<path d="${g.outer}" fill="${tone.symbol}" fill-rule="evenodd"/>` +
    (g.inset ? `<path d="${g.inset}" fill="${tone.inset}"/>` : "") +
    `</g>`
  );
}

function wordmarkMarkup(tone, { x = 0, y = 0, scale = 1 } = {}) {
  return (
    `<g transform="translate(${n(x)} ${n(y)}) scale(${n(scale)})" fill="${tone.word}">` +
    geometry.wordmark.paths.map((d) => `<path d="${d}"/>`).join("") +
    (geometry.wordmark.accent ? `<path d="${geometry.wordmark.accent}" fill="${tone.inset}"/>` : "") +
    `</g>`
  );
}

/** Lockup geometry in wordmark units. */
function layout(kind) {
  const w = geometry.wordmark;
  const L = geometry.lockup;
  if (kind === "symbol") {
    const s = geometry.symbol.size;
    return { width: s, height: s, draw: (t, o = {}) => symbolMarkup(t, o) };
  }
  if (kind === "wordmark") {
    return { width: w.width, height: w.height, draw: (t) => wordmarkMarkup(t) };
  }
  if (kind === "horizontal") {
    const s = L.horizontal.symbolSize;
    const height = Math.max(s, w.height);
    const symbolY = L.horizontal.symbolY ?? (height - s) / 2;
    const wordY = L.horizontal.wordY ?? (height - w.height) / 2;
    return {
      width: s + L.horizontal.gap + w.width,
      height,
      draw: (t) =>
        symbolMarkup(t, { y: symbolY, size: s }) +
        wordmarkMarkup(t, { x: s + L.horizontal.gap, y: wordY }),
    };
  }
  if (kind === "stacked") {
    const s = L.stacked.symbolSize;
    const width = Math.max(s, w.width);
    return {
      width,
      height: s + L.stacked.gap + w.height,
      draw: (t) =>
        symbolMarkup(t, { x: (width - s) / 2, size: s }) +
        wordmarkMarkup(t, { x: (width - w.width) / 2, y: s + L.stacked.gap }),
    };
  }
  throw new Error(`unknown layout ${kind}`);
}

function svgDocument({ width, height, body, background, title = "Aafnai" }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(width)} ${n(height)}" ` +
    `width="${n(width)}" height="${n(height)}" role="img" aria-label="${title}">` +
    `<title>${title}</title>` +
    (background ? `<rect width="${n(width)}" height="${n(height)}" fill="${background}"/>` : "") +
    body +
    `</svg>`
  );
}

/** Render oversized, then downsample, so edges stay clean at every size. */
async function renderPng(svg, svgWidth, svgHeight, outPath, width, { nearest = false } = {}) {
  const height = Math.round((width * svgHeight) / svgWidth);
  const density = Math.min(72 * ((width * 4) / svgWidth), 72 * 60);
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(Buffer.from(svg), { density })
    .resize(width, height, { kernel: nearest ? "nearest" : "lanczos3", fit: "fill" })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  written.push(relative(REPO, outPath));
  return outPath;
}

/** Square app icon: symbol centred on a solid square. The OS adds corner shapes. */
function iconSvg(fraction, { background = geometry.appIcon.background, tone = TONES.color, small = false } = {}) {
  const S = 1000;
  const s = S * fraction;
  const dx = (geometry.appIcon.offset?.x ?? 0) * S;
  const dy = (geometry.appIcon.offset?.y ?? 0) * S;
  return svgDocument({
    width: S,
    height: S,
    background,
    body: symbolMarkup(tone, { x: (S - s) / 2 + dx, y: (S - s) / 2 + dy, size: s, small }),
  });
}

/* ------------------------------- Build ------------------------------- */

async function build() {
  for (const dir of [EXPORTS, REVIEW, PUBLIC]) rmSync(dir, { recursive: true, force: true });

  // 1. Logo family: every layout in every tone, as SVG and 1x/2x PNG.
  for (const kind of LAYOUTS) {
    const l = layout(kind);
    for (const [toneName, tone] of Object.entries(TONES)) {
      const svg = svgDocument({ width: l.width, height: l.height, body: l.draw(tone) });
      const base = `aafnai-${kind}-${toneName}`;
      write(join(SOURCE, "svg", `${base}.svg`), svg);
      write(join(EXPORTS, "logo", "svg", `${base}.svg`), svg);
      write(join(PUBLIC, "logo", `${base}.svg`), svg);
      await renderPng(svg, l.width, l.height, join(EXPORTS, "logo", "png", `${base}@1x.png`), PNG_WIDTH[kind]);
      await renderPng(svg, l.width, l.height, join(EXPORTS, "logo", "png", `${base}@2x.png`), PNG_WIDTH[kind] * 2);
    }
  }
  if (geometry.symbolSmall) {
    const s = geometry.symbolSmall.size;
    for (const [toneName, tone] of Object.entries(TONES)) {
      const svg = svgDocument({ width: s, height: s, body: symbolMarkup(tone, { small: true }) });
      write(join(SOURCE, "svg", `aafnai-symbol-small-${toneName}.svg`), svg);
      write(join(EXPORTS, "logo", "svg", `aafnai-symbol-small-${toneName}.svg`), svg);
    }
  }

  // 2. Favicons. The SVG switches to ivory in dark browser themes.
  const fav = geometry.symbolSmall ?? geometry.symbol;
  const favSvg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fav.size} ${fav.size}">` +
    `<style>.m{fill:${C.primary}}.i{fill:${C.accent}}@media (prefers-color-scheme:dark){.m{fill:${C.paper}}}</style>` +
    `<path class="m" d="${fav.outer}" fill-rule="evenodd"/>` +
    (fav.inset ? `<path class="i" d="${fav.inset}"/>` : "") +
    `</svg>`;
  write(join(EXPORTS, "favicon", "favicon.svg"), favSvg);
  write(join(APP, "icon.svg"), favSvg);
  const favFlat = svgDocument({ width: fav.size, height: fav.size, body: symbolMarkup(TONES.color, { small: true }) });
  const f16 = await renderPng(favFlat, fav.size, fav.size, join(EXPORTS, "favicon", "favicon-16.png"), 16);
  const f32 = await renderPng(favFlat, fav.size, fav.size, join(EXPORTS, "favicon", "favicon-32.png"), 32);
  const f48 = await renderPng(favFlat, fav.size, fav.size, join(EXPORTS, "favicon", "favicon-48.png"), 48);
  const ico = join(EXPORTS, "favicon", "favicon.ico");
  execFileSync("python3", [
    "-c",
    `from PIL import Image
frames = [Image.open(p).convert("RGBA") for p in ${JSON.stringify([f16, f32, f48])}]
frames[-1].save(${JSON.stringify(ico)}, format="ICO", sizes=[(16,16),(32,32),(48,48)], append_images=frames[:-1])`,
  ]);
  written.push(relative(REPO, ico));
  execFileSync("cp", [ico, join(APP, "favicon.ico")]);
  written.push(relative(REPO, join(APP, "favicon.ico")));

  // 3. PWA icons (any + maskable) and the Apple touch icon.
  const scales = geometry.appIcon.scale;
  for (const size of [192, 512]) {
    const any = join(EXPORTS, "icons", `aafnai-icon-${size}.png`);
    await renderPng(iconSvg(scales.any), 1000, 1000, any, size);
    execFileSync("cp", [any, join(mkdirp(join(PUBLIC, "icons")), `aafnai-icon-${size}.png`)]);
    const mask = join(EXPORTS, "icons", `aafnai-maskable-${size}.png`);
    await renderPng(iconSvg(scales.maskable), 1000, 1000, mask, size);
    execFileSync("cp", [mask, join(PUBLIC, "icons", `aafnai-maskable-${size}.png`)]);
  }
  const apple = join(EXPORTS, "icons", "aafnai-apple-touch-icon-180.png");
  await renderPng(iconSvg(scales.apple), 1000, 1000, apple, 180);
  execFileSync("cp", [apple, join(APP, "apple-icon.png")]);
  written.push(relative(REPO, join(APP, "apple-icon.png")));

  // 4. Social / profile avatar.
  const avatar = join(EXPORTS, "social", "aafnai-avatar-1024.png");
  await renderPng(iconSvg(scales.avatar), 1000, 1000, avatar, 1024);

  // 5. Email logo at twice its display width (displayed at 160px).
  const hz = layout("horizontal");
  const emailLogo = join(EXPORTS, "email", "aafnai-email-logo@2x.png");
  await renderPng(svgDocument({ width: hz.width, height: hz.height, body: hz.draw(TONES.color) }), hz.width, hz.height, emailLogo, 320);
  execFileSync("cp", [emailLogo, join(mkdirp(join(PUBLIC, "email")), "aafnai-email-logo@2x.png")]);

  // 6. Share preview: a template with a marked title area, and the default image.
  const shareW = 1200;
  const shareH = 630;
  const margin = 72;
  const logoW = 300;
  const logoH = (logoW * hz.height) / hz.width;
  const logoAt = `<g transform="translate(${margin} ${margin}) scale(${n(logoW / hz.width)})">${hz.draw(TONES.color)}</g>`;
  const titleArea = `<rect x="${margin}" y="${margin + logoH + 80}" width="${shareW - margin * 2}" height="${shareH - margin * 2 - logoH - 80}" fill="none" stroke="${C.primary}" stroke-width="2" stroke-dasharray="10 8"/>`;
  const templateLabel = `<text x="${margin + 24}" y="${margin + logoH + 128}" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="${C.primary}">Page title area — keep text inside, no claims</text>`;
  await renderPng(svgDocument({ width: shareW, height: shareH, background: C.paper, body: logoAt + titleArea + templateLabel }), shareW, shareH, join(EXPORTS, "social", "aafnai-share-template-1200x630.png"), shareW);
  const st = layout("stacked");
  const stW = 420;
  const stH = (stW * st.height) / st.width;
  const shareDefault = svgDocument({
    width: shareW,
    height: shareH,
    background: C.paper,
    body: `<g transform="translate(${n((shareW - stW) / 2)} ${n((shareH - stH) / 2)}) scale(${n(stW / st.width)})">${st.draw(TONES.color)}</g>`,
  });
  const og = join(EXPORTS, "social", "aafnai-share-default-1200x630.png");
  await renderPng(shareDefault, shareW, shareH, og, shareW);
  execFileSync("cp", [og, join(APP, "opengraph-image.png")]);
  write(join(APP, "opengraph-image.alt.txt"), "Aafnai");
  written.push(relative(REPO, join(APP, "opengraph-image.png")));

  // 7. Path data for the React <Logo>.
  write(
    join(WEB, "src", "components", "brand", "logo-geometry.ts"),
    `// Generated by brand/aafnai/scripts/build-brand.mjs from brand/aafnai/source/geometry.mjs.\n` +
      `// Do not edit by hand — change the master geometry and rebuild.\n\n` +
      `export const symbol = ${JSON.stringify(geometry.symbol, null, 2)} as const;\n\n` +
      `export const symbolSmall = ${JSON.stringify(geometry.symbolSmall ?? null, null, 2)};\n\n` +
      `export const wordmark = ${JSON.stringify(geometry.wordmark, null, 2)} as const;\n\n` +
      `export const lockup = ${JSON.stringify(geometry.lockup, null, 2)} as const;\n\n` +
      `export const colors = ${JSON.stringify(C, null, 2)} as const;\n`,
  );

  await reviewSheets({ f16, f32, f48, avatar, og });
}

function mkdirp(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/* --------------------------- Review sheets --------------------------- */

const dataUri = async (path, width) =>
  `data:image/png;base64,${(await sharp(path).resize(width ? { width } : undefined).png().toBuffer()).toString("base64")}`;

const label = (x, y, text, { size = 18, fill = C.ink, weight = 400 } = {}) =>
  `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${text}</text>`;

async function reviewSheets({ f16, f32, f48, avatar, og }) {
  // Small-size check: master and simplified symbol at 16, 32, 48 px, actual size and enlarged.
  const variants = [{ name: "Master symbol", small: false }];
  if (geometry.symbolSmall) variants.push({ name: "Simplified small-size symbol", small: true });
  const grounds = [
    { name: "ivory", bg: C.paper, tone: TONES.color },
    { name: "white", bg: C.white, tone: TONES.color },
    { name: "charcoal", bg: C.ink, tone: TONES.reversed },
  ];
  const cellW = 470;
  const rowH = 230;
  let body = label(40, 56, "Aafnai symbol — small-size check (16, 32, 48 px)", { size: 28, weight: 700 });
  body += label(40, 88, "Left of each pair: actual pixels. Right: the same pixels enlarged 6× so the terracotta inset can be judged.", { size: 18, fill: "#556563" });
  let y = 130;
  for (const variant of variants) {
    body += label(40, y + 24, variant.name, { size: 22, weight: 700 });
    grounds.forEach((ground, gi) => {
      const x0 = 40 + gi * cellW;
      body += `<rect x="${x0}" y="${y + 40}" width="${cellW - 20}" height="${rowH - 60}" rx="14" fill="${ground.bg}" stroke="#DDD6CB"/>`;
      body += label(x0 + 14, y + rowH - 32, `on ${ground.name}`, { size: 16, fill: ground.name === "charcoal" ? C.paper : "#556563" });
    });
    y += rowH;
  }
  const sheetW = 40 + grounds.length * cellW + 20;
  const sheetH = y + 40;
  const base = await sharp(Buffer.from(svgDocument({ width: sheetW, height: sheetH, background: C.white, body }))).png().toBuffer();
  const composites = [];
  let vy = 130;
  for (const variant of variants) {
    for (const [gi, ground] of grounds.entries()) {
      let cx = 40 + gi * cellW + 18;
      for (const px of [16, 32, 48]) {
        const g = variant.small && geometry.symbolSmall ? geometry.symbolSmall : geometry.symbol;
        const svg = svgDocument({ width: g.size, height: g.size, body: symbolMarkup(ground.tone, { small: variant.small }) });
        const actual = await sharp(Buffer.from(svg), { density: Math.min(72 * ((px * 4) / g.size), 72 * 60) }).resize(px, px, { kernel: "lanczos3" }).png().toBuffer();
        const enlarged = await sharp(actual).resize(px * 6 > 150 ? 150 : px * 6, px * 6 > 150 ? 150 : px * 6, { kernel: "nearest" }).png().toBuffer();
        const top = vy + 52;
        composites.push({ input: actual, left: Math.round(cx), top: Math.round(top + 55 - px / 2) });
        const enlargedSize = Math.min(px * 6, 150);
        composites.push({ input: enlarged, left: Math.round(cx + px + 6), top: Math.round(top) });
        cx += px + 6 + enlargedSize + 14;
      }
    }
    vy += rowH;
  }
  const smallCheck = join(REVIEW, "small-size-check.png");
  mkdirSync(REVIEW, { recursive: true });
  await sharp(base).composite(composites).png().toFile(smallCheck);
  written.push(relative(REPO, smallCheck));

  // Avatar crops: square and circle.
  const av = await sharp(avatar).resize(360, 360).png().toBuffer();
  const circleMask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360"><circle cx="180" cy="180" r="180" fill="#fff"/></svg>`);
  const circle = await sharp(av).composite([{ input: circleMask, blend: "dest-in" }]).png().toBuffer();
  const cropBody = label(40, 50, "Social / profile avatar — square and circular crops", { size: 26, weight: 700 }) + label(40, 470, "Square (1024 px source)", { size: 18, fill: "#556563" }) + label(440, 470, "Circular crop", { size: 18, fill: "#556563" });
  const cropBase = await sharp(Buffer.from(svgDocument({ width: 840, height: 500, background: C.white, body: cropBody }))).png().toBuffer();
  const avatarCheck = join(REVIEW, "avatar-crop-check.png");
  await sharp(cropBase).composite([{ input: av, left: 40, top: 80 }, { input: circle, left: 440, top: 80 }]).png().toFile(avatarCheck);
  written.push(relative(REPO, avatarCheck));

  // Asset sheet: the whole family on one page.
  const W = 1600;
  let s = label(56, 76, "Aafnai — logo family", { size: 40, weight: 700 }) +
    label(56, 112, "Redrawn from the approved “01 / Own space” concept. Every file below is generated from one master geometry file.", { size: 20, fill: "#556563" });
  let top = 160;
  const tile = async (x, y, w, h, bg, svg, svgW, svgH, caption, pad = 36) => {
    const fitW = w - pad * 2;
    const fitH = h - pad * 2 - 30;
    const scale = Math.min(fitW / svgW, fitH / svgH);
    const iw = svgW * scale;
    const ih = svgH * scale;
    const img = await dataUri(await tmpPng(svg, svgW, svgH, Math.round(iw * 2)), Math.round(iw * 2));
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${bg}" stroke="#DDD6CB"/>` +
      `<image x="${n(x + (w - iw) / 2)}" y="${n(y + pad + (fitH - ih) / 2)}" width="${n(iw)}" height="${n(ih)}" href="${img}"/>` +
      label(x + 18, y + h - 18, caption, { size: 15, fill: bg === C.ink ? C.paper : "#556563" });
  };
  for (const kind of LAYOUTS) {
    const l = layout(kind);
    s += label(56, top + 8, { horizontal: "Horizontal", stacked: "Stacked", symbol: "Symbol", wordmark: "Wordmark" }[kind], { size: 22, weight: 700 });
    const h = kind === "horizontal" || kind === "wordmark" ? 200 : 260;
    const w = (W - 56 * 2 - 24 * 2) / 3;
    let x = 56;
    for (const toneName of Object.keys(TONES)) {
      const svg = svgDocument({ width: l.width, height: l.height, body: l.draw(TONES[toneName]) });
      s += await tile(x, top + 24, w, h, TONE_BACKGROUND[toneName], svg, l.width, l.height, `aafnai-${kind}-${toneName} · ${TONES[toneName].label}`);
      x += w + 24;
    }
    top += h + 64;
  }
  s += label(56, top + 8, "App icons, favicons and avatar", { size: 22, weight: 700 });
  const iconRow = top + 24;
  const iconTiles = [
    [await dataUri(join(EXPORTS, "icons", "aafnai-icon-512.png"), 400), 200, "PWA icon 512 (192 also)"],
    [await dataUri(join(EXPORTS, "icons", "aafnai-maskable-512.png"), 400), 200, "Maskable 512 · safe zone shown"],
    [await dataUri(join(EXPORTS, "icons", "aafnai-apple-touch-icon-180.png"), 360), 180, "Apple touch icon 180"],
    [await dataUri(avatar, 400), 200, "Avatar 1024"],
  ];
  let ix = 56;
  for (const [uri, size, caption] of iconTiles) {
    s += `<image x="${ix}" y="${iconRow}" width="${size}" height="${size}" href="${uri}"/>` + `<rect x="${ix}" y="${iconRow}" width="${size}" height="${size}" fill="none" stroke="#DDD6CB"/>`;
    if (caption.startsWith("Maskable")) s += `<circle cx="${ix + size / 2}" cy="${iconRow + size / 2}" r="${size * 0.4}" fill="none" stroke="${C.accent}" stroke-width="2" stroke-dasharray="6 5"/>`;
    s += label(ix, iconRow + size + 26, caption, { size: 15, fill: "#556563" });
    ix += size + 40;
  }
  const favX = ix + 10;
  for (const [i, [path, px]] of [[f16, 16], [f32, 32], [f48, 48]].entries()) {
    s += `<image x="${favX + i * 70}" y="${iconRow + 80 - px / 2}" width="${px}" height="${px}" href="${await dataUri(path)}"/>`;
  }
  s += label(favX, iconRow + 226, "Favicon 16 · 32 · 48 (actual size)", { size: 15, fill: "#556563" });
  top = iconRow + 280;
  s += label(56, top + 8, "Share preview 1200 × 630 and email logo", { size: 22, weight: 700 });
  s += `<image x="56" y="${top + 24}" width="600" height="315" href="${await dataUri(join(EXPORTS, "social", "aafnai-share-template-1200x630.png"), 1200)}"/><rect x="56" y="${top + 24}" width="600" height="315" fill="none" stroke="#DDD6CB"/>`;
  s += `<image x="680" y="${top + 24}" width="600" height="315" href="${await dataUri(og, 1200)}"/><rect x="680" y="${top + 24}" width="600" height="315" fill="none" stroke="#DDD6CB"/>`;
  s += label(56, top + 364, "Template with title area", { size: 15, fill: "#556563" }) + label(680, top + 364, "Default share image (used by the site)", { size: 15, fill: "#556563" });
  s += `<image x="1304" y="${top + 24}" width="160" height="${n((160 * hz().height) / hz().width)}" href="${await dataUri(join(EXPORTS, "email", "aafnai-email-logo@2x.png"))}"/>`;
  s += label(1304, top + 120, "Email logo · 160 px display", { size: 15, fill: "#556563" });
  top += 400;
  s += label(56, top + 8, "Colours", { size: 22, weight: 700 });
  const swatches = [["Primary teal", C.primary], ["Charcoal", C.ink], ["Ivory", C.paper], ["Terracotta accent", C.accent], ["White", C.white]];
  swatches.forEach(([name, hex], i) => {
    const x = 56 + i * 300;
    s += `<rect x="${x}" y="${top + 28}" width="270" height="110" rx="12" fill="${hex}" stroke="#DDD6CB"/>` + label(x, top + 166, `${name} ${hex.toUpperCase()}`, { size: 17 });
  });
  top += 210;
  const sheet = join(REVIEW, "asset-sheet.png");
  await sharp(Buffer.from(svgDocument({ width: W, height: top, background: C.white, body: s })), { density: 72 }).png({ compressionLevel: 9 }).toFile(sheet);
  written.push(relative(REPO, sheet));
}

const hz = () => layout("horizontal");
let tmpCount = 0;
async function tmpPng(svg, svgW, svgH, width) {
  const path = join(REVIEW, ".tmp", `t${tmpCount++}.png`);
  mkdirSync(dirname(path), { recursive: true });
  const density = Math.min(72 * ((width * 2) / svgW), 72 * 60);
  await sharp(Buffer.from(svg), { density }).resize(width).png().toFile(path);
  return path;
}

await build();
rmSync(join(REVIEW, ".tmp"), { recursive: true, force: true });
const unique = [...new Set(written)].sort();
console.log(`Wrote ${unique.length} files:`);
for (const file of unique) console.log(`  ${file}`);
