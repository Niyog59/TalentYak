# Ghar Tira

A two-sided marketplace connecting the Nepali diaspora with service providers in Nepal. Two verticals: pandit (shraddha and ancestral rites) and fitness coaching. Agency-first, marketplace later.

## Read this first

If you are a person or an agent about to work on this project:

1. **`CLAUDE.md`** — the contract. Invariants, security operating rules, money discipline, session protocols. Non-negotiable.
2. **`docs/aafnai/DECISION_REGISTER.md`** — **current product authority.** Every rule with a status: confirmed, proposed, open, or superseded. Where this and any other document disagree, **this one wins**.
3. **`docs/aafnai/PRODUCT_CONTRACT.md`** — what the product must do: launch boundary, coach-plan specification, commission rules, user journeys.
4. **`ARCHITECTURE.md`** — system design, data model, node registry, money flow.
5. **`docs/HANDOVER.md`** — business context and history. Amended 2026-09-09; §6 was replaced. Founder-written.
6. The relevant spec in **`docs/specs/`**.

## The product, in one breath

Aafnai is a contractor-delivered managed coaching service for the Nepali diaspora. The customer buys coaching from Aafnai; their **selected** independent coach delivers it. Coaches create their own plans, set their own prices, and define their own inclusions — there is no platform package and no price approval. The customer chooses their coach and plan **before** paying. Commission is 70/30 on recurring coaching and 60/40 on one-off consultations. Coaches are paid monthly in arrears for service actually delivered.

Fitness is the first vertical. Pandit (ancestral rites) is built and retained. Tutoring and bookkeeping are catalog-only placeholders.

## The invariants, in one breath

Human confirms every ritual date. Grief data and body data are locked. Card data never touches our servers. The Stripe webhook is the only writer of payment truth. RLS on every table, same commit. The service-role key never reaches the browser. Payout economics are disclosed by us, never discovered. No fake data in production.

Full text and reasoning: `CLAUDE.md` → THE INVARIANTS.

## File guide

| Path | What it is |
|---|---|
| `CLAUDE.md` | The contract — invariants, rules, roster, protocols |
| `docs/aafnai/DECISION_REGISTER.md` | **Current product authority.** Every rule, with status, source, and owner |
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
