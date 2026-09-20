/**
 * Produces the browser session cookies for one synthetic journey account, so a
 * browser test can act as that person without anyone typing a password or an
 * authenticator code into a form. The session is created through Supabase's
 * own auth API with the same server-side cookie library the app uses, so the
 * cookies are exactly what a real sign-in would set. The admin session
 * completes a real TOTP challenge and is therefore aal2.
 *
 *   node --import ./test/register.mjs test/journey/session.ts <credentials.json> <admin|coach|customer> <out.json>
 */
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { totp } from "../db/totp.ts";

const [file, label, outFile] = process.argv.slice(2);
const person = JSON.parse(readFileSync(file, "utf8"))[label];
if (!person) throw new Error(`Unknown person ${label}`);

const jar = new Map<string, string>();
const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  cookies: {
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    setAll: (items) => items.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
  },
});

const signIn = await supabase.auth.signInWithPassword({ email: person.email, password: person.password });
if (signIn.error) throw new Error(`sign-in failed: ${signIn.error.message}`);

if (person.totpSecret) {
  const factors = await supabase.auth.mfa.listFactors();
  const factor = factors.data?.totp?.find((f) => f.status === "verified");
  if (!factor) throw new Error("no verified factor");
  const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: totp(person.totpSecret) });
  if (verified.error) throw new Error(`MFA failed: ${verified.error.message}`);
}

const { data } = await supabase.auth.getSession();
const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
writeFileSync(outFile, JSON.stringify([...jar.entries()].map(([name, value]) => ({ name, value }))));
chmodSync(outFile, 0o600);
console.log(`${label}: ${jar.size} cookie(s), assurance ${aal.data?.currentLevel}, expires ${new Date((data.session?.expires_at ?? 0) * 1000).toISOString()}`);
