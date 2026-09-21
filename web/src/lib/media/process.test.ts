import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sniff } from "@/lib/media/sniff";
import { MediaProcessingError, processPhoto, processVideo } from "@/lib/media/process";
import { probe, run } from "@/lib/media/ffmpeg";

/**
 * Progress photos and form clips are body data (invariant 3), and phones write
 * where and on what they were taken into the file. These tests prove what we
 * store is our own re-encoding, upright, un-cropped, smaller, and carrying
 * none of that — and that we refuse what we cannot make safe, out loud.
 */

async function sharpOrSkip() {
  try {
    return (await import("sharp")).default;
  } catch {
    return null;
  }
}

const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
/** An ISO-BMFF `ftyp` box with a major brand and compatible brands. */
function ftyp(major: string, ...compatible: string[]): Uint8Array {
  const size = 16 + compatible.length * 4;
  return new Uint8Array([0, 0, 0, size, ...ascii("ftyp"), ...ascii(major), 0, 0, 0, 0, ...compatible.flatMap(ascii), ...new Array(48).fill(0)]);
}

describe("what a file really is", () => {
  test("common phone and camera formats are recognised by their bytes", () => {
    assert.deepEqual(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 0])), { kind: "image", format: "jpeg" });
    assert.deepEqual(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { kind: "image", format: "png" });
    assert.deepEqual(sniff(new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")])), { kind: "image", format: "webp" });
    assert.deepEqual(sniff(ftyp("avif", "mif1", "miaf")), { kind: "image", format: "avif" });
    assert.deepEqual(sniff(ftyp("qt  ", "qt  ")), { kind: "video", format: "mov" });
    assert.deepEqual(sniff(ftyp("isom", "iso2", "avc1", "mp41")), { kind: "video", format: "mp4" });
    assert.deepEqual(sniff(ftyp("3gp4", "isom", "3gp4")), { kind: "video", format: "3gp" });
    assert.deepEqual(sniff(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0])), { kind: "video", format: "webm" });
  });

  test("an iPhone HEIC photo is recognised as a photo — and NOT mistaken for a video", () => {
    // HEIC and MP4 share a container. A check that only looked for `ftyp`
    // would have called this a clip and handed it to the video encoder.
    for (const brands of [["heic", "mif1", "heic"], ["mif1", "mif1", "heic"], ["heix", "mif1"], ["hevc", "msf1"]]) {
      assert.deepEqual(sniff(ftyp(brands[0], ...brands.slice(1))), { kind: "image", format: "heic" }, `brands ${brands.join(",")}`);
    }
  });

  test("an AVIF that uses the generic HEIF brand is still an AVIF", () => {
    assert.deepEqual(sniff(ftyp("mif1", "avif", "mif1", "miaf")), { kind: "image", format: "avif" });
  });

  test("documents, archives and scripts are refused whatever they are called", () => {
    for (const bytes of [ascii("%PDF-1.7\n"), ascii("PKzip"), ascii("#!/bin/sh\nrm -rf /"), ascii("GIF89a"), ascii("<svg onload=alert(1)>")]) {
      assert.equal(sniff(new Uint8Array(bytes)).kind, "unsupported");
    }
  });
});

describe("optimising a photo", () => {
  test("a sideways 12-megapixel phone photo is uprighted, resized without cropping, and loses its GPS", async (t) => {
    const sharp = await sharpOrSkip();
    if (!sharp) return t.skip("sharp is not available");

    const w = 4032, h = 3024;
    const pixels = Buffer.alloc(w * h * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = (Math.sin(i / 997) * 60 + 128 + ((i * 7919) % 61) - 30) & 255;
    const original = await sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
      .withMetadata({ orientation: 6 })
      .withExif({
        IFD0: { Make: "Apple", Model: "iPhone 15 Pro", Artist: "Test Person" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "27/1 42/1 3600/100", GPSLongitudeRef: "E", GPSLongitude: "85/1 19/1 2400/100" },
      })
      .jpeg({ quality: 95 })
      .toBuffer();

    const out = await processPhoto(original);
    const stored = await sharp(out.bytes).metadata();
    const report = out.report as { source: Record<string, unknown>; output: Record<string, number>; savedPercent: number };

    // Found in the source, gone from the output.
    assert.equal(report.source.gps, true, "the fixture really carries GPS");
    assert.equal(report.source.orientation, 6);
    assert.equal(stored.exif, undefined, "EXIF (including GPS) survived");
    assert.equal(stored.xmp, undefined);
    assert.equal(stored.iptc, undefined);
    assert.equal(stored.icc, undefined);
    assert.equal(stored.orientation, undefined, "an orientation flag survived");

    // Upright: the phone was held in portrait, so the result is taller than wide.
    assert.equal(stored.width, 1536);
    assert.equal(stored.height, 2048);
    // Not cropped, not stretched: 3024:4032 is exactly 3:4.
    assert.equal(stored.width! / stored.height!, 3024 / 4032);
    assert.ok(out.bytes.byteLength < original.byteLength, "the optimised photo is not smaller");
    assert.ok(report.savedPercent > 0);

    const preview = await sharp(out.preview).metadata();
    assert.equal(preview.exif, undefined, "the thumbnail carries metadata");
    assert.ok(Math.max(preview.width!, preview.height!) <= 480);
  });

  test("an Apple-encoded HEIC photo is uprighted, re-encoded, and loses its GPS and device details", async (t) => {
    const sharp = await sharpOrSkip();
    if (!sharp) return t.skip("sharp is not available");
    // Encoded by Apple's own HEIC encoder (macOS `sips`, the same encoder an
    // iPhone uses): 600x400 stored sideways with a rotation box, carrying GPS,
    // make and model in its EXIF item.
    const heic = await readFile(join(process.cwd(), "test", "fixtures", "apple-portrait-gps.heic"));
    assert.equal(sniff(new Uint8Array(heic.subarray(0, 64))).kind, "image");

    const out = await processPhoto(heic, "heic");
    const report = out.report as { source: Record<string, unknown> };
    assert.equal(report.source.format, "heic");
    assert.equal(report.source.gps, true, "the fixture really carries GPS");
    assert.equal(report.source.rotationBox, true, "the fixture really carries a rotation box");

    const stored = await sharp(out.bytes).metadata();
    assert.equal(stored.format, "webp");
    assert.equal(stored.exif, undefined, "EXIF survived");
    assert.equal(stored.icc, undefined);
    // Upright: 600x400 turned to portrait.
    assert.equal(out.width, 400);
    assert.equal(out.height, 600);
    for (const s of ["GPS", "Apple", "iPhone"]) {
      assert.ok(!out.bytes.includes(Buffer.from(s)), `"${s}" is still in the stored file`);
    }
  });

  test("a file that claims to be HEIC but is not one is refused permanently", async () => {
    const fake = Buffer.concat([Buffer.from(ftyp("heic", "mif1", "heic")), Buffer.alloc(4096, 7)]);
    await assert.rejects(() => processPhoto(fake, "heic"), (err: unknown) => err instanceof MediaProcessingError && err.permanent);
  });

  test("a small photo is never enlarged", async (t) => {
    const sharp = await sharpOrSkip();
    if (!sharp) return t.skip("sharp is not available");
    const small = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#556b2f" } }).png().toBuffer();
    const out = await processPhoto(small);
    assert.equal(out.width, 640);
    assert.equal(out.height, 480);
  });

  test("a file that claims to be a photo but will not decode is refused", async () => {
    const broken = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(0x41)]);
    await assert.rejects(() => processPhoto(broken), MediaProcessingError);
  });
});

describe("processing a clip", () => {
  async function makeClip(dir: string, args: string[]): Promise<Buffer> {
    const raw = join(dir, "raw.mov");
    const tagged = join(dir, "tagged.mov");
    const a = await run(["-hide_banner", "-loglevel", "error", "-y", ...args, raw], 60_000);
    assert.equal(a.code, 0, a.stderr);
    // The way a phone writes it: a rotation matrix, a location, a make and model.
    const b = await run([
      "-hide_banner", "-loglevel", "error", "-y", "-display_rotation:v:0", "-90", "-i", raw, "-c", "copy",
      "-metadata", "location=+27.7172+085.3240+1400.000/", "-metadata", "make=Apple", "-metadata", "model=iPhone 15 Pro",
      "-metadata", "creation_time=2026-09-18T07:12:00Z", "-movflags", "use_metadata_tags", "-f", "mov", tagged,
    ], 60_000);
    assert.equal(b.code, 0, b.stderr);
    return readFile(tagged);
  }

  test("a portrait phone clip is uprighted, re-encoded for any browser, keeps its sound and motion, and loses its location", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clip-test-"));
    try {
      const source = await makeClip(dir, [
        "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=60", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "8M", "-c:a", "aac", "-ac", "2", "-f", "mov",
      ]);
      const before = await probe(await writeTemp(dir, "check.mov", source));
      assert.ok(before.identifyingTags.includes("location"), "the fixture really carries a location");
      assert.equal(before.rotation, -90);

      const out = await processVideo(source);
      const after = await probe(await writeTemp(dir, "out.mp4", out.bytes));

      assert.equal(after.video?.codec, "h264");
      assert.equal(after.audio?.codec, "aac", "the sound was lost");
      assert.equal(after.rotation, 0, "a rotation flag survived");
      assert.deepEqual(after.identifyingTags, [], `tags survived: ${after.identifyingTags.join(", ")}`);
      // Upright and bounded: 1080x1920 as displayed, scaled to 720x1280.
      assert.equal(out.width, 720);
      assert.equal(out.height, 1280);
      assert.equal(after.video?.fps, 60, "the frame rate a form check needs was reduced");
      assert.ok(Math.abs((after.durationSeconds ?? 0) - 3) < 0.2);
      assert.ok(out.preview.byteLength > 0, "no poster frame");
      assert.ok(out.bytes.byteLength < source.byteLength);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an iPhone-style HDR (HLG, 10-bit HEVC) clip is tone-mapped to ordinary video, not left grey and flat", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clip-test-"));
    try {
      const hdrPath = join(dir, "hdr.mov");
      const made = await run([
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-t", "2",
        "-c:v", "libx265", "-preset", "ultrafast", "-pix_fmt", "yuv420p10le",
        "-x265-params", "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:log-level=error",
        "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc", "-tag:v", "hvc1", "-f", "mov", hdrPath,
      ], 60_000);
      assert.equal(made.code, 0, made.stderr);
      const source = await readFile(hdrPath);
      const before = await probe(hdrPath);
      assert.equal(before.video?.transfer, "arib-std-b67", "the fixture really is HLG");
      assert.equal(before.video?.pixelFormat, "yuv420p10le");

      const out = await processVideo(source);
      const report = out.report as { output: Record<string, unknown>; source: Record<string, unknown> };
      assert.equal(report.source.hdr, "arib-std-b67");
      assert.equal(report.output.hdrTonemapped, true, "HDR was not converted");
      const after = await probe(await writeTemp(dir, "out.mp4", out.bytes));
      assert.equal(after.video?.codec, "h264");
      assert.equal(after.video?.pixelFormat, "yuv420p", "the output is not ordinary 8-bit video");
      assert.equal(after.video?.transfer, "bt709", "the output is not tagged as standard range");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("junk behind a video header is refused permanently — retrying cannot help", async () => {
    const header = ftyp("isom", "iso2", "avc1", "mp41");
    const junk = Buffer.concat([Buffer.from(header), Buffer.alloc(200_000, 0x5a)]);
    await assert.rejects(
      () => processVideo(junk),
      (err: unknown) => err instanceof MediaProcessingError && err.permanent,
    );
  });

  test("a clip cut short fails the output check, stores nothing, and can be retried", async () => {
    // What an interrupted phone export looks like: the index says 4 seconds,
    // the data stops a third of the way in. The encoder produces something
    // shorter; the check notices the duration changed and refuses to store it.
    const dir = await mkdtemp(join(tmpdir(), "clip-test-"));
    try {
      const whole = join(dir, "whole.mp4");
      const made = await run([
        "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
        "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-movflags", "+faststart", whole,
      ], 60_000);
      assert.equal(made.code, 0, made.stderr);
      const bytes = await readFile(whole);
      const truncated = bytes.subarray(0, Math.floor(bytes.byteLength / 3));

      await assert.rejects(
        () => processVideo(Buffer.from(truncated)),
        (err: unknown) => err instanceof MediaProcessingError && !err.permanent && /Nothing was stored|couldn't be processed/.test(err.message),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function writeTemp(dir: string, name: string, bytes: Buffer): Promise<string> {
  const { writeFile } = await import("node:fs/promises");
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}
