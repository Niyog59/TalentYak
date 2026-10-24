#!/usr/bin/env node
/**
 * Structural check on the migration files.
 *
 * **This does not prove the SQL runs.** It cannot: there is no parser here and
 * no database. What it catches is the class of mistake that breaks a migration
 * half way through and leaves the schema in a state nobody planned — an
 * unterminated dollar-quoted body, unbalanced parentheses, a policy with no
 * predicate at all. Running the migrations against a real database is the only
 * thing that proves them, and that is a separate, honest step.
 *
 * A note on WITH CHECK, because it is tempting to add a rule for it and wrong:
 * Postgres defaults a policy's WITH CHECK to its USING expression when the
 * clause is omitted. `FOR ALL USING (is_admin())` therefore already restricts
 * inserts and updates to admins. Flagging every omission produces two dozen
 * false positives on correct policies and trains people to ignore the output.
 *
 * What genuinely goes wrong is subtler and not detectable by pattern matching:
 * a USING expression that stays true AFTER the row is modified. `USING
 * (auth.uid() = id)` on `profiles` is satisfied both before and after
 * `set role = 'admin'`, so the policy permits privilege escalation while
 * looking perfectly reasonable. That is why 0008 adds a trigger rather than
 * another policy — column-level protection is not something RLS can express.
 *
 * Usage:  node scripts/check-migrations.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "web", "supabase", "migrations");

const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const problems = [];
const notes = [];

for (const file of files) {
  const text = readFileSync(join(dir, file), "utf8");
  // Remove `--` comments, but not a `--` that sits inside a quoted string
  // such as a regular expression ('(^-|--|-$)'), which is SQL, not a comment.
  const stripped = text
    .split("\n")
    .map((line) => {
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === "'") inQuote = !inQuote;
        else if (!inQuote && line[i] === "-" && line[i + 1] === "-") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");

  // Dollar-quoted function bodies must pair up, or everything after the stray
  // marker is swallowed into a string and the migration silently truncates.
  const tags = stripped.match(/\$[A-Za-z_]*\$/g) ?? [];
  if (tags.length % 2 !== 0) {
    problems.push(`${file}: odd number of dollar-quote markers (${tags.length})`);
  }

  const outside = stripped.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, " BODY ");

  const open = (outside.match(/\(/g) ?? []).length;
  const close = (outside.match(/\)/g) ?? []).length;
  if (open !== close) {
    problems.push(
      `${file}: unbalanced parentheses outside function bodies (${open} open, ${close} close)`,
    );
  }

  if (((outside.match(/'/g) ?? []).length) % 2 !== 0) {
    problems.push(`${file}: odd number of single quotes outside function bodies`);
  }

  if (outside.trim() && !outside.trim().endsWith(";")) {
    problems.push(`${file}: does not end with a terminated statement`);
  }

  // A policy with neither predicate is either a mistake or a wide-open door.
  const policyRe = /create policy\s+"([^"]+)"\s+on\s+(\w+)([\s\S]*?);/gi;
  let m;
  while ((m = policyRe.exec(stripped)) !== null) {
    const [, name, table, body] = m;
    const lower = body.toLowerCase();
    if (!lower.includes("using") && !lower.includes("with check")) {
      problems.push(`${file}: policy "${name}" on ${table} has neither USING nor WITH CHECK`);
    }
  }

  // Every table created here should have RLS turned on in the same file.
  // the project rules require it in the same commit; same file is stricter and easier
  // to check.
  const created = [...stripped.matchAll(/create table(?:\s+if not exists)?\s+(\w+)/gi)].map(
    (x) => x[1],
  );
  const rlsOn = new Set(
    [...stripped.matchAll(/alter table\s+(\w+)\s+enable row level security/gi)].map((x) => x[1]),
  );
  for (const table of created) {
    if (!rlsOn.has(table)) {
      problems.push(`${file}: table "${table}" is created without ENABLE ROW LEVEL SECURITY`);
    }
  }

  // A table with RLS on and no policy is deny-all. That is a legitimate and
  // deliberate pattern for locked data, so it is reported, never failed.
  const policied = new Set(
    [...stripped.matchAll(/create policy\s+"[^"]+"\s+on\s+(\w+)/gi)].map((x) => x[1]),
  );
  for (const table of rlsOn) {
    if (!policied.has(table)) {
      notes.push(`${file}: "${table}" has RLS enabled and no policy — deny-all, server functions only`);
    }
  }
}

// Views run with their OWNER's privileges unless declared security_invoker,
// which bypasses row-level security entirely (0025 fixed exactly this). Every
// view must either be switched to security_invoker somewhere in the migration
// history, or carry "DEFINER VIEW BY DESIGN" in its comment.
{
  const all = files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  const views = new Set([...all.matchAll(/create (?:or replace )?view\s+(\w+)/gi)].map((x) => x[1]));
  for (const view of views) {
    const invoker = new RegExp(`alter view\\s+${view}\\s+set\\s*\\(\\s*security_invoker\\s*=\\s*true`, "i").test(all)
      || new RegExp(`create (?:or replace )?view\\s+${view}\\s+with\\s*\\(\\s*security_invoker\\s*=\\s*true`, "i").test(all);
    const byDesign = new RegExp(`comment on view\\s+${view}\\s+is\\s+'DEFINER VIEW BY DESIGN`, "i").test(all);
    if (!invoker && !byDesign) {
      problems.push(`view "${view}" bypasses row-level security: set security_invoker = true, or document it as DEFINER VIEW BY DESIGN`);
    }
  }
}

console.log(`Checked ${files.length} migration files.\n`);

if (notes.length) {
  console.log("Deny-all tables (expected for locked data):");
  for (const n of notes) console.log("  ·", n);
  console.log();
}

if (problems.length) {
  console.log("PROBLEMS:");
  for (const p of problems) console.log("  -", p);
  console.log();
  process.exit(1);
}

console.log("No structural problems found.");
console.log("This is a structural check only — it does NOT prove the SQL runs.");
