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

- [x] `.cursorrules` protected-table list rebuilt from the migrations (R-55) — fixed in M02
- [x] `scripts/lib/with-idle-timeout.mjs` now exists. The phantom `docs/STATE.md`, `DIRECTION.md`, `DATA-MAP.md`, `RUNBOOK.md` references were removed from `.cursorrules`; payout and RLS tests are now `npm test`
- [x] `.cursorrules` no longer cites a nonexistent CLAUDE.md section

**Money and payments**

- [ ] Renewal webhooks are not deduplicated — `invoice.payment_succeeded` supplies no payment intent, so the only guard (`0004_payments.sql:21`) does not apply (R-11)
- [ ] `charge.refunded` does not reverse coach earnings or transition the booking (`webhook.ts:96-99`) (R-12)
- [ ] No handler for payment failure, subscription cancellation, or dispute (R-13)
- [ ] Payment insert errors are swallowed and acknowledged as processed (`webhook.ts:147`) (R-14)
- [ ] `payout_ledger` mixes immutable amounts with mutable workflow status; admin RLS is `for all` (R-15)
- [ ] Payout export mutates state via `GET` (`admin/payouts/export/route.ts`) (R-18) — **CSV formula-injection protection landed 2026-09-15**; the GET-mutation fix is M07 work
- [ ] Batch "paid" is the literal string in a free-text notes field (`admin/payouts/page.tsx:76,142`) (R-16)
- [ ] No sold-price snapshot on bookings; `/admin/catalog` edits prices in place with no audit (R-20)

**Identity and access**

- [x] Coaches now sign in: invitation acceptance creates the provider and links `profile_id` (migration 0024) (R-35)
- [x] Guest bookings are claimed on sign-in, but only against a **verified** email address, and every claim is recorded (migration 0024) (R-36)
- [x] Grief and health keys moved out of `bookings.intake_response` into `protected_intake`, counts reconciled, and a trigger stops them coming back (migration 0021) (R-38)
- [x] `is_admin()` requires a completed second factor **in the database**, not only in the UI (migration 0017) (R-37)

**Platform safety**

- [x] Seven security headers in `next.config.ts`; nonce-based CSP in `proxy.ts` with a strict `script-src` (R-40)
- [x] Database-backed rate limiting (migration 0018) on sign-in, sign-up, reset, checkout, photo upload, payout-detail change and coach-change requests; the legacy `createBooking` purchase path is retired (R-41)
- [x] `lib/supabase/admin.ts` now has all three guards: `server-only`, a throwing `window` check, and a non-public env var name (R-42)
- [x] Cron guard now **fails closed**, compares in constant time, prefers POST, and `CRON_SECRET` is documented in `.env.example` (R-43)
- [x] Email templates now HTML-escape every user value, drop non-http(s) link schemes, and send a plain-text alternative (R-44)
- [x] Indexes added, including `bookings(stripe_subscription_id)` (migration 0008) and every foreign key and ordering column added since (R-45)
- [x] Test runner added — Node's built-in runner, **no new dependency**. `npm test` / `npm run verify`. 94 tests as of 2026-09-15. **RLS tests still outstanding**, blocked on database access (R-46)

**Presentation**

- [x] Phone navigation exists (`components/shell/mobile-menu.tsx`), and the signed-in areas have their own tab bar (R-47)
- [x] Marketing copy corrected to what the product does: no invented testimonial, no promised messaging or named coordinator, and no "billed quarterly" — coaches publish their own plans and prices (R-50)

---

## M03–M07 — TalentYak implementation batch (2026-09-15)

Plan and conflict analysis: `docs/implementation/M03-M07-PLAN.md`. Status is tracked with four distinct claims — implemented, tested locally, externally verified, blocked — which are never collapsed into one.

### Stage 0 — foundations — complete

- [x] Test runner with no added dependency; `npm test`, `npm run test:watch`, `npm run verify`
- [x] Idle-timeout wrapper at `scripts/lib/with-idle-timeout.mjs`, as CLAUDE.md requires
- [x] Money core — integer minor units, per-currency precision, decimal-safe parsing, range validation, exact largest-remainder allocation, BigInt intermediates
- [x] Versioned policy layer — commission, discount funding, billing terms, price change, cancellation, payment failure, recognition, payout, eligibility; each carrying `confirmed` or `sandbox_default`
- [x] Live-billing gate, closed by default and independently blocked by any unapproved policy
- [x] All five founder money fixtures implemented as tests, plus prepaid allocation and cumulative refund reconciliation
- [x] TalentYak brand integrated — assets, `BrandLogo`, favicon and app icons, manifest, metadata, forest-green tokens
- [x] Security repairs: R-40, R-42, R-43, R-44, and CSV formula injection
- [x] Every hardcoded commission rate removed from components; rates now read from the policy register
- [x] Documents reconciled to TalentYak and 20% — DECISION_REGISTER §L, CLAUDE.md, .cursorrules, README.md, ARCHITECTURE.md

### Stages 1–6 — done, against the founder's hosted project as the test environment

Status of record: `docs/implementation/M03-M07-STATUS.md`.

- [x] M03 domain model, permissions, migrations — 30 migrations, access matrix exercised as real users
- [x] M04 accounts, authentication, onboarding, coach invitations, admin bootstrap, second factor
- [x] M05 coach profiles, plan builder with per-currency prices, capacity, public discovery, founder review
- [x] M06 checkout, Stripe webhook as the only writer of payment truth, renewals, failed payments, cancellation, refunds, disputes
- [x] M07 earnings, immutable ledger, reconciliation, payout batches with evidence, coach changes
- [x] M08 slice — outbox worker, scheduled endpoint, email templates, retention contracts (destructive execution off)
- [x] Verified: typecheck, lint, 196 unit tests, 95 database tests, production build, browser journey end to end
- [ ] **Open:** one test purchase must be completed by hand on Stripe's hosted page (founder checklist item 7)
- [ ] **Open:** coach credential evidence upload screen (database and review screen exist)
- [ ] **Open:** photo upload not yet exercised through a browser file picker (unit-tested, including EXIF stripping)

### Stage 7 — rename and handover

- [x] Update `origin` from `Niyog59/Aafnai` to the verified `Niyog59/TalentYak`
- [ ] Rename `/Users/niyoguprety/dev/ghar-tira` → `/Users/niyoguprety/dev/TalentYak` (last, deliberately)
- [ ] Produce the six deliverable documents in the brief's §15

### Deferred

- [ ] **Maskable PWA icon.** The pack contains none, and one needs a padded export verified against circular launcher crops. All icons ship `purpose: "any"` until then.
- [ ] **`brand/aafnai/scripts/build-brand.mjs`** generates the retired Aafnai mark. Superseded by the supplied TalentYak pack; retained as history, not wired to anything.
- [ ] **Business GitHub account and commit identity.** The repo is under a personal account with a personal commit email. Vercel Git Fork Protection will block deployments on this once Vercel is connected.
- [x] ~~**Database test teardown leaves orphaned outbox jobs.**~~ Resolved 2026-09-21 at the source: a job whose recipient was deleted now finishes as skipped, not failed; the 29 historical rows were reclassified. Suites that queue email (payouts, coach changes) delete their fixture users without cancelling the jobs those users created. The jobs then fail with `coach not found` and inflate the founder console's "failed or blocked" count. Teardown should cancel any outbox row referencing a fixture being deleted.
- [x] ~~**Video is stored uncompressed and with its metadata.**~~ Resolved 2026-09-21: clips are re-encoded with FFmpeg inside our own functions (see `docs/implementation/M08-M10-M14-STATUS.md`).
- [ ] **Clip processing capacity.** Encoding runs inside a Vercel function at roughly 1.0–1.35x real time, which is why clips are capped at 2 minutes and 50 MB. If longer clips or high volume are needed, move `processVideo()` to a dedicated worker; options and costs are in the status document.
- [x] ~~**iPhone HEIC photos are refused.**~~ Resolved 2026-09-21: decoded with libheif (WebAssembly) in an isolated worker thread.
- [ ] **Upgrade `libheif-js` when a release bundles libheif ≥ 1.23.5.** 1.23.2 (current, newest published) predates upstream parsing fixes released 2026-09-01 to 2026-09-21. Mitigated by WebAssembly isolation, a worker thread with a deadline, and size/pixel caps.
- [x] ~~**Security advisories in dependencies.**~~ Resolved 2026-09-21: `next` 16.3.5, `sharp` 0.35.4, `js-yaml` 4.3.2 — all patch or minor updates; `npm audit` reports none.
- [ ] **Deletion requests are recorded, not fulfilled.** `deletion_requests` rows appear on `/admin/retention`; the actual erase-and-anonymise process is not built.
- [x] ~~**`/admin/retention` has not been opened in a browser.**~~ Verified 2026-09-21 on the deployed site as a two-factor test admin.
- [ ] **Founder: set `RESEND_WEBHOOK_SECRET`** so delivered / bounced / complained reach the founder console. Steps in `docs/implementation/M08-M10-M14-STATUS.md` → Blockers.
- [ ] **Worker scheduling is capped at daily by the Vercel Hobby plan.** Request-triggered work runs immediately; only the safety-net sweep is daily. This becomes a real limitation when Batch 4 builds appointment reminders, which need to fire at a particular hour. Options and costs in `docs/implementation/M08-M10-M14-STATUS.md`.
