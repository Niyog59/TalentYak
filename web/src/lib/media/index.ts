import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { capFor, tooLargeMessage } from "@/lib/media/sniff";

/**
 * Private media: getting files in, and getting authorised links out.
 *
 * GETTING FILES IN. The browser never sends a file to our own server — on the
 * hosting we use, a request body cannot exceed 4.5 MB. Instead:
 *
 *   1. `createUpload` reserves a row and issues a SINGLE-USE token for ONE path
 *      in the holding bucket `media-uploads`, which nobody can read
 *   2. the browser uploads straight to storage in resumable chunks
 *   3. `completeUpload` checks the file really arrived and measures it
 *   4. `processMedia` (lib/media/process.ts) validates, cleans and stores it
 *
 * A token cannot overwrite a file once it exists (measured: a second write
 * with the same token is refused as a duplicate), and it is only ever issued
 * for the owner's own reserved row.
 *
 * GETTING LINKS OUT. The caller passes a Supabase client carrying the
 * REQUESTING person's session and we read the row with it. If row-level
 * security returns it, they may see it; otherwise no link is issued. The rules
 * therefore live in one place — the policies in 0021 and 0030.
 *
 * RESIDUAL VALIDITY. A signed link is a bearer token: it works for whoever
 * holds it until it expires, whatever the database says afterwards. When a
 * coach is reassigned, new requests are refused at once, but a link already in
 * their browser keeps working for up to LINK_SECONDS. Links are minted per
 * request and redirected to — never written into a page or a stored record —
 * so that window is the whole of the exposure.
 */

const SOURCE_BUCKET = "media-uploads";
const OUTPUT_BUCKET = "private-media";

/** Deliberately short. See the note above before raising it. */
export const LINK_SECONDS = 120;

export class UploadRefused extends Error {}

export interface UploadTicket {
  id: string;
  bucket: string;
  path: string;
  token: string;
}

export async function createUpload(args: {
  ownerProfileId: string;
  enrollmentId: string | null;
  purpose: "progress_photo" | "form_review_clip" | "chat_attachment";
  kind: "image" | "video";
  bytes: number;
}): Promise<UploadTicket> {
  if (!Number.isFinite(args.bytes) || args.bytes <= 0) throw new UploadRefused("That file is empty.");
  if (args.bytes > capFor(args.kind)) throw new UploadRefused(tooLargeMessage(args.kind));

  const admin = createAdminClient();
  if (!admin) throw new UploadRefused("Uploads aren't available in this environment.");

  const { data, error } = await admin.rpc("reserve_media_upload", {
    p_owner: args.ownerProfileId,
    p_enrollment: args.enrollmentId,
    p_purpose: args.purpose,
    p_media_kind: args.kind,
    p_declared_bytes: Math.round(args.bytes),
  });
  if (error) {
    throw new UploadRefused(
      error.message.includes("enrollment_not_owned")
        ? "That upload doesn't belong to your coaching."
        : "That upload couldn't be started. Please try again.",
    );
  }
  const row = (data as { id: string; source_path: string }[])[0];

  const { data: signed, error: signError } = await admin.storage.from(SOURCE_BUCKET).createSignedUploadUrl(row.source_path);
  if (signError || !signed?.token) {
    await admin.rpc("fail_media_processing", { p_id: row.id, p_reason: "The upload couldn't be started.", p_permanent: true });
    throw new UploadRefused("That upload couldn't be started. Please try again.");
  }

  return { id: row.id, bucket: SOURCE_BUCKET, path: row.source_path, token: signed.token };
}

/**
 * The browser reports the upload finished. We confirm the object exists and
 * measure it ourselves — the browser's word is not evidence.
 */
export async function completeUpload(ownerProfileId: string, assetId: string): Promise<"uploaded" | "missing" | "not_yours"> {
  const admin = createAdminClient();
  if (!admin) return "missing";

  const { data: row } = await admin
    .from("media_assets")
    .select("id, owner_profile_id, state, source_path")
    .eq("id", assetId)
    .maybeSingle();
  if (!row || row.owner_profile_id !== ownerProfileId) return "not_yours";
  if (row.state !== "reserved") return "uploaded"; // idempotent: a second "done" is harmless
  if (!row.source_path) return "missing";

  const folder = row.source_path.split("/").slice(0, -1).join("/");
  const name = row.source_path.split("/").pop()!;
  const { data: listing } = await admin.storage.from(SOURCE_BUCKET).list(folder, { search: name, limit: 5 });
  const object = (listing ?? []).find((o) => o.name === name);
  const size = Number((object?.metadata as { size?: number } | undefined)?.size ?? 0);
  if (!object || size <= 0) return "missing";

  const { data: marked } = await admin.rpc("mark_media_uploaded", { p_id: assetId, p_owner: ownerProfileId, p_bytes: size });
  return marked ? "uploaded" : "missing";
}

export interface MediaLink {
  url: string;
}

/**
 * A short-lived link, issued only if the REQUESTING person may read the row.
 * `viewer` must carry that person's session — never the admin client, which
 * would issue links to anyone who asked.
 */
export async function linkFor(
  viewer: SupabaseClient,
  assetId: string,
  which: "original" | "preview",
  opts: { download?: boolean } = {},
): Promise<MediaLink | null> {
  const { data: asset } = await viewer
    .from("media_assets")
    .select("id, state, storage_path, preview_path, deleted_at, media_kind")
    .eq("id", assetId)
    .maybeSingle();

  // No row: row-level security refused it, or it is gone. Not ready: the
  // cleaned copy does not exist yet, and the original is never served.
  if (!asset || asset.state !== "ready" || asset.deleted_at) return null;
  const path = which === "original" ? asset.storage_path : asset.preview_path;
  if (!path) return null;

  const admin = createAdminClient();
  if (!admin) return null;
  const extension = path.split(".").pop();
  const { data } = await admin.storage.from(OUTPUT_BUCKET).createSignedUrl(path, LINK_SECONDS, {
    download: opts.download ? `talentyak-${asset.media_kind === "video" ? "clip" : "photo"}.${extension}` : undefined,
  });
  return data?.signedUrl ? { url: data.signedUrl } : null;
}

/**
 * The owner deleting their own media: the cleaned copy, its preview, and the
 * held original if processing never finished.
 */
export async function deleteOwnMedia(viewer: SupabaseClient, assetId: string): Promise<boolean> {
  const { data, error } = await viewer.rpc("delete_own_media", { p_id: assetId });
  if (error) return false;
  const rows = (data ?? []) as { storage_path: string | null; preview_path: string | null; source_path: string | null }[];
  if (!rows.length) return false;

  const admin = createAdminClient();
  if (!admin) return true;
  const outputs = rows.flatMap((r) => [r.storage_path, r.preview_path]).filter((p): p is string => Boolean(p));
  const sources = rows.map((r) => r.source_path).filter((p): p is string => Boolean(p));
  if (outputs.length) await admin.storage.from(OUTPUT_BUCKET).remove(outputs);
  if (sources.length) await admin.storage.from(SOURCE_BUCKET).remove(sources);
  return true;
}

/**
 * Housekeeping for uploads that never finished. NOT retention: it only touches
 * files that never became usable, and the retention policies stay off.
 */
export async function sweepAbandonedMedia(): Promise<{ abandoned: number; requeued: number; released: number }> {
  const admin = createAdminClient();
  if (!admin) return { abandoned: 0, requeued: 0, released: 0 };

  const { data, error } = await admin.rpc("sweep_abandoned_media", { p_older_than_minutes: 1440 });
  if (error) throw new Error(`abandoned media sweep failed: ${error.message}`);

  const rows = (data ?? []) as { id: string; source_path: string | null; outcome: string }[];
  const paths = rows.map((r) => r.source_path).filter((p): p is string => Boolean(p));
  if (paths.length) await admin.storage.from(SOURCE_BUCKET).remove(paths);
  return {
    abandoned: rows.filter((r) => r.outcome === "abandoned").length,
    requeued: rows.filter((r) => r.outcome === "requeued").length,
    released: rows.filter((r) => r.outcome === "failed_original_released").length,
  };
}
