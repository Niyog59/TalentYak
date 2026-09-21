/**
 * What a file actually is, from its first bytes.
 *
 * Shared by the browser and the server on purpose. The browser uses it to
 * refuse an unsupported file INSTANTLY, before a 40 MB upload is wasted on it.
 * The server uses the same function on the real bytes after upload and has the
 * final say — the browser's check is a courtesy, never the gate.
 *
 * A file name and a declared content type are both chosen by the uploader and
 * are never consulted here.
 *
 * HEIC/HEIF — the iPhone camera's default — is recognised as a photo. It shares
 * a container family with MP4, and an earlier version of this check would have
 * called an iPhone photo a video; the brands are read to tell them apart.
 *
 * Anything else unrecognised — documents, archives, RAW files, GIFs — is
 * refused out loud, never stored "just in case".
 */

export const MAX_PHOTO_BYTES = 30 * 1024 * 1024;
/** The storage plan's own per-file ceiling, measured: 49 MB accepted, 51 MB refused. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
/**
 * Measured on the deployed function (one CPU): re-encoding runs at roughly
 * 1.0–1.35x the clip's own length — a 30.5 s 1080p60 clip took 41.3 s, a 75 s
 * one 73.4 s. Two minutes therefore needs at most ~160 s, inside the 230 s
 * processing limit with margin. Three minutes would not reliably fit.
 */
export const MAX_VIDEO_SECONDS = 120;

export type Sniffed =
  | { kind: "image"; format: "jpeg" | "png" | "webp" | "avif" | "heic" }
  | { kind: "video"; format: "mp4" | "mov" | "3gp" | "webm" }
  | { kind: "unsupported"; format: "unknown"; reason: string };

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...Array.from(bytes.slice(from, to)));

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);
const MP4_BRANDS = new Set(["isom", "iso2", "iso3", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "m4v ", "mp71", "dash", "f4v "]);
const GPP_BRANDS = new Set(["3gp4", "3gp5", "3gp6", "3g2a", "3g2b", "3g2c", "3ge6", "3gg6"]);

const UNKNOWN_REASON = "Upload a photo (JPEG, HEIC, PNG, WebP or AVIF) or a video (MP4, MOV or WebM).";

/** Needs at least the first 64 bytes. */
export function sniff(bytes: Uint8Array): Sniffed {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: "image", format: "jpeg" };
  }
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) {
    return { kind: "image", format: "png" };
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return { kind: "image", format: "webp" };
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { kind: "video", format: "webm" };
  }

  // The ISO base media family: MP4, MOV, 3GP, HEIC and AVIF all start with an
  // `ftyp` box. The major brand and the compatible brands say which.
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const boxSize = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    const major = ascii(bytes, 8, 12).toLowerCase();
    const brands = [major];
    for (let o = 16; o + 4 <= Math.min(bytes.length, boxSize); o += 4) {
      brands.push(ascii(bytes, o, o + 4).toLowerCase());
    }

    // AVIF can carry `mif1` as its major brand, so check for it first.
    if (brands.includes("avif") || brands.includes("avis")) return { kind: "image", format: "avif" };
    if (brands.some((b) => HEIF_BRANDS.has(b))) return { kind: "image", format: "heic" };
    if (major === "qt  ") return { kind: "video", format: "mov" };
    if (GPP_BRANDS.has(major)) return { kind: "video", format: "3gp" };
    if (MP4_BRANDS.has(major) || brands.some((b) => MP4_BRANDS.has(b))) return { kind: "video", format: "mp4" };
  }

  return { kind: "unsupported", format: "unknown", reason: UNKNOWN_REASON };
}

/** The size message, in the unit people think in. */
export function tooLargeMessage(kind: "image" | "video"): string {
  return kind === "image"
    ? `That photo is larger than ${MAX_PHOTO_BYTES / 1048576} MB. Choose a smaller one.`
    : `That clip is larger than ${MAX_VIDEO_BYTES / 1048576} MB, which is the most our storage accepts for one file. ` +
        "Trim it, or record a shorter one.";
}

export function capFor(kind: "image" | "video"): number {
  return kind === "image" ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
}
