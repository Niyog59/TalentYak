import "server-only";
import { spawn } from "node:child_process";
import { access, chmod, copyFile, constants } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Running ffmpeg, and reading what it says about a file.
 *
 * The binary is ffmpeg-static's build (FFmpeg 6.0, with libx264 and AAC),
 * shipped inside the functions that process media and nowhere else. It is run
 * with a hard time limit: a clip that cannot be processed in time fails and
 * can be retried, rather than holding a function until the platform kills it
 * mid-write.
 *
 * `ffprobe` is deliberately not used. The only maintained static ffprobe
 * package is 350 MB and unmaintained; ffmpeg prints the same stream facts when
 * asked to read a file, and those are parsed here.
 */

let resolved: string | null = null;

async function binary(): Promise<string> {
  if (resolved) return resolved;
  const mod = (await import("ffmpeg-static")) as unknown as { default: string | null };
  const path = mod.default;
  if (!path) throw new Error("ffmpeg is not available for this platform");

  try {
    await access(path, constants.X_OK);
    resolved = path;
  } catch {
    // Some deployment packaging drops the executable bit. /tmp is writable on
    // every host we run on, so a copy there can be made executable.
    const copy = join(tmpdir(), "ffmpeg");
    await copyFile(path, copy);
    await chmod(copy, 0o755);
    resolved = copy;
  }
  return resolved;
}

export interface RunResult {
  code: number | null;
  stderr: string;
  timedOut: boolean;
}

export async function run(args: string[], timeoutMs: number): Promise<RunResult> {
  const bin = await binary();
  return new Promise((resolve) => {
    // The ignore comment stops the bundler treating this dynamic path as a
    // reason to ship the whole project with the function; the one file it needs
    // is included explicitly in next.config.ts.
    const child = spawn(/*turbopackIgnore: true*/ bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let timedOut = false;
    child.stderr.on("data", (chunk: Buffer) => {
      // Enough to diagnose, not enough to fill memory on a chatty encode.
      if (stderr.length < 200_000) stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stderr: String(err), timedOut: false });
    });
  });
}

export interface Probe {
  durationSeconds: number | null;
  video: { codec: string; width: number; height: number; fps: number | null } | null;
  audio: { codec: string; channels: string | null } | null;
  /** Degrees from the display matrix, if the file asks to be rotated. */
  rotation: number;
  /** Container and stream tags that identify a person, a place, or a device. */
  identifyingTags: string[];
  raw: string;
}

// Tags that say where, when, or on what a clip was recorded. Their presence in
// a SOURCE is reported; their absence in an OUTPUT is required. The `encoder`
// tag is not on this list: in our output it names our own tool, not a person
// or their phone.
const IDENTIFYING = /^(location|location-eng|com\.apple\.quicktime\.(location\.[\w.]+|make|model|software|creationdate)|creation_time|make|model|com\.android\.[\w.]+|date)$/i;

export async function probe(file: string): Promise<Probe> {
  // Reading a file with no output always exits non-zero; the facts are in stderr.
  const { stderr } = await run(["-hide_banner", "-nostdin", "-i", file], 30_000);

  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const durationSeconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null;

  const videoLine = /Stream #\d+:\d+[^\n]*?: Video: ([^\s,]+)[^\n]*/.exec(stderr);
  let video: Probe["video"] = null;
  if (videoLine) {
    const dims = /\b(\d{2,5})x(\d{2,5})\b/.exec(videoLine[0]);
    const fps = /([\d.]+) fps/.exec(videoLine[0]);
    if (dims) {
      video = { codec: videoLine[1], width: Number(dims[1]), height: Number(dims[2]), fps: fps ? Number(fps[1]) : null };
    }
  }

  const audioLine = /Stream #\d+:\d+[^\n]*?: Audio: ([^\s,]+)[^\n]*/.exec(stderr);
  const audio = audioLine
    ? { codec: audioLine[1], channels: /\b(mono|stereo|5\.1|7\.1|\d+ channels)\b/.exec(audioLine[0])?.[1] ?? null }
    : null;

  const rot = /displaymatrix: rotation of (-?[\d.]+) degrees/.exec(stderr);
  const rotation = rot ? Math.round(Number(rot[1])) : 0;

  const identifyingTags = new Set<string>();
  for (const m of stderr.matchAll(/^\s{4,}([\w.\-]+)\s*:\s*(.+)$/gm)) {
    if (IDENTIFYING.test(m[1])) identifyingTags.add(m[1].toLowerCase());
  }

  return { durationSeconds, video, audio, rotation, identifyingTags: [...identifyingTags], raw: stderr };
}
