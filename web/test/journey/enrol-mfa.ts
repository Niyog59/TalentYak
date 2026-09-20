/**
 * Adds an authenticator factor to one synthetic journey account through the
 * auth API, and records its secret alongside that account's credentials, so the
 * browser test can reach two-factor-protected screens (payout details, the
 * founder console) without a code being typed into a form.
 *
 *   node --import ./test/register.mjs test/journey/enrol-mfa.ts <credentials.json> <coach|customer>
 */
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { totp } from "../db/totp.ts";

const [file, label] = process.argv.slice(2);
const people = JSON.parse(readFileSync(file, "utf8"));
const person = people[label];
if (!person) throw new Error(`Unknown person ${label}`);
if (person.totpSecret) {
  console.log(`${label} already has an authenticator factor.`);
  process.exit(0);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const signIn = await supabase.auth.signInWithPassword({ email: person.email, password: person.password });
if (signIn.error) throw new Error(signIn.error.message);

const enrol = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "journey-test" });
if (enrol.error || !enrol.data) throw new Error(`enrol failed: ${enrol.error?.message}`);
const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: enrol.data.id, code: totp(enrol.data.totp.secret) });
if (verified.error) throw new Error(`verify failed: ${verified.error.message}`);

people[label].totpSecret = enrol.data.totp.secret;
writeFileSync(file, JSON.stringify(people, null, 2));
chmodSync(file, 0o600);
console.log(`${label} now has a verified authenticator factor.`);
