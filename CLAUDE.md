# CLAUDE.md — Ghar Tira

**Read this file first, every session. Follow the map at the bottom for depth.**

Ghar Tira is a two-sided marketplace connecting the Nepali diaspora with service providers in Nepal, across two verticals: pandit (shraddha and ancestral rites) and fitness coaching. The business runs agency-first — the founder sets prices, finds customers, matches supply, and controls quality. Business context and pricing live in `docs/HANDOVER.md`.

---

## THE INVARIANTS — violating one is a failed build, even if it's green

The expensive thing to retrofit is never a feature. It's an invariant.

1. **Ritual correctness is the brand.** Every ceremony date and tithi that reaches a customer is **confirmed by a human before it is sent or acted on**. No automated tithi send, ever. A wrong shraddha date is a family's ancestral rite performed on the wrong day, in a community small enough that everyone hears about it.
2. **Grief data is locked.** The deceased's name, gotra, relationship, and tithi live in a deny-by-default table. Never in public HTML, API responses, sitemaps, analytics events, error logs, or LLM prompts.
3. **Body and health data is locked.** Progress photos, measurements, bodyweight, injuries — owning customer and currently-assigned coach only. Private bucket, short-lived signed URLs, EXIF stripped on upload.
4. **Card data never touches our servers.** Stripe only. We store Stripe object IDs — never a PAN or CVV, not in a database, not in a log line.
5. **Money and trust states are server-side only.** `paid`, `payout_status`, `subscription_status`, `verified` — writable only by server functions, admin role, or a signature-verified webhook. **The Stripe webhook is the only writer of payment truth**; the browser's success redirect is a UI hint, never a grant of entitlement.
6. **RLS on every table, deny by default, written in the same commit as the table.**
7. **The service-role key never reaches the browser.** Server env vars only; the browser gets the anon key.
8. **Payout economics are disclosed by us, never discovered.** A provider must never reverse-engineer their share from a page we built.
9. **No fake data on the live site.** Rich fake seed data locally is encouraged. In production: no fake reviews, no invented provider profiles, no fabricated booking counters.

---

## STANDING RULES FOR AGENTS

- **Plan first, always.** Present a plan or spec and STOP for approval before writing code. No exceptions for "small" changes.
- **Propose the smallest thing that closes the gap.** If you find yourself adding a capability nobody asked for because it "would pair well," stop and put it in `TASKS.md` instead.
- **Never decide product direction.** `docs/HANDOVER.md` is founder-written. Propose changes in your report; do not edit it.
- **Code is truth over docs.** Where a doc and the codebase disagree, the codebase is what's real. Flag every contradiction you find rather than assuming the doc is right.
- **Never claim work is complete without verification.** "Done" means tested against acceptance criteria, not "code written."
- **One agent at a time.** Parallel agent runs corrupt the working tree. `git status` clean between handoffs.
- **Security-sensitive work routes to the heavy agent.** Auth, RLS, migrations, Stripe, payouts, webhooks — anything touching invariants 2–8.
- **Stop before commit.** No pushing without explicit approval.
- **Emit Founder Checkpoints.** After each meaningful unit of work, emit the three-line checkpoint below. Automatically, without being asked.
- **Follow the interruption & failure protocol.** STOP conditions, hang handling, and what to report are non-negotiable.

---

## AGENT ROSTER

Single-founder project; routing is done by hand, not by a router agent.

| Name | Role | Notes |
|---|---|---|
| **सारथी Sarathi** | Chief of staff. Takes a task, writes a short spec, proposes it. | Writes specs, never code. |
| **वज्र Bajra** | Heavy coding agent (Claude Code, top-tier model). | Auth, RLS, migrations, Stripe, payouts, webhooks — anything security- or money-critical. |
| **निर्माण Nirmaan** | Routine coding agent (Cursor Composer). | UI, components, copy, styling. Not covered by security tooling — never give it invariant-touching work. |
| **परीक्षक Parikshak** | QA. Checks the build against approved *intent*, not just "does it run." | Tests preview deploys. Read-only smoke checks in prod, never writes. |
| **प्रहरी Prahari** | Security review layer. | Runs on the heavy agent's edits. Does not cover Nirmaan. |

Rules written against a named agent apply to every agent unless a rule names one specifically.

---

## SECURITY OPERATING RULES (non-negotiable, apply to every module)

**Keys and access**
- The Supabase service-role key NEVER appears in client code. The server client is import-guarded three ways: `import "server-only"`, a runtime `window` check, and a non-`NEXT_PUBLIC_` env var name.
- Secrets only in env vars. `.env*` is gitignored. A leaked key is rotated, not "probably fine."
- Admin routes verify the role claim server-side on every request. **Admin accounts require a second factor** — they guard contractor tax documents, payout details, and grief data.

**Database**
- Every table gets RLS enabled with explicit policies in the same migration that creates it. Deny by default.
- Sensitive classes get their own tables, never mixed with public fields: grief data, contractor PII/payout details, health records.
- Tables holding locked PII may correctly be RLS-enabled with **zero policies** — deny-all, server-functions-only. That is the right pattern, not a gap.
- Status fields users must never set are writable only via admin role or server functions.
- Every foreign key and every column used in `WHERE`/`ORDER BY` gets an index in the same migration.

**Payments and payouts**
- Stripe webhooks: verify the signature on every request, reject unsigned, and **process idempotently by event ID**. A replayed webhook must never double-grant or double-pay.
- Entitlement is granted by the webhook, never by the browser redirect.
- The payout ledger is append-only. Corrections are new rows, never overwrites.
- Never log full Stripe payloads containing customer PII into a general application log.

**Storage**
- Private buckets for recordings, contractor documents, and progress photos. Everything private is served by short-lived signed URLs scoped to the requesting user — no permanent public URLs, no guessable paths.
- Ceremony recordings are the family's property. Never used in marketing without written per-ceremony consent.
- All uploads: validate magic bytes, size-cap, re-encode images server-side, strip EXIF. Progress photos carry GPS in EXIF — stripping is a privacy control, not an optimisation.

**Input and abuse**
- All user-generated text is hostile input: sanitize, length-cap, and when passed to an LLM, wrap as data with injection-resistant prompts.
- Rate limit expensive and abusable actions: signup, booking creation, message send, password reset, any AI call.
- Security headers are set in `next.config.ts` and never removed. CSP is the exception — it lives in middleware because it needs a per-request nonce.

---

## MONEY DISCIPLINE

- **One pricing source of truth.** Prices, payout splits, and direct-cost assumptions live in one module. No price literal in a component or a migration.
- **The pandit payout model is post-cost, not flat.** Direct ritual costs come out of the ticket first; the remainder splits 50/50. Fitness is 60/40 coach/platform. Never implement "60% of ticket" as a shortcut — see `docs/HANDOVER.md` §5.2.
- **Every pricing change ships with a test** using the worked examples from HANDOVER §5.2 as fixtures.
- **Signup price is locked forever** for existing subscribers. Any price change ships with an explicit answer to "what happens to people already paying?"
- **Money is integer minor units with an explicit currency code.** Never floats.

---

## ACCOUNTS, GIT IDENTITY & DEPLOYMENT

> **TODO — fill in when the LLC and business accounts exist.** The pattern below is the one proven on meet-merchants; keep the structure, fill the values. Until then, do not push this repo anywhere.

- This machine has multiple GitHub accounts. This repo MUST use the **Ghar Tira business** account only — never a personal account.
- Commit author identity is set repo-locally and must stay the business name/email. Vercel's Git Fork Protection blocks deployments whose commit author is not a team member — a personal-email commit silently fails to deploy (status BLOCKED).
- `origin` pushes through a dedicated SSH host alias. Push only through this alias.
- Keep Git Fork Protection ON; do not disable it to work around a deploy block — fix the commit author instead.

---

## JOURNAL & COMMIT RULES

`DEVLOG.md` is the local-only debugging journal. Every session appends entries in this format, at the smallest useful level of detail:

```
## [date] [time] — [short title]
- WHAT: exactly what was changed (files, functions, configs)
- WHY: the reasoning/decision behind it
- HOW: approach taken, alternatives rejected and why
- ISSUES: errors hit, how resolved, anything left unresolved
- VERIFIED: what was tested and the result
```

It is gitignored and must never be committed.

Commit messages: conventional style (`feat:`, `fix:`, `chore:`, `refactor:`), professional, concise, factual. No AI or tool references in commits, code comments, or project files — ever.

---

## SESSION PROTOCOLS

Applies to ALL agents in the roster, every session, every prompt, forever.

### Founder Checkpoints

Emit a brief checkpoint after each meaningful unit of work (a task, a file group, a command). Exactly three lines:

```
✓ Done: [what just finished, one line]
→ Next: [what's starting next, one line]
⚠ Needs you: [decision/problem, one line] — or "nothing, continuing"
```

Max three lines. No walls of text between tasks. Emit BEFORE starting the next task. If something goes wrong mid-task, emit a checkpoint immediately — don't silently try to fix first. If "Needs you" is anything other than "nothing, continuing," STOP and wait. This is NOT the CTO brief — it's a running heartbeat.

### End-of-work documentation protocol

After completing the work in any prompt, BEFORE the final commit:

1. Finish the implementation and verify it (build passes, tests green).
2. Prepare a "Documentation updates" proposal: a short list of what should be added or updated in `ARCHITECTURE.md`, `MIGRATION.md`, `TASKS.md`, or `README.md` as a result of this work. For each item: which file, what change, why.
3. Present the proposal and STOP. Ask: "Approve these documentation updates?" Do not modify the contract files before approval. (`TASKS.md` progress ticks and `DEVLOG.md` entries do NOT need approval — write those freely.)
4. On approval, apply exactly the approved changes, then make the final commit including both the work and the approved documentation updates.
5. If items are rejected or modified, apply only what was approved.

### End-of-work explanation (teach the founder)

After documentation approval and before ending the session, always provide a "What I built" explanation:

- Audience: smart but new to programming. Plain language. Short.
- Structure:
  1. What was built, in one paragraph
  2. WHERE each piece lives — file by file, one line each
  3. How data flows through it, if data moves
  4. One thing that could break here later and what the symptom would look like
  5. Any term used that a non-programmer wouldn't know, defined in one line
- No code blocks unless asked. Analogies welcome.

This is not optional politeness — it is part of the deliverable.

### CTO Briefing

After the documentation proposal and founder explanation, append one entry to `CTO-BRIEF.md` (repo root, gitignored, local-only). `DEVLOG.md` stays dev-centric — it is the agents' memory. `CTO-BRIEF.md` is for a different reader: the founder learning to operate as CTO.

- Voice: a senior software engineer and senior devops engineer briefing their CTO. Plain language, business-first, technically precise but never a technical dump.
- 150–250 words. If it can't fit, the session did too many unrelated things.
- Fixed structure:
  1. What changed — in product/business terms, not file terms.
  2. Decisions made & what they traded off — one or two sentences each.
  3. New risk or debt created — honest; "none" only if true.
  4. If this breaks in production — which service to check first (Vercel / Supabase / Stripe / Cloudflare / Resend) and what the failure looks like to a customer.
  5. New term, one line.
- Zero code blocks. File paths only when the CTO would need them to point an agent at a problem.
- Write fresh from the reader's side, never a mechanical summary of DEVLOG.

### Interruption & failure protocol

If any of the following happen, STOP immediately, do not fix forward, and report before doing anything else:

STOP CONDITIONS:

- A build fails and you don't know why within one attempt
- A test fails unexpectedly
- An npm install or dependency operation errors
- You realize the task requires touching files outside the scope of the current prompt
- You discover a conflict between this prompt's instructions and `CLAUDE.md` / `ARCHITECTURE.md`
- You are about to do something destructive (delete files, drop tables, discard changes) not explicitly authorized
- **You are about to touch anything that moves money, or any table holding grief or health data, and the prompt did not explicitly authorize it**
- A command produces no output and makes no progress for its defined idle window (see "Hangs") — it is hung
- You have been working on one step for more than 10 minutes without progress
- Anything surprises you — a file that shouldn't exist, a config that contradicts the spec, an unexpected error

WHAT TO REPORT:

1. Where you stopped (which step, which file)
2. What you were trying to do
3. What went wrong or surprised you (exact error if there is one)
4. What you think the options are — propose 2–3 paths with trade-offs, don't just ask "what should I do?"
5. Your recommendation and why

WHAT NOT TO DO:

- Do not retry the same failing operation more than twice
- Do not install new packages to work around an error without asking
- Do not make scope changes to make something work
- Do not push to main if any step failed or was skipped
- Do not "fix" an error by deleting things

HANGS (no output = hung; elapsed time is never the signal):

- The signal for "hung" is NO OUTPUT / NO PROGRESS within a command's defined idle window — never elapsed wall-clock time alone. A command actively printing output must be allowed to continue, however long it takes.
- A command silent for its idle window is hung: kill it and report. Never busy-wait, never re-poll in a shell loop, never retry-loop on a hang.
- Preserve evidence BEFORE killing. Ensure diagnostic output is unbuffered or written to a file first. Never `kill -9` a process whose output you have not captured.
- Enforce this in code, not by memory: hang-prone commands (seed, RLS tests, db reset/push, backup) run through an idle-timeout wrapper that kills a child only after a no-output window and prints why. Long-lived servers (`next dev`, `next start`) are deliberately NOT wrapped.

---

## MAP — where everything lives

| File | What it holds | Who writes it |
|---|---|---|
| `CLAUDE.md` (this) | Invariants, rules, roster, protocols, map | Founder |
| `docs/HANDOVER.md` | Business source of truth — model, pricing, gates, regulatory | **Founder only** |
| `ARCHITECTURE.md` (root) | System design, schema, data flow, node registry | Agents may propose |
| `MIGRATION.md` (root) | Vendor dependencies, portability, backups | Agents may propose |
| `docs/specs/` | Per-module build specs | Sarathi drafts, founder approves |
| `TASKS.md` (root) | Deferred items, known debt, someday-sockets | Anyone may append |
| `DEVLOG.md` (root, gitignored) | Per-session engineering journal | Every agent, every session |
| `CTO-BRIEF.md` (root, gitignored) | End-of-session founder briefing | Every agent, every session |
| `.cursorrules` | Cursor-specific pointer to this file | Founder |

**Before starting work:** read this file, then `ARCHITECTURE.md`, then the relevant spec.
