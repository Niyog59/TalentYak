# Ghar Tira / Aafnai — Migration & Exit Runbook

**Written from the codebase at `master @ 2bb3d9f`, 2026-09-09.**

Every vendor in this stack is replaceable, and this file is the proof. If a vendor raises prices, changes terms, blocks the account, or fails, this document is how we leave without losing customers, money records, or the tithi database.

**Rule:** a new vendor dependency is added to the stack inventory **in the same commit that introduces it**. An undocumented vendor is a hostage situation waiting to happen.

---

## 1. Stack inventory

| Concern | Vendor | Lock-in | Seam module | Honest exit cost |
|---|---|---|---|---|
| Framework / hosting | Next.js 16 on Vercel | **Medium** | — | The app is standard App Router; it runs on any Node host. What is Vercel-specific: `vercel.json` cron and Vercel's automatic `CRON_SECRET`. Replacing means an external scheduler. **Days.** |
| Database / auth / RLS | Supabase | **High** | `lib/supabase/{client,server,admin}.ts` | Postgres itself is portable — `pg_dump` and restore. What is not: `auth.users`, the `handle_new_user` trigger, `auth.uid()` inside every RLS policy, and every user's session. Moving auth means re-authenticating every user. **Weeks.** *Seam is partial: query builders appear directly in page components.* |
| Payments in | Stripe | **Highest** | `lib/payments/{stripe,checkout,webhook}.ts` | Saved payment methods are not casually portable. Subscription billing anchors and grandfathered prices are the hard part. **Say this plainly rather than pretending otherwise.** Mitigation: every Stripe object ID is mirrored into our own tables and the pricing *logic* lives in our code, not in Stripe metadata. **Months, with customer friction.** |
| Payouts out | Payoneer (manual CSV) — **under review** | **Low** | `lib/payouts/index.ts` | Manual CSV export; switching providers is a new formatter. `providers.payout_channel` and `payout_reference` are already generic. **Days.** |
| Email | Resend | **Low** | `lib/email/index.ts` | Three HTML templates, one `send` call. Any SMTP or API provider substitutes. **Hours.** Domain reputation is the real cost. |
| Object storage | Cloudflare R2 | **Low** | `lib/recordings.ts` | S3-compatible; the AWS SDK is already the client. Change the endpoint and copy objects. **Days**, dominated by transfer time. |
| BS calendar | `nepali-date-converter` | **Low to replace, catastrophic to get wrong** | `verticals/pandit/tithi.ts` | See §5. |
| Video calls | **None yet** | — | — | Unbuilt. Daily is an unverified candidate. Keep the seam in `lib/calls/` from day one. |

**Two contradictions with `docs/HANDOVER.md` §7.1**, recorded rather than silently resolved: the handover specifies `nepali-calendar-engine` (code uses `nepali-date-converter`) and Payoneer (a Nepal route is now under review).

---

## 2. Exit procedure

Same shape for any vendor.

1. **Freeze.** Stop writes to the affected system. Announce a maintenance window if customers are live.
2. **Export.** Full data export in a format you can read without the vendor.
3. **Verify the export before touching anything live.** Restore it into a scratch environment and check row counts, referential integrity, and a sample of real records. *An export you have not restored is a hypothesis, not a backup.*
4. **Stand up the replacement.** New project, schema applied, RLS verified against the new instance.
5. **Run the full test suite against it.** Payout math and RLS especially. **Note: no test suite exists yet — this step is currently impossible, which is itself a reason to build one.**
6. **Re-point the seam module.** One `lib/*` file, ideally. If more than one file changes, the seam had leaked and that is worth logging to `TASKS.md`.
7. **Cut over.** DNS, env vars, webhook endpoints.
8. **Keep the old vendor read-only for 30 days.** Do not cancel on cutover day.
9. **Reconcile money records** before decommissioning anything financial. Customer payments, earned coach balances, and actual payouts must each tie out independently.

---

## 3. Environment variable inventory

`.env*` is gitignored at both the root and `web/`. `web/.env.example` documents every variable with no values. **A `NEXT_PUBLIC_` prefix on anything in the server-only column is a security incident, not a typo.**

### Client-safe (`NEXT_PUBLIC_`, shipped to the browser)

| Variable | Purpose | Read at |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `lib/env.ts` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key — RLS applies | `lib/env.ts` |
| `NEXT_PUBLIC_SITE_URL` | Absolute URLs for Stripe redirects | `lib/env.ts` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Declared in `.env.example` — **read nowhere in source** | — |

### Server-only (must never be `NEXT_PUBLIC_`)

| Variable | Purpose | Read at |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS. The most dangerous value in the system | `lib/env.ts` → `lib/supabase/admin.ts` |
| `STRIPE_SECRET_KEY` | Stripe API | `lib/env.ts` |
| `STRIPE_WEBHOOK_SECRET` | Signature verification | `lib/env.ts` |
| `RESEND_API_KEY` | Email send | `lib/env.ts` |
| `EMAIL_FROM` | Sender identity | `lib/env.ts` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Object storage | `lib/recordings.ts` |
| `CRON_SECRET` | Job-processor auth | `app/api/jobs/process/route.ts` — **⚠ absent from `.env.example`, and the guard fails OPEN when unset** |

**Guard status.** `lib/supabase/admin.ts` carries only one of the three mandated guards — the server-only env var name. It lacks `import "server-only"` and a runtime `window` check, unlike nine sibling lib modules that have them. This is open debt.

---

## 4. Vendor-specific notes

**Stripe — where the exit genuinely hurts.** Saved payment methods can be migrated only through Stripe's own data-migration process, and it is not self-serve. Subscription billing anchors and grandfathered prices are worse: a customer on a locked signup price has that price expressed as a Stripe object, and recreating it elsewhere means recreating the billing relationship. *Mitigation already in place:* every Stripe object ID is mirrored into `payments` and `bookings`, and the split logic lives in `lib/payouts/`, never in Stripe metadata. *Mitigation still needed:* checkout currently builds inline `price_data` rather than using Stripe Price objects, so there is no durable product catalog on the Stripe side to reconcile against.

**Supabase — auth is the anchor, not the data.** The Postgres data leaves cleanly. `auth.users`, the signup trigger, and `auth.uid()` in every RLS policy do not. Any migration re-authenticates every user.

**Payout route — undecided.** `providers.payout_channel` defaults to `'payoneer'`. Remitly Business is a candidate and is **unverified**: the exact business model, permitted use, Nepal recipient-route eligibility, fees, FX handling, and documentation requirements must all be confirmed against official current sources before it is specified. Nothing in this repository confirms the corridor works for this use case.

---

## 5. Correctness dependencies

The Bikram Sambat calendar library is trivial to replace and catastrophic to get wrong.

- **Pin the exact version. Never float.** Currently `nepali-date-converter@^3.4.0` — a caret, which violates this rule.
- Re-run a fixture suite of known-correct conversions before any upgrade. **No such suite exists.**
- Mitigating factor today: the library is used only for an admin display string (`todayInBs()`). It does **not** compute any date that reaches a customer — every ceremony date is human-confirmed (`ARCHITECTURE.md` §8). If that ever changes, this becomes the highest-risk dependency in the stack.

---

## 6. Backups

**Current state: there are none.** No automated backup, no off-site copy, no restore drill — and **no git remote**, so the source itself exists on one disk.

Required:

- Daily automated, off-site, encrypted, run in CI rather than from the app bundle.
- A retention ladder (daily for a month, weekly for a quarter, monthly for a year) and a dead-man's switch that alerts on a *missing* backup, not only a failed one.
- **A quarterly restore drill into a scratch database, with the result recorded in `DEVLOG.md`.**
- Decrypted backups contain grief, health, and contractor data in the clear. Treat a backup file as the most sensitive artifact the business owns. `.gitignore` already excludes `*.dump`, `*.sql.gz`, `*.enc`, and `backups/`.

---

## 7. Creating the production project

A literal checklist for 2am. **Not yet executed; no production environment is known to exist.**

1. Create the Supabase project. Record the region.
2. Apply migrations **in order**, `0001` through `0007`, then any later ones.
3. **Verify RLS against the live instance**, not by reading SQL: sign in as a customer and confirm another customer's booking is unreachable; as a coach and confirm an unassigned client is unreachable.
4. Create storage buckets with the correct visibility — **private**, plus a separate quarantine bucket (`ARCHITECTURE.md` §6).
5. Set every server-only env var in the host, never in the repository. Include `CRON_SECRET`.
6. Register the Stripe webhook endpoint and record its signing secret.
7. Seed the catalog. **No fake reviews, no invented providers, no fabricated counters.**
8. Promote one profile to `admin` and enable its second factor.
9. Run the first backup, then **restore it** to prove it works.
10. Record the date and the operator in `DEVLOG.md`.

---

## 8. Requirements for enabling live payments

Development and testing proceed with **mock payments**. This is the list that must be true before real money moves. Nothing here is satisfied today.

### Business and legal — must precede the rest

1. **Legal entity and business bank account.** Stripe onboarding requires both.
2. **Confirm the contracting structure.** Aafnai is a contractor-delivered managed coaching service: the customer buys coaching from Aafnai, and the selected independent coach delivers it. **This determines whether Stripe treats Aafnai as the merchant of record for the full amount.** It is an intended structure, not legal validation — confirm with a qualified adviser.
3. **Written coach agreements** covering the 70/30 and 60/40 rates, the commission base, who bears fees, monthly-in-arrears payout timing, refund and dispute treatment, and the coach's independent-contractor status.
4. **Customer terms, privacy policy, and a fitness waiver.** Health data and body media are being collected.
5. **Tax position.** Whether tax is separately collected — the commission base excludes it — and any UK/AU VAT/GST obligation if those markets open.
6. **Confirm the Nepal payout route** end to end, including a real test transfer, before promising any coach a payment date.

### Technical — each is confirmed missing today

7. **Webhook idempotency** that survives interrupted processing **and** deduplicates business effects across different event types. The current partial index on `stripe_payment_intent_id` does not cover renewals.
8. **Refunds reverse coach earnings** via a compensating entry. Currently they do not reverse at all.
9. **Handlers for payment failure, subscription cancellation, and dispute.** None exist.
10. **Payment insert errors surfaced, not swallowed.** The webhook currently returns `{received:true}` regardless, so Stripe never retries a lost payment.
11. **The three ledgers separated** — customer payments, earned coach balances, actual payouts — with immutable amounts and a separate payout workflow.
12. **Payout export moved off `GET`**, with confirmation and an idempotency key.
13. **Payout math tests** using the worked examples as fixtures: $100 monthly → $70/$30; $20 one-off → $12/$8; $510 six-month → $85 per service month at $59.50/$25.50. Required by `CLAUDE.md`; no test runner exists.
14. **Rate limiting** on booking creation and magic-link send.
15. **Security headers and CSP.** `next.config.ts` is currently empty of headers.
16. **Admin second factor.** Admin guards payout references and grief data.
17. **`CRON_SECRET` required rather than optional**, and added to `.env.example`.
18. **Backups running, with one restore proven.**

### Sequencing

Live payments are enabled **after** 1–6 are settled and 7–18 are built and verified. Test mode may be enabled as soon as an entity exists; **test mode is not gated on the legal items, and live mode is.**

---

## Keep this true

- New vendor → new row, same commit.
- Vendor removed → row deleted, reason in `DEVLOG.md`.
- A seam module leaking vendor-specific types into application code is architectural debt; log it in `TASKS.md`.
- Review this file at every phase boundary. A stale exit plan is the same as no exit plan.
