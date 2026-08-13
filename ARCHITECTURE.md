# Ghar Tira — Architecture

> **Stub.** This file is part of the documentation practice ported from meet-merchants, but its contents have not been written yet. It must be filled in **from the actual codebase**, not from intent. Until then, treat the code as the only source of truth.

## What goes in this file

**1. What this is** — one paragraph on the system, and a pointer to `docs/HANDOVER.md` for business context.

**2. Invariants** — the architectural expression of `CLAUDE.md` → THE INVARIANTS. Contact/grief/health data isolation enforced in the *database* (RLS, views, server functions), never in the UI alone. Money and trust fields server-only. The webhook as the source of payment truth. Structured columns, not JSON blobs.

**3. Data model** — tables by domain (core / pandit / fitness), and the conventions: snake_case, `id uuid primary key`, `created_at timestamptz`, money as integer minor units plus an explicit currency code, ritual dates stored in both AD and BS, an index on every FK and every `WHERE`/`ORDER BY` column in the same migration.

**4. Extension nodes registry** — empty tables, unused columns, and stub adapters that are **intentional architectural reservations**, each with the trigger that activates it.

**5. Node protection rule** — no cleanup, deletion, or "simplification" of a registered node without a written decision recorded in the commit message and noted in `DEVLOG.md`. If a node cannot be built as specified, do not remove it: log a `⚠ ARCHITECTURE ISSUE` in `DEVLOG.md` and wait for human review.

**6. Performance architecture** — Server Components by default, route-level code splitting, images through `next/image` with explicit dimensions, pagination capped, skeletons not spinners, admin-only heavy JS behind dynamic imports. Budgets (LCP, INP, first-load JS, CLS) checked at the end of every module, with `npm run build` reporting against them. Hang protection via the idle-timeout wrapper.

**7. Money flow** — the path from customer through Stripe, webhook, payments table, pricing module, append-only payout ledger, and out through Payoneer. The diagram is where the "webhook is the source of truth" and "ledger is append-only" rules become visible.

**8. The tithi pipeline** — the highest-consequence path in the product. The calendar library produces a *candidate*; a human confirms; only then does a notification job exist. Nothing transitions out of `pending_confirmation` without a recorded human actor.

**9. Vendor boundaries** — every vendor behind a local `/lib/*` module so it can be replaced. Never a vendor SDK call from a component.

## Changing this file

`ARCHITECTURE.md` and `MIGRATION.md` are foundational. If you discover an error or a conflict — a rule contradicts itself, a node cannot be built as specified, a performance budget appears impossible — write the problem to `DEVLOG.md` under a `⚠ ARCHITECTURE ISSUE` heading, STOP, and wait for human review.

Minor typo/wording fixes that change no meaning are allowed, tagged `[docs:]`. Never delete a node, never weaken an invariant, never remove a performance rule on your own.
