import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LINK_SECONDS } from "@/lib/media";

/**
 * A founder opening an applicant's certificate: an authorisation check, then
 * a redirect to a two-minute private link. No link is ever written into a
 * page. The certificate row is read through the founder's own session, so the
 * database's rule (administrator, second factor, submitted application) is
 * what decides. PDFs are always a download, never shown inline on our site.
 *
 * Refusal is a 404 whatever the reason, so the response doesn't confirm a
 * file exists.
 */
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!UUID.test(id)) return notFound();

  const session = await getSession();
  if (!session || session.profile.role !== "admin" || session.aal !== "aal2" || session.profile.suspended_at) return notFound();

  const supabase = await createClient();
  if (!supabase) return notFound();
  const { data: cert } = await supabase.from("coach_application_certificates").select("id, file_path, file_kind").eq("id", id).maybeSingle();
  if (!cert?.file_path) return notFound();

  const admin = createAdminClient();
  if (!admin) return notFound();
  const { data } = await admin.storage.from("provider-evidence").createSignedUrl(cert.file_path, LINK_SECONDS, {
    download: cert.file_kind === "pdf" ? "certificate.pdf" : undefined,
  });
  if (!data?.signedUrl) return notFound();

  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" } });
}
