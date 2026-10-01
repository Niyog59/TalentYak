# M18 (launch) — Launch readiness, error monitoring and final integration

> Two pieces of work were both called M18. Coach applications (built in a separate session, 2026-09-29/30) is `M18-STATUS.md`; this file is launch readiness. Their migrations are `0062_coach_applications.sql` and `0062_scheduler_status.sql` — both applied under those exact names, so neither is renamed.

**2026-10-01.** One consolidated launch verification over M03–M17, plus error monitoring. Migration `0062_scheduler_status.sql` (read-only, admin-only), applied to the shared hosted project. New dependency: `@sentry/nextjs` 11.2.0 (requested). Next.js patched 16.3.5 → 16.3.8 for a critical advisory published since M17. Operating documents: `docs/operations/launch-runbook.md` (alerts, problems, rollback, backups, spending) and `docs/operations/live-activation.md` (pilot plan, live checklist).

## Verdicts

| | Verdict | Why |
|---|---|---|
| **Unpaid private pilot** (one real coach, one real client, test card) | **Not ready yet — close.** | The software side is ready. What's missing is one founder step each: a monitored support mailbox; Sentry connected; a Daily payment method, because **every call is refused today**; one real coach profile; and the shared-database decision (pilot items P1–P7). |
| **Paid launch** | **Not ready.** | Every live prerequisite is still open (L1–L12): final legal documents, unapproved policies, payout route, a separate production database with backups, Vercel plan, live Stripe configuration, and no real-device or real-person validation. A test payment does not establish live readiness. |

## Built in M18

- **Error reporting (Sentry)**, inactive until a DSN is set:
  - browser, server (Node) and edge, through Next's supported hooks (`src/instrumentation.ts`, `src/instrumentation-client.ts`, `onRequestError`), plus the page and root error screens;
  - environment (`production` / `preview` / `development`) and release (deployed commit);
  - source maps uploaded only with a build-time token, then deleted from the build — never served.
- **Privacy, two layers:**
  - the SDK is told to collect nothing about people or requests (`dataCollection` all off — SDK v11 collects cookies, headers, bodies and user info by default, and the old `sendDefaultPii` switch no longer controls them);
  - **every report is filtered in-process before sending** (`src/lib/monitoring/scrub.ts`): allowlisted fields only; free text redacted for emails, tokens, keys, card and phone numbers, private media links and query strings; console and typing breadcrumbs dropped; local variables dropped.
  - Replay, tracing, web vitals and visitor session pings are off (the pings asked Sentry to infer IP addresses).
  - No tunnel route: the SDK's tunnel forwards to any Sentry organisation (an open relay). Instead, the CSP allows exactly the DSN's host.
- **Operational failures raise alerts** without duplicating records (records stay in Jobs & deliveries):
  - a background job out of retries, or blocked;
  - a payment notification that couldn't be applied;
  - unexpected media-processing failure;
  - scheduled-sweep errors.

  Each report carries the kind of failure and a topic, never the payload, recipient or provider text.
- **Schedule monitor**: the 5-minute worker checks in to a Sentry cron monitor (production only), so a stopped schedule is noticed.
- **Founder panel → Jobs & deliveries → "Is everything running?"**:
  - when the scheduled worker was last called, and what the site answered (`admin_scheduler_status()`, from pg_cron and pg_net);
  - whether error reporting is on, with environment and release;
  - a link to Sentry;
  - **test buttons** for a server and a browser error (admin with two-step only, recorded in change history).
- Fixed: two unit tests had a date that expired on 1 Oct 2026 (`handlers.test.ts`).
- Journey tools:
  - `test/journey/buyer.ts` — a synthetic buyer for real test-mode checkouts;
  - `clock.mjs` now picks a plan and passes the welcome & expectations versions (it broke after 0040).

## Launch sheet — evidence

Legend:
- **Deployed** = checked against www.talentyak.com or its webhook.
- **Local→shared** = local production build against the shared hosted database and real Stripe test mode.
- **DB suite** = real signed-in users against the hosted database.
- **Earlier** = verified in an earlier module, with the code unchanged since.

| Area | Result | How |
|---|---|---|
| Unit, typecheck, lint, migration structure | **379/379** pass | `npm run verify` |
| Production build | pass, with and without Sentry settings; no `.map` files served | `next build` |
| Founder panel database suite (never rerun after M17's last fixes) | **9/9** | DB suite |
| Payments, access, private media, workflows | **138/138** | DB suite: paid-access, access-matrix, media, workflows |
| **Real Stripe-hosted test checkout** (founder checklist item 7, open since 2026-09-20) | **Pass.** One attempt → one active purchase → one relationship → one paid month, USD 100.00 → ledger **8000 coach / 2000 platform** (`commission.coaching.v3`); receipt job done; coach notice queued once; return page "You're in" | Local→shared; the **deployed** webhook recorded it (no local relay running) |
| Out-of-order notifications | Pass — Stripe delivered `invoice.paid` before `checkout.session.completed`; handled | Deployed webhook |
| Duplicate notifications | Pass — all four events replayed twice in reverse order → all `duplicate`; counts unchanged (1 purchase, 1 relationship, 1 month, 2 ledger rows, 1 receipt, 1 coach notice). A bad signature → 400 | Local webhook, real Stripe events |
| Second purchase of the same plan | Refused: "You already have an ongoing plan with this coach." | Local→shared |
| Successful renewal | Pass — month 2 paid, 2 more ledger rows | Stripe test clock, deployed webhook |
| Failed renewal | Pass — purchase `past_due`, month 3 `failed`, **no** ledger rows, one "payment failed" email; coaching continues in the paid month | Stripe test clock, deployed webhook |
| Pause after expiry, readable history, approved wording, recovery, suspension not overridden, the M13 check-in exception | Pass | DB suite (paid-access, today) + M12/M13/M15 walkthroughs (earlier) |
| Cancel at period end and resume; partial refund (coach and platform reversed in proportion); dispute; dispute before payment | Pass | Earlier (M06, real Stripe events); payment code unchanged since 2026-09-19 |
| Immediate cancellation in the Stripe dashboard | Ends coaching at once, even mid-month — by design of "subscription ended". Documented in the runbook: always cancel at period end | Observed during cleanup |
| Cross-client and cross-coach privacy; former coach loses access; forged media record refused; suspended users lose reach; feature switches enforced for already-open sessions | Pass | DB suites today (access-matrix, media, founder-admin) |
| Realtime removal on reassignment or suspension | Pass | Earlier (M14 messaging suite; unchanged) |
| Short-lived link limitation | A viewing link already issued keeps working until it expires (minutes); new links are refused at once after reassignment or suspension | Documented (M08) |
| Founder sign-in with two-step; panel; scheduler status; monitoring test | Pass | Local→shared, admin with a real TOTP challenge |
| Error reports contain no personal data | **Pass.** A local stand-in for Sentry received exactly what would be sent. Browser: one event, message "browser boom for [email] with [secret] card [number] [private-media-url]", `infer_ip: never`, no session, no tracing. Server: method, path, environment, release, tags only; no cookies, headers, body, user or IP | Local production build |
| Error reports arrive in a real Sentry with an alert | **Not verified** — no Sentry account | Founder (runbook §2) |
| Scheduled worker actually running | Pass — 288 scheduled calls in 24 h, all answered 200; jobs completing today | Deployed (pg_cron, pg_net) |
| Domain, HTTPS, redirects | Pass — apex → www 308; http → https 308; public pages 200; private pages → sign-in | Deployed |
| Latest production deployment | Success | GitHub commit status |
| Calls | **Blocked** — the join pass is issued (200), then Daily refuses the meeting (`account-missing-payment-method`); the client sees the honest "on TalentYak's side" message with message / rebook / report | Local→shared, Daily API |
| Security advisories | One error: `public_coach_directory` definer view — **by design** (M03, documented, public fields only). Warnings are known patterns; `auth_leaked_password_protection` is off (dashboard setting) | Supabase advisors |
| Customer error handling | Raw database text never reaches customers (mapped codes only — reviewed); pending vs saved states, device drafts, duplicate-safe retries, per-section dashboard failures, and the support route while paused | Earlier (M12, M13, M15); reviewed |

## Remaining blockers and owners

| # | Item | Owner | Next action |
|---|---|---|---|
| 1 | Sentry account (free, no card), DSN in Vercel, test errors seen, alert email received | Founder | `launch-runbook.md` §2 |
| 2 | Daily payment method; then one real two-person call on phones | Founder, then a session | Daily → Billing |
| 3 | `SUPPORT_EMAIL` set on production and monitored | Founder | Vercel env |
| 4 | Separate production database with backups, and a restore drill | Founder decision (new spending) | `live-activation.md` L5 |
| 5 | Real email round trip to a real inbox (confirmation, reset, receipt) | Founder | — |
| 6 | Real phone photo, clip and HEIC upload | Founder or pilot coach | — |
| 7 | Real founding coach profile | Founder + coach | M16 status "What's needed" |
| 8 | Unpaid pilot with one coach and one client | Founder | `live-activation.md` Part A |
| 9 | Legal documents; policies; payout route; countries; Vercel Pro; business GitHub; OPEN-08 | Founder | `live-activation.md` Part B |
| 10 | Vercel token (revoked) — needed only if an agent should set environment variables or read logs | Founder (optional) | — |
| 11 | PostHog project and keys | Founder | M17 handover |
| 12 | Supabase dashboard two-step; second authenticator device | Founder | M17 handover |

## Known limitations

- **No backups of any kind** today (free plan); file contents are never included in database backups.
- Personal-data **export** has no button; it's handled by hand from the Supabase dashboard (the panel can't read health records by design). Deletion requests are recorded in-app; the erase is manual; automatic deletion stays off.
- The scheduler panel only shows what pg_net keeps (about 6 hours of responses).
- A checkout page doesn't say "you already have this plan" until you press Continue.
- `npm audit` reports a high advisory in development-only lint tooling (`brace-expansion`); production dependencies: 0.
- Four synthetic profiles from today remain, held by their append-only payment records (retired coach, test addresses, hidden on production), as in M15.

## Intentionally disabled

- Live payments (gate closed).
- Customer coach changing (off).
- Automatic retention deletion.
- Automatic payouts and transfers (batches are prepared; the founder pays).
- Session replay and performance tracing.
- Daily webhooks (paid Daily plan).
- PostHog (no key).

## Not done, and why

- **Real people and real devices:** no pilot participants, phones or real inbox were available to this session. Nothing was simulated and called a pilot.
- **Restore drill:** there is no backup to restore and no isolated project. I didn't create a project without your go-ahead.
- **Deployed signed-in journeys:** checked against the shared database with a local production build. The deployed webhook and worker did take part.

## Deployed — `505eff0`, www.talentyak.com

Vercel production deployment: **success**.
- **Signed out:** `/`, `/coaches`, `/how-it-works`, `/waitlist`, `/become-a-coach`, `/sitemap.xml` and `/robots.txt` answer 200; `/admin`, `/admin/operations` and `/account` redirect to sign-in; `/api/events` answers 204.
- **Refusals:** the job endpoint refuses an unauthenticated call (401); the Stripe webhook refuses an unsigned request (400).
- **Source maps:** JavaScript chunks answer 200, their `.map` files 403.
- **Sentry not yet active:** the CSP `connect-src` has no Sentry host, consistent with no DSN set.
- **Scheduled worker:** the first run on the new code (23:45 UTC) answered 200.
- **Migration:** `0062_scheduler_status.sql` was applied before the push.

**Switch state after deploy:** everything on except **Changing coach (off)**. The coach-applications work from the other M18 session added **Accept coach applications — on**. So real people can apply to coach on the live site today, and their applications (including certificate files) are stored in the shared test database. That is the founder's call; see M18-STATUS.
