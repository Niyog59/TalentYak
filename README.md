# TalentYak

A contractor-delivered managed coaching service for the Nepali diaspora, at `talentyak.com`. Fitness is the only active launch vertical. The pandit vertical (shraddha and ancestral rites) is built, retained, and not publicly sellable.

## Read this first

If you are a person or an agent about to work on this project:

1. **`CLAUDE.md`** — the contract. Invariants, security operating rules, money discipline, session protocols. Non-negotiable.
2. **`docs/aafnai/DECISION_REGISTER.md`** — **current product authority.** Every rule with a status: confirmed, proposed, open, or superseded. **Read §L first** — it carries the TalentYak brand and the 20% commission, and supersedes several earlier entries. Where this and any other document disagree, **this one wins**.
3. **`docs/aafnai/PRODUCT_CONTRACT.md`** — what the product must do: launch boundary, coach-plan specification, commission rules, user journeys.
4. **`ARCHITECTURE.md`** — system design, data model, node registry, money flow.
5. **`docs/implementation/M03-M07-STATUS.md`** — **what is actually true today**: what is built, what was tested and against which real services, and what is blocked.
6. **`docs/HANDOVER.md`** — business context and history. Amended 2026-09-09; §6 was replaced. Founder-written.
7. The relevant spec in **`docs/specs/`**.

## The product, in one breath

TalentYak is a contractor-delivered managed coaching service for the Nepali diaspora. The customer buys coaching from TalentYak; their **selected** independent coach delivers it. Coaches create their own offers, set their own prices, and define their own inclusions — there is no platform package and no price approval. The customer chooses their coach and offer **before** paying. **Commission is 20% on recurring coaching and 20% on one-off consultations**; the coach receives 80%. Coaches are paid monthly in arrears for service actually delivered.

Fitness is the launch vertical. Pandit (ancestral rites) is built and retained. Tutoring and bookkeeping are catalog-only placeholders.

## The invariants, in one breath

Human confirms every ritual date. Grief data and body data are locked. Card data never touches our servers. The Stripe webhook is the only writer of payment truth. RLS on every table, same commit. The service-role key never reaches the browser. Payout economics are disclosed by us, never discovered. No fake data in production.

Full text and reasoning: `CLAUDE.md` → THE INVARIANTS.

## Running it

```bash
cd web
npm install
cp .env.example .env.local     # fill in; .env.local is gitignored and must stay so
npm run dev                    # http://localhost:3001
npm run verify                 # typecheck + lint + unit tests
```

Against a database, with credentials in `.env.local`:

```bash
node scripts/check-migrations.mjs                              # structure of the migrations
npm --prefix web run db:migrate:dry                            # what would apply
TALENTYAK_DB_TESTS=confirmed npm --prefix web run test:db      # permissions, as real users
```

Which variables are needed, and what is configured today: `docs/operations/configuration.md`.

## File guide

| Path | What it is |
|---|---|
| `CLAUDE.md` | The contract — invariants, rules, roster, protocols |
| `docs/aafnai/DECISION_REGISTER.md` | **Current product authority.** Every rule, with status, source, and owner. §L is the newest pass |
| `docs/implementation/M03-M07-STATUS.md` | **Status of record** — built, tested, verified, blocked, per module |
| `docs/implementation/HANDOVER-M03-M07.md` | Where everything lives and what the next module should not have to rediscover |
| `docs/FOUNDER-NEXT-STEPS.md` | The only actions that genuinely need the founder, with exact steps |
| `docs/operations/configuration.md` | Every environment variable, and what is and is not configured |
| `docs/operations/payments-and-payouts.md` | How money moves, who may write it, what each state means |
| `docs/operations/database-and-migrations.md` | Migration rules, and how to build the production project cleanly |
| `web/src/lib/policy/` | **Every commercial rule, versioned.** Commission, payouts, cancellation, the live-billing gate |
| `web/src/lib/money/` | Money arithmetic — integer minor units, currency precision, exact allocation |
| `brand/talentyak/` | Approved logo pack, masters, and integration notes |
| `docs/aafnai/PRODUCT_CONTRACT.md` | What the product must do — scope, plan spec, commission, journeys |
| `docs/aafnai/CODEBASE_RECONCILIATION.md` | Each requirement mapped to real code, with keep/repair/replace/new/defer |
| `docs/aafnai/M00_ACCEPTANCE.md` | Given/When/Then product scenarios |
| `docs/aafnai/M00_COMPLETION_REPORT.md` | What was inspected, changed, and verified in M00 |
| `ARCHITECTURE.md` | System design, data model, node registry, money flow |
| `MIGRATION.md` | Vendor portability, exit runbook, backups |
| `TASKS.md` | Deferred items, known debt |
| `docs/HANDOVER.md` | Business context and history. Amended 2026-09-09 — §6 replaced. Founder-written. |
| `docs/specs/` | Per-module build specs (`module-N.md`) |
| `.cursorrules` | Cursor-side pointer into CLAUDE.md |
| `DEVLOG.md` | Per-session engineering journal. Gitignored. |
| `CTO-BRIEF.md` | End-of-session founder briefing. Gitignored. |
