import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/** A random link token and the hash that is stored. Only the hash is kept. */
export function newToken(): { plain: string; hash: string } {
  const plain = randomBytes(32).toString("base64url");
  return { plain, hash: hashToken(plain) };
}

export function hashToken(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{30,60}$/;

/** The confirm page. Returns the coach they asked about, if any. Safe to repeat. */
export async function confirmWaitlist(plain: string): Promise<{ ok: boolean; providerId: string | null }> {
  if (!TOKEN_RE.test(plain)) return { ok: false, providerId: null };
  const admin = createAdminClient();
  if (!admin) return { ok: false, providerId: null };
  const { data } = await admin.rpc("waitlist_confirm", { p_hash: hashToken(plain) });
  return data ? { ok: true, providerId: (data as { provider_id: string | null }).provider_id } : { ok: false, providerId: null };
}
