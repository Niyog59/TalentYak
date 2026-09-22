/**
 * Synthetic client + coach with a live coaching relationship, for driving the
 * messaging screens in two independent browser sessions. Writes each person's
 * session cookies (mode 600) so a browser can act as them without anyone
 * typing a password. `cleanup` removes everything it made.
 *
 *   TALENTYAK_DB_TESTS=confirmed node --import ./test/register.mjs test/journey/messaging-fixture.ts setup <dir>
 *   TALENTYAK_DB_TESTS=confirmed node --import ./test/register.mjs test/journey/messaging-fixture.ts cookies <dir>
 *   TALENTYAK_DB_TESTS=confirmed node --import ./test/register.mjs test/journey/messaging-fixture.ts cleanup <dir>
 */
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { adminClient, createTestUser, deleteTestUsers, makeCoach, sql, lit } from "../db/harness.ts";
import { CURRENT_LEGAL } from "../../src/lib/legal.ts";

const [mode, dir] = process.argv.slice(2);
if (!mode || !dir) throw new Error("usage: setup|cookies|cleanup <dir>");
const stateFile = join(dir, "messaging-fixture.json");

interface State {
  customer: { id: string; email: string; password: string };
  coach: { id: string; email: string; password: string; providerId: string };
  enrollmentId: string;
  conversationId: string;
}

async function cookies(email: string, password: string, out: string) {
  const jar = new Map<string, string>();
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (items) => items.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  writeFileSync(out, JSON.stringify([...jar.entries()].map(([name, value]) => ({ name, value }))));
  chmodSync(out, 0o600);
}

const sb = adminClient();

if (mode === "setup") {
  const customer = await createTestUser("ui-client");
  const coach = await makeCoach("ui-coach");
  for (const [id, name] of [[customer.id, "Sita Fixture"], [coach.user.id, "Anjali Fixture"]]) {
    await sb.from("profiles").update({
      terms_version: CURRENT_LEGAL.termsVersion, privacy_version: CURRENT_LEGAL.privacyVersion,
      timezone: id === customer.id ? "America/Chicago" : "Asia/Kathmandu", full_name: name, preferred_name: name.split(" ")[0],
    }).eq("id", id);
  }
  const { data: e } = await sb.from("enrollments").insert({ customer_id: customer.id, provider_id: coach.providerId, state: "active" }).select("id").single();
  await sb.from("enrollment_assignments").insert({
    enrollment_id: e!.id, provider_id: coach.providerId, effective_from: new Date(Date.now() - 3 * 86_400_000).toISOString(),
  });
  const { data: c } = await sb.from("conversations").select("id").eq("enrollment_id", e!.id).single();
  const state: State = {
    customer: { id: customer.id, email: customer.email, password: customer.password },
    coach: { id: coach.user.id, email: coach.user.email, password: coach.user.password, providerId: coach.providerId },
    enrollmentId: e!.id as string,
    conversationId: c!.id as string,
  };
  writeFileSync(stateFile, JSON.stringify(state));
  chmodSync(stateFile, 0o600);
  await cookies(customer.email, customer.password, join(dir, "cookies-customer.json"));
  await cookies(coach.user.email, coach.user.password, join(dir, "cookies-coach.json"));
  console.log(JSON.stringify({ conversationId: state.conversationId, customer: customer.id, coach: coach.user.id, enrollment: state.enrollmentId }));
} else if (mode === "cookies") {
  const state = JSON.parse(readFileSync(stateFile, "utf8")) as State;
  await cookies(state.customer.email, state.customer.password, join(dir, "cookies-customer.json"));
  await cookies(state.coach.email, state.coach.password, join(dir, "cookies-coach.json"));
  console.log("cookies refreshed");
} else if (mode === "cleanup") {
  const state = JSON.parse(readFileSync(stateFile, "utf8")) as State;
  const { data: convs } = await sb.from("conversations").select("id").eq("enrollment_id", state.enrollmentId);
  for (const c of convs ?? []) {
    await sql(`delete from outbox where topic = 'email.unread_messages' and payload->>'conversation_id' = ${lit(c.id as string)}`);
  }
  const ids = [state.customer.id, state.coach.id];
  await sql(`delete from outbox where topic = 'email.support_case_opened' and dedupe_key in (select 'support_case:' || id from support_cases where reporter_profile_id in (${ids.map(lit).join(",")}))`);
  await sb.from("support_cases").delete().in("reporter_profile_id", ids);
  const { data: files } = await sb.from("media_assets").select("storage_path, preview_path, source_path").in("owner_profile_id", ids);
  const out = (files ?? []).flatMap((f) => [f.storage_path, f.preview_path]).filter(Boolean) as string[];
  const src = (files ?? []).map((f) => f.source_path).filter(Boolean) as string[];
  if (out.length) await sb.storage.from("private-media").remove(out);
  if (src.length) await sb.storage.from("media-uploads").remove(src);
  await sb.from("media_assets").delete().in("owner_profile_id", ids);
  await sb.from("enrollment_assignments").delete().eq("enrollment_id", state.enrollmentId);
  await sb.from("enrollments").delete().eq("id", state.enrollmentId);
  await deleteTestUsers(ids);
  console.log("fixtures removed");
}
