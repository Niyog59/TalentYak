# Ghar Tira — Migration & Exit Runbook

> **Stub.** Part of the documentation practice ported from meet-merchants; contents not yet written. Fill in from the actual stack.

**Purpose:** every vendor in this stack is replaceable, and this file is the proof. If a vendor raises prices, changes terms, blocks the account, or fails, this document is how we leave without losing customers, money records, or the tithi database.

**Rule:** a new vendor dependency is added to the stack inventory **in the same commit that introduces it**. No exceptions. An undocumented vendor is a hostage situation waiting to happen.

## What goes in this file

**1. Stack inventory** — a table of every vendor: concern, vendor, lock-in risk, the local `/lib/*` seam that isolates it, and the honest exit cost. Stripe will be the high-lock-in row; say so plainly rather than pretending everything is swappable.

**2. Step-by-step exit procedure** — freeze, export, **verify the export before touching anything live**, stand up the replacement, run the full test suite against it, re-point the seam module, cut over, keep the old vendor read-only for 30 days, reconcile money records before decommissioning.

**3. Environment variable inventory** — every variable, split into client-safe (`NEXT_PUBLIC_`) and server-only. A `NEXT_PUBLIC_` prefix on anything in the server-only column is a security incident, not a typo. Note that `.env*` is gitignored and `.env.example` documents every variable with no values.

**4. Vendor-specific notes** — where the exit is genuinely painful, explain why and what mitigates it. For Stripe: saved payment methods are not casually portable, subscription billing anchors and grandfathered prices are the hard part, and the mitigation is that every Stripe object ID is mirrored into our own tables and the pricing *logic* lives in our code, not in Stripe metadata.

**5. Correctness dependencies** — the Bikram Sambat calendar library is trivial to replace but catastrophic to get wrong. Pin the exact version, never float, and re-run a fixture suite of known-correct conversions before any upgrade.

**6. Backups** — daily automated, off-site, encrypted, in CI rather than the app bundle, with a retention ladder and a dead-man's switch. **A quarterly restore drill into a scratch database, with the result recorded in `DEVLOG.md`.** A backup that has never been restored is a hypothesis, not a backup. Note that decrypted backups contain grief, health, and contractor data in the clear.

**7. Creating the production project** — a literal checklist someone can follow at 2am: project creation, env vars, migration order, RLS verification against prod, bucket creation with correct visibility, live-mode keys, webhook endpoint registration, first backup run.

## Keep this true

- New vendor → new row, same commit.
- Vendor removed → row deleted, reason in `DEVLOG.md`.
- A seam module leaking vendor-specific types into application code is architectural debt; log it in `TASKS.md`.
- Review this file at every phase boundary. A stale exit plan is the same as no exit plan.
