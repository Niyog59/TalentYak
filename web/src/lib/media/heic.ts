import "server-only";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

/**
 * Decoding an iPhone HEIC photo.
 *
 * The image library we use for everything else (sharp) cannot decode HEIC: its
 * build has no HEVC decoder. libheif-js is libheif compiled to WebAssembly,
 * with the libde265 HEVC decoder inside it, so it needs no native binary on
 * the server.
 *
 * WHY A SEPARATE THREAD WITH A TIME LIMIT. libheif is a parser for a complex
 * format, and it has had security fixes as recently as this month — some newer
 * than the version libheif-js currently packages (1.23.2). Running it as
 * WebAssembly already means a malformed file cannot corrupt memory outside its
 * own sandbox; running it in a worker thread with a hard deadline means a file
 * built to make it spin or allocate endlessly costs one terminated thread, not
 * the whole function. The pixel cap is checked before the decoded buffer is
 * allocated.
 *
 * WHAT COMES BACK is raw RGBA pixels with the camera's rotation ALREADY
 * applied (libheif applies the file's rotation and mirroring boxes by
 * default), and nothing else — no EXIF, no GPS, no colour profile. The caller
 * re-encodes those pixels, so no metadata can survive by construction.
 */

/** 50 megapixels covers a 48 MP iPhone photo; the RGBA buffer is ~200 MB. */
const MAX_PIXELS = 50_000_000;
const DECODE_TIMEOUT_MS = 30_000;

export interface DecodedHeic {
  width: number;
  height: number;
  rgba: Buffer;
}

export class HeicDecodeError extends Error {}

// Runs in the worker. CommonJS, because eval'd workers are not modules.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
try {
  const libheif = require(workerData.lib);
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(workerData.bytes));
  if (!images || !images.length) throw new Error("no image in file");
  // The first top-level image is the primary one — the photo a person took.
  const image = images[0];
  const width = image.get_width();
  const height = image.get_height();
  if (!width || !height) throw new Error("no dimensions");
  if (width * height > workerData.maxPixels) throw new Error("too many pixels");
  const data = new Uint8ClampedArray(width * height * 4);
  image.display({ data, width, height }, (result) => {
    if (!result) {
      parentPort.postMessage({ error: "decode failed" });
      return;
    }
    parentPort.postMessage({ width, height, rgba: result.data.buffer }, [result.data.buffer]);
  });
} catch (err) {
  parentPort.postMessage({ error: String(err && err.message || err) });
}
`;

export async function decodeHeic(input: Buffer): Promise<DecodedHeic> {
  // Resolved from the deployment root, where the processing routes ship
  // libheif-js (next.config.ts), rather than through the bundler.
  const lib = join(process.cwd(), "node_modules", "libheif-js", "wasm-bundle.js");

  return new Promise((resolve, reject) => {
    const worker = new Worker(/*turbopackIgnore: true*/ WORKER_SOURCE, {
      eval: true,
      workerData: { lib, bytes: input, maxPixels: MAX_PIXELS },
      resourceLimits: { maxOldGenerationSizeMb: 1024 },
    });

    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new HeicDecodeError("That photo took too long to read."));
    }, DECODE_TIMEOUT_MS);

    worker.once("message", (msg: { error?: string; width?: number; height?: number; rgba?: ArrayBuffer }) => {
      clearTimeout(timer);
      void worker.terminate();
      if (msg.error || !msg.rgba || !msg.width || !msg.height) {
        reject(new HeicDecodeError(msg.error === "too many pixels" ? "That photo is too large to process." : "That HEIC photo couldn't be read."));
        return;
      }
      resolve({ width: msg.width, height: msg.height, rgba: Buffer.from(msg.rgba) });
    });

    worker.once("error", () => {
      clearTimeout(timer);
      reject(new HeicDecodeError("That HEIC photo couldn't be read."));
    });
  });
}
