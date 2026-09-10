# Tasks

Deferred items, known debt, and someday-sockets. Anyone may append; agents tick progress here freely (no approval needed).

**Convention:** one `##` section per module or workstream, marked `— complete` when done. Completed sections are kept, not deleted — the order things were built in is useful history. Anything an agent wanted to build but was told not to goes under a `### Deferred` heading with the trigger that would unblock it.

---

## Documentation practice — ported from meet-merchants (2026-08-13)

- `CLAUDE.md` — invariants, standing rules, agent roster, security operating rules, money discipline, session protocols
- `.cursorrules` — Cursor-side pointer into CLAUDE.md
- `AGENTS.md` — generic agent entry point
- `ARCHITECTURE.md`, `MIGRATION.md` — stubs; contents to be written from the real codebase
- `TASKS.md`, `DEVLOG.md`, `CTO-BRIEF.md`, `docs/specs/README.md` — templates seeded

---

## Open

- [ ] Fill in `ARCHITECTURE.md` from the actual codebase (data model, node registry, money flow, tithi pipeline, vendor seams)
- [ ] Fill in `MIGRATION.md` stack inventory and env var inventory from the actual stack
- [ ] Fill in `CLAUDE.md` → ACCOUNTS, GIT IDENTITY & DEPLOYMENT once the LLC and business accounts exist. Until then, do not push this repo.
- [ ] Decide the canonical project location and get the codebase under git

---

## M00 — Aafnai product contract and scope (2026-09-09) — complete

Documentation module. No application code, dependencies, migrations, or configuration changed.

- `docs/aafnai/PRODUCT_CONTRACT.md` — purpose, launch boundary, responsibility matrix, coach-plan field spec, service-type/commission classification, user journeys, proposed lifecycle contracts
- `docs/aafnai/DECISION_REGISTER.md` — 57 decision IDs, 6 explicit supersessions, 13 open policies with gates and owners
- `docs/aafnai/CODEBASE_RECONCILIATION.md` — 55 items mapping audit findings and new requirements to re-verified source
- `docs/aafnai/M00_ACCEPTANCE.md` — 14 Given/When/Then product scenarios
- `docs/aafnai/M00_COMPLETION_REPORT.md` — what was inspected, changed, and verified

Confirmed this module: coach-created plans with coach-set prices (no platform package, no price approval); commission 70/30 monthly and 60/40 one-off; dual-timezone scheduling with video and audio calls; the eight progress/workspace capabilities as first-product scope; Google sign-in and local-currency display.

### Deferred

- **In-app messaging** — gated on `OPEN-06`. `docs/HANDOVER.md:243` defers it to WhatsApp; the founder has not confirmed either way. Unblocked by a decision on OPEN-06. **Either way, the "direct messaging with your coach" claim in `web/src/verticals/fitness/catalog.ts:37` must be corrected.**
- Native apps, wearables, macro tracking, automated payouts, Stripe Connect, coach ratings and reviews, public multi-vertical marketplace, coach-owned-client software subscription — all unchanged from prior scope discipline.

---

## Deferred — do not build yet

*(Add items here with the trigger that would unblock them.)*

---

## Known debt

Found during the M00 audit and reconciliation (2026-09-09). All source-inspected; none runtime-tested. Full detail and dispositions in `docs/aafnai/CODEBASE_RECONCILIATION.md`.

**Agent instructions contradict the repository**

- [ ] `.cursorrules` names protected tables `deceased_records`, `tithi_reminders`, `health_records` — none exist. The real grief table `shraddha_dates` is **not** named in the hard-stop list (safety defect; R-55)
- [ ] `AGENTS.md` and `.cursorrules` require `docs/STATE.md`, `docs/DIRECTION.md`, `docs/DATA-MAP.md`, `docs/RUNBOOK.md`, `scripts/payout-test.ts`, `scripts/rls-test.ts`, `scripts/lib/with-idle-timeout.mjs` — none exist
- [ ] `.cursorrules` cites a `CLAUDE.md` "Tone rules" section that does not exist

**Money and payments**

- [ ] Renewal webhooks are not deduplicated — `invoice.payment_succeeded` supplies no payment intent, so the only guard (`0004_payments.sql:21`) does not apply (R-11)
- [ ] `charge.refunded` does not reverse coach earnings or transition the booking (`webhook.ts:96-99`) (R-12)
- [ ] No handler for payment failure, subscription cancellation, or dispute (R-13)
- [ ] Payment insert errors are swallowed and acknowledged as processed (`webhook.ts:147`) (R-14)
- [ ] `payout_ledger` mixes immutable amounts with mutable workflow status; admin RLS is `for all` (R-15)
- [ ] Payout export mutates state via `GET` (`admin/payouts/export/route.ts:10`) (R-18)
- [ ] Batch "paid" is the literal string in a free-text notes field (`admin/payouts/page.tsx:76,142`) (R-16)
- [ ] No sold-price snapshot on bookings; `/admin/catalog` edits prices in place with no audit (R-20)

**Identity and access**

- [ ] A coach cannot sign in — `providers.profile_id` is only ever read, never written (R-35)
- [ ] Guest purchases never become owned accounts; `customer_id` is never backfilled (R-36)
- [ ] Grief data is stored in `bookings.intake_response`, readable by any assigned provider — invariant 2 violation (R-38)
- [ ] Admin accounts have no second factor, contrary to `CLAUDE.md` → Security operating rules (R-37)

**Platform safety**

- [ ] No security headers and no CSP (`next.config.ts` empty; `proxy.ts` refreshes cookies only) (R-40)
- [ ] No rate limiting; `createBooking` inserts via the service-role client and sends an email per call (R-41)
- [ ] `lib/supabase/admin.ts` lacks `import "server-only"` and a `window` guard, unlike nine sibling modules (R-42)
- [ ] Cron guard fails open when `CRON_SECRET` is unset, and the variable is absent from `.env.example` (R-43)
- [ ] Email templates interpolate user text unescaped (`email/index.ts:59,78`) (R-44)
- [ ] ~16 missing indexes, notably `bookings(stripe_subscription_id)` used by every renewal lookup (R-45)
- [ ] No test runner, no test script, no test file — contrary to `CLAUDE.md` money-math and RLS test rules (R-46)

**Presentation**

- [ ] Public navigation is unreachable below 640px (`site-nav.tsx:32`) (R-47)
- [ ] Marketing claims exceed the product: homepage testimonial of unverified truth (`page.tsx:141`), "direct messaging" (`fitness/catalog.ts:37`), "named coordinator" (`services/[vertical]/[service]/page.tsx:54`) (R-50)
