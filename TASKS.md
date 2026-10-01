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

---

## Batch 3 — Coaching Welcome & Expectations (2026-09-27) — complete

- [x] Coach draft, preview, publish; TalentYak section (admin at aal2); shown before purchase; version recorded with the purchase; publish/checkout race refused; personal copy with acknowledgement; revisions with what changed; existing clients labelled; conversation link card; update notices (decision register §P).
- [ ] **Founder: publish approved wording for TalentYak's section** before launch (`TY-EXP-05`). The test project carries test wording.
- [ ] **Policy links are hidden when the document is printed.** On paper they could appear as plain text (page names) instead. Small; unblocked any time.
- [ ] **The public site header shows "Log in" even when signed in** (seen during Batch 3 browser checks; predates this batch). Unblocked by checking how the marketing header reads the session.
- [ ] **The document's rendering safety is proven in the browser, not in unit tests** — Node's test runner cannot load JSX. A static test guards against raw-HTML rendering in the expectations code. Unblocked by a decision to add a JSX-capable test setup.
- [ ] **Confirm a signed-in checkout on the deployed test site reaches Stripe** after `34c5ada`. Verified locally only; the signed-in browser check on the live domain was blocked by local permission settings. Unblocked by the founder (or an allowed session) opening a test plan and pressing Continue.

---

## Batch 4 — M09 flexible scheduling (2026-09-27) — complete

- [x] Coach calendar and availability, client sessions, chat proposal cards, weekly series across clock changes, eligibility reconciliation, fixed-call allowances, one-off slot holds with late-payment recovery, admin exceptions, M08 notices (decision register §Q).
- [ ] **Founder: approve or change the scheduling timings** (`scheduling.v1`, TY-SCHED-05). They stay development defaults until then.
- [x] ~~Deployed worker lacked the new notice handlers~~ — closed by deploying `ab3f2ac`; verified live. Keep applying migrations and deploying together.
- [ ] **A real Stripe late payment for a lapsed one-off hold was simulated at database level**, not produced through Stripe (it needs a payment completed more than 35 minutes after checkout started). Unblocked by a test clock or a deliberately slow manual run.
- [ ] **Tentative sessions confirm on the five-minute sweep**, not the instant a renewal is paid. Acceptable; unblocked by calling `reconcile_appointments()` from the payment path if it matters.
- [x] ~~**Joining a session** (video/audio) is Batch 5~~ — built in Batch 5.


## Batch 5 — M10 private calls (2026-09-27)

- [x] Private per-session rooms at Daily, server-issued short-lived passes, call screen with device check, audio-only, waiting/reconnecting/leave/rejoin, room window with warnings, closing on every loss of access, attendance fetch, outcome corrections, client reports via support cases, notices.
- [ ] **Founder: add a payment method to the Daily account** (dashboard.daily.co → Billing). Daily refuses every meeting until then (`account-missing-payment-method`), so no two-person call has run yet. Then: run the live call checks listed in the checklist's Batch 5 section.
- [ ] **Founder: approve or change the call timings** (`calls.v1`, TY-CALL-04). Development defaults until then.
- [ ] **Daily has no spending cap** (TY-CALL-10). Consider a billing alert in the Daily dashboard once a card is on file; the app's own limits are two people per room, rooms only for their window, and pass limits.
- [ ] **Daily webhooks** need a paid Daily plan. The receiver is built and refuses everything until `DAILY_WEBHOOK_SECRET` is set; attendance comes from the after-call fetch meanwhile.
- [ ] **Physical phones not tested**: iOS Safari / Android Chrome camera switching, backgrounding, Bluetooth headsets. Needs real devices once calls can run.
- [ ] **Test hygiene (found in Batch 5):** `web/test/db/scheduling.db.test.ts` cleans up by deleting EVERY `email.appointment%` outbox row created in the last three hours, not only its own. In the shared test project that removed another journey's pending reminders. Scope the delete to the suite's own appointment ids.

---

## M11 — Coach-created programmes (2026-09-27) — complete

- [x] Workout and nutrition plans per client: templates copied into independent plans, drafts, preview, publish now or on a date, cancel before start, version history, Monday–Sunday week with rest days and in-order plans, one-week session moves, exercise details with alternatives, client training & food profile, M08 notices, M12 references (decision register §S).
- [ ] **Clients aren't prompted to fill in their training & food profile.** It is linked from their plan page and the coach is told when it's empty. Unblocked by adding a step after purchase or on first sign-in.
- [ ] **In-order plans can't show "next session"** — that needs recorded workouts (M12). They show the order instead.
- [ ] **Coaches can't move a client's session from their screens** (the database allows it; only the client's screen offers it). Add if coaches ask.
- [ ] **Renaming an exercise keeps its identity** (so progress continues). Replacing one with a different exercise should be done by removing it and adding a new one; the editor does not warn about this. Consider a hint in the editor.
- [ ] **Legacy page `/coach/clients/[bookingId]`** still uses the old `programs` tables for legacy bookings. Retire with the legacy booking path.
- [ ] **Deploy with the migration.** A plan notice queued before the new worker is live fails with "no handler" (test data only so far).

---

## M12 — Client logging and progress (2026-09-27) — complete

- [x] Workout logging from the plan (confirmed sets only, alternatives/substitutes/extras, load meaning, kg/lb, rest timer, backdating, corrections), reliable saving with device drafts, conflict choice and pause holding; body weight and measurements; dated private photos with comparison; food diary; progress and consistency; coach review and "useful to track"; gentle reminders (decision register §T).
- [ ] **Same-day coach handover.** Records are dated by the client's day, so on the day of a coach change a new coach on the "share nothing" choice doesn't see that day's entries (they appear from the next day). Errs on privacy; revisit if coaches notice.
- [ ] **Corrections while paused also wait.** Editing or deleting an existing workout, food entry or reading is held like new entries (TY-TRACK-06 read strictly). Relax for corrections if the founder wants.
- [ ] **Reminder send not verified live.** Logic and dedupe reviewed; watch the first evening's notifications after deploy.
- [ ] **Drafts on a shared device when a session simply expires.** They're separated by account and dropped after 30 days if already saved, but only cleared on an explicit sign-out.
- [ ] **Form review (AAF-PROG-08)** — clips with coach feedback on a set — is still unbuilt; `FULFILLMENT.formReview` stays not ready.
- [ ] **Charts are per date range, not paged.** Very long histories (hundreds of workouts) load the range in one read; add paging if it gets slow.

---

## M13 — Check-ins and coach feedback (2026-09-28) — complete

- [x] Coach templates (versioned; weekly starter), per-client schedules with explicit client timezone and optional reply time, pauses and planned breaks without backlog, client form with device drafts and duplicate-safe sending, period progress summary from M12 kept as sent, corrections with history and re-review, coach queue and review with dated feedback, next steps and plan/message links, notices through the outbox, coach-change hand-over or flag, and the **approved exception** to finish a review sent in paid time after it expires (decision register §U, TY-CHECKIN-02; `checkin_access.v1`).
- [ ] **Founder: approve or change the reminder timings** (`checkin_reminders.v1`, TY-CHECKIN-06). Development defaults until then.
- [ ] **Check-ins aren't a per-plan inclusion.** Any coach can schedule them for any paid client (OPEN-06 still open). Gate by plan if inclusions become first-class.
- [ ] **Attachments aren't checked against the question kind.** A client can attach a photo to the clip question (or the reverse); both are private check-in attachments. Tighten if it confuses coaches.
- [ ] **Flagged check-ins need a person.** The admin page lists them (metadata only); nobody is emailed when one appears. Add an admin alert if coach changes become common.
- [ ] **Reminder and review-due notices not verified by a live send.** Queue, dedupe and recheck are tested; watch the first real week after deploy.
- [ ] **The coach's feedback editor keeps the last published text** as the starting point for an update. Convenient, but a coach could republish unchanged text; consider clearing it.
- [ ] **Test hygiene:** the messaging suite's realtime signal test timed out once in this pass and passed on rerun (known timing sensitivity).

## M15 — Client and coach dashboards (2026-09-28) — complete

- [x] Client dashboard (`/account`): today's workout with Start/Continue, rest days and week links; to-do (payment pause, check-in due or draft, session suggestions to answer, unread per conversation); getting-started steps (never blocking); per relationship: next session with Join only when M10 would allow it, requests and cancellations, check-ins, messages, nutrition and today's food diary, 4-week progress by the coach's focus, plan and renewal, calls left where included; plan and expectations updates with dismiss; support routes (also while paused); earlier coaching. Coach dashboard (`/coach`): one filtered queue (check-ins, updated check-ins, form-check clips, unanswered messages, booking requests, plans) with snooze and "no reply needed"; today's sessions with call links; searchable clients with factual last activity and next item; plans; recent activity; capacity and availability shortcuts; earnings by currency. Role switch for coach-and-client accounts. Decision register §V.
- [ ] **Unread counts include system cards** (session and expectations cards in a conversation), exactly as the Messages screen counts them. Consider counting only people's messages in both places.
- [ ] **Form-check detection counts any video attached to a check-in**, not only one on the clip question (the check-in attachment kind isn't matched to the question; see M13).
- [ ] **Notifications inbox is shared** between a person's coach and client roles (existing behaviour); the dashboards themselves are separated.
- [ ] **Not verified live:** a signed-in journey on the deployed site, real phones and screen readers, and a payment pause through the real Stripe path (the walkthrough changed states directly; the real path also puts sessions on hold).
- [ ] **Test hygiene:** three synthetic walkthrough profiles remain on TEST, held by their append-only payment records (retired coaches, nothing public) — same as the scheduling suite's fixtures.

## M16 — Public launch website (2026-09-28) — complete (not publicly launchable yet)

- [x] Homepage (value → founding coaches → how coaching works → package benefits → questions → next action), "Start coaching" coach & package choices, coach profiles (availability, checked qualifications, experience, languages, approach, packages with renewal, cancellation and refund terms, coach's own published commitments), waitlist with double opt-in, withdraw and a founder page to send availability notices, checkout gating and revalidation, next steps after payment, package choice kept through sign-up and email confirmation, About with how coaches are selected and support contact, canonical URLs, social previews, sitemap with profiles, structured data without ratings, privacy-minimal page counts. Decision register §W.
- [ ] **Founder — launch blockers for the public site:** real founding coaches (see M16-STATUS "What's needed"), and a **separate production database** (the hosted project is shared with tests; the live-site guard hides test coaches but a shared database is not a launch setup).
- [ ] **Founder — blockers for purchases:** final reviewed terms and privacy notice; approve or change `discount.v1`, `billing_terms.v1`, `recognition.v1`, `payout.v1`, `eligibility.v1`; live Stripe keys and `LIVE_BILLING=true`; a payment method on the Daily account before packages with calls can be sold (calls are still marked not ready in `lib/fulfillment.ts`).
- [ ] **Founder:** confirm `SUPPORT_EMAIL` is set on the production deployment and monitored — the About page shows it as the pre-purchase contact.
- [ ] **Optional:** set `TEST_CHECKOUT_EMAILS` on production for named testers; administrators with a second factor can already test.
- [ ] **Test hygiene:** DB suites leave published fixture coaches; they are hidden on production by the guard, but suites should retire their coaches in `after()`.
- [ ] **Waitlist entries aren't expired automatically** (automatic deletion stays off). Unconfirmed entries stay until withdrawn; decide a retention rule in M17.


## M17 — Founder administration panel (2026-09-28) — complete (see M17-STATUS)

- [x] Founder panel with overview (date ranges, attention queue, people and money by currency, charts), search, accounts, support owners and notes, coach-change decisions, feature controls with history and restore, coaching operations, jobs, website & launch, policies & launch, change history; switches enforced from screen to database to jobs; client coach-change flow (off at launch); PostHog server-side (inactive until configured); password change; access and recovery guide (decision register §X).
- [ ] **Founder — decide OPEN-08's money half** (register §X1). Until then "Changing coach" can only be off or test accounts only.
- [ ] **Founder — PostHog**: create a free project (no card), then set `POSTHOG_PROJECT_KEY`, `POSTHOG_HOST` and `POSTHOG_APP_URL` on the production deployment; confirm the first events arrive. Nothing is collected until then.
- [ ] **Founder — Supabase dashboard account**: confirm it has two-step verification (it is the recovery route for the founder account).
- [ ] **Founder — add a second authenticator device** to the founder account.
- [ ] **Stripe fees aren't in the ledger.** The overview says "not recorded yet"; import `balance_transaction` fees as `processing_fee` entries if fee reporting is wanted.
- [ ] **Sign-ins are counted from M17 onwards** (earlier ones were never recorded).
- [ ] **The attention queue counts everything, test records included** (it's a to-do list, not a report). On the shared test database that means large numbers from old automated runs.
- [ ] **Test hygiene:** the M17 and workflow database suites change switches on the shared test project for a few seconds and restore them, recorded as "automated test" by a deleted test admin. Not a concern once production has its own database.
- [ ] **Emergency messaging off hides screens**; the database's own access rules still let the two participants read their messages through the API. Add a read gate if a real incident ever needs it.
- [ ] **Old tables still on the older look** (coaches, finance, payouts, scheduling, retention…): they work inside the new panel; restyle when next touched.

## M18 — Coach applications (2026-09-29) — built on branch `claude/bold-franklin-nukw4j` (see M18-STATUS)

- [x] "Become a coach" in the header and phone menu; public page without commercial terms; account-based application with draft, qualifications and private certificate files; receipt and decision emails (once each); status, correction, withdrawal and deletion; founder list with search and filters, detail with private certificates, checklist, notes, qualification checks and history; founder alerts; approval → sign the draft agreement (or decline) → coach in onboarding → existing final approval; "Accept coach applications" switch (register §Y).
- [ ] **Founder — decide how long closed applications are kept** (register §Y1). Proposed 12 months; nothing is deleted automatically until approved.
- [ ] **Founder — coach agreement**: legal review of the draft; decide the notice period and the Nepal payout route it lists as "still being confirmed".
- [ ] **Founder — run the database suite from the laptop**: `test/db/coach-applications.db.test.ts` (it skips in the cloud session, which has no database keys or network access to the database).
- [ ] **Not verified**: a signed-in click-through against the database (sign-up, application, founder review, signing), real email arriving, real phones and screen readers.
- [ ] **Changing email isn't possible anywhere in accounts yet**, so an applicant can't move their application to another address (they would apply from the other account). Add account email change (with fresh confirmation) if needed.
- [ ] **Deleting an account deletes its application rows but not certificate files** in storage (they become unreferenced private files). Add a cleanup to the account-deletion job.
- [ ] **Declined or withdrawn applicants can apply again immediately.** Add a waiting period if repeat applications become a problem.

## M18 (launch) — Launch readiness and error monitoring (2026-10-01) — complete (pilot and paid launch not yet ready; see M18-LAUNCH-READINESS)

- [x] Sentry error reporting (browser, server, edge) with in-process privacy filtering, no replay or tracing, environment and release tags, source maps only with a build token; operational failures (jobs, payment notifications, media, sweeps) raise alerts; scheduled-worker cron monitor; "Is everything running?" on Jobs & deliveries with protected test errors; real Stripe-hosted test checkout, duplicates and renewals verified; launch runbook and live-activation checklist.
- [x] ~~Founder checklist item 7: one test purchase through Stripe's hosted page.~~ Done 2026-10-01 with Stripe's test card; recorded by the deployed webhook.
- [ ] **Founder — connect Sentry** (`docs/operations/launch-runbook.md` §2), then press both test buttons and confirm the alert email. Until then nothing alerts on errors, a stopped schedule or a site outage.
- [ ] **Founder — uptime check.** Add one in Sentry (if the plan allows) for `https://www.talentyak.com/`. Nothing notices a full outage today.
- [ ] **No backups exist** (Supabase free plan) and files are never in database backups. Required before real customers: paid plan or nightly dump, bucket copies, one restore drill.
- [ ] **Vercel Hobby is non-commercial.** Move to Pro with a spend limit before taking payments.
- [ ] **Personal-data export has no button.** Handled by hand from the Supabase dashboard via a support case. Add a "Privacy request" support category (needs a constraint migration) if requests become common.
- [ ] **Checkout doesn't warn about an existing plan with the same coach** until Continue is pressed (the database refuses correctly). Show it on the page.
- [ ] **Leaked-password protection** is off in Supabase Auth (may need a paid plan).
- [ ] **Dev-only audit advisory** (`brace-expansion` via lint tooling). Production dependencies report 0.
