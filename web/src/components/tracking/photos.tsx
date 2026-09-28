"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/button";
import { MediaUploader } from "@/components/media/uploader";
import { formatDay } from "@/lib/format";
import { removeItem, send, writeItem, type StoredOp } from "@/lib/tracking/device";

/*
 * Dated, private progress photos. Uploading reuses M08 end to end — the file
 * goes straight to private storage, is re-encoded with location and device
 * details removed, and is only ever shown through a two-minute link issued
 * after an access check. Removing one uses M08's own deletion.
 */

export interface PhotoView {
  id: string;
  mediaId: string;
  takenOn: string;
  pose: "front" | "side" | "back" | "other" | null;
  state: string;
}

const POSE_LABEL: Record<string, string> = { front: "Front", side: "Side", back: "Back", other: "Other" };

function describe(p: PhotoView) {
  return `${formatDay(p.takenOn, { month: "short", day: "numeric", year: "numeric" })}${p.pose ? ` · ${POSE_LABEL[p.pose]}` : ""}`;
}

function Photo({ p, className = "" }: { p: PhotoView; className?: string }) {
  if (p.state !== "ready") {
    return (
      <div className={`flex aspect-[3/4] items-center justify-center rounded-lg border border-dashed border-line-strong bg-paper-raised p-3 text-center text-sm text-ink-muted ${className}`}>
        {p.state === "failed" ? "This photo couldn't be used. Remove it and try another." : "Removing hidden details… this takes a few seconds."}
      </div>
    );
  }
  return (
    <a href={`/api/media/${p.mediaId}`} className={`block ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/media/${p.mediaId}?variant=preview`} alt={`Progress photo, ${describe(p)}`} className="aspect-[3/4] w-full rounded-lg bg-brand-tint object-contain" />
    </a>
  );
}

export function PhotoCompare({ photos }: { photos: PhotoView[] }) {
  const ready = [...photos].filter((p) => p.state === "ready").sort((a, b) => a.takenOn.localeCompare(b.takenOn));
  const [a, setA] = useState(ready[0]?.id ?? "");
  const [b, setB] = useState(ready.at(-1)?.id ?? "");
  if (ready.length < 2) return <p className="text-ink-muted">Add photos on two different dates to compare them side by side.</p>;
  const left = ready.find((p) => p.id === a) ?? ready[0];
  const right = ready.find((p) => p.id === b) ?? ready.at(-1)!;
  const options = ready.map((p) => ({ value: p.id, label: describe(p) }));
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {([["Earlier", left, setA], ["Later", right, setB]] as const).map(([label, p, set]) => (
          <div key={label}>
            <label className="block">
              <span className="block text-sm font-semibold">{label}</span>
              <select value={p.id} onChange={(e) => set(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line-strong bg-surface px-2">
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <Photo p={p} className="mt-2" />
            <p className="mt-1 text-center text-sm text-ink-muted">{describe(p)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProgressPhotos({
  viewerId,
  enrollmentId,
  today,
  photos,
  live,
}: {
  viewerId: string;
  enrollmentId: string;
  today: string;
  photos: PhotoView[];
  live: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [pose, setPose] = useState<string>("front");
  const [message, setMessage] = useState<{ bad: boolean; text: string } | null>(null);

  async function attach(mediaId: string) {
    const body = { op: "photo.save", enrollmentId, mediaId, date, pose: pose || null };
    const op: StoredOp = { v: 1, kind: "op", id: `photo:${mediaId}`, body, href: `/account/progress/${enrollmentId}/body`, label: `Progress photo — ${formatDay(date)}`, state: "pending", updatedAt: Date.now() };
    writeItem(viewerId, op);
    const r = await send(body);
    if (r.status === "saved") {
      removeItem(viewerId, "op", op.id);
      setMessage({ bad: false, text: "Added. It appears below once hidden details are removed." });
      router.refresh();
    } else {
      writeItem(viewerId, { ...op, state: r.status === "offline" ? "offline" : r.status === "held" ? "held" : "failed", message: r.status === "failed" ? r.message : undefined });
      setMessage({ bad: true, text: r.status === "failed" ? r.message : "The photo is uploaded but not yet dated in your progress. It's kept on this device and will be added when you're connected." });
    }
    window.dispatchEvent(new Event("talentyak:tracking-changed"));
  }

  async function remove(p: PhotoView) {
    if (!window.confirm(`Remove the photo from ${describe(p)}? The file is deleted and your coach can no longer see it. This can't be undone.`)) return;
    const r = await send({ op: "media.remove", mediaId: p.mediaId });
    if (r.status === "saved") {
      setMessage({ bad: false, text: "Removed. The file has been deleted." });
      router.refresh();
    } else {
      setMessage({ bad: true, text: r.status === "failed" ? r.message : "You're offline. Remove it when you're connected." });
    }
  }

  return (
    <div>
      {live ? (
        <div className="rounded-xl border border-line bg-paper-raised p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="block font-semibold">Date taken</span>
              <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3" />
            </label>
            <label className="block">
              <span className="block font-semibold">Pose <span className="font-normal text-ink-muted">(optional)</span></span>
              <select value={pose} onChange={(e) => setPose(e.target.value)} className="mt-1 min-h-12 w-full rounded-lg border border-line-strong bg-surface px-3">
                <option value="front">Front</option>
                <option value="side">Side</option>
                <option value="back">Back</option>
                <option value="other">Other</option>
                <option value="">Not saying</option>
              </select>
            </label>
          </div>
          <div className="mt-3">
            <MediaUploader
              purpose="progress_photo"
              enrollmentId={enrollmentId}
              imagesOnly
              label="Choose a photo"
              help="Private: only you and your current coach can see it. Location and device details are removed before anyone can."
              onUploaded={(id) => void attach(id)}
            />
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-line-strong bg-paper-raised p-3 text-ink-muted">New photos can be added while coaching is active. Your photos below stay yours, and you can remove any of them.</p>
      )}

      {message ? <p role={message.bad ? "alert" : "status"} className={`mt-3 font-medium ${message.bad ? "text-danger" : "text-brand"}`}>{message.text}</p> : null}

      {photos.length ? (
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p) => (
            <li key={p.id}>
              <Photo p={p} />
              <p className="mt-1 text-sm">{describe(p)}</p>
              <Button size="sm" variant="quiet" onClick={() => void remove(p)}>
                Remove<span className="sr-only"> photo from {describe(p)}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-ink-muted">No progress photos yet. They&rsquo;re optional.</p>
      )}
    </div>
  );
}
