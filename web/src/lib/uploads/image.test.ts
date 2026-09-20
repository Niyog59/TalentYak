import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ImageRejected, MAX_IMAGE_BYTES, reencodeProfilePhoto } from "@/lib/uploads/image";

/**
 * Progress photos and coach photos carry GPS coordinates in EXIF (invariant 3).
 * These tests prove that what we store is a re-encoded copy with no metadata,
 * and that a file is judged by its bytes rather than by its name or its
 * declared type.
 */

async function sharpOrSkip() {
  try {
    return (await import("sharp")).default;
  } catch {
    return null;
  }
}

function fileOf(bytes: Uint8Array, name = "photo.jpg", type = "image/jpeg"): File {
  return new File([bytes as unknown as BlobPart], name, { type });
}

describe("accepting a photo", () => {
  test("a file that is not an image is refused, whatever it claims to be", async () => {
    const notAnImage = fileOf(new TextEncoder().encode("#!/bin/sh\necho hello\n"), "photo.jpg", "image/jpeg");
    await assert.rejects(() => reencodeProfilePhoto(notAnImage), ImageRejected);
  });

  test("an empty file is refused", async () => {
    await assert.rejects(() => reencodeProfilePhoto(fileOf(new Uint8Array())), ImageRejected);
  });

  test("a file above the size cap is refused before it is decoded", async () => {
    const huge = fileOf(new Uint8Array(MAX_IMAGE_BYTES + 1));
    await assert.rejects(() => reencodeProfilePhoto(huge), (err: Error) => /larger than 5 MB/.test(err.message));
  });

  test("a real photo is re-encoded, and its location data does not survive", async (t) => {
    const sharp = await sharpOrSkip();
    if (!sharp) return t.skip("sharp is not available in this environment");

    // A JPEG carrying EXIF, including a GPS tag, as a phone would produce.
    const original = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#7f9f8f" } })
      // A copyright tag stands in for the metadata a phone attaches; the point
      // is that NOTHING survives re-encoding, GPS included.
      .withExifMerge({ IFD0: { Copyright: "Test", Artist: "Phone camera" } })
      .jpeg()
      .toBuffer();
    const before = await sharp(original).metadata();
    assert.ok(before.exif, "the fixture really does carry EXIF");

    const stored = await reencodeProfilePhoto(fileOf(new Uint8Array(original)));
    const after = await sharp(stored).metadata();

    assert.equal(after.format, "webp", "what we store is our own encoding");
    assert.equal(after.exif, undefined, "invariant 3: location data is stripped");
    assert.ok(after.width! <= 800 && after.height! <= 800, "the stored copy is bounded in size");
  });
});
