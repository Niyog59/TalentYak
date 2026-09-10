# Aafnai — Codebase Reconciliation

**Module:** M00 · **Inspected:** `master @ 2bb3d9f89f9588076d958def8f0bb444ef54f26f`, working tree clean.

Maps each relevant audit finding and each new M00 requirement to **current, re-verified source**, a disposition, an owning module, dependencies, data-preservation considerations, an acceptance scenario, and the decision that gates it.

## Method and honesty boundary

- Every `SRC` citation below was **re-verified in this session** against the working tree. The 2026-09-09 audit was used as a starting list, not as evidence.
- **All findings are from source inspection only.** No build, type-check, install, migration, database query, integration call, or browser test was run in this session. **No claim below asserts runtime behaviour.**
- Where this reconciliation **contradicts the earlier audit**, it says so explicitly — see §3, which corrects the audit's remedies for R-11, R-15/R-16, R-28/R-31, R-39, and R-48.

## Disposition vocabulary

| Disposition | Meaning |
|---|---|
| **KEEP** | Sound as built; carry forward |
| **REPAIR** | Right shape, defective detail |
| **REPLACE** | Wrong shape for the confirmed requirements |
| **NEW** | Nothing exists; greenfield |
| **DEFER** | Real, but not needed for the first product |

## Module map

M00 product contract · M01 baseline/safety · M02 design · M03 shared domain/migrations · M04 auth · M05 coach profiles/plans/currencies/capacity · M06 payments · M07 earnings/payouts · M08 jobs/email/private media · M09 scheduling · M10 calls · M11 programmes · M12 logging/progress · M13 check-ins · M14 messaging · M15 dashboards · M16 public journeys · M17 operations · M18 integrated QA/release

---

## 1. What the confirmed decisions change structurally

Four M00 decisions change the shape of the system, not merely its contents. Everything in §2 follows from these.

### 1.1 Coach-created plans invert the catalog — **the single largest structural change**

**Current state (verified).** `services` is a **platform-global catalog table**: `id text primary key` as a hand-written slug, `vertical_slug`, `price_cents`, `status` (`SRC web/supabase/migrations/0002_catalog.sql:19-36`). **There is no provider or coach foreign key on `services`.** Confirmed by exhaustive grep: `provider_id` / `coach_provider_id` appear on `bookings`, `payout_ledger`, `ceremonies`, and `programs` — never on `services`.

Prices are additionally hard-coded in three places that can drift: `SRC web/src/verticals/fitness/catalog.ts:23,38,54`, `SRC web/src/verticals/pandit/catalog.ts`, and `SRC web/supabase/seed.sql`.

**Consequence.** A coach cannot own a plan. AAF-PLAN-01 is not a feature addition to the catalog — it **inverts its ownership model**, from *platform defines N services* to *each coach defines their own plans*.

**Knock-on effects by module:**

| Module | Effect |
|---|---|
| **M03** | Plans need a coach owner, immutable versions, and a structured entitlement record. `services` cannot carry this. |
| **M05** | The plan builder becomes a primary coach surface. It does not exist in any form. |
| **M06** | Checkout must charge *a specific coach's plan version* and freeze its terms (AAF-DATA-02). Current checkout builds inline `price_data` from a global service (`SRC web/src/lib/payments/checkout.ts:23-46`). |
| **M09** | Call entitlement derives from the purchased plan version, not from a global tier. |
| **M15** | The coach dashboard gains plan management and earnings; the client dashboard must render the frozen plan version, not the coach's current plan. |
| **M16** | The client must choose a coach and their plan **before paying** — confirmed by AAF-FLOW-01 on 2026-09-09. `docs/HANDOVER.md` §6.5 amended; the 48-hour board becomes an exception tool |

### 1.2 The coach is known at purchase, not assigned afterward — **CONFIRMED 2026-09-09**

**Current state (verified).** `bookings.provider_id` is nullable and assigned later by an admin dropdown (`SRC web/supabase/migrations/0003_bookings.sql:24`; `SRC web/src/lib/bookings/actions.ts:157-178`). The whole flow assumes intake → founder matches within 48h (`SRC web/src/app/admin/fitness/page.tsx:30-33`).

**Decided (AAF-FLOW-01, AAF-FLOW-02).** The client selects their coach and plan — seeing qualifications, price, inclusions, and **compatible availability** — **before being charged**, and the system **confirms the coach can accept this customer before collecting payment**. `docs/HANDOVER.md` §6.5 has been amended.

**Consequence.** The 48-hour matching board becomes an exception tool for unassigned edge cases and transfers, not the main flow. `bookings.provider_id` (or its successor) should be **non-null at creation** for coaching purchases. **This is a product-model change, not a bug fix.**

### 1.5 Three ledgers, and earnings recognised on delivery — **CONFIRMED 2026-09-09**

`payout_ledger` today writes one row per payment at the moment the webhook fires (`SRC web/src/lib/payments/webhook.ts:163-172`), conflating "money arrived" with "coach earned it," and mixing immutable amounts with mutable workflow status (`SRC web/supabase/migrations/0004_payments.sql:33-46`).

**Decided (AAF-DATA-05, AAF-TERM-02, AAF-PAY-03/04).** Three separate things — **customer payments**, **earned coach balances**, **actual payouts**. Earnings are recognised **as service is delivered**, not when money arrives. A $510 six-month package allocates $85 per service month, $59.50 coach and $25.50 Aafnai, with the undelivered balance tracked separately. Coaches are paid monthly in arrears in the first seven days of the following month, prorating partial months consistently.

**Consequence for M03 and M07:** a service-period allocation model is now required, not optional. A one-row-per-payment ledger cannot express a partially delivered term, and cannot answer "what does this coach get paid on the 3rd of next month?"

### 1.3 Required media and progress capabilities are no longer deferrable

The audit recommended deferring progress photos and measurements. **FM00 §3.4 confirms all eight capabilities as first-product scope.** Per the M00 instruction, a required capability is **not** marked deferred because an earlier audit suggested deferring it. See R-13 … R-16.

### 1.4 Currency and scheduling do not exist at all

- **Currency (verified).** `currency text not null default 'usd'` (`SRC web/supabase/migrations/0002_catalog.sql:26`, `:0004_payments.sql:13`); the TypeScript type is the **literal** `currency: "usd"` (`SRC web/src/lib/catalog/types.ts:23`), so the type system forbids any other value; `formatPrice` hard-codes `$` (`SRC web/src/lib/catalog/types.ts:58-67`). AAF-ACCT-02 requires changes at all three layers.
- **Scheduling (verified).** No availability, slot, appointment, or timezone table exists. `bookings.scheduled_at` is one nullable timestamp set by an admin. The only timezone in the system is a **free-text intake string** `timezone_city` (`SRC web/src/verticals/fitness/intake.ts:67-72`). `bookings.video_link` is free text and, per the prior audit, is never written by any code path.

---

## 2. Reconciliation register

### A. Domain and plans

| ID | Requirement / finding | Current source evidence | Status | Disposition | Module | Depends on | Data preservation | Acceptance | Open decision |
|---|---|---|---|---|---|---|---|---|---|
| **R-01** | Coach-owned plans with coach-set prices (AAF-PLAN-01) | `services` has no coach FK — `0002_catalog.sql:19-36`; no `provider_id` on services (grep verified) | Absent | **REPLACE** the catalog ownership model | M03, M05 | M00 | Retain `services` rows for pandit; do not repurpose. New plan entity alongside, not in place of | AC-01 | — *(business model settled by AAF-OPS-05)* |
| **R-02** | Immutable plan versions frozen at purchase (AAF-DATA-02) | No version column; `/admin/catalog` mutates `price_cents` in place — `SRC web/src/app/admin/catalog/page.tsx:42-45` | Absent | **NEW** | M03, M05, M06 | R-01 | Existing bookings have no sold-price snapshot; backfill from `payments.amount_cents` where a payment exists, else mark unknown | AC-08 | OPEN-07 |
| **R-03** | Structured entitlements per purchase (AAF-ENT-01) | No entitlement concept anywhere | Absent | **NEW** | M03, M05 | R-01, R-02 | n/a — new data | AC-05 | OPEN-06 |
| **R-04** | No price-approval workflow (AAF-PLAN-02) | No approval workflow exists today — nothing to remove in code. **Risk is documentary:** `HB:151` and `APH:61` still describe approval | n/a | **KEEP** (absence is correct) | M05 | — | — | AC-01 | — |
| **R-05** | Standard comparison fields (AAF-PLAN-03) | `ServiceRow` renders name/summary/price only — `SRC web/src/components/service-row.tsx:9-35` | Partial | **REPLACE** | M05, M16 | R-01 | — | AC-01 | OPEN-06 |
| **R-06** | Vertical registry as the plug-in surface | `SRC web/src/verticals/registry.ts:29-47`; core never special-cases a slug | Working | **KEEP** | M03 | — | Preserve pandit and future-vertical entries (AAF-BRAND-05) | AC-13 | AAF-BRAND-04 |
| **R-07** | Generic intake renderer | `SRC web/src/components/intake-form.tsx:11-30`, 7 field types | Working | **KEEP** | M05, M16 | — | — | — | — |
| **R-08** | Booking state machine + audit trail | `SRC web/src/lib/bookings/status.ts:15-23`; `booking_events` append-only — `0003_bookings.sql:42-52` | Working | **KEEP**, extend for purchases | M03, M06 | — | Preserve all existing events | AC-10 | — |

### B. Commission, payments, earnings

| ID | Requirement / finding | Current source evidence | Status | Disposition | Module | Depends on | Data preservation | Acceptance | Open decision |
|---|---|---|---|---|---|---|---|---|---|
| **R-09** | Monthly 70/30, one-off 60/40 (AAF-COMM-01/02) | Current: `coachRate = providerFounding ? 0.65 : 0.6` — `SRC web/src/verticals/fitness/payout.ts:11`; rule strings `fitness_65_35_founding` / `fitness_60_40` — `:18`; fallback `0.6` / `default_60_40` — `SRC web/src/lib/payouts/index.ts:24,30` | **Contradicts M00** | **REPAIR** the rule; **KEEP** the rule abstraction | M06, M07 | M00 | **Critical:** ledger rows store `rule` per row (`0004_payments.sql:42`). Historical rows keep their original rule string. New rates apply to new plans only (AAF-DATA-04) | AC-02 | OPEN-01a *(multi-currency only)* |
| **R-10** | Service-type classification, not payment count (AAF-COMM-05) | `services.billing_type` is `one_time` \| `subscription` — a **billing** attribute, not a service type. A prepaid term would read as `one_time` | Wrong axis | **NEW** field; **REPAIR** derivation | M03, M06 | R-01 | — | AC-09 | **OPEN-02** |
| **R-11** | Webhook dedup surviving interruption + cross-event effects (AAF-TECH-01) | Only guard: partial unique index on `stripe_payment_intent_id` — `0004_payments.sql:21`. `invoice.payment_succeeded` supplies no intent id — `SRC web/src/lib/payments/webhook.ts:79-85`. Three events handled: `:37`, `:64`, `:89` | Insufficient | **REPAIR** — see §3.1 | M06 | — | Do not retro-deduplicate existing rows without operator review | AC-14 | — |
| **R-12** | Refund reverses coach earnings | `charge.refunded` updates `payments.status` only — `SRC web/src/lib/payments/webhook.ts:96-99`. No ledger reversal, no booking transition | Defect | **REPAIR** via compensating entry (AAF-DATA-01) | M06, M07 | R-11 | Never edit a historical amount | AC-10 | — *(settled by AAF-COMM-09)* |
| **R-13** | Failed payment, cancellation, dispute handling | No `invoice.payment_failed`, `customer.subscription.deleted`, or `charge.dispute.created` case — verified in the switch at `webhook.ts:36-102` | Absent | **NEW** | M06 | R-11 | — | AC-14 | OPEN-02, OPEN-05 |
| **R-14** | Payment errors must not be swallowed | `if (error || !payment) return;` — `SRC web/src/lib/payments/webhook.ts:147`; returns `{received:true}` regardless | Defect | **REPAIR** | M06 | R-11 | — | AC-14 | — |
| **R-15** | Immutable amounts, separate payout workflow (AAF-DATA-01) | `payout_ledger` mixes both: `status` mutated at `SRC web/src/app/admin/payouts/export/route.ts:43` and `SRC web/src/app/admin/payouts/page.tsx:71`; admin RLS is `for all` — `0004_payments.sql:66` | Wrong shape | **REPLACE** — see §3.2 | M03, M07 | — | **Migrate existing ledger rows into the immutable side, preserving `rule`, amounts, and timestamps** | AC-11 | — *(settled by AAF-PAY-03)* |
| **R-16** | Earnings state machine (7 states) | Current: `payout_status` enum has 3 — `pending` \| `exported` \| `paid` (`0004_payments.sql:4`). "Paid" for a batch is the literal string in a free-text notes field — `payouts/page.tsx:76,142` | Partial | **REPLACE** | M03, M07 | R-15 | Map `pending`→`earned`, `exported`→`transfer_pending`, `paid`→`paid` for existing rows, recording the mapping | AC-11 | — *(settled by AAF-PAY-03; states per PRODUCT_CONTRACT §7.6)* |
| **R-17** | Payment ≠ payout in the UI (AAF-PAY-01) | No coach-facing earnings view exists at all | Absent | **NEW** | M07, M15 | R-16 | — | AC-11 | OPEN-12 *(settlement buffer)* |
| **R-18** | Payout export must not mutate via GET | `export async function GET()` creates a batch and mutates ledger status — `SRC web/src/app/admin/payouts/export/route.ts:10,32-47`; linked as a plain anchor — `payouts/page.tsx:94` | Defect | **REPAIR** → POST + confirmation + idempotency key | M07 | R-15 | — | AC-11 | — |
| **R-19** | Local-currency display (AAF-ACCT-02) | `currency` defaults `'usd'` (`0002_catalog.sql:26`); TS literal type `"usd"` (`catalog/types.ts:23`); `$` hard-coded (`:58-67`) | Absent | **REPAIR** all three layers | M05, M06, M16 | R-01 | Existing rows are USD; preserve explicitly rather than assuming | AC-02 | **OPEN-01a** |
| **R-20** | Sold-price provenance | No price snapshot on `bookings`; `/admin/catalog` edits in place with no audit — `admin/catalog/page.tsx:34-48` | Absent | **NEW** | M03, M06 | R-02 | Backfill from `payments.amount_cents` where present | AC-08 | OPEN-07 |

### C. Scheduling, calls, workspace

| ID | Requirement / finding | Current source evidence | Status | Disposition | Module | Depends on | Data preservation | Acceptance | Open decision |
|---|---|---|---|---|---|---|---|---|---|
| **R-21** | Coach availability in coach's timezone (AAF-CAL-01) | No availability table; no IANA timezone stored anywhere. Only `timezone_city` free text — `SRC web/src/verticals/fitness/intake.ts:67-72` | Absent | **NEW** | M09 | M03 | — | AC-06 | OPEN-05 |
| **R-22** | Client-timezone slots, conflict protection, history (AAF-CAL-02/06) | `bookings.scheduled_at` is one admin-set timestamp — `0003_bookings.sql:28` | Absent | **NEW** | M09 | R-21 | Preserve existing `scheduled_at` values as historical pandit data | AC-06 | OPEN-05 |
| **R-23** | Video + audio calls (AAF-CAL-03/04) | `bookings.video_link` free text — `0003_bookings.sql:29`; per prior audit, never written by any code | Absent | **NEW** | M10 | R-22 | — | AC-05 | OPEN-05, AAF-CAL-07 |
| **R-24** | Coach-authored programmes | `programs` / `program_days` / `exercises` exist with correct RLS via `booking_coached_by_me()` — `0007_fitness.sql:5-36,107-142`. Coach can create only: `SRC web/src/app/coach/clients/[bookingId]/page.tsx:57,70,82`. No edit, no delete, no `rest_seconds`/`tempo`/`notes`/`sort` in the form; all three actions discard results | Partial | **REPAIR** (keep schema + RLS, replace the UI) | M11 | R-25 | Keep all existing programme rows | AC-03, AC-04 | — |
| **R-25** | Immutable programme versions (AAF-PROG-10) | No version column on `programs`; an edit today would mutate in place | Absent | **NEW** | M03, M11 | — | Existing programmes become v1 | AC-04 | — |
| **R-26** | Client logs sets/reps/weights/notes (AAF-PROG-05) | `workout_logs`, `set_logs` exist — `0007_fitness.sql:38-55`. **Zero write paths in the application** (grep verified: no `.insert` targets these tables) | Schema only | **NEW** UI + actions; **KEEP** schema | M12 | R-25 | — | AC-04 | — |
| **R-27** | Bodyweight + measurements (AAF-PROG-02/03) | `bodyweight_logs`, `measurements` exist — `0007_fitness.sql:57-74`. **Zero writes.** Coach reads weigh-ins at `coach/clients/[bookingId]/page.tsx:44`, computing an average over a table nothing populates. **No unit-preference column** | Schema only | **NEW** UI; **REPAIR** schema (units) | M12 | — | — | AC-04, AC-07 | — |
| **R-28** | Private progress photos (AAF-PROG-01) | `progress_photos` exists — `0007_fitness.sql:76-82`. **Zero writes.** No upload route. `getUploadUrl` exists and **is called from nowhere** — `SRC web/src/lib/recordings.ts:27` | Schema only | **NEW** — see §3.3 | M08, M12 | R-31 | — | AC-07 | OPEN-10 |
| **R-29** | Form-review video + feedback (AAF-PROG-08) | No table, no route, no component | Absent | **NEW** | M08, M12 | R-31 | — | AC-07 | OPEN-06, OPEN-10 |
| **R-30** | Progress graphs (AAF-PROG-07/09/11) | None. Only a 7-day average — `coach/clients/[bookingId]/page.tsx:11-18` | Absent | **NEW** | M15 | R-26, R-27 | — | AC-04 | — |
| **R-31** | Secure media pipeline (AAF-TECH-02, AAF-PROG-12) | `getUploadUrl` does no validation, no size cap, no re-encode, no metadata strip — `recordings.ts:27-35`. `getDownloadUrl` issues **7-day** URLs — `:25,37-45`, advertised as a feature in email — `SRC web/src/lib/email/index.ts:102` | Inadequate | **REPLACE** — see §3.3 | M08 | M03 | Preserve existing `recordings` rows and R2 objects | AC-07 | OPEN-10 |
| **R-32** | Check-ins (per-plan cadence) | No table, no route | Absent | **NEW** | M13 | R-03 | — | AC-05 | **OPEN-06** |
| **R-33** | Messaging | No table, no route. **`HB:243` explicitly defers in-app messaging to WhatsApp.** Meanwhile `SRC web/src/verticals/fitness/catalog.ts:37` sells "direct messaging with your coach" | Absent + **untruthful copy** | **DEFER pending OPEN-06**; **copy must be corrected either way** | M14, M16 | — | — | AC-05 | **OPEN-06** |

### D. Identity, access, safety

| ID | Requirement / finding | Current source evidence | Status | Disposition | Module | Depends on | Data preservation | Acceptance | Open decision |
|---|---|---|---|---|---|---|---|---|---|
| **R-34** | Google sign-in (AAF-ACCT-01) | Magic link only — `SRC web/src/app/(marketing)/account/sign-in/sign-in-form.tsx:21`. Callback already handles a generic OAuth code exchange — `SRC web/src/app/auth/callback/route.ts:13` | Partial | **REPAIR** | M04 | — | Existing profiles keep their identity | — | AAF-ACCT-03 |
| **R-35** | Coach can sign in at all | `providers.profile_id` exists (`0001_core.sql:66`) but is **only ever read**, never written — grep found exactly one use: `SRC web/src/app/coach/layout.tsx:35`. No invite or linkage UI | **Blocking gap** | **NEW** | M04, M17 | — | Preserve existing provider rows | AC-01 | — |
| **R-36** | Guest purchase becomes an owned account | `customer_id: user?.id ?? null` — `SRC web/src/lib/bookings/actions.ts:74`; RLS matches `customer_id = auth.uid()` only — `0003_bookings.sql:58` | **Blocking gap** | **REPAIR** | M04, M06 | — | **Backfill existing null-`customer_id` bookings by verified email; do not guess** | — | — |
| **R-37** | Admin second factor (AAF-SEC-01) | Single-factor magic link; `isAdmin()` checked server-side but no second factor — `SRC web/src/lib/auth.ts:38-41` | Absent | **NEW** | M04, M17 | R-34 | — | — | — |
| **R-38** | Grief data out of generic intake | Pandit intake collects `deceased_name`, `relation`, `gotra` — `SRC web/src/verticals/pandit/intake.ts:22-77` — into `bookings.intake_response` (`SRC web/src/lib/bookings/actions.ts:77`), which any assigned provider can read (`0003_bookings.sql:63`) | **Invariant 2 violation** | **REPAIR** | M03, M17 | — | **Migrate existing intake JSON into typed protected storage; do not drop** | AC-13 | AAF-BRAND-04 |
| **R-39** | Hiding a vertical is not a data fix (AAF-TECH-04) | `catalog_status='hidden'` affects only catalog listing — `0002_catalog.sql:53`. `bookings` RLS is unaffected by service status | Correction | **NEW** understanding; no code change alone suffices | M01, M03 | R-38 | — | AC-13 | — |
| **R-40** | Security headers and CSP | `next.config.ts` is empty of headers (3 lines, verified). `SRC web/src/proxy.ts` only refreshes the session cookie. No CSP, no nonce | Absent | **NEW** | M01 | — | — | — | — |
| **R-41** | Rate limiting | None anywhere (grep verified). `createBooking` inserts via the **service-role** client with no throttle — `SRC web/src/lib/bookings/actions.ts:63-81` — and enqueues an email per call | Absent | **NEW** | M01 | — | — | — | — |
| **R-42** | Service-role import guard | `SRC web/src/lib/supabase/admin.ts` has the server-only env var name but **no `import "server-only"` and no `window` check** — unlike nine sibling modules that do carry the guard | Gap | **REPAIR** | M01 | — | — | — | — |
| **R-43** | Cron endpoint fails open | `if (secret) { ...check... }` — `SRC web/src/app/api/jobs/process/route.ts:9-15`. `CRON_SECRET` is **not** in `web/.env.example` (verified) | Defect | **REPAIR** | M01, M08 | — | — | AC-12 | — |
| **R-44** | Email HTML escaping | `customerName` interpolated unescaped — `SRC web/src/lib/email/index.ts:59`; raw `bodyHtml` — `:78`; validated only as `z.string().min(1)` — `SRC web/src/lib/bookings/actions.ts:12` | Defect | **REPAIR** | M08 | — | — | — | — |
| **R-45** | Missing indexes | Present: `bookings(status, customer_id, customer_email)`, `payments(booking_id)`, `payout_ledger(provider_id, status)`, `programs(booking_id)`, others. **Absent:** `bookings(stripe_subscription_id)` — used by every renewal lookup at `webhook.ts:75` — `bookings(provider_id)` (coach RLS subquery), `payout_ledger(batch_id, payment_id, booking_id)`, `program_days(program_id)`, `exercises(program_day_id)`, and ~12 more | Gap | **REPAIR** in one additive migration | M03 | — | Additive only | — | — |
| **R-46** | Tests | **No test runner, no test script, no test file** (verified: `web/package.json` scripts are `dev`/`build`/`start`/`lint`; no `scripts/` directory). `CLAUDE.md` and `.cursorrules` both mandate payout and RLS tests | Absent | **NEW** | M01 | — | — | AC-02 | — |

### E. Presentation and operations

| ID | Requirement / finding | Current source evidence | Status | Disposition | Module | Acceptance | Open decision |
|---|---|---|---|---|---|---|---|
| **R-47** | Public navigation on mobile | Links are `hidden … sm:inline` with no mobile menu — `SRC web/src/components/site-nav.tsx:32`. Below 640px only the logo and "Sign in" are reachable | Defect | **REPAIR** | M02, M16 | — | — |
| **R-48** | Accessibility method (AAF-TECH-03) | Zero `aria-` attributes (grep verified) — but the actionable defects are R-47, absent focus styles, the pervasive `text-ink/50`–`/30` opacity scale, and unannounced form errors at `booking-form.tsx:69` | Mixed | **REPAIR** by testing, **not** by adding ARIA | M02, M16 | — | — |
| **R-49** | Brand surface | 29 files contain `Ghartira`/`घरतिर`; **no table, column, default, or seed row does** — only a comment at `0001_core.sql:1`. Tokens are semantically named — `SRC web/src/app/globals.css:7-29` | Ready | **REPAIR** (values + copy) | M02 | — | AAF-BRAND-06 |
| **R-50** | Untruthful marketing claims | Testimonial at `SRC web/src/app/(marketing)/page.tsx:141`; "direct messaging" at `SRC web/src/verticals/fitness/catalog.ts:37`; "named coordinator you can reach directly" at `SRC web/src/app/(marketing)/services/[vertical]/[service]/page.tsx:54` | **Invariant 9 risk** | **REPAIR** | M16 | AC-12 | **OPEN-10** |
| **R-51** | Admin console | 8 working screens; booking detail combines status machine, assignment, intake, payments, and audit — `SRC web/src/app/admin/bookings/[id]/page.tsx` | Working | **KEEP**, extend | M17 | AC-10 | — |
| **R-52** | Vendor seams | No Stripe call outside `lib/payments/`; no Resend call outside `lib/email/`; `server-only` present on nine lib modules | Working | **KEEP** | M01 | AC-12 | — |
| **R-53** | Graceful degradation | `isSupabaseConfigured()` / `isStripeConfigured()` gate every path — `SRC web/src/lib/env.ts:17-21` | Working | **KEEP** | M01 | **AC-12** | — |
| **R-54** | Empty architecture docs | `ARCHITECTURE.md` and `MIGRATION.md` are stubs describing themselves; `docs/specs/` holds only its template README | Absent | **NEW** | M03, M18 | — | — |
| **R-55** | Agent instructions contradict the repo | `AGENTS.md`/`.cursorrules` require `docs/STATE.md`, `docs/DIRECTION.md`, `docs/DATA-MAP.md`, `docs/RUNBOOK.md`, `scripts/payout-test.ts`, `scripts/rls-test.ts`, `scripts/lib/with-idle-timeout.mjs` — **none exist**. `.cursorrules` cites a `CLAUDE.md` "Tone rules" section that **does not exist**. `.cursorrules` names protected tables `deceased_records`, `tithi_reminders`, `health_records` — **none exist**; the real grief table `shraddha_dates` **is not named** | **Safety defect** | **REPAIR** (founder-owned files; not edited here) | M01 | AC-13 | — |

---

### 2.1 Items added by the second-pass decisions — 2026-09-09

| ID | Requirement | Current source evidence | Status | Disposition | Module | Acceptance | Open decision |
|---|---|---|---|---|---|---|---|
| **R-56** | Coach acceptance confirmed **before** payment (AAF-FLOW-02) | `services.capacity_limit` exists (`0002_catalog.sql:31`) and is **read by no code**. Flow is intake → pay → assign (`admin/fitness/page.tsx`) | Absent | **NEW** | M05, M06, M09 | AC-15 | — |
| **R-57** | Coach and plan visible pre-purchase, incl. compatible availability (AAF-FLOW-01) | `providers` has no bio, photo, specialisation, or credential column (`0001_core.sql:63-75`); no public coach route exists | Absent | **NEW** | M05, M16 | AC-15 | OPEN-10 (vetting evidence) |
| **R-58** | Service-period allocation and earned-on-delivery recognition (AAF-TERM-02) | Ledger row written at payment time (`webhook.ts:163`); no service-period concept anywhere | Absent | **NEW** | M03, M07 | AC-09 | AAF-TERM-05 |
| **R-59** | Undelivered balance tracked separately (AAF-TERM-03, AAF-DATA-05) | No such concept; `payout_ledger` has one status field doing several jobs | Absent | **NEW** | M03, M07 | AC-09, AC-11 | — |
| **R-60** | Monthly-in-arrears payout run, first 7 days (AAF-PAY-03) | Export is manual, ad-hoc, and mutates via `GET` (`admin/payouts/export/route.ts:10`) | Absent | **NEW** | M07 | AC-11 | OPEN-13 |
| **R-61** | Commission base excl. taxes; fees from Aafnai's share (AAF-COMM-06/07) | `computePayout` takes `grossCents` with no tax or fee concept (`lib/payouts/index.ts:10-32`) | Absent | **REPAIR** | M06, M07 | AC-02 | OPEN-01a |
| **R-62** | Discount funding attribution (AAF-COMM-08) | No discount or coupon concept anywhere | Absent | **NEW** | M05, M06 | AC-02 | — |
| **R-63** | Mock payment mode for development (AAF-DEV-01) | `isStripeConfigured()` gates checkout to a hard "not live yet" message (`lib/bookings/actions.ts:55-61`) — degradation, not a test double | Partial | **NEW** | M06, M18 | AC-12 | — |
| **R-64** | Coach change preserves earned vs remaining funding (AAF-TERM-04) | `assignProvider` swaps `provider_id` with **no payout consequence at all** (`lib/bookings/actions.ts:157-178`) | Absent | **NEW** | M07, M17 | AC-10 | OPEN-08 |

---

## 3. Corrected remedies

The 2026-09-09 audit proposed fixes that are incomplete or wrong. **These corrections govern; do not implement the audit's version.**

### 3.1 Event deduplication — audit remedy was insufficient (R-11)

**Audit said:** "Add a `stripe_events(id)` table; insert-first, ignore duplicates."

**Why that is not enough.** Two distinct failures survive it:

1. **Interrupted processing.** Insert-then-process means a crash *after* the insert and *before* the side effects leaves the event marked seen with nothing applied. The retry is discarded as a duplicate and the payment is lost. Marking complete *after* processing has the mirror problem: a crash after side effects but before the mark causes re-application.
2. **Cross-event duplication.** Different event types can describe the same economic event — a first subscription cycle can arrive as both `checkout.session.completed` and `invoice.payment_succeeded`. Distinct event IDs, one payment. Message-level dedup cannot see this.

**Required instead.** (a) A durable event record with explicit processing state (`received` → `processing` → `completed` / `failed`), so an interrupted attempt is recoverable and re-entrant rather than silently dropped or double-applied; and (b) a separate **business-effect idempotency key** on the economic outcome — the natural key being the purchase and its service period — so the effect is applied once regardless of how many messages describe it.

### 3.2 Financial immutability — audit remedy was the wrong shape (R-15, R-16)

**Audit said:** "Make `payout_ledger` append-only."

**Why that is wrong.** The same table also carries workflow status that legitimately changes (`pending` → `exported` → `paid`). A table cannot be both append-only and status-mutable; the audit's own recommendation contradicts the code it was describing.

**Required instead.** Two structures: **immutable earnings entries** (amount, rate, base, service type, period, source purchase — never edited, corrected only by new compensating entries per AAF-DATA-01) and a **separate payout workflow record** referencing them, which may transition through the seven states in PRODUCT_CONTRACT §7.6 with its own audit trail. Batch "paid" must be a real state with a timestamp, never the string `"Paid"` in a notes field (`payouts/page.tsx:76,142`).

### 3.3 Uploads — the audit's claim was **wrong** and is corrected (R-28, R-31)

**Audit said:** a presigned direct-to-storage PUT "architecturally *cannot*" strip EXIF, because the bytes never reach the server.

**That is incorrect**, and this reconciliation corrects it. A presigned upload into a **secure quarantine** location, followed by server-side validation (magic bytes, size cap), re-encoding, metadata stripping, promotion to a private serving location, and deletion of the original, **fully satisfies** the requirement while keeping large uploads off the application server. What genuinely cannot satisfy it is exposing unvalidated originals directly, which is what `getUploadUrl` would do today (`recordings.ts:27-35`) — although, being uncalled, it currently does nothing at all.

### 3.4 Accessibility — audit framing was unhelpful (R-48)

**Audit said:** "Zero `aria-*` attributes in the entire source tree."

**Attribute count is not a measure of accessibility**, and adding ARIA indiscriminately regularly makes screen-reader output worse. The real, testable defects are: public navigation unreachable below 640px (R-47); focus indication removed and only weakly restored (`outline-none focus:border-ink`); a pervasive opacity scale down to `text-ink/30` that will fail contrast on `#F5F3EF`; and form errors rendered as plain paragraphs that are never announced (`booking-form.tsx:69`). Fix by semantics, keyboard operability, contrast, and announcement — verified by testing.

### 3.5 Vertical visibility — not a security control (R-39, AAF-TECH-04)

**Audit said:** "Set pandit to `hidden`" as part of a fitness-first launch.

Setting `catalog_status='hidden'` affects **only** the catalog listing policy (`0002_catalog.sql:53`). It does not touch `bookings.intake_response`, `shraddha_dates`, or any RLS policy governing them. **Grief-data isolation (R-38) is an independent requirement that must be satisfied whether or not the vertical is visible** (AAF-BRAND-05).

---

## 4. Module impact summary

| Module | Impact of M00 | Key items |
|---|---|---|
| **M01** baseline/safety | Unchanged in kind; several defects confirmed still present | R-40 … R-46, R-52, R-53, R-55 |
| **M02** design | Rebrand is values + copy; nav and contrast are real defects | R-47, R-48, R-49 |
| **M03** shared domain | **Substantially larger.** Plan ownership, versions, entitlements, appointments, earnings split, programme versions, media | R-01…R-03, R-10, R-15, R-16, R-25, R-45 |
| **M04** auth | Google sign-in, **coach login linkage**, guest→account, admin MFA | R-34 … R-37 |
| **M05** coach plans | **Largest new surface.** Plan builder, share display, capacity, currency | R-01…R-05, R-19 |
| **M06** payments | Charge a coach's plan version; freeze terms; classify by service type; fix dedup/refund/failure | R-02, R-10 … R-14, R-19, R-20 |
| **M07** earnings/payouts | New rates; immutable entries; 7-state workflow; coach-facing statement; POST export | R-09, R-15 … R-18 |
| **M08** jobs/email/media | **Promoted from deferred.** Quarantine pipeline is now required | R-28, R-29, R-31, R-43, R-44 |
| **M09** scheduling | **Entirely new.** Availability, slots, dual timezones, conflicts, history | R-21, R-22 |
| **M10** calls | **Entirely new.** Video + audio; `technical_failure` as a real outcome | R-23 |
| **M11** programmes | Keep schema and RLS; replace the UI; add versioning | R-24, R-25 |
| **M12** logging/progress | **Entirely new UI** over five schema-only tables; add unit preference | R-26 … R-29 |
| **M13** check-ins | New; cadence per plan, not universal | R-32 |
| **M14** messaging | **Gated on OPEN-06.** Copy must be corrected regardless | R-33 |
| **M15** dashboards | Graphs, earnings statement, frozen-plan rendering, no automatic verdicts | R-17, R-30 |
| **M16** public journeys | Coach and plan discovery **before** purchase — conflicts with `HB:194` | R-05, R-47, R-50 |
| **M17** operations | Coach invitation, coach change, grief-data remediation | R-35, R-38, R-51 |
| **M18** QA/release | Nothing exists to build on | R-46, R-54 |

---

## 5. Items the audit recommended deferring that are **now required**

Recorded explicitly, per the M00 instruction that a required capability must not be marked deferred merely because the audit suggested it.

| Capability | Audit recommendation | M00 status | ID |
|---|---|---|---|
| Progress photos | "Defer, then build properly" | **CONFIRMED first-product** | AAF-PROG-01 / R-28 |
| Measurements | "Defer" | **CONFIRMED first-product** | AAF-PROG-03 / R-27 |
| Form-review video | "Defer — WhatsApp at launch" | **CONFIRMED first-product** | AAF-PROG-08 / R-29 |
| Progress graphs | Not mentioned | **CONFIRMED first-product** | AAF-PROG-07 / R-30 |
| Scheduling and calls | "Defer — paste a Zoom link" | **CONFIRMED first-product** | AAF-CAL-01…06 / R-21…R-23 |
| Local-currency display | "Defer — charge USD" | **CONFIRMED** (display); charge currency OPEN-01a | AAF-ACCT-02 / R-19 |

Genuinely still deferred: native apps, wearables, macro tracking, automated payouts, Stripe Connect, coach ratings/reviews, public multi-vertical marketplace, coach-owned-client software subscription. Messaging (R-33) is gated on OPEN-06, not deferred by default.
