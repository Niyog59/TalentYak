import "server-only";

/**
 * Accepting an image from a person.
 *
 * The declared content type and the file name are both chosen by the uploader,
 * so neither is trusted. The first bytes decide what the file is; anything that
 * is not a JPEG, PNG or WebP is refused. The image is then decoded and written
 * out again as a fresh WebP, which is what makes the upload safe to serve:
 * re-encoding drops EXIF (including GPS position), embedded profiles and any
 * payload hidden after the image data. Only the re-encoded copy is ever stored.
 *
 * sharp ships with Next.js as its image library. If it cannot load on the host,
 * uploads fail closed with a clear message rather than storing the original.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export class ImageRejected extends Error {}

export function sniffImage(bytes: Uint8Array): "jpeg" | "png" | "webp" | null {
  return sniff(bytes);
}

function sniff(bytes: Uint8Array): "jpeg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "webp";
  return null;
}

export async function reencodeProfilePhoto(file: File): Promise<Buffer> {
  if (!file || file.size === 0) throw new ImageRejected("Choose a photo to upload.");
  if (file.size > MAX_IMAGE_BYTES) throw new ImageRejected("That photo is larger than 5 MB. Choose a smaller one.");

  const input = new Uint8Array(await file.arrayBuffer());
  if (!sniff(input)) throw new ImageRejected("Upload a JPEG, PNG or WebP photo.");

  let sharp: (typeof import("sharp"))["default"];
  try {
    sharp = (await import("sharp")).default;
  } catch {
    throw new ImageRejected("Photo uploads aren't available right now. Please try again later.");
  }

  try {
    return await sharp(input, { limitInputPixels: 40_000_000 })
      .rotate() // apply the camera's orientation before the metadata is dropped
      .resize(800, 800, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new ImageRejected("That file couldn't be read as a photo.");
  }
}
