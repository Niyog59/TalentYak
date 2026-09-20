#!/usr/bin/env node
/**
 * Applies the SQL migrations to the configured Supabase project, in order, once
 * each.
 *
 *   node scripts/apply-migrations.mjs --dry-run   # show what would run
 *   node scripts/apply-migrations.mjs             # apply
 *
 * Uses the Supabase Management API, which is the same mechanism the dashboard's
 * own SQL editor uses. That needs a Personal Access Token: the service-role key
 * is a credential for reading and writing rows through the API, not a database
 * login, and it cannot create a table.
 *
 * What this deliberately will NOT do:
 *
 * - **Reset anything.** There is no drop-schema, no truncate, no `db reset`.
 *   The only destructive statement anywhere in the migration set is in
 *   `0000_clear_stray_profiles.sql`, which refuses to run if it finds a single
 *   row.
 * - **Re-run a migration.** Each applied file is recorded in a
 *   `schema_migrations` table with a checksum. A file that changes after being
 *   applied is reported as an error, not silently re-applied — quietly running
 *   an edited migration is how two environments drift apart without anyone
 *   noticing.
 * - **Continue past a failure.** The run stops at the first error and says
 *   which file and which message, so the schema is never left half-built with
 *   the rest applied on top of it.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "web", "supabase", "migrations");

// --- Environment --------------------------------------------------------------

function loadEnvLocal() {
  try {
    const text = readFileSync(join(root, "web", ".env.local"), "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* No .env.local. The checks below will report what is missing. */
  }
}

loadEnvLocal();

const dryRun = process.argv.includes("--dry-run");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? "";

if (!supabaseUrl) {
  console.error("NEXT_PUBLIC_SUPABASE_URL is not set in web/.env.local.");
  process.exit(2);
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];

if (!accessToken && !dryRun) {
  console.error(
    `SUPABASE_ACCESS_TOKEN is not set in web/.env.local.\n\n` +
      `The service-role key cannot create tables — it is an API credential, not a\n` +
      `database login. Create a Personal Access Token here:\n\n` +
      `    https://supabase.com/dashboard/account/tokens\n\n` +
      `then add it to web/.env.local as SUPABASE_ACCESS_TOKEN=...\n`,
  );
  process.exit(2);
}

// --- Running SQL ---------------------------------------------------------------

async function runSql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );

  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed.message ?? parsed.error ?? text;
    } catch {
      /* keep the raw body */
    }
    throw new Error(`${res.status}: ${message}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const checksum = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);

// --- Main ----------------------------------------------------------------------

const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

console.log(`Project:    ${projectRef}`);
console.log(`Migrations: ${files.length} file(s) in web/supabase/migrations`);
console.log(dryRun ? "Mode:       DRY RUN — nothing will be executed\n" : "Mode:       APPLY\n");

if (dryRun) {
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const statements = sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--")).length;
    console.log(`  ${file.padEnd(34)} ${String(sql.length).padStart(6)} bytes, ~${statements} non-comment lines  [${checksum(sql)}]`);
  }
  console.log("\nDry run complete. Nothing was sent to the database.");
  process.exit(0);
}

// The ledger of what has already run. Created first, and never dropped.
await runSql(`
  create table if not exists schema_migrations (
    filename text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  );
`);

const applied = new Map();
const rows = await runSql(`select filename, checksum from schema_migrations;`);
for (const row of rows ?? []) applied.set(row.filename, row.checksum);

let ran = 0;
let skipped = 0;

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  const sum = checksum(sql);

  const previous = applied.get(file);
  if (previous) {
    if (previous !== sum) {
      console.error(
        `\n✗ ${file} has CHANGED since it was applied (${previous} → ${sum}).\n` +
          `  An applied migration must never be edited: this database and the file no\n` +
          `  longer agree, and re-running it would not fix that. Write a new migration.\n`,
      );
      process.exit(1);
    }
    skipped++;
    continue;
  }

  process.stdout.write(`  ${file.padEnd(34)} `);
  try {
    await runSql(sql);
    await runSql(
      `insert into schema_migrations (filename, checksum) values ('${file}', '${sum}');`,
    );
    console.log("applied");
    ran++;
  } catch (error) {
    console.log("FAILED");
    console.error(`\n✗ ${file} failed:\n  ${error.message}\n`);
    console.error(
      `  Stopping here. ${ran} migration(s) applied before this one; the rest have not\n` +
        `  been attempted, so the schema is not half-built under later changes.\n`,
    );
    process.exit(1);
  }
}

console.log(`\nDone. ${ran} applied, ${skipped} already present.`);
