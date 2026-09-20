/**
 * Test bootstrap. Loaded with `node --import ./test/register.mjs --test`.
 *
 * Two jobs, both deliberately dependency-free:
 *
 * 1. Resolve the `@/` path alias the application uses. Node does not read
 *    tsconfig `paths`, so without this a test importing a module that itself
 *    imports `@/lib/env` fails to resolve. TypeScript itself is handled by
 *    Node's native type stripping — no transpiler is involved.
 *
 * 2. Load `web/.env.local` if it exists, so database and integration tests can
 *    reach the configured project. Values are never logged. A missing file is
 *    normal: unit tests must pass without any credential present.
 */
import { register } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolvePath(here, "..");

// --- 1. `@/` alias resolution -------------------------------------------------

const hookSource = `
const SRC = ${JSON.stringify(pathToFileURL(resolvePath(appRoot, "src") + "/").href)};

// TypeScript's bundler resolution lets application code import "@/lib/money/money"
// with no extension. Node's ESM resolver requires one, so each candidate is tried
// in the order TypeScript itself would: exact, then .ts, then a directory index.
const CANDIDATES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx", ".js", ".mjs"];

export async function resolve(specifier, context, nextResolve) {
  // "server-only" is a marker package whose default entry throws on import; it
  // resolves to a no-op only under the "react-server" condition, which Next's
  // bundler supplies and Node does not. Resolving it to that same no-op keeps
  // the guard meaningful in the build while letting a server module be unit
  // tested. Setting --conditions=react-server globally would instead swap
  // React's own build out from under every test, which is a bigger change than
  // the problem needs.
  if (specifier === "server-only") {
    return nextResolve(specifier, {
      ...context,
      conditions: [...context.conditions, "react-server"],
    });
  }

  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);

  const base = SRC + specifier.slice(2);
  let lastError;

  for (const suffix of CANDIDATES) {
    try {
      return await nextResolve(base + suffix, context);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}
`;

register(`data:text/javascript,${encodeURIComponent(hookSource)}`);

// --- 2. .env.local ------------------------------------------------------------

const envPath = resolvePath(appRoot, ".env.local");

if (existsSync(envPath)) {
  for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip one matching pair of surrounding quotes.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    // A real environment variable always wins over the file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
