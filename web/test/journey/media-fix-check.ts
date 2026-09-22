/**
 * Live check of the media write fix (0036) through the real routes of a running
 * app. Creates synthetic accounts, uploads a real photo as the customer, views
 * it as customer and coach, reassigns the coach away, and confirms the former
 * coach gets no fresh link and cannot forge a record. Deletes everything after.
 *
 *   TALENTYAK_DB_TESTS=confirmed node --import ./test/register.mjs test/journey/media-fix-check.ts [baseUrl]
 */
import sharp from "sharp";
import { createServerClient } from "@supabase/ssr";
import { adminClient, createTestUser, deleteTestUsers, makeCoach, type TestUser } from "../db/harness.ts";
import { CURRENT_LEGAL } from "../../src/lib/legal.ts";

const base = process.argv[2] ?? "http://localhost:3001";
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function cookiesFor(user: TestUser): Promise<string> {
  const jar = new Map<string, string>();
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (items) => items.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { error } = await sb.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(error.message);
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function onboard(id: string) {
  await adminClient().from("profiles").update({
    terms_version: CURRENT_LEGAL.termsVersion,
    privacy_version: CURRENT_LEGAL.privacyVersion,
    timezone: "America/Chicago",
    full_name: "Fixture Person",
  }).eq("id", id);
}

const view = (cookie: string, id: string) =>
  fetch(`${base}/api/media/${id}?variant=preview`, { headers: { cookie }, redirect: "manual" });

const sb = adminClient();
const customer = await createTestUser("fixchk-customer");
const coachA = await makeCoach("fixchk-coach-a");
const coachB = await makeCoach("fixchk-coach-b");
const ids = [customer.id, coachA.user.id, coachB.user.id];
let enrollmentId = "";

try {
  for (const id of ids) await onboard(id);
  const { data: e } = await sb.from("enrollments")
    .insert({ customer_id: customer.id, provider_id: coachA.providerId, state: "active" }).select("id").single();
  enrollmentId = e!.id as string;
  await sb.from("enrollment_assignments").insert({
    enrollment_id: enrollmentId, provider_id: coachA.providerId,
    effective_from: new Date(Date.now() - 86_400_000).toISOString(),
  });

  const [cCustomer, cCoachA] = [await cookiesFor(customer), await cookiesFor(coachA.user)];

  // 1. A normal upload through the real routes.
  const jpeg = await sharp({ create: { width: 600, height: 900, channels: 3, background: { r: 120, g: 180, b: 90 } } })
    .jpeg().withMetadata({ exif: { IFD0: { Make: "FixturePhone" } } }).toBuffer();
  const start = await fetch(`${base}/api/media/uploads`, {
    method: "POST", headers: { cookie: cCustomer, "content-type": "application/json" },
    body: JSON.stringify({ purpose: "progress_photo", enrollmentId, kind: "image", bytes: jpeg.length }),
  });
  const ticket = await start.json() as { id: string; bucket: string; path: string; token: string };
  check("upload starts for the owner", start.status === 200, `status ${start.status}`);

  const put = await customer.client.storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, jpeg, { contentType: "image/jpeg" });
  check("bytes accepted by storage with the single-use token", !put.error, put.error?.message ?? "");

  const done = await fetch(`${base}/api/media/complete`, {
    method: "POST", headers: { cookie: cCustomer, "content-type": "application/json" }, body: JSON.stringify({ id: ticket.id }),
  });
  check("upload completion accepted", done.status === 200, `status ${done.status}`);

  let state = "";
  for (let i = 0; i < 30 && state !== "ready" && state !== "failed"; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const { data } = await sb.from("media_assets").select("state").eq("id", ticket.id).single();
    state = data!.state as string;
  }
  check("processing finished and the file is ready", state === "ready", `state ${state}`);

  const ownerView = await view(cCustomer, ticket.id);
  check("owner gets a fresh viewing link", ownerView.status === 302, `status ${ownerView.status}`);
  const signed = ownerView.headers.get("location") ?? "";
  const img = signed ? await fetch(signed) : null;
  check("the link serves the processed image", img?.status === 200 && (img.headers.get("content-type") ?? "").includes("image"), `status ${img?.status}`);

  const coachView = await view(cCoachA, ticket.id);
  check("current coach gets a fresh viewing link", coachView.status === 302, `status ${coachView.status}`);

  // 2. Reassign coach A away, as a coach change does.
  await sb.from("enrollment_assignments").update({ effective_to: new Date().toISOString() })
    .eq("enrollment_id", enrollmentId).is("effective_to", null);
  await sb.from("enrollment_assignments").insert({
    enrollment_id: enrollmentId, provider_id: coachB.providerId, previous_provider_id: coachA.providerId,
    effective_from: new Date(Date.now() + 1000).toISOString(), history_scope: "programme_and_logs",
  });
  await sb.from("enrollments").update({ provider_id: coachB.providerId }).eq("id", enrollmentId);

  const formerView = await view(cCoachA, ticket.id);
  check("former coach gets no fresh link (same session)", formerView.status === 404, `status ${formerView.status}`);

  // 3. The former coach tries to forge a record pointing at the client's file.
  const { data: target } = await sb.from("media_assets").select("storage_path, preview_path").eq("id", ticket.id).single();
  const forged = await coachA.user.client.from("media_assets").insert({
    owner_profile_id: coachA.user.id, purpose: "progress_photo", media_kind: "image", state: "ready",
    storage_path: target!.storage_path, preview_path: target!.preview_path,
  }).select("id");
  check("former coach cannot forge a record", Boolean(forged.error), forged.error?.message ?? "INSERTED");

  const { data: mine } = await coachA.user.client.from("media_assets").select("id").limit(1);
  const repoint = mine?.[0]
    ? await coachA.user.client.from("media_assets").update({ storage_path: target!.storage_path }).eq("id", mine[0].id).select("id")
    : { data: [] };
  check("former coach cannot repoint any record", (repoint.data ?? []).length === 0);

  const customerUpdate = await customer.client.from("media_assets").update({ state: "failed" }).eq("id", ticket.id).select("id");
  check("owner cannot modify their own record directly", (customerUpdate.data ?? []).length === 0);

  const stillOwner = await view(cCustomer, ticket.id);
  check("owner still views after the coach change", stillOwner.status === 302, `status ${stillOwner.status}`);
} finally {
  const { data: rows } = await sb.from("media_assets").select("storage_path, preview_path, source_path").eq("owner_profile_id", customer.id);
  const out = (rows ?? []).flatMap((r) => [r.storage_path, r.preview_path]).filter(Boolean) as string[];
  const src = (rows ?? []).map((r) => r.source_path).filter(Boolean) as string[];
  if (out.length) await sb.storage.from("private-media").remove(out);
  if (src.length) await sb.storage.from("media-uploads").remove(src);
  await sb.from("media_assets").delete().eq("owner_profile_id", customer.id);
  if (enrollmentId) {
    await sb.from("enrollment_assignments").delete().eq("enrollment_id", enrollmentId);
    await sb.from("enrollments").delete().eq("id", enrollmentId);
  }
  await deleteTestUsers(ids);
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed; fixtures removed`);
  process.exitCode = failed ? 1 : 0;
}
