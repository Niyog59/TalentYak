# M17 — Founder administration panel

Scope: the founder brief (FM17, 2026-09-28). Migrations `0056_founder_admin.sql` → `0061_overview_test_activity.sql`, applied to the hosted TEST project. No new dependencies, no paid services. Decisions: `docs/aafnai/DECISION_REGISTER.md` §X. Operating guide: `docs/operations/founder-operating-guide.md`; access and recovery: `docs/operations/founder-access.md`.

## Built

- **Panel shell** (`components/admin/`): forest-green sidebar grouped by job (Today, People, Coaching, Money, Website, System, Older tools), a phone drawer, global search, and environment labels on every page (site, database, payments; a production site on the test database shows as a warning).
- **Overview** (`/admin`): Today / 7 / 30 days / custom range in the founder's timezone; attention queue (support, payments, payouts, coaching, technical) where an unreadable count says so; people figures (new accounts, distinct sign-ins counted from M17, paying now, past due now, cancellation requests versus coaching that actually ended, failed renewal attempts, test purchases left out); money by currency (collected, refunded, platform commission, coach earnings, fees "not recorded yet", payouts recorded, owed to coaches by state), never converted or summed across currencies, never called revenue; daily charts with a table view; live-payment blockers; features not fully on. All from `admin_overview_metrics` over payment and ledger records; test activity excluded unless asked.
- **Accounts** (list with filters and paging; detail with verification, onboarding, relationships, purchases, cases, history), client **suspension** through a recorded function (coaches through their workflow; administrators never), **test-account list** toggle.
- **Support**: owner, filters (state, owner), internal notes (admin-only), case history, links to the reporter, client, coach and purchase (identifiers only). Conversations still need the per-case grant.
- **Coach changes**: the client's reason and choices, eligibility of each coach, what applying touches (sessions, requests, series, check-ins, plans, part-finished earnings), sharing capped at the client's consent, confirmation, and the open money decision stated.
- **Feature controls** (`/admin/features`): eleven features with readiness (built / needs setup / not built, with blockers) separate from availability; per-feature modes with explanations, normal versus emergency marked; dependencies (bookings ↔ calls, new purchases → public profiles) and warnings; live impact counts; reason and confirmation; history with restore; test accounts; a "Not built" list.
- **Enforcement** at every layer: pages hide entry points and explain; actions and APIs recheck on every request; the database refuses (triggers on messages, uploads, booking requests, call passes, plans, templates, check-in schedules, checkouts, waitlist entries and coach-change requests; the tracking gate answers `logging_paused` and the device keeps entries); jobs skip (no message alerts when messaging is switched off, no log reminders while logging is paused, no new check-in requests). Calls switched off close open rooms.
- **Coach change for clients**: shown only when the switch allows; choose an eligible coach or ask TalentYak; choose what may be shared (with consent); what happens next; withdraw. Concurrency: row lock + one-open-request index; capacity rechecked under lock at confirmation.
- **Coaching operations**, **Jobs & deliveries**, **Website & launch** (who can buy and why, approved coaches and how they're shown, waitlist, welcome document, analytics), **Policies & launch** (safeguards, blockers, setup, open decisions, the policy register — view only), **Change history** (one timeline across the panel's log, switches, coach status, coach changes, refunds, payouts, support access, roles; append-only).
- **Change history for older actions**: invitations, capacity limits, payout-detail and photo reviews, qualification checks, exception updates, hold releases, job retries now write to the log.
- **Password change** while signed in (current password, second factor first); recovery documented.
- **PostHog**, server-side and anonymous, through the M16 counting point (no double counting), plus sign-up, sign-in and confirmed purchase (once per purchase); inactive until `POSTHOG_PROJECT_KEY` is set.

## Found and fixed during verification

- A client suspension from the panel reported success without suspending: the profile guard only lets the server key change suspension. Fixed with a named-action route (`0060`), the same pattern coach status uses.
- The overview counted money from old automated-test rows as real, because their test coaches' accounts had been deleted. "Real" now needs a live purchase, or an existing non-test coach (`0061`).
- Logging paused hid that a relationship was otherwise live, which would have closed check-ins too (`0057`).
- Small: a count chart showed a "0.5" tick; "On" was tagged "Stops new activity"; a change by a since-deleted account said "launch defaults".

## Verified

| Check | How | Result |
|---|---|---|
| Typecheck, lint, migration structure, unit tests | `npm run verify` | pass — **371** (new: switch rules and dependencies, analytics privacy filter and dedupe, report date ranges in a timezone, message alerts while messaging is off) |
| Production build | `npm run build` | pass |
| M17 database suite | `test/db/founder-admin.db.test.ts` on TEST | **9/9**: admin-only access (client, coach, admin without second factor, anonymous refused); append-only history (even the database owner); switch reason / stale screen / unsupported mode / unapproved policy refused, recorded, restored; messaging paused refused for an already-signed-in session, history readable, test-accounts-only; logging paused → `logging_paused`, readable; waitlist off refuses; coach change end to end (off, test only, eligible list, not someone else's, ineligible preference, simultaneous duplicates → exactly one, withdraw, capacity at confirmation, consent cap, former coach loses access, new coach sees agreed scope, new separate conversation, audited); support owner/notes/events admin-only; suspension path; overview per currency, test excluded by default, invalid range refused, search never finds notes |
| Full database suite | `npm run test:db` on TEST | **337/338** in one run; the one failure was the known timing-sensitive realtime signal test — the messaging suite then passed **29/29** on rerun |
| Walkthrough, local site against TEST, desktop 1366px and phone 375px | browser, throwaway `@example.test` accounts, removed afterwards | sign-in → two-step code required before `/admin`; overview (real-only says "no real payments, 311 test purchases left out"; include-test shows per-currency table, owed by state, daily charts with table view); all 29 panel pages 200 with no errors; no sideways scroll on phone; drawer menu; accounts list/detail; test-list add/remove; feature change refused without confirmation (entered text kept), applied with it; restore with "doesn't undo" note; client saw only the eligible coach, chose sharing + consent, request shown with withdraw; paused messaging showed a plain notice instead of the composer; founder applied the change (sharing capped at consent) → relationship moved to the new coach; everything in Change history; public pages still load; switches back to defaults; signed-out `/admin` → sign-in |

**Not re-run after the last small walkthrough fixes** (notice wording, history labels, "takes effect" defaulting to now, restore badge spacing): each was typechecked, but the final `npm run verify` + M17 suite rerun was stopped before completing. Run them first (see the handover).

## Not verified / needs you

- PostHog: not connected (no project key), so no event has been sent or seen in PostHog.
- A real email arriving, real phones and screen readers, and the deployed site signed in (not smoke-checked on the live domain for M17).
- OPEN-08 money decision (register §X1) — "Changing coach" stays off / test-only until then.
- A separate production database (still a launch blocker).

## Deployed — `0cf16cd`, www.talentyak.com

Checked 2026-09-29 from a cloud session on a fresh checkout of `main`.

| Check | Result |
|---|---|
| `npm ci` | pass — 438 packages, 0 vulnerabilities |
| `npm run build` | pass (Next.js 16.3.5; one font-fallback warning for Atkinson Hyperlegible Next, already present) |
| `npm run verify` | pass after the build — typecheck, lint, 63 migration files, **371/371** unit tests. On a fresh checkout it fails **before** the first build: `src/app/layout.tsx` uses `LayoutProps`, a route type Next generates during `next build` / `next dev` / `next typegen` into `.next/` (gitignored). Not an M17 regression and not a code fault; the laptop always had `.next/` |
| Vercel production deployment | **success** — GitHub commit status "Vercel: Deployment has completed" for `0cf16cd` (includes the M17 code from `8d1cb8b`) |
| Live-site smoke check (`/admin` redirect, public pages 200, sitemap, `/api/events` 204) | **not run** — the cloud session's network policy refuses connections to `www.talentyak.com` |
| M17 database suite (`test/db/founder-admin.db.test.ts`) | **not run** — no database credentials in the cloud session. The last recorded run is 9/9 before the final small walkthrough fixes |

Migrations `0056`–`0061` were applied to the hosted TEST project before the M17 push; nothing was applied or changed in this check. Still to do: the live-site smoke check and the M17 database suite rerun, from the founder's laptop or a session with that access.
