import "server-only";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { probe, run } from "@/lib/media/ffmpeg";
import { decodeHeic, HeicDecodeError } from "@/lib/media/heic";
import { MAX_VIDEO_SECONDS, sniff } from "@/lib/media/sniff";

/**
 * Turning an upload in the holding area into something safe to show a coach.
 *
 * THE ORDER, which is the point of this module:
 *
 *   1. claim the asset (atomic; a second processor gets nothing)
 *   2. read the ORIGINAL's bytes and decide what it really is
 *   3. produce a cleaned copy — photos with sharp, clips with ffmpeg
 *   4. re-read the cleaned copy and CHECK it: right format, no identifying
 *      metadata, no rotation flag left behind, sensible size and duration
 *   5. store it (never overwriting anything), then download what was stored
 *      and check it again — the storage service has the final word on what we
 *      actually hold
 *   6. mark it ready — the only place `metadata_stripped` becomes true
 *   7. only then delete the original
 *
 * A failure retrying could fix leaves the original in the holding area so the
 * owner can try again. A permanent refusal (HEIC, a document, an over-length
 * clip) deletes the original at once — nothing could ever be done with it.
 * Either way the asset is `failed` with a reason, visible only to its owner.
 *
 * PHOTOS are kept at up to 2048 px on the long edge. That is enough to compare
 * posture and shape between two progress photos months apart; beyond it, a
 * phone photo is mostly sensor noise that costs storage and data plans. They are
 * never cropped or stretched: proportions are preserved exactly.
 *
 * CLIPS are made broadly playable — H.264 High, yuv420p, AAC, MP4 with the
 * index at the front so playback starts before the download ends — at up to
 * 1280 px on the long edge, keeping frame rate up to 60 fps (fast movement is
 * what a form check is for) and keeping the audio (a coach's cue, or the bar
 * hitting the floor, is part of the review).
 */

const SOURCE_BUCKET = "media-uploads";
const OUTPUT_BUCKET = "private-media";

const PHOTO_LONG_EDGE = 2048;
const PHOTO_QUALITY = 82;
const PREVIEW_LONG_EDGE = 480;
const VIDEO_LONG_EDGE = 1280;
const VIDEO_CRF = 23;
/** Under the function's own limit, so a slow encode fails cleanly instead of being killed mid-write. */
const VIDEO_TIMEOUT_MS = 230_000;

export class MediaProcessingError extends Error {
  /** True when retrying cannot help: an unsupported format stays unsupported. */
  readonly permanent: boolean;

  constructor(message: string, permanent: boolean) {
    super(message);
    this.permanent = permanent;
  }
}

interface Output {
  bytes: Buffer;
  contentType: string;
  extension: string;
  width: number;
  height: number;
  durationSeconds: number | null;
  preview: Buffer;
  report: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/** Where in an EXIF block the GPS pointer (tag 0x8825) lives, in either byte order. */
function hasGpsPointer(exif: Buffer | undefined): boolean {
  if (!exif) return false;
  return exif.includes(Buffer.from([0x88, 0x25, 0x00, 0x04])) || exif.includes(Buffer.from([0x25, 0x88, 0x04, 0x00]));
}

/** An EXIF item, as HEIC stores it, begins with this marker. */
function hasExifMarker(bytes: Buffer): boolean {
  return bytes.includes(Buffer.from("Exif\0\0", "latin1"));
}

export async function processPhoto(input: Buffer, format: string = "unknown"): Promise<Output> {
  const sharp = (await import("sharp")).default;

  let oriented: import("sharp").Sharp;
  let shownWidth: number;
  let shownHeight: number;
  let sourceReport: Record<string, unknown>;

  if (format === "heic") {
    // iPhone HEIC: decoded to bare pixels, with the camera's rotation already
    // applied, in an isolated thread (lib/media/heic.ts). Nothing but pixels
    // comes back, so no metadata can reach the output.
    let decoded;
    try {
      decoded = await decodeHeic(input);
    } catch (err) {
      const slow = err instanceof HeicDecodeError && /too long/.test(err.message);
      throw new MediaProcessingError(err instanceof Error ? err.message : "That HEIC photo couldn't be read.", !slow);
    }
    shownWidth = decoded.width;
    shownHeight = decoded.height;
    // HEIC photos from a camera are opaque; flattening drops the alpha channel
    // the decoder always returns, which would otherwise bloat the output.
    oriented = sharp(decoded.rgba, { raw: { width: decoded.width, height: decoded.height, channels: 4 } }).flatten({
      background: "#ffffff",
    });
    sourceReport = {
      format: "heic",
      bytes: input.byteLength,
      width: shownWidth,
      height: shownHeight,
      rotationBox: input.includes(Buffer.from("irot", "latin1")),
      exif: hasExifMarker(input),
      gps: hasGpsPointer(input),
      decoder: "libheif (WebAssembly)",
    };
  } else {
    // A decompression bomb is refused by pixel count before it is decoded.
    const source = sharp(input, { limitInputPixels: 80_000_000, failOn: "error" });
    let meta;
    try {
      meta = await source.metadata();
    } catch {
      throw new MediaProcessingError("That file couldn't be read as a photo.", true);
    }
    if (!meta.width || !meta.height) throw new MediaProcessingError("That file couldn't be read as a photo.", true);

    // Orientations 5–8 turn the picture on its side: its displayed width is the
    // stored height. Reported as the person sees it.
    const sideways = (meta.orientation ?? 1) >= 5;
    shownWidth = sideways ? meta.height : meta.width;
    shownHeight = sideways ? meta.width : meta.height;

    // `.rotate()` with no angle applies the camera's orientation to the pixels.
    // It MUST run before the metadata is dropped, or the photo is stored on its
    // side forever. sharp writes no metadata unless asked to, so the output
    // carries no EXIF, GPS, XMP, IPTC or colour profile; colours are converted
    // to sRGB first so a phone's wide-gamut photo does not come out dull.
    oriented = sharp(input, { limitInputPixels: 80_000_000 }).rotate();
    sourceReport = {
      format: meta.format,
      bytes: input.byteLength,
      width: shownWidth,
      height: shownHeight,
      orientation: meta.orientation ?? 1,
      exif: Boolean(meta.exif),
      gps: hasGpsPointer(meta.exif),
      xmp: Boolean(meta.xmp),
      iptc: Boolean(meta.iptc),
      iccProfile: Boolean(meta.icc),
    };
  }

  let bytes: Buffer;
  let preview: Buffer;
  try {
    bytes = await oriented
      .clone()
      .resize(PHOTO_LONG_EDGE, PHOTO_LONG_EDGE, { fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb")
      .webp({ quality: PHOTO_QUALITY, effort: 5, smartSubsample: true })
      .toBuffer();
    preview = await oriented
      .clone()
      .resize(PREVIEW_LONG_EDGE, PREVIEW_LONG_EDGE, { fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb")
      .webp({ quality: 72, effort: 4 })
      .toBuffer();
  } catch {
    throw new MediaProcessingError("That photo couldn't be processed. It may be damaged.", false);
  }

  const out = await verifyPhoto(bytes, shownWidth, shownHeight);
  await verifyPhoto(preview, shownWidth, shownHeight);

  return {
    bytes,
    contentType: "image/webp",
    extension: "webp",
    width: out.width,
    height: out.height,
    durationSeconds: null,
    preview,
    report: {
      kind: "image",
      source: sourceReport,
      output: {
        format: "webp",
        bytes: bytes.byteLength,
        width: out.width,
        height: out.height,
        quality: PHOTO_QUALITY,
        metadata: "none",
      },
      preview: { bytes: preview.byteLength },
      savedBytes: input.byteLength - bytes.byteLength,
      savedPercent: Math.round((1 - bytes.byteLength / input.byteLength) * 1000) / 10,
    },
  };
}

/**
 * The cleaned photo is decoded again and inspected. If anything identifying
 * survived, or the proportions changed, it is refused rather than stored.
 */
async function verifyPhoto(bytes: Buffer, sourceWidth: number, sourceHeight: number) {
  const sharp = (await import("sharp")).default;
  const m = await sharp(bytes).metadata();
  if (m.format !== "webp") throw new MediaProcessingError("Processing produced the wrong format.", false);
  if (m.exif || m.xmp || m.iptc || m.icc) {
    throw new MediaProcessingError("Metadata survived processing; nothing was stored.", false);
  }
  if ((m.orientation ?? 1) !== 1) throw new MediaProcessingError("An orientation flag survived processing.", false);
  const sourceRatio = sourceWidth / sourceHeight;
  const outRatio = (m.width ?? 0) / (m.height ?? 1);
  // One pixel of rounding on the short edge is the only allowed difference.
  if (Math.abs(sourceRatio - outRatio) > 2 / Math.min(m.width ?? 1, m.height ?? 1)) {
    throw new MediaProcessingError("Processing changed the photo's proportions; nothing was stored.", false);
  }
  return { width: m.width ?? 0, height: m.height ?? 0 };
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

export async function processVideo(input: Buffer): Promise<Output> {
  const dir = await mkdtemp(join(tmpdir(), "media-"));
  const inPath = join(dir, "source");
  const outPath = join(dir, "out.mp4");
  const posterPath = join(dir, "poster.jpg");
  const started = Date.now();

  try {
    await writeFile(inPath, input);
    const src = await probe(inPath);

    if (!src.video) throw new MediaProcessingError("That file doesn't contain a video we can read.", true);
    if (!src.durationSeconds || src.durationSeconds <= 0) {
      throw new MediaProcessingError("That clip couldn't be read. It may be damaged.", false);
    }
    if (src.durationSeconds > MAX_VIDEO_SECONDS + 0.5) {
      throw new MediaProcessingError(
        `That clip is ${Math.round(src.durationSeconds)} seconds long. Clips can be up to ${MAX_VIDEO_SECONDS / 60} minutes — trim it and upload again.`,
        true,
      );
    }

    // ffmpeg applies the display rotation to the pixels by default, so a clip
    // filmed in portrait comes out upright with no rotation flag left to
    // disagree with the picture. Every tag from the container and from each
    // stream is dropped; `bitexact` stops ffmpeg writing its own version into
    // the file.
    const scale = `scale=w='trunc(min(1\\,${VIDEO_LONG_EDGE}/max(iw\\,ih))*iw/2)*2':h='trunc(min(1\\,${VIDEO_LONG_EDGE}/max(iw\\,ih))*ih/2)*2'`;

    // iPhones record HDR (HLG, 10-bit) by default. Squeezed into ordinary
    // 8-bit video without conversion it looks grey and flat — a coach would be
    // judging form from a washed-out picture. So HDR is tone-mapped to standard
    // range, after scaling down (cheaper on one CPU).
    const hdr = src.video.transfer === "arib-std-b67" || src.video.transfer === "smpte2084";
    const tonemap =
      "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709," +
      "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

    const encodeWith = (filters: string) =>
      run(
        [
          "-hide_banner", "-nostdin", "-y",
          "-i", inPath,
          "-map", "0:v:0", "-map", "0:a:0?",
          "-vf", filters,
          "-fpsmax", "60",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", String(VIDEO_CRF),
          "-profile:v", "high", "-pix_fmt", "yuv420p",
          "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
          "-c:a", "aac", "-b:a", "128k",
          "-map_metadata", "-1", "-map_metadata:s:v", "-1", "-map_metadata:s:a", "-1", "-map_chapters", "-1",
          "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact",
          "-movflags", "+faststart",
          "-t", String(MAX_VIDEO_SECONDS + 1),
          outPath,
        ],
        VIDEO_TIMEOUT_MS,
      );

    let hdrTonemapped = false;
    let encode = await encodeWith(hdr ? `${scale},${tonemap}` : scale);
    if (hdr && encode.code === 0) {
      hdrTonemapped = true;
    } else if (hdr && !encode.timedOut) {
      // If the tone-mapping filter is unavailable on this host, the clip is
      // still made playable rather than refused — and the report says the
      // colours were not converted, instead of pretending they were.
      encode = await encodeWith(`${scale},format=yuv420p`);
    }

    if (encode.timedOut) {
      throw new MediaProcessingError("That clip took too long to process. Try again, or upload a shorter clip.", false);
    }
    if (encode.code !== 0) {
      throw new MediaProcessingError("That clip couldn't be processed. It may be damaged or use an unusual format.", false);
    }

    const out = await probe(outPath);
    const outBytes = (await stat(outPath)).size;

    // What must be true of the cleaned clip before it is stored.
    const problems: string[] = [];
    if (out.video?.codec !== "h264") problems.push(`video codec ${out.video?.codec ?? "missing"}`);
    if (src.audio && out.audio?.codec !== "aac") problems.push("audio was lost");
    if (out.rotation !== 0) problems.push("a rotation flag survived");
    if (out.identifyingTags.length) problems.push(`tags survived: ${out.identifyingTags.join(", ")}`);
    if (!out.durationSeconds || Math.abs(out.durationSeconds - src.durationSeconds) > 1) {
      problems.push("the duration changed");
    }
    const longEdge = Math.max(out.video?.width ?? 0, out.video?.height ?? 0);
    if (!longEdge || longEdge > VIDEO_LONG_EDGE) problems.push("unexpected dimensions");
    if (problems.length) {
      throw new MediaProcessingError(`Processing check failed (${problems.join("; ")}). Nothing was stored.`, false);
    }

    // A still for the grid, from a second in (or halfway through a short clip).
    const at = Math.min(1, src.durationSeconds / 2).toFixed(2);
    await run(["-hide_banner", "-nostdin", "-y", "-ss", at, "-i", outPath, "-frames:v", "1", "-q:v", "3", posterPath], 30_000);
    const sharp = (await import("sharp")).default;
    const preview = await sharp(await readFile(posterPath))
      .resize(PREVIEW_LONG_EDGE, PREVIEW_LONG_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();

    // Displayed dimensions of the source, as a person holding the phone saw it.
    const sideways = Math.abs(src.rotation) % 180 === 90;
    const srcW = sideways ? src.video.height : src.video.width;
    const srcH = sideways ? src.video.width : src.video.height;

    return {
      bytes: await readFile(outPath),
      contentType: "video/mp4",
      extension: "mp4",
      width: out.video!.width,
      height: out.video!.height,
      durationSeconds: Math.round(out.durationSeconds! * 100) / 100,
      preview,
      report: {
        kind: "video",
        source: {
          bytes: input.byteLength,
          width: srcW,
          height: srcH,
          codec: src.video.codec,
          fps: src.video.fps,
          durationSeconds: src.durationSeconds,
          rotation: src.rotation,
          audio: src.audio ? `${src.audio.codec} ${src.audio.channels ?? ""}`.trim() : null,
          pixelFormat: src.video.pixelFormat,
          hdr: hdr ? src.video.transfer : false,
          identifyingTags: src.identifyingTags,
        },
        output: {
          bytes: outBytes,
          width: out.video!.width,
          height: out.video!.height,
          codec: "h264 (High) / aac, mp4, faststart",
          fps: out.video!.fps,
          durationSeconds: out.durationSeconds,
          rotation: out.rotation,
          audio: out.audio ? `${out.audio.codec} ${out.audio.channels ?? ""}`.trim() : null,
          identifyingTags: out.identifyingTags,
          crf: VIDEO_CRF,
          pixelFormat: out.video!.pixelFormat,
          hdrTonemapped,
        },
        savedBytes: input.byteLength - outBytes,
        savedPercent: Math.round((1 - outBytes / input.byteLength) * 1000) / 10,
        processingMs: Date.now() - started,
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The whole job
// ---------------------------------------------------------------------------

export type ProcessOutcome =
  | { status: "ready"; report: Record<string, unknown> }
  | { status: "failed"; reason: string; permanent: boolean }
  | { status: "skipped"; reason: string };

export async function processMedia(assetId: string): Promise<ProcessOutcome> {
  const admin = createAdminClient();
  if (!admin) return { status: "skipped", reason: "storage not configured" };

  const { data: claimed, error: claimError } = await admin.rpc("claim_media_processing", { p_id: assetId });
  if (claimError) throw new Error(`claim failed: ${claimError.message}`);
  const asset = (claimed as { id: string; owner_profile_id: string; media_kind: string; source_path: string | null }[])?.[0];
  // Already processed, already being processed, or not uploaded yet.
  if (!asset?.source_path) return { status: "skipped", reason: "not claimable" };

  const written: string[] = [];
  try {
    const { data: blob, error: downloadError } = await admin.storage.from(SOURCE_BUCKET).download(asset.source_path);
    if (downloadError || !blob) throw new MediaProcessingError("The uploaded file couldn't be read back. Try again.", false);
    const input = Buffer.from(await blob.arrayBuffer());

    // The bytes decide. What the browser said at upload time is not trusted.
    const kind = sniff(new Uint8Array(input.subarray(0, 64)));
    if (kind.kind === "unsupported") throw new MediaProcessingError(kind.reason, true);
    if (kind.kind !== asset.media_kind) {
      throw new MediaProcessingError("That file isn't the kind of file it was uploaded as.", true);
    }

    const output = kind.kind === "image" ? await processPhoto(input, kind.format) : await processVideo(input);

    // New paths every time, and `upsert: false`: a processed file is never
    // overwritten, and a retry never writes over the result of another run.
    const base = `${asset.owner_profile_id}/${asset.id}`;
    const tag = randomUUID().slice(0, 8);
    const storagePath = `${base}/${kind.kind === "image" ? "photo" : "clip"}-${tag}.${output.extension}`;
    const previewPath = `${base}/preview-${tag}.webp`;

    await put(admin, storagePath, output.bytes, output.contentType);
    written.push(storagePath);
    await put(admin, previewPath, output.preview, "image/webp");
    written.push(previewPath);

    // Read back what storage actually holds and check it byte for byte.
    await verifyStored(admin, storagePath, output.bytes);
    await verifyStored(admin, previewPath, output.preview);

    const { data: done, error: completeError } = await admin.rpc("complete_media_processing", {
      p_id: asset.id,
      p_storage_path: storagePath,
      p_preview_path: previewPath,
      p_content_type: output.contentType,
      p_byte_size: output.bytes.byteLength,
      p_width: output.width,
      p_height: output.height,
      p_duration: output.durationSeconds,
      p_report: output.report,
    });
    if (completeError || !done) throw new MediaProcessingError("The result couldn't be recorded. Try again.", false);

    // Only now is the original released and removed. If this delete fails, the
    // row no longer points at it and the housekeeping sweep cannot resurrect
    // it; it is an orphan in a bucket nobody can read, and is logged.
    const { data: releasedPath } = await admin.rpc("release_media_source", { p_id: asset.id });
    if (releasedPath) {
      const { error: removeError } = await admin.storage.from(SOURCE_BUCKET).remove([releasedPath as string]);
      if (removeError) console.error("[media] original not removed after processing:", asset.id);
    }

    return { status: "ready", report: output.report };
  } catch (err) {
    if (written.length) await admin.storage.from(OUTPUT_BUCKET).remove(written);
    const permanent = err instanceof MediaProcessingError ? err.permanent : false;
    const reason = err instanceof MediaProcessingError ? err.message : "Processing failed unexpectedly. Try again.";
    if (!(err instanceof MediaProcessingError)) {
      console.error("[media] processing error:", asset.id, err instanceof Error ? err.message : err);
    }
    // A permanent refusal (HEIC, a document, an over-length clip) releases the
    // original in the same statement, and its bytes are removed here: nobody
    // can retry it, so there is no reason to keep somebody's file (0034).
    const { data: released } = await admin.rpc("fail_media_processing", {
      p_id: asset.id,
      p_reason: reason,
      p_permanent: permanent,
    });
    if (released) await admin.storage.from(SOURCE_BUCKET).remove([released as string]);
    return { status: "failed", reason, permanent };
  }
}

async function put(admin: SupabaseClient, path: string, bytes: Buffer, contentType: string) {
  const { error } = await admin.storage.from(OUTPUT_BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (error) throw new MediaProcessingError("The processed file couldn't be stored. Try again.", false);
}

async function verifyStored(admin: SupabaseClient, path: string, expected: Buffer) {
  const { data, error } = await admin.storage.from(OUTPUT_BUCKET).download(path);
  if (error || !data) throw new MediaProcessingError("The processed file couldn't be verified. Try again.", false);
  const stored = Buffer.from(await data.arrayBuffer());
  if (!stored.equals(expected)) throw new MediaProcessingError("The stored file didn't match. Try again.", false);
}

/**
 * The safety net, run by the scheduled job: anything uploaded but never
 * processed — a function that died before it started, a processing claim whose
 * lease expired — is picked up again, oldest first, a bounded number at a time.
 */
export async function processPendingMedia(limit = 2): Promise<number> {
  const admin = createAdminClient();
  if (!admin) return 0;
  const { data } = await admin
    .from("media_assets")
    .select("id")
    .eq("state", "uploaded")
    .order("created_at")
    .limit(limit);
  let n = 0;
  for (const row of data ?? []) {
    const outcome = await processMedia(row.id);
    if (outcome.status !== "skipped") n++;
  }
  return n;
}
