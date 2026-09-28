"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { capFor, sniff, tooLargeMessage } from "@/lib/media/sniff";

/*
 * Choosing a file and sending it straight to private storage.
 *
 * THE FILE NEVER PASSES THROUGH OUR OWN SERVER. The hosting we use refuses any
 * request body over 4.5 MB, which most phone photos and nearly every clip
 * exceed. Our server issues a single-use token for one path in a private
 * holding area; the browser sends the bytes there itself.
 *
 * RESUMABLE, IN 6 MB CHUNKS (tus protocol — the size storage requires for
 * resumable uploads). A dropped connection or a pause loses at most the chunk
 * in flight: on retry, the browser asks storage how much it already has and
 * carries on from there. On a phone connection in Nepal, that is the
 * difference between a 48 MB clip arriving and never arriving.
 *
 * RETRY IS EXPLICIT, NEVER AUTOMATIC. An upload that failed because the file
 * was refused would otherwise retry forever.
 *
 * THIS SCREEN'S CHECKS ARE A COURTESY. It refuses an unsupported file or an
 * oversized clip instantly so nobody waits on an upload that was never going
 * to work.
 * The server reads the real bytes afterwards and has the final say.
 */

const CHUNK_BYTES = 6 * 1024 * 1024;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type Status = "idle" | "starting" | "uploading" | "paused" | "error" | "finishing" | "done";

interface Ticket {
  id: string;
  bucket: string;
  path: string;
  token: string;
}

interface Session {
  file: File;
  kind: "image" | "video";
  ticket: Ticket;
  uploadUrl: string | null;
  offset: number;
}

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
// Bucket names and our generated paths are plain ASCII.
const b64 = (s: string) => btoa(s);

export function MediaUploader({
  purpose,
  enrollmentId,
  label = "Add a photo or clip",
  help,
  onUploaded,
  imagesOnly = false,
  disabled = false,
}: {
  purpose: "progress_photo" | "form_review_clip" | "chat_attachment" | "food_photo";
  enrollmentId?: string | null;
  label?: string;
  help?: string;
  /** Called once the upload is stored and handed to processing. */
  onUploaded?: (assetId: string, kind: "image" | "video") => void;
  /** Refuse clips up front: a progress or food photo is a photo. */
  imagesOnly?: boolean;
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [sent, setSent] = useState(0);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const session = useRef<Session | null>(null);
  const inFlight = useRef<XMLHttpRequest | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const tusHeaders = (token: string): Record<string, string> => ({
    apikey: ANON_KEY,
    "x-signature": token,
    "Tus-Resumable": "1.0.0",
  });

  /** Sends one chunk, reporting progress within it. Resolves with storage's new offset. */
  const sendChunk = (s: Session, from: number) =>
    new Promise<number>((resolve, reject) => {
      const to = Math.min(s.file.size, from + CHUNK_BYTES);
      const xhr = new XMLHttpRequest();
      inFlight.current = xhr;
      xhr.open("PATCH", s.uploadUrl!);
      for (const [k, v] of Object.entries(tusHeaders(s.ticket.token))) xhr.setRequestHeader(k, v);
      xhr.setRequestHeader("Upload-Offset", String(from));
      xhr.setRequestHeader("Content-Type", "application/offset+octet-stream");
      xhr.upload.onprogress = (e) => setSent(from + e.loaded);
      xhr.onload = () => {
        inFlight.current = null;
        const next = Number(xhr.getResponseHeader("Upload-Offset"));
        if (xhr.status >= 200 && xhr.status < 300 && Number.isFinite(next)) resolve(next);
        else if (xhr.status === 413) reject(new Error("too_large"));
        else reject(new Error(`status ${xhr.status}`));
      };
      xhr.onerror = () => {
        inFlight.current = null;
        reject(new Error("network"));
      };
      xhr.onabort = () => {
        inFlight.current = null;
        reject(new Error("paused"));
      };
      xhr.send(s.file.slice(from, to));
    });

  /** Creates the resumable upload, or asks storage how far an existing one got. */
  const locate = async (s: Session): Promise<number> => {
    if (s.uploadUrl) {
      const head = await fetch(s.uploadUrl, { method: "HEAD", headers: tusHeaders(s.ticket.token) });
      if (head.ok) return Number(head.headers.get("Upload-Offset") ?? 0);
      // Expired or unknown: start this file's transfer afresh.
      s.uploadUrl = null;
    }
    const created = await fetch(`${SUPABASE_URL}/storage/v1/upload/resumable/sign`, {
      method: "POST",
      headers: {
        ...tusHeaders(s.ticket.token),
        "Upload-Length": String(s.file.size),
        "Upload-Metadata": [
          `bucketName ${b64(s.ticket.bucket)}`,
          `objectName ${b64(s.ticket.path)}`,
          // The holding area never serves anything, so the declared type is
          // irrelevant — and it is not trusted anywhere downstream.
          `contentType ${b64("application/octet-stream")}`,
        ].join(","),
      },
    });
    if (created.status === 413) throw new Error("too_large");
    const location = created.headers.get("Location");
    if (!created.ok || !location) throw new Error(`create ${created.status}`);
    s.uploadUrl = new URL(location, SUPABASE_URL).toString();
    return 0;
  };

  async function pump() {
    const s = session.current;
    if (!s) return;
    setStatus("uploading");
    setMessage(null);
    try {
      let offset = await locate(s);
      s.offset = offset;
      setSent(offset);
      while (offset < s.file.size) {
        offset = await sendChunk(s, offset);
        s.offset = offset;
        setSent(offset);
      }

      setStatus("finishing");
      const done = await fetch("/api/media/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.ticket.id }),
      });
      if (!done.ok) {
        const body = await done.json().catch(() => ({}));
        throw new Error(body.error ?? "finish");
      }

      session.current = null;
      setHasSession(false);
      setStatus("done");
      setMessage(
        s.kind === "video"
          ? "Uploaded. Your clip is being processed — this usually takes under a minute."
          : "Uploaded. Your photo is being processed.",
      );
      if (inputRef.current) inputRef.current.value = "";
      if (onUploaded) onUploaded(s.ticket.id, s.kind);
      else startTransition(() => router.refresh());
    } catch (err) {
      const reason = err instanceof Error ? err.message : "";
      if (reason === "paused") {
        setStatus("paused");
        setMessage(`Paused at ${mb(s.offset)} of ${mb(s.file.size)} MB. Resume carries on from there.`);
        return;
      }
      setStatus("error");
      setMessage(
        reason === "too_large"
          ? "Storage refused that file as too large. Nothing was kept."
          : reason === "network"
            ? `The connection dropped at ${mb(s.offset)} of ${mb(s.file.size)} MB. Try again to carry on from there.`
            : reason.startsWith("status") || reason.startsWith("create") || reason === "finish"
              ? "The upload didn't complete. Try again to carry on from where it stopped."
              : reason,
      );
    }
  }

  async function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage(null);
    setSent(0);
    setTotal(file.size);

    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const kind = sniff(head);
    if (kind.kind === "unsupported") {
      setStatus("error");
      setMessage(kind.reason);
      session.current = null;
      setHasSession(false);
      return;
    }
    if (imagesOnly && kind.kind !== "image") {
      setStatus("error");
      setMessage("Choose a photo here. Clips can be added on your photos and clips page.");
      session.current = null;
      setHasSession(false);
      return;
    }
    if (file.size > capFor(kind.kind)) {
      setStatus("error");
      setMessage(tooLargeMessage(kind.kind));
      session.current = null;
      setHasSession(false);
      return;
    }

    setStatus("starting");
    const start = await fetch("/api/media/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose, enrollmentId: enrollmentId ?? null, kind: kind.kind, bytes: file.size }),
    });
    const body = await start.json().catch(() => ({}));
    if (!start.ok) {
      setStatus("error");
      setMessage(body.error ?? "That upload couldn't be started. Please try again.");
      session.current = null;
      setHasSession(false);
      return;
    }

    const s: Session = { file, kind: kind.kind, ticket: body as Ticket, uploadUrl: null, offset: 0 };
    session.current = s;
    setHasSession(true);
    void pump();
  }

  const busy = status === "starting" || status === "uploading" || status === "finishing";
  const percent = total ? Math.floor((sent / total) * 100) : 0;
  const resumable = (status === "paused" || status === "error") && hasSession;

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <label className="block font-medium" htmlFor={`upload-${purpose}`}>
        {label}
      </label>
      {help ? <p className="mt-1 text-sm text-ink-muted">{help}</p> : null}

      <input
        ref={inputRef}
        id={`upload-${purpose}`}
        type="file"
        // A convenience for the file picker only; the server decides.
        accept={imagesOnly ? "image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif" : "image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,video/mp4,video/quicktime,video/webm,video/3gpp"}
        onChange={onChange}
        disabled={disabled || busy || status === "paused"}
        className="mt-3 block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-line-strong file:bg-paper file:px-4 file:font-semibold"
      />

      {status === "uploading" || status === "paused" || status === "finishing" || (status === "error" && sent > 0) ? (
        <div className="mt-3">
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Upload progress"
            className="h-2 w-full overflow-hidden rounded-full bg-brand-tint"
          >
            <div className="h-full bg-brand transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-2 text-sm text-ink-muted" aria-live="polite">
            {status === "finishing" ? "Checking the upload…" : `${mb(sent)} of ${mb(total)} MB — ${percent}%`}
          </p>
        </div>
      ) : null}

      {status === "starting" ? <p className="mt-3 text-sm text-ink-muted">Starting…</p> : null}

      {message ? (
        <p
          role={status === "error" ? "alert" : "status"}
          className={`mt-3 text-sm ${status === "error" ? "font-medium text-danger" : "text-ink-muted"}`}
        >
          {message}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {status === "uploading" ? (
          <Button variant="secondary" size="sm" onClick={() => inFlight.current?.abort()}>
            Pause
          </Button>
        ) : null}
        {resumable ? (
          <Button variant="secondary" size="sm" onClick={() => void pump()}>
            {status === "paused" ? "Resume" : "Try again"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
