# Ghar Tira

A two-sided marketplace connecting the Nepali diaspora with service providers in Nepal. Two verticals: pandit (shraddha and ancestral rites) and fitness coaching. Agency-first, marketplace later.

## Read this first

If you are a person or an agent about to work on this project:

1. **`CLAUDE.md`** — the contract. Invariants, security operating rules, money discipline, session protocols. Non-negotiable.
2. **`ARCHITECTURE.md`** — system design. Currently a stub; the codebase is the source of truth until it's written.
3. **`docs/HANDOVER.md`** — business source of truth: model, pricing, payout math, regulatory position, decision gates.
4. The relevant spec in **`docs/specs/`**.

## The invariants, in one breath

Human confirms every ritual date. Grief data and body data are locked. Card data never touches our servers. The Stripe webhook is the only writer of payment truth. RLS on every table, same commit. The service-role key never reaches the browser. Payout economics are disclosed by us, never discovered. No fake data in production.

Full text and reasoning: `CLAUDE.md` → THE INVARIANTS.

## File guide

| Path | What it is |
|---|---|
| `CLAUDE.md` | The contract — invariants, rules, roster, protocols |
| `ARCHITECTURE.md` | System design (stub) |
| `MIGRATION.md` | Vendor portability and backups (stub) |
| `TASKS.md` | Deferred items, known debt |
| `docs/HANDOVER.md` | Business source of truth. Founder-written. |
| `docs/specs/` | Per-module build specs |
| `.cursorrules` | Cursor-side pointer into CLAUDE.md |
| `DEVLOG.md` | Per-session engineering journal. Gitignored. |
| `CTO-BRIEF.md` | End-of-session founder briefing. Gitignored. |
