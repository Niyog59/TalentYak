/**
 * Synthetic people for the end-to-end sandbox journey.
 *
 * Creates three confirmed accounts on reserved `example.test` addresses (which
 * cannot receive mail): an admin with an authenticator factor, a person who
 * will be invited as a coach, and a customer. Credentials are written to a
 * private file OUTSIDE the repository (path given as the first argument) and
 * never printed.
 *
 *   node --import ./test/register.mjs test/journey/setup.ts <credentials.json>
 *   node --import ./test/register.mjs test/journey/setup.ts <credentials.json> code admin
 */
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { createTestUser, setRole, upgradeToAal2 } from "../db/harness.ts";
import { totp } from "../db/totp.ts";

const [file, command, label] = process.argv.slice(2);
if (!file || file.includes("/dev/ghar-tira") || file.includes("/dev/TalentYak")) {
  console.error("Give a credentials path outside the repository.");
  process.exit(2);
}

if (command === "code") {
  const people = JSON.parse(readFileSync(file, "utf8"));
  const secret = people[label]?.totpSecret;
  if (!secret) throw new Error(`No authenticator secret for ${label}`);
  console.log(totp(secret));
  process.exit(0);
}

const admin = await createTestUser("journey-admin");
await setRole(admin.id, "admin");
await upgradeToAal2(admin);
const coach = await createTestUser("journey-coach");
const customer = await createTestUser("journey-customer");

const out = Object.fromEntries(
  [["admin", admin], ["coach", coach], ["customer", customer]].map(([k, u]) => {
    const user = u as typeof admin & { totpSecret?: string };
    return [k as string, { id: user.id, email: user.email, password: user.password, totpSecret: user.totpSecret ?? null }];
  }),
);
writeFileSync(file, JSON.stringify(out, null, 2));
chmodSync(file, 0o600);
console.log(`Created admin, coach and customer test accounts. Credentials written to ${file} (not printed).`);
console.log(Object.entries(out).map(([k, v]) => `  ${k}: ${(v as { email: string }).email}`).join("\n"));
