# TalentYak — Migration & Exit Runbook

**Written from the codebase at `master @ 2bb3d9f`, 2026-09-09. Updated 2026-09-19, after M03–M07 were built and applied to a real database.**

> Brand history: this project was Ghar Tira, then Aafnai, and is now TalentYak. Older names in paths, policy identifiers and historical documents are preserved deliberately.

Every vendor in this stack is replaceable, and this file is the proof. If a vendor raises prices, changes terms, blocks the account, or fails, this document is how we leave without losing customers, money records, or the tithi database.

**Rule:** a new vendor dependency is added to the stack inventory **in the same commit that introduces it**. An undocumented vendor is a hostage situation waiting to happen.

---

## 1. Stack inventory

| Concern | Vendor | Lock-in | Seam module | Honest exit cost |
|---|---|---|---|---|
| Framework / hosting | Next.js 16 on Vercel | **Medium** | — | The app is standard App Router; it runs on any Node host. What is Vercel-specific: `vercel.json` cron and Vercel's automatic `CRON_SECRET`. Replacing means an external scheduler. **Days.** |
| Database / auth / RLS | Supabase | **High** | `lib/supabase/{client,server,admin}.ts` | Postgres itself is portable — `pg_dump` and restore. What is not: `auth.users`, the `handle_new_user` trigger, `auth.uid()` inside every RLS policy, and every user's session. Moving auth means re-authenticating every user. **Weeks.** *Seam is partial: query builders appear directly in page components.* |
| Payments in | Stripe | **Highest** | `lib/checkout/service.ts`, `lib/payments/{stripe,webhook,billing}.ts` | Saved payment methods are not casually portable. Subscription billing anchors and grandfathered prices are the hard part. **Say this plainly rather than pretending otherwise.** Mitigation: every Stripe object ID is mirrored into our own tables and the pricing *logic* lives in our code, not in Stripe metadata. **Months, with customer friction.** |
| Payouts out | **None chosen** — transfers are made by hand and recorded | **Low** | `lib/payouts/` | No route to Nepal has been verified, so none is assumed. The system prepares batches, exports a masked CSV and records each transfer with its reference; `provider_payout_destinations.channel` is free text for exactly this reason. Switching to an API later is a new formatter. **Days.** |
| Email | Resend | **Low** | `lib/email/index.ts` | Templates are pure functions; one `send` call. Any SMTP or API provider substitutes. **Hours.** Domain reputation is the real cost. One coupling to undo: sends pass an idempotency key so a retry cannot deliver twice — a replacement provider needs an equivalent, or crash-after-send becomes a duplicate. |
| Object storage — private media | Supabase Storage | **Low–medium** | `lib/media/index.ts`, `lib/media/process.ts`, `components/media/uploader.tsx` | Bytes copy out with any S3 tool. What changes: the single-use upload token and the tus endpoint the browser uploads to. Authorisation stays in Postgres. **Days.** |
| Object storage — recordings | Cloudflare R2 | **Low** | `lib/recordings.ts` | S3-compatible; the AWS SDK is already the client. Change the endpoint and copy objects. **Days**, dominated by transfer time. Retained pandit vertical only. |
| Media processing | sharp 0.35 (images), `libheif-js` 1.23 (HEIC, WebAssembly), `ffmpeg-static` 5.3 → FFmpeg 6.0 (clips) | **Low** | `lib/media/process.ts`, `lib/media/heic.ts`, `lib/media/ffmpeg.ts` | All run inside our own functions. A dedicated worker or managed transcoder replaces `processVideo()` only. **Days.** |
| BS calendar | `nepali-date-converter` | **Low to replace, catastrophic to get wrong** | `verticals/pandit/tithi.ts` | See §5. |
| Video calls | **None yet** | — | — | Unbuilt. Daily is an unverified candidate. Keep the seam in `lib/calls/` from day one. |

**Two contradictions with `docs/HANDOVER.md` §7.1**, recorded rather than silently resolved: the handover specifies `nepali-calendar-engine` (code uses `nepali-date-converter`) and Payoneer (no Nepal route has been verified, and the system no longer assumes one).

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
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Declared in `.env.example` — **read nowhere in source**; checkout is Stripe-hosted, so the browser never needs it | — |

### Server-only (must never be `NEXT_PUBLIC_`)

| Variable | Purpose | Read at |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS. The most dangerous value in the system | `lib/env.ts` → `lib/supabase/admin.ts` |
| `STRIPE_SECRET_KEY` | Stripe API | `lib/env.ts` |
| `STRIPE_WEBHOOK_SECRET` | Signature verification | `lib/env.ts` |
| `RESEND_API_KEY` | Email send | `lib/env.ts` |
| `EMAIL_FROM` | Sender identity | `lib/env.ts` |
| `RESEND_WEBHOOK_SECRET` | Verifies Resend delivery events (Svix signature). Endpoint fails closed without it | `app/api/webhooks/resend/route.ts` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Object storage | `lib/recordings.ts` |
| `SUPPORT_EMAIL` | Reply address shown to customers; hidden until set | `lib/env.ts` |
| `CRON_SECRET` | Job-processor auth. **Required** — the endpoint refuses to run without it, compares in constant time, and prefers POST | `app/api/jobs/process/route.ts` |
| `LIVE_BILLING` | One of the four locks on real money. Necessary, never sufficient | `lib/policy/live-gate.ts` |
| `STRIPE_ACCOUNT_ID` | Optional. If set, the webhook refuses events from any other Stripe account | `lib/payments/webhook.ts` |
| `SUPABASE_ACCESS_TOKEN` | **Migrations only.** Never read at runtime; revoke when schema work is done | `scripts/apply-migrations.mjs` |
| `DAILY_API_KEY` | **Reserved, unread.** Video calls are unbuilt; Daily is still an unverified candidate (see §4). Nothing reads this yet | — |

**Guard status.** `lib/supabase/admin.ts` now carries all three mandated guards: `import "server-only"`, a runtime `window` check that throws, and its non-public variable name. The debt recorded here in the first version is closed.

---

## 4. Vendor-specific notes

**Stripe — where the exit genuinely hurts.** Saved payment methods can be migrated only through Stripe's own data-migration process, and it is not self-serve. Subscription billing anchors and grandfathered prices are worse: a customer on a locked signup price has that price expressed as a Stripe object, and recreating it elsewhere means recreating the billing relationship. *Mitigation already in place:* every Stripe object ID is mirrored into `payments` and `bookings`, and the split logic lives in `lib/payouts/`, never in Stripe metadata. *Mitigation still needed:* checkout currently builds inline `price_data` rather than using Stripe Price objects, so there is no durable product catalog on the Stripe side to reconcile against.

**Resend — what "sent" is allowed to mean.** `notification_deliveries` records `accepted`, `delivered`, `bounced`, `complained`, `failed` and `uncertain` as six different facts, and `SendResult` has no `sent` variant at all. Accepted means the provider took the message; it is **not** proof it arrived. `uncertain` exists for the honest case where we called the provider and never learned the outcome — a crash after the request left, which no provider can rule out. Any replacement must keep this vocabulary: collapsing it to "sent" would make the founder console state things nobody can know. Migration `0029` added the notification inbox on top of this; the delivery table itself predates it (`0018`).

**Supabase Storage — private media.** Photos and clips are in two private buckets (`media-uploads` holding area, `private-media` processed copies). Leaving means: re-pointing `lib/media/index.ts` and `lib/media/process.ts` at another object store, replacing the single-use upload token (`createSignedUploadUrl`) with that store's presigned equivalent, and pointing the browser uploader at a tus endpoint (or a multipart presigned flow). Row-level authorisation does not move with the bytes — it lives in Postgres and is unaffected. The 50 MB per-file ceiling is the current Supabase plan's, not ours; on a paid plan it is configurable.

**FFmpeg — where the ceiling is.** Clips are re-encoded inside our own serverless functions using `ffmpeg-static` (FFmpeg 6.0, libx264, AAC; ~45 MB binary, shipped only with the three processing routes). That is bounded by the function's CPU and time limit. If clip volume or length grows beyond what one function can encode in time, the replacement is a dedicated worker or a managed transcoding service; the interface to replace is `processVideo()`.

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

**The full, current procedure lives in `docs/operations/database-and-migrations.md`.** It is kept there because it changes with the schema; this section records only what must never be got wrong.

- **The test project must never become production.** The existing Supabase project is the test environment and holds synthetic accounts, coaches, purchases and Stripe test references. Production is a new, clean project built from `web/supabase/migrations/` — **30 files, applied in order**, nothing copied across.
- **Migration `0013` names the one email address that may ever claim the admin role.** Production needs its own; nothing promotes the first account to sign up.
- **Verify row-level security against the live instance, not by reading SQL.** `npm run test:db` does exactly this, as real signed-in users, before any real person has an account.
- **Storage buckets** come from migration `0022`: `coach-photos-pending` and `provider-evidence` private, `coach-photos` public. No storage policy is created on purpose — uploads go through the server, which re-encodes every image and strips EXIF.
- **Every server-only variable goes in the host**, never in the repository. `CRON_SECRET` is required; the job endpoint refuses to run without it.
- **The Stripe webhook signing secret is per endpoint.** A local or relay value means nothing to a deployed endpoint.
- **First backup taken and restored**, proving it works, before real customers exist.

---

## 8. Requirements for enabling live payments

Testing proceeds in **Stripe test mode**. This is what must be true before real money moves. The technical half is now built; the business half is not, and the code refuses to take real money until both are done.

### The four locks in the code

Enforced by `web/src/lib/policy/live-gate.ts`, checked on the server before any charge:

1. `LIVE_BILLING=true` in the server environment.
2. **Every commercial policy approved** — no policy in the active set still carrying `sandbox_default`.
3. **Final legal documents**, not drafts (`web/src/lib/legal.ts`).
4. **Everything a plan promises can actually be delivered** (`web/src/lib/fulfillment.ts`). Programmes, calls, check-ins, messaging, form review and progress tracking arrive in M09–M14.

Lock 4 cannot be opened by approving anything, and that is deliberate: selling a weekly call before calls exist takes real money for a promise the product cannot keep.

### Business and legal — still outstanding

1. **Legal entity and business bank account.** Stripe onboarding requires both.
2. **Confirm the contracting structure.** TalentYak is a contractor-delivered managed coaching service: the customer buys coaching from TalentYak, and the selected independent coach delivers it. This determines whether TalentYak is the merchant of record for the full amount. An intended structure is not legal validation — confirm with a qualified adviser.
3. **Written coach agreements** covering the 20% commission, the commission base, who bears transfer and conversion fees, payout timing, refund and dispute treatment, and independent-contractor status.
4. **Customer terms, privacy notice and a fitness waiver.** Health data and body media are collected. The documents in the product today are labelled drafts and hold lock 3 closed.
5. **Tax position** — whether tax is separately collected (the commission base excludes it) and any obligation in markets that open.
6. **A verified Nepal payout route**, including a real test transfer, before any coach is promised a payment date.

### Technical — built and exercised since this list was written

| Was missing | Now |
|---|---|
| Webhook idempotency across event types | Effects keyed by what they describe; replay, cross-event and crash-recovery all proven |
| Refunds reversing coach earnings | Compensating entries, proportional, taken from future earnings |
| Payment failure, cancellation and dispute handlers | All three, exercised with a Stripe test clock and dispute test card |
| Errors swallowed by the webhook | Failures mark the receipt failed, return 500 so Stripe retries, and a sweep re-fetches stuck events |
| Three ledgers conflated | Immutable `ledger_entries` separate from `earning_states` workflow |
| Payout export on `GET` | Same-origin, admin-only, audited `POST`; the old route is deleted |
| Payout math untested | Founder fixtures are tests; 196 unit and 95 database tests run |
| Rate limiting | Database-backed, on every abusable action |
| Security headers and CSP | Set in `next.config.ts`, nonce CSP in `proxy.ts` |
| Admin second factor | Required by `is_admin()` in the database itself |
| `CRON_SECRET` optional | Required; the endpoint refuses without it |
| Backups | **Still outstanding** — see §6 |

### Sequencing

Test mode is live today and needs none of the business items. **Live mode waits on all six business items and on M09–M14 existing**, whichever is later.

---

## Keep this true

- New vendor → new row, same commit.
- Vendor removed → row deleted, reason in `DEVLOG.md`.
- A seam module leaking vendor-specific types into application code is architectural debt; log it in `TASKS.md`.
- Review this file at every phase boundary. A stale exit plan is the same as no exit plan.
