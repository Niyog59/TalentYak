# M03–M07 — status of record

**Written 2026-09-18 (UTC), amended 2026-09-20. This file replaces every earlier status note for this batch.** Where an older document, a checkpoint, or a chat summary disagrees with this file, this file is the one that was checked against the running system.

**What changed on 2026-09-20.** The batch was committed, pushed and deployed, and the four things this file listed as blocked are no longer blocked: email sends, Google sign-in works, the redirect configuration is correct, and a real Stripe test event reaches the deployed application. Struck-through lines below are kept rather than deleted, so the record shows what was true when it was written. No code changed on that date; the work was configuration and verification.

Each module below states five things, and nothing else is implied:

- **Built** — code that exists and compiles.
- **Tested here** — checks that were actually executed, with what they exercised.
- **Verified against real services** — what was proven against Supabase, Stripe or Resend as they are configured today.
- **Not done** — work inside this batch's scope that is not finished.
- **Blocked on** — what is waiting on somebody or something outside the code.

"Complete" is used only where the actions, the screens and the background worker for that module all exist and were exercised.

---

## How the checks below were run

| | |
|---|---|
| Date | 2026-09-17 → 2026-09-18 UTC |
| Environment | Local development server (`next dev`, port 3001) against the founder's **hosted Supabase project used as the test environment**, and **Stripe in test mode** |
| Database | 30 migrations applied; 67 tables in `public` |
| Commands | `npx tsc --noEmit`, `npx eslint src`, `npm test`, `TALENTYAK_DB_TESTS=confirmed npm run test:db`, `npx next build`, `node ../scripts/check-migrations.mjs`, `npm run db:migrate` |
| Results | typecheck clean · lint clean · **unit 196/196** · **database 95/95** · production build succeeds |
| Browser | Built-in browser pane, phone width (394px) and desktop width (1280px), driven as real signed-in people |
| Money | No real money moved. Stripe test mode only; `LIVE_BILLING` is off and the live gate refuses regardless |
| Email | No email was delivered to anybody. Test accounts use `@example.test`, which the worker refuses to send to and records as `sent: false, reason: reserved_test_address` |

Test accounts are synthetic, created for this run, and named `talentyak-test-…@example.test`.

---

## M03 — Shared domain model, permissions, safe migrations

**Status: complete in code and exercised against the real database.**

**Built.** 30 migrations, additive only, none edited after being applied (the runner refuses an edited migration by checksum). Identity and server-controlled roles, provider membership separate from login, public profile vs private vetting notes vs deny-all payout destinations, offers with immutable published versions and frozen prices, purchases with a full snapshot of what was bought, checkout attempts, subscriptions, billing cycles, enrolments with non-overlapping assignment history and a history-sharing scope, appointment and call-entitlement contracts for M09, an append-only ledger with effect keys, earning states, refunds, disputes, payout batches with evidence, reconciliation exceptions, a durable Stripe event receipt table, a transactional outbox, versioned intake, consents, retention contracts, and rate-limit counters.

**Tested here.** The access matrix is exercised as real signed-in users (anonymous visitor, customer A and B, assigned coach, unrelated coach, suspended coach, MFA'd admin), not through the privileged service key: 95 database tests, including concurrency (two simultaneous checkouts cannot oversell a coach's capacity), historical price preservation, role-escalation attempts, immutability of published versions and of ledger rows, and direct-manipulation attempts that bypass the screens.

**Verified against real services.** All migrations applied to the hosted project; RLS verified with the anonymous key and with real user sessions.

**Against §6 of the brief, point by point:**

| Requirement | State |
|---|---|
| Model boundaries (identity, provider, offer/version/price, purchase/checkout/subscription/cycle/enrolment, assignment history, appointment + call entitlement, payment/refund/dispute/ledger/payout/reconciliation, event receipt + outbox, intake/consent/retention) | Done |
| Money in integer minor units, currency precision, decimal-safe parsing, overflow checks, deterministic remainder allocation | Done — `web/src/lib/money/`, proven by fixtures from the decision register |
| Purchase snapshots price, currency, version, provider, inclusions, term, renewal rule and policy versions | Done — verified on a real purchase in this run |
| Separate payment / access / appointment / approval / publication / payout states with documented writers | Done — see `docs/operations/payments-and-payouts.md` |
| IANA timezones, instants in UTC | Done — a stored legacy spelling is now normalised (Asia/Katmandu → Asia/Kathmandu) |
| Uniqueness, financial effect uniqueness, non-overlapping assignments, capacity invariants | Done — effect keys proven to stop double counting in this run |
| Indexes, stable ordering, structured errors, idempotency keys, optimistic concurrency | Done — optimistic concurrency on profile and offer drafts |
| Vertical-specific sensitive fields out of generic JSON | Done — pandit grief keys moved to `protected_intake` with counts reconciled (migration 0021) |
| Access matrix enforced in server actions **and** RLS | Done |
| Anonymous sees only published public fields | Done — and a leak found and fixed in this batch (below) |
| Admin capability-limited and MFA-protected | Done — `is_admin()` requires a completed second factor in the database itself, not only in the UI |
| Hidden verticals unreachable by direct request | Done — checked at the database and again in the checkout service |
| New tables get RLS in the same migration | Done — enforced by `scripts/check-migrations.mjs` |

**Two security defects were found and fixed during this batch**, both in code written earlier in the batch, both proven with tests that now run every time:

1. `coach_balances` was a view that ran with its owner's privileges, so **any visitor, signed in or not, could read every coach's earnings totals**. Fixed in migration 0025 (`security_invoker`, access revoked from anonymous). Only synthetic data existed. The migration checker now fails any view that does not either run as the caller or carry a written justification.
2. `in_action()` returned NULL on a fresh pooled connection, which made three guard clauses evaluate to NULL and pass intermittently — a coach could have published, self-approved or changed capacity by writing to the database directly. Fixed in migration 0023, with eight fresh-session regression tests.

**Not done.** Nothing in M03 scope.

**Blocked on.** Nothing.

---

## M04 — Accounts, authentication, onboarding

**Status: complete in code; exercised end to end except the two items named under "blocked on".**

**Built.** Email/password sign-up and sign-in, email confirmation, password reset, magic link, sign-out and sign-out-everywhere, Google sign-in (button and callback, scopes limited to `openid email profile`), onboarding that records name, timezone, display currency and the consents, session expiry and suspension handling, second-factor enrolment/challenge/removal with admin lock-out protection, a secure first-admin claim tied to one recorded email address and a confirmed address, coach invitations (random token, only its hash stored, tied to one email address, expiring, revocable) with an acceptance page, and legacy guest-booking claiming that only ever matches a verified address.

**Tested here.** Sign-in refusal messages are neutral (they do not reveal whether an account exists). Invitation acceptance was driven in the browser: the page reveals nothing until you are signed in, onboarding is required first, and accepting turns the account into a coach account with a public address derived from the person's name.

**Verified against real services.** Against the real Supabase auth server: password sign-in, TOTP enrolment and verification, session assurance levels (a second factor really does change what the database allows), and admin screens refusing a session that has not completed its second factor.

**Not done.** Nothing in scope.

**Blocked on.**
- ~~Google sign-in is not enabled in the Supabase project.~~ **Resolved 2026-09-20.** The provider is enabled, the authorisation handoff to Google was verified, and the button is live on sign-in and sign-up.
- ~~Supabase's redirect allowlist does not include `talentyak.com`.~~ **Resolved 2026-09-20.** The allowlist carries `https://www.talentyak.com/**` and the Site URL was corrected from `http://localhost:3000`, which had been silently breaking every link an auth email would have carried.
- Password sign-in was exercised through the API rather than typed into the browser form in this session, because I do not type credentials into forms. The form itself was checked earlier in the batch with a deliberately wrong password (refused neutrally) and a correct one (signed in).

---

## M05 — Coach profiles, offers, currencies, capacity

**Status: complete in code and exercised end to end.**

**Built.** Coach profile editor with optimistic concurrency, photo upload (magic-byte check, re-encoded server-side, EXIF stripped, private pending bucket, admin approval before it becomes public), submit-for-review, publish/hide, capacity and accepting-new-clients, plan builder (drafts, inclusions, per-currency prices with each currency's minimum, an exact preview of the coach's 80%, publish with confirmation, new version from a published one, discard draft, pause, resume, archive, version history), public coach directory and public coach page, and the founder's review console.

**Tested here, in the browser, as the real people:** an unapproved coach cannot publish (the option says so, and the database refuses independently); an approved coach publishes their own plan at their own price with no founder involvement; a published version cannot be edited — changing it creates a new version, and the old one is kept for the customers on it; a price with too many decimal places is refused; a price below what card payments allow is refused; the founder's "return for changes" is refused without a reason; approval is recorded with who and when.

**Verified against real services.** Profile, plan, price and capacity writes against the hosted database as the signed-in coach. EXIF stripping is proven by a unit test that builds a JPEG carrying metadata and asserts the stored copy has none.

**Not done.**
- Photo upload was exercised through its unit tests, not through the browser file picker (my browser tooling cannot attach a file here).
- Coach credentials can be recorded and reviewed in the database and are listed in the console, but there is no coach-facing screen for uploading credential evidence yet.

**Blocked on.** Nothing.

---

## M06 — Checkout and subscription lifecycle

**Status: complete in code; the money path is proven in Stripe test mode, with one step that only a human can finish.**

**Built.** A checkout service that derives everything from the database (offer version, price, currency, billing interval, coach availability, capacity) and accepts only an identifier and a currency from the browser; idempotent checkout attempts; Stripe-hosted payment; a capacity hold that is released immediately if Stripe fails; a return page that grants nothing by itself; the webhook as the only writer of payment truth, with signature verification, receipts, leases, authoritative re-fetch from Stripe, and effects keyed by what they describe; renewal, failed payment, cancellation and resumption; a restricted Stripe Billing Portal (invoices and card updates only); admin refunds; disputes; abandoned-checkout cleanup; and a live gate that refuses real money unless the environment flag, every commercial policy, the legal documents **and** the ability to deliver what the plan promises are all in place.

**Tested here and against Stripe test mode, in this run:**

| Check | Result |
|---|---|
| Real checkout in the browser | Redirects to Stripe's hosted page showing "Subscribe to Monthly strength coaching — $80.00" |
| Payment completed (Stripe test token, no card typed anywhere) | Purchase `active`, enrolment created, capacity hold converted, cycle `paid`, subscription `active` |
| Ledger | Coach `$64.00` pending, TalentYak `$16.00` — commission rounded first, coach takes the remainder |
| Same event delivered again | `duplicate`, nothing counted twice |
| Two different Stripe events describing the same payment | Same single set of ledger rows |
| Event with a tampered signature | Rejected, HTTP 400 |
| Crash in the middle of processing (simulated) | The scheduled sweep re-fetched the event from Stripe and finished it; still exactly one set of ledger rows |
| Renewal (Stripe test clock, one month forward) | Second billing period recorded, paid-through advanced, second month's earnings recorded separately |
| Renewal payment declined | Purchase `past_due`, that period `failed`, **no earnings recorded for it**, paid-through unchanged |
| Cancel at period end, then resume | Both applied at Stripe and read back from Stripe |
| Partial refund ($20 of $80) | Coach reversed $16, TalentYak reversed $4, taken from future earnings; three separate Stripe events for it did not duplicate anything |
| Card dispute | Dispute recorded, the coach's unpaid earnings on that purchase held |
| Notifications | Queued and processed; recorded truthfully as not sent, because the addresses are reserved test addresses |

**How Stripe events reached the local app.** There is no public URL yet and the Stripe CLI is not installed here, so `scripts/stripe-event-relay.mjs` reads **real events from the Stripe test account**, signs them the way Stripe signs a webhook, and delivers them to the local endpoint. This proves the signature check, the receipt and lease handling, the re-fetch and the database effects. It does **not** prove that Stripe can reach a deployed URL, or that a deployed endpoint's signing secret is right — those are checked once the app is deployed (founder checklist item 6).

**Not done.**
- **One human step is deliberately unfinished:** completing a payment on Stripe's hosted page requires typing card details, which I do not do. The payment in this run was completed through Stripe's test API instead, with the same metadata the hosted page carries, so everything after the payment is the real path. The founder should complete one test purchase by hand (founder checklist item 7).
- The out-of-order case found during this run — a dispute arriving **before** the payment it refers to — was being dropped silently. It now records a reconciliation exception and retries; that fix is proven by re-delivering the event.

**Blocked on.** Real payments remain refused by design until the policies are approved, the legal documents are final, and the things plans promise (programmes, calls, check-ins, messaging, form review, progress tracking) are actually built in M09–M14.

---

## M07 — Earnings, ledger, reconciliation, payouts

**Status: complete in code and exercised end to end, using one clearly labelled fixture (explained below).**

**Built.** Coach earnings with balances per state and per currency, activity, a CSV statement of their own rows; a founder finance page (reconciliation exceptions with recorded resolutions, purchases needing review, open disputes, held earnings with release, failed and blocked background jobs with a retry, unprocessed Stripe events); payout batch preparation that claims eligible earnings transactionally and states why anyone was held back; CSV export as an authorised POST (never a GET) carrying masked references; per-payout reveal of the full reference, logged; recording a payout as paid with a reference, a time and evidence; failures and returned payouts; manual adjustments; and customer-requested coach changes with assignment history and future-period attribution.

**Tested here, in the browser:** the coach added payout details behind a second factor (the details are shown masked afterwards); the founder checked them; a batch was prepared — `$128.00 to 2 coaches`, with the coaches who owe more than they have earned held back and the reason given for each; the CSV export refused a GET (405), refused a cross-site POST and a signed-out POST (403), and on an authorised POST returned masked references with every row marked `NOT PAID` while the batch moved to `exported` and no coach moved to `paid`; the batch was marked sent; one reference was revealed (recorded in the audit trail); the payout was recorded as paid with its reference and evidence; the coach's earnings page then showed `$48.00` paid, `$192.00` held by the dispute, `$64.00` pending, and the refund as `−$16.00`.

**The fixture, stated plainly.** Earnings only become payable once the coaching period they paid for has ended, and a Stripe test clock moves Stripe's clock, not the database's. So one payment with an already-finished period was recorded through the application's own function, with the same 20% split, and marked in its source key as `fixture:payout-journey:…`. There is no Stripe payment behind that one row. It exists so the payout screens could be exercised; it is not evidence that anybody paid anything.

**Not done.** Nothing in scope.

**Blocked on.** **No payout route to Nepal has been verified.** The system never moves money itself: the founder makes each transfer in whatever service they choose and records it here with its reference. Remitly, Payoneer and Stripe Connect are **not** assumed to work for this (founder checklist item 9).

---

## Supporting work in this batch (M08 foundations, branding, PWA)

**Built and exercised.** A transactional outbox with atomic claiming, deduplication, retries with backoff, leases, recovery and a blocked state; a scheduled endpoint that refuses to run without its secret (401 without, 401 with a wrong one, 200 with the right one) and which also expires abandoned checkouts, recognises delivered periods, ends lapsed enrolments and recovers stuck Stripe events; email templates that escape everything a person wrote; delivery recorded as "accepted by the sending service", never as "delivered"; the TalentYak logo pack in place, app icons, manifest and offline-capable groundwork.

**Found and fixed during this run:** jobs were being stamped with the application server's clock, which ran slightly ahead of the database's, so the immediate post-response worker pass considered them not yet due and they waited for the scheduled sweep. The database now decides when a job is due.

**Not done.** Retention notices exist as contracts with destructive execution switched off — deliberately, and it stays off in this batch.

**Blocked on.** ~~Resend's sending domain is not verified and `EMAIL_FROM` is empty.~~ **Resolved 2026-09-20.** The domain is verified, `EMAIL_FROM` is set, and a job queued into the outbox was carried all the way out by the *deployed* worker: `state=done`, `sent=true`, delivery row `accepted` with a provider message id. Supabase Auth's own SMTP was pointed at Resend separately on the same day.

---

## Known limitations, stated plainly

1. ~~No email can be delivered yet.~~ **Resolved 2026-09-20.** App email and Supabase Auth email both send through Resend. `SUPPORT_EMAIL` is still empty, so outgoing mail carries no reply address.
2. ~~Google sign-in cannot succeed yet.~~ **Resolved 2026-09-20.**
3. ~~Nothing is deployed.~~ **Resolved 2026-09-20.** `https://www.talentyak.com` serves the app from Vercel, the apex redirects to www, and Stripe's test webhook delivers there: a payment event created at the API reached the deployed endpoint in three seconds, its signature was verified, and — matching no checkout of ours — it was recorded `ignored` rather than invented into the ledger.
4. **Live payments are refused** by the gate, which needs approved policies, final legal documents, and deliverable promises.
5. **The test project holds synthetic data** from this batch's tests, including coaches and purchases. Production must be a separate, clean project, recreated from `supabase/migrations/` (see `docs/operations/database-and-migrations.md`).
6. **The keyboard `Enter` key could not be confirmed** as submitting a form through my browser automation; the forms are ordinary forms with a submit button, which browsers submit on Enter, but this was not proven with a real keypress.
7. **A coach's credential evidence has no upload screen yet**, only database support and the founder's review view.
8. **Three access tokens are still live and should be revoked** (founder checklist item 5): the Supabase database token in `web/.env.local`, a Vercel token in `~/.talentyak-vercel-token`, and a Supabase personal access token in `~/.talentyak-supabase-pat`. Nothing in the running application uses any of them.
