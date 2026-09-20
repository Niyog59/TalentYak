import { env } from "@/lib/env";

/**
 * Public URL of an APPROVED coach photo. Only paths written by the admin
 * approval action reach this bucket, and the database refuses any other path.
 */
export function coachPhotoUrl(path: string | null | undefined): string | null {
  if (!path || !env.supabaseUrl) return null;
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/.test(path)) return null;
  return `${env.supabaseUrl}/storage/v1/object/public/coach-photos/${path}`;
}
