/**
 * Synthetic client + coach with a paid coaching plan and a confirmed session
 * near now, for driving the private-call screens in the browser as both
 * people. Writes each person's session cookies (mode 600) so the browser can
 * act as them without anyone typing a password. `cleanup` removes it all.
 *
 *   TALENTYAK_DB_TESTS=confirmed node --import ./test/register.mjs test/journey/call-fixture.ts setup <dir>
 *   TALENTYAK_DB_TESTS=confirmed node --import ./test/register.mjs test/journey/call-fixture.ts session <dir> <start-in-min> [length-min]
 *   TALENTYAK_DB_TESTS=confirmed node --import ./test/register.mjs test/journey/call-fixture.ts cookies <dir>
 *   TALENTYAK_DB_TESTS=confirmed node --import ./test/register.mjs test/journey/call-fixture.ts cleanup <dir>
 */
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import {
  adminClient, createTestUser, deleteTestUsers, ensurePlatformExpectations, liveExpectationIds, makeCoach, makeDraftOffer,
  publishCoachExpectations, setRole, sql, lit, upgradeToAal2,
} from "../db/harness.ts";
import { totp } from "../db/totp.ts";
import { CURRENT_LEGAL } from "../../src/lib/legal.ts";
import { money } from "../../src/lib/money/money.ts";
import { entriesForCycleEarning } from "../../src/lib/ledger/effects.ts";

const [mode, dir, a1, a2] = process.argv.slice(2);
if (!mode || !dir) throw new Error("usage: setup|session|cookies|cleanup <dir>");
const stateFile = join(dir, "call-fixture.json");

interface State {
  customer: { id: string; email: string; password: string };
  coach: { id: string; email: string; password: string; providerId: string };
  enrollmentId: string;
  purchaseId: string;
  appointments: string[];
  day: number;
  admin?: { id: string; email: string; password: string; totpSecret: string };
}

const sb = adminClient();
const KTM = 5 * 60 + 45;
const ktm = (days: number, hh: number) => {
  const n = new Date(Date.now() + KTM * 60_000);
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + days, hh) - KTM * 60_000).toISOString();
};

async function cookies(email: string, password: string, out: string, totpSecret?: string) {
  const jar = new Map<string, string>();
  const c = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (items) => items.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  if (totpSecret) {
    // A real second-factor challenge, so the admin session is aal2.
    const factors = await c.auth.mfa.listFactors();
    const factor = factors.data?.totp?.find((f) => f.status === "verified");
    if (!factor) throw new Error("no verified factor");
    const v = await c.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(totpSecret) });
    if (v.error) throw new Error(v.error.message);
  }
  writeFileSync(out, JSON.stringify([...jar.entries()].map(([name, value]) => ({ name, value }))));
  chmodSync(out, 0o600);
}

function save(state: State) {
  writeFileSync(stateFile, JSON.stringify(state));
  chmodSync(stateFile, 0o600);
}

if (mode === "setup") {
  await ensurePlatformExpectations();
  const customer = await createTestUser("call-ui-client");
  const coach = await makeCoach("call-ui-coach", { max: 5 });
  for (const [id, name, tz] of [[customer.id, "Sita Fixture", "America/Chicago"], [coach.user.id, "Anjali Fixture", "Asia/Kathmandu"]]) {
    await sb.from("profiles").update({
      terms_version: CURRENT_LEGAL.termsVersion, privacy_version: CURRENT_LEGAL.privacyVersion,
      timezone: tz, full_name: name, preferred_name: name.split(" ")[0],
    }).eq("id", id);
  }
  await publishCoachExpectations(coach);
  const rows = Array.from({ length: 7 }, (_, d) => ({ provider_id: coach.providerId, weekday: d, start_time: "06:00", end_time: "21:00" }));
  await coach.user.client.from("availability_windows").insert(rows);
  await coach.user.client.from("coach_schedule_settings").upsert({ provider_id: coach.providerId, horizon_days: 90 });

  const offer = await makeDraftOffer(coach, { slug: `call-ui-${randomUUID().slice(0, 6)}` });
  const pub = await coach.user.client.rpc("publish_offer_version", { p_version_id: offer.versionId });
  if (pub.error) throw new Error(pub.error.message);
  const shown = await liveExpectationIds(coach.providerId);
  const co = await sb.rpc("create_checkout_records", {
    p: {
      customer_id: customer.id, offer_version_id: offer.versionId, currency: "USD", idempotency_key: randomUUID(), hold_seconds: 2100,
      expectations_coach_version_id: shown.coach, expectations_platform_version_id: shown.platform,
    },
  });
  if (co.error) throw new Error(co.error.message);
  const purchaseId = co.data.purchase_id as string;
  const { data: pu } = await sb.from("purchases").select("provider_id, customer_id, commission_policy_id, charge_amount_minor").eq("id", purchaseId).single();
  const k = `call-ui-${randomUUID()}`;
  const paid = await sb.rpc("record_cycle_payment", {
    p: {
      purchase_id: purchaseId,
      cycle: { source_key: k, period_start: new Date().toISOString(), period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(), currency: "USD", amount_minor: pu!.charge_amount_minor, stripe_payment_intent_id: `pi_test_${k}` },
      entries: entriesForCycleEarning({
        billingCycleId: k, purchaseId, providerId: pu!.provider_id, customerId: pu!.customer_id,
        serviceAmount: money(pu!.charge_amount_minor, "USD"), serviceType: "recurring_coaching", commissionPolicyId: pu!.commission_policy_id, delivered: false,
      }),
    },
  });
  if (paid.error) throw new Error(paid.error.message);
  save({
    customer: { id: customer.id, email: customer.email, password: customer.password },
    coach: { id: coach.user.id, email: coach.user.email, password: coach.user.password, providerId: coach.providerId },
    enrollmentId: paid.data.enrollment_id, purchaseId, appointments: [], day: 3,
  });
  await cookies(customer.email, customer.password, join(dir, "cookies-customer.json"));
  await cookies(coach.user.email, coach.user.password, join(dir, "cookies-coach.json"));
  console.log(JSON.stringify({ customer: customer.id, coach: coach.user.id, enrollment: paid.data.enrollment_id }));
} else if (mode === "session") {
  const state = JSON.parse(readFileSync(stateFile, "utf8")) as State;
  const startIn = Number(a1 ?? 5);
  const length = Number(a2 ?? 30);
  // Earlier fixture sessions that would overlap are retired first.
  if (state.appointments.length) {
    await sql(`update appointments set state = 'cancelled', state_reason = 'fixture_replaced' where id in (${state.appointments.map(lit).join(",")}) and state = 'booked' and ends_at > now() - interval '2 hours'`);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const as = async (email: string, password: string) => {
    const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return c;
  };
  const client = await as(state.customer.email, state.customer.password);
  const coach = await as(state.coach.email, state.coach.password);
  const p = await client.rpc("propose_appointment", {
    p: { kind: "coaching", enrollment_id: state.enrollmentId, starts_at: ktm(state.day++, 9), duration_minutes: 60, request_key: randomUUID().replaceAll("-", "").slice(0, 24) },
  });
  if (p.error) throw new Error(p.error.message);
  const r = await coach.rpc("respond_to_proposal", { p_proposal: p.data.proposal_id, p_action: "accept" });
  if (r.error) throw new Error(r.error.message);
  const id = r.data.appointment_id as string;
  await sql(`update appointments set starts_at = now() + interval '${startIn} minutes', ends_at = now() + interval '${startIn + length} minutes',
    blocked_from = now() + interval '${startIn} minutes', blocked_to = now() + interval '${startIn + length} minutes' where id = ${lit(id)}`);
  // The confirmation and reminders were queued for the original time; they are not what this fixture is testing.
  await sql(`update outbox set state = 'cancelled', completed_at = now(), last_error = 'call fixture: time moved' where payload->>'appointment_id' = ${lit(id)} and state in ('pending', 'blocked')`);
  state.appointments.push(id);
  save(state);
  console.log(JSON.stringify({ appointment: id, startsInMin: startIn, lengthMin: length }));
} else if (mode === "journey") {
  // The connected journey starts from nothing: a coach who has not yet
  // published expectations, hours or a plan, and a client who has bought
  // nothing. Everything after this is done in the browser.
  const customer = await createTestUser("journey-client");
  const coach = await makeCoach("journey-coach", { max: 5 });
  for (const [id, name, tz] of [[customer.id, "Maya Journey", "America/New_York"], [coach.user.id, "Bikash Journey", "Asia/Kathmandu"]]) {
    await sb.from("profiles").update({
      terms_version: CURRENT_LEGAL.termsVersion, privacy_version: CURRENT_LEGAL.privacyVersion,
      timezone: tz, full_name: name, preferred_name: name.split(" ")[0],
    }).eq("id", id);
  }
  await sb.from("providers").update({ timezone: "Asia/Kathmandu" }).eq("id", coach.providerId);
  const offer = await makeDraftOffer(coach, { slug: `journey-${randomUUID().slice(0, 6)}` });
  const j = { customer: { id: customer.id, email: customer.email, password: customer.password },
    coach: { id: coach.user.id, email: coach.user.email, password: coach.user.password, providerId: coach.providerId }, offerVersionId: offer.versionId };
  writeFileSync(join(dir, "journey.json"), JSON.stringify(j), { mode: 0o600 });
  await cookies(customer.email, customer.password, join(dir, "cookies-customer.json"));
  await cookies(coach.user.email, coach.user.password, join(dir, "cookies-coach.json"));
  console.log(JSON.stringify({ customer: customer.id, coach: coach.user.id, providerId: coach.providerId }));
} else if (mode === "journey-cleanup") {
  const j = JSON.parse(readFileSync(join(dir, "journey.json"), "utf8"));
  const ids = [j.customer.id, j.coach.id];
  const { data: appts } = await sb.from("appointments").select("id").in("customer_id", [j.customer.id]);
  const list = (appts ?? []).map((a) => lit(a.id as string)).join(",");
  if (list) await sql(`delete from outbox where payload->>'appointment_id' in (${list}) or payload->>'room_id' in (select id::text from call_rooms where appointment_id in (${list}))`);
  await sql(`delete from outbox where topic = 'email.support_case_opened' and dedupe_key in (select 'support_case:' || id from support_cases where reporter_profile_id in (${ids.map(lit).join(",")}))`);
  await sb.from("support_cases").delete().in("reporter_profile_id", ids);
  const { data: files } = await sb.from("media_assets").select("storage_path, preview_path, source_path").in("owner_profile_id", ids);
  const out = (files ?? []).flatMap((f) => [f.storage_path, f.preview_path]).filter(Boolean) as string[];
  const src = (files ?? []).map((f) => f.source_path).filter(Boolean) as string[];
  if (out.length) await sb.storage.from("private-media").remove(out);
  if (src.length) await sb.storage.from("media-uploads").remove(src);
  await sb.from("capacity_reservations").delete().eq("provider_id", j.coach.providerId);
  await sb.from("offers").update({ status: "archived", archived_at: new Date().toISOString() }).eq("provider_id", j.coach.providerId);
  await sb.from("providers").update({ status: "retired", active: false, published_at: null, accepting_new_clients: false }).eq("id", j.coach.providerId);
  await deleteTestUsers(ids);
  console.log("journey fixtures removed");
} else if (mode === "admin") {
  const state = JSON.parse(readFileSync(stateFile, "utf8")) as State;
  const admin = await createTestUser("call-ui-admin");
  await sb.from("profiles").update({ terms_version: CURRENT_LEGAL.termsVersion, privacy_version: CURRENT_LEGAL.privacyVersion, timezone: "Asia/Kathmandu", full_name: "Admin Fixture" }).eq("id", admin.id);
  await setRole(admin.id, "admin");
  await upgradeToAal2(admin);
  const secret = (admin as unknown as { totpSecret: string }).totpSecret;
  state.admin = { id: admin.id, email: admin.email, password: admin.password, totpSecret: secret };
  save(state);
  await cookies(admin.email, admin.password, join(dir, "cookies-admin.json"), secret);
  console.log("admin ready");
} else if (mode === "cookies") {
  const state = JSON.parse(readFileSync(stateFile, "utf8")) as State;
  await cookies(state.customer.email, state.customer.password, join(dir, "cookies-customer.json"));
  await cookies(state.coach.email, state.coach.password, join(dir, "cookies-coach.json"));
  console.log("cookies refreshed");
} else if (mode === "cleanup") {
  const state = JSON.parse(readFileSync(stateFile, "utf8")) as State;
  const ids = [state.customer.id, state.coach.id, ...(state.admin ? [state.admin.id] : [])];
  if (state.appointments.length) {
    const list = state.appointments.map(lit).join(",");
    await sql(`delete from outbox where payload->>'appointment_id' in (${list}) or payload->>'room_id' in (select id::text from call_rooms where appointment_id in (${list}))`);
  }
  await sql(`delete from outbox where topic = 'email.support_case_opened' and dedupe_key in (select 'support_case:' || id from support_cases where reporter_profile_id in (${ids.map(lit).join(",")}))`);
  await sb.from("support_cases").delete().in("reporter_profile_id", ids);
  await sb.from("capacity_reservations").delete().eq("provider_id", state.coach.providerId);
  await sb.from("offers").update({ status: "archived", archived_at: new Date().toISOString() }).eq("provider_id", state.coach.providerId);
  await sb.from("providers").update({ status: "retired", active: false, published_at: null, accepting_new_clients: false }).eq("id", state.coach.providerId);
  await deleteTestUsers(ids);
  console.log("fixtures removed (Daily rooms are deleted by the close jobs; check the Daily account for leftovers)");
}
