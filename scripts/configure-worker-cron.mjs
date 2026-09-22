#!/usr/bin/env node
/**
 * Stores the job worker's endpoint and bearer secret in Supabase Vault, where
 * the five-minute schedule from migration 0038 reads them.
 *
 *   node scripts/configure-worker-cron.mjs https://www.talentyak.com
 *
 * The secret is read from CRON_SECRET in the environment (or web/.env.local)
 * and sent straight to the project through the Management API. It is never
 * printed, never written to a file, and never passed on the command line.
 * Run again after rotating CRON_SECRET in Vercel.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    for (const raw of readFileSync(join(root, "web", ".env.local"), "utf8").split("\n")) {
      const line = raw.trim();
      if (!line.startsWith(`${name}=`)) continue;
      return line.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {
    // fall through
  }
  return "";
}

const site = process.argv[2];
if (!site || !/^https:\/\/[a-z0-9.-]+$/i.test(site)) {
  console.error("Usage: node scripts/configure-worker-cron.mjs https://<site origin>");
  process.exit(1);
}
const secret = env("CRON_SECRET");
const token = env("SUPABASE_ACCESS_TOKEN");
const ref = new URL(env("NEXT_PUBLIC_SUPABASE_URL")).hostname.split(".")[0];
if (!secret || !token || !ref) {
  console.error("CRON_SECRET, SUPABASE_ACCESS_TOKEN and NEXT_PUBLIC_SUPABASE_URL are required.");
  process.exit(1);
}

const quote = (v) => `'${String(v).replaceAll("'", "''")}'`;
const upsert = (name, value, description) => `
  do $$
  declare v_id uuid;
  begin
    select id into v_id from vault.secrets where name = ${quote(name)};
    if v_id is null then
      perform vault.create_secret(${quote(value)}, ${quote(name)}, ${quote(description)});
    else
      perform vault.update_secret(v_id, ${quote(value)}, ${quote(name)}, ${quote(description)});
    end if;
  end $$;`;

const query =
  upsert("worker_url", `${site}/api/jobs/process`, "Job worker endpoint called by pg_cron (0038)") +
  upsert("worker_cron_secret", secret, "Bearer secret for the job worker; mirrors CRON_SECRET in Vercel");

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!res.ok) {
  console.error(`Vault update failed (${res.status}).`);
  process.exit(1);
}
console.log(`Stored worker_url (${site}/api/jobs/process) and worker_cron_secret in Vault for project ${ref}.`);
