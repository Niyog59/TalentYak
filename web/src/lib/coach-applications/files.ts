import "server-only";
import { sniffImage } from "@/lib/uploads/image";

/**
 * Certificate files attached to a coach application.
 *
 * Accepted: a photo or scan (JPEG, PNG or WebP) or a PDF, up to 4 MB — under
 * the 6 MB server-action limit with room for the form around it. The file's
 * own first bytes decide what it is; its name and declared type are ignored.
 *
 * PHOTOS are decoded and written out again as WebP. That drops EXIF (including
 * GPS position) and anything hidden after the image data. They are never
 * cropped: a certificate must stay readable, so only the long edge is capped.
 *
 * PDFs can't be rewritten without adding a PDF library, so they are stored as
 * uploaded, checked instead: a real PDF header, and none of the features that
 * make a PDF do something when opened (scripts, launch actions, embedded
 * files, forms that run code). Founders open them only as a download from a
 * short-lived private link — never inline on a TalentYak page.
 */

export const MAX_CERTIFICATE_BYTES = 4 * 1024 * 1024;
const LONG_EDGE = 2400;

export class CertificateRejected extends Error {}

export type CertificateKind = "image" | "pdf";

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
}

/** PDF name tokens that make a document act rather than just display. */
const ACTIVE_PDF_TOKENS = ["/JavaScript", "/JS", "/Launch", "/EmbeddedFiles", "/EmbeddedFile", "/RichMedia", "/XFA", "/SubmitForm", "/ImportData"];

/**
 * The first active feature found, or null. Scans the raw bytes as Latin-1 so a
 * token is matched exactly; a name written with #-escapes (like /J#61vaScript)
 * is decoded first, because that is how scripts are commonly smuggled past
 * naive checks.
 */
export function activePdfFeature(bytes: Uint8Array): string | null {
  const raw = Buffer.from(bytes).toString("latin1");
  const decoded = raw.replace(/\/[^\s/<>[\]()]+/g, (name) => name.replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))));
  for (const token of ACTIVE_PDF_TOKENS) {
    // A token must end at a delimiter, so "/JSON" isn't mistaken for "/JS".
    const re = new RegExp(`${token.replace("/", "\\/")}(?=[\\s/<>\\[\\]()]|$)`);
    if (re.test(decoded)) return token;
  }
  return null;
}

export interface CleanCertificate {
  kind: CertificateKind;
  extension: "webp" | "pdf";
  contentType: "image/webp" | "application/pdf";
  body: Buffer;
}

export async function cleanCertificate(file: File): Promise<CleanCertificate> {
  if (!file || file.size === 0) throw new CertificateRejected("Choose a file to upload.");
  if (file.size > MAX_CERTIFICATE_BYTES) throw new CertificateRejected("That file is larger than 4 MB. Upload a smaller photo or PDF.");
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (isPdf(bytes)) {
    const feature = activePdfFeature(bytes);
    if (feature) {
      throw new CertificateRejected("That PDF contains interactive content we can't accept. Save or print it as a plain PDF, or upload a photo of the certificate.");
    }
    return { kind: "pdf", extension: "pdf", contentType: "application/pdf", body: Buffer.from(bytes) };
  }

  if (!sniffImage(bytes)) throw new CertificateRejected("Upload a photo (JPEG, PNG or WebP) or a PDF.");

  let sharp: (typeof import("sharp"))["default"];
  try {
    sharp = (await import("sharp")).default;
  } catch {
    throw new CertificateRejected("Uploads aren't available right now. Please try again later.");
  }
  try {
    const body = await sharp(bytes, { limitInputPixels: 50_000_000 })
      .rotate() // apply the camera's orientation before the metadata is dropped
      .resize(LONG_EDGE, LONG_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    return { kind: "image", extension: "webp", contentType: "image/webp", body };
  } catch {
    throw new CertificateRejected("That file couldn't be read as a photo.");
  }
}
