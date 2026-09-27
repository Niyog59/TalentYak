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

- [x] ~~**In-app messaging** — gated on `OPEN-06`.~~ Built in M14 (2026-09-22) on the founder's full-scope prompt, which is treated as the decision on `OPEN-06`; the unbuilt "direct messaging" catalog claim was already removed. **Recording that decision in `docs/aafnai/DECISION_REGISTER.md` is a founder action, listed under Open below.**
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
- [x] ~~**Founder: set `RESEND_WEBHOOK_SECRET`.**~~ Done 2026-09-21; a test email moved from accepted to delivered on the live site.
- [x] ~~**Worker scheduling is capped at daily by the Vercel Hobby plan.**~~ Resolved 2026-09-22 at no cost: Supabase Cron (`pg_cron` + `pg_net`, migration `0038`) calls the same protected endpoint every five minutes, with the bearer secret in Supabase Vault. Two scheduled runs verified on the live project. Batch 4 reminders now depend only on a producer, not on the schedule.

### M14 — private messaging (2026-09-22)

- [x] ~~**`messaging.v1` is a sandbox default, not an approved policy.**~~ Approved 2026-09-22 as `messaging.v2` (decision register §N), together with `cancellation.v2` and `payment_failure.v2`. The paused-conversation wording is now the founder's own: *"Your payment didn't go through. Renew to continue coaching. Your progress is saved."*
- [ ] **Typing indicators not built.** The M14 prompt left them optional and they were skipped: they need a second realtime channel carrying per-keystroke state, and they imply a presence signal the product deliberately does not show. Unblocked by a founder request.
- [ ] **Conversation privacy wording is not legal copy.** The screen states plainly that messages are not end-to-end encrypted, that support can read a conversation only under a logged, expiring, per-case grant, and that anything already downloaded cannot be recalled. `legal/privacy` has not been updated to match. Unblocked by a privacy-policy review.
- [ ] **The database workflows test suite leaves its accounts behind.** Nine `talentyak-test-wf-…` profiles remained after a full run on 2026-09-22 (35 older ones predate this batch). Unlike the outbox issue resolved on 2026-09-21, this is fixture teardown, not production behaviour. Unblocked by adding teardown to `test/db/workflows.db.test.ts`.
- [ ] **Read receipts depend on the browser reporting honestly.** The rule "read means it was on screen in a visible tab" is enforced by the screen, not the database — the database only refuses to move a marker backwards. A modified client could mark messages read without showing them. Accepted: the failure mode harms only the person doing it.
- [ ] **`f21e08c` carries a `Co-Authored-By` trailer**, contrary to CLAUDE.md's rule against tool references in commits. Not amended because the commit is pushed; unblocked by a founder decision to rewrite that history.

### Paid access — approved rules (2026-09-22)

- [ ] **Bookings do not yet call `coaching_is_live()`.** The rule ("no new bookings while a renewal has failed past the paid period") is enforced for messages and coach-side coaching work, and the shared check exists — but the appointment module that would call it is Batch 4. Unblocked by building it; it must call the function rather than re-deriving the rule.
- [ ] **"Coaching activity" was read as coach-side work.** While paused, the coach cannot add programming and neither side can message, but the customer can still write their own records (their weight log, their own data). Recorded as TY-ACCESS-06; unblocked by the founder correcting it if that reading is wrong.
- [ ] **The pause is not announced.** A customer sees the approved wording when they open the app, their account page or a conversation; no email is sent when a relationship pauses. The notification machinery exists (`email.payment_failed` already fires on the failed charge). Unblocked by a decision on whether a second message at the pause point helps or nags.
- [ ] **Five policies still await approval**, and live billing stays refused until they are settled: fee presentation and FX/dispute allocation, prepaid-term enablement, earnings recognition and hold, payout cutoff and negative balances, customer countries and payout corridors.
- [x] ~~**Supabase personal access token is rejected (401) as of 2026-09-24.**~~ Replaced by the founder 2026-09-25; the management connection works again and all 41 database changes are confirmed applied with fingerprints matching the code. The full database suite was rerun; its one failure is recorded and resolved below.

### Working agreements (2026-09-25)

- [x] **Plain-language reporting approved** as the founder's policy (decision register §O, `TY-REPORT-01` … `06`). Applies to every agent from now: what happened, how it affects users, a recommendation, whether the founder must act — with technical detail kept in the development notes.
- [x] ~~**Add a one-line pointer to §O in the project instructions file.**~~ Added 2026-09-25 with the founder's go-ahead, under the standing rules every agent reads first.
- [x] ~~**Live new-message alerts no longer reach signed-in people (found 2026-09-25).**~~ Resolved 2026-09-26. The next day alerts arrived in under half a second and could not be made to fail again; the cause could not be confirmed (the platform's own logs were not reachable through the API), and the evidence points to a temporary fault in the hosting provider's live-update service. Two real weaknesses it exposed were fixed: the screen now notices when live alerts go quiet without the connection saying so, stops claiming "Up to date", checks every 20 seconds, and recovers by itself when alerts return (verified in a browser by silently blocking alerts); and the realtime tests now confirm their own message was sent, wait with a deadline instead of a fixed pause, and prove delivery works for an active participant before treating a suspended one's silence as meaningful.

