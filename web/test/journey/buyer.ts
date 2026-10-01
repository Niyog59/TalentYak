/**
 * A synthetic buyer (reserved test address, never emailed) with browser session
 * cookies, for driving a real Stripe TEST-MODE checkout in the browser. The
 * account has bought nothing; `delete` removes it.
 *
 *   TALENTYAK_DB_TESTS=confirmed node --import ./test/register.mjs test/journey/buyer.ts create <dir> [label]
 *   TALENTYAK_DB_TESTS=confirmed node --import ./test/register.mjs test/journey/buyer.ts delete <dir> [label]
 */
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { adminClient, createTestUser, deleteTestUsers } from "../db/harness.ts";
import { CURRENT_LEGAL } from "../../src/lib/legal.ts";
const [mode, dir, label = "buyer"] = process.argv.slice(2);
const sb = adminClient();
if (mode === "create") {
  const u = await createTestUser(`m18-${label}`);
  await sb.from("profiles").update({ terms_version: CURRENT_LEGAL.termsVersion, privacy_version: CURRENT_LEGAL.privacyVersion, timezone: "America/New_York", full_name: "Mina Buyer", preferred_name: "Mina" }).eq("id", u.id);
  const jar = new Map<string, string>();
  const c = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (i) => i.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))) } });
  const r = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (r.error) throw new Error(r.error.message);
  writeFileSync(`${dir}/cookies-${label}.json`, JSON.stringify([...jar].map(([name, value]) => ({ name, value })))); chmodSync(`${dir}/cookies-${label}.json`, 0o600);
  writeFileSync(`${dir}/${label}.json`, JSON.stringify({ id: u.id, email: u.email })); chmodSync(`${dir}/${label}.json`, 0o600);
  console.log(JSON.stringify({ id: u.id, email: u.email }));
} else if (mode === "delete") {
  const b = JSON.parse(readFileSync(`${dir}/${label}.json`, "utf8"));
  await deleteTestUsers([b.id]); console.log("deleted");
}
