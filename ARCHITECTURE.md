# Ghar Tira / Aafnai — Architecture

**Written from the codebase at `master @ 2bb3d9f`, 2026-09-09, and amended with the M00 product decisions of the same date.**

Two truth markers are used throughout. **BUILT** means it exists in the repository and was verified by reading the source. **REQUIRED** means a confirmed M00 decision demands it and it does **not** exist yet. Nothing here has been runtime-tested; no build, migration, or database query has been run against this description.

Business context: `docs/HANDOVER.md`. Current product authority: `docs/aafnai/DECISION_REGISTER.md`.

---

## 1. What this is

A Next.js 16 application (App Router, React 19, TypeScript strict) backed by Supabase Postgres, deployed to Vercel. One shared core — identity, catalog, bookings, payments, payouts, notifications — with **per-vertical modules** plugged in through a single registry. The core never special-cases a vertical slug.

Two verticals exist in code. **Pandit** (ancestral rites) is complete and active. **Fitness** is the launch vertical for Aafnai and is largely unbuilt on the customer side. Tutoring and bookkeeping are catalog-only placeholders.

Only two client components exist in the entire application; everything else is a Server Component.

---

## 2. Invariants, architecturally

`CLAUDE.md` states the invariants. This section says **where each one is enforced** — and, honestly, where it currently is not.

| Invariant | Enforcement point | State |
|---|---|---|
| 1 · Human confirms every ritual date | `scheduleReminder` re-reads the row server-side and refuses unless `date_confirmed_by_human` **and** a Gregorian date exist — `web/src/app/admin/pandit/page.tsx:85` | **BUILT and correct** |
| 2 · Grief data locked | Belongs in `shraddha_dates` (RLS: owner + admin). **But** the intake form writes `deceased_name`, `relation`, `gotra` into `bookings.intake_response`, which any assigned provider can read — `0003_bookings.sql:63` | **VIOLATED** — see §4, node `bookings.intake_response` |
| 3 · Body and health data locked | `booking_belongs_to_me()` / `booking_coached_by_me()` in RLS — `0007_fitness.sql:95-120` | **BUILT** at the data layer; no upload pipeline exists to protect (§6) |
| 4 · Card data never touches our servers | Stripe Checkout redirect only. No card field in any form | **BUILT and correct** |
| 5 · Money and trust states server-side only | No RLS policy lets a customer write `status`, `payments`, or `payout_ledger`. Booking status moves only via `transitionBooking` (admin-gated) or service role | **BUILT and correct** |
| 5b · Webhook is the only writer of payment truth | `/book/[service]/received` reads no payment state and grants nothing — it ignores its own `?booking=` parameter | **BUILT and correct** |
| 6 · RLS on every table, same commit | All 22 tables carry `enable row level security` in their creating migration | **BUILT** |
| 7 · Service-role key never reaches the browser | Server-only env var name — **but** `web/src/lib/supabase/admin.ts` lacks `import "server-only"` and a `window` check, unlike nine sibling lib modules | **PARTIAL** |
| 8 · Payout economics disclosed, never discovered | The plan builder must show Customer pays / Coach receives / Aafnai share | **REQUIRED** — no plan builder exists |
| 9 · No fake data in production | Homepage testimonial of unverified truth — `(marketing)/page.tsx:141`; "direct messaging" sold at `verticals/fitness/catalog.ts:37` with no messaging built | **AT RISK** |

**Structural principle:** isolation is enforced in the **database**, never in the UI alone. Every access rule above that works, works because Postgres refuses — not because a component hides a button.

---

## 3. Data model

Conventions, all currently honoured: `snake_case`; `uuid` primary keys with `gen_random_uuid()`; `timestamptz created_at`; **money as integer minor units with an explicit currency column**; enums for state; ritual dates stored in both AD and BS.

### 3.1 Core — `0001`, `0002`, `0003`

```
profiles(id → auth.users, email, full_name, phone, role, created_at)
   └─ created by trigger handle_new_user() on auth.users insert
providers(id, profile_id → profiles, display_name, vertical_slug, country,
          payout_channel, payout_reference, founding, active, notes)
verticals(slug PK, name, name_ne, tagline, description, status, sort)
services(id PK, vertical_slug → verticals, name, summary, description,
         price_cents, currency, billing_type, billing_interval, price_note,
         stripe_price_id, capacity_limit, status, sort, metadata)
intake_schemas(id, service_id → services, version, schema jsonb)
bookings(id, service_id, vertical_slug, customer_id → profiles NULLABLE,
         customer_email, customer_name, provider_id → providers,
         status, intake_response jsonb, intake_schema_version,
         scheduled_at, video_link, admin_notes,
         stripe_checkout_session_id, stripe_subscription_id, updated_at)
booking_events(id, booking_id → bookings CASCADE, from_status, to_status,
               actor, note, created_at)
```

`bookings` is the universal join key: every vertical table keys off `booking_id`.

### 3.2 Payments and payouts — `0004`

```
payments(id, booking_id, stripe_payment_intent_id, stripe_checkout_session_id,
         stripe_invoice_id, amount_cents, currency, status, kind, raw jsonb)
payout_batches(id, label, exported_at, notes)
payout_ledger(id, payment_id, booking_id, provider_id, gross_cents,
              direct_costs_cents, provider_share_cents, platform_share_cents,
              rule, status, batch_id)
```

### 3.3 Communications — `0005`

```
notification_jobs(id, kind, recipient_email, subject, payload jsonb,
                  booking_id, scheduled_for, status, sent_at, error)
recordings(id, booking_id, r2_key, label, delivered_at)
```

### 3.4 Pandit — `0006`

```
ceremonies(id, booking_id, ceremony_type, temple, pandit_provider_id,
           assistant_name, samagri_notes, performed_at, recording_id,
           correctness_checked, notes)
shraddha_dates(id, customer_email, customer_name, customer_id, booking_id,
               deceased_name, relation, gotra, tradition,
               tithi_month_bs, tithi_paksha, tithi_name,
               next_gregorian_date, date_confirmed_by_human,
               reminder_opt_in, reminder_scheduled, notes)
```

`shraddha_dates` holds **grief data** — see §4 and §5.

### 3.5 Fitness — `0007`

```
programs(id, booking_id, coach_provider_id, title, goal, notes, active)
  └─ program_days(id, program_id CASCADE, day_index, title, notes)
       └─ exercises(id, program_day_id CASCADE, name, sets, reps,
                    rest_seconds, tempo, notes, sort)
workout_logs(id, booking_id, program_day_id, performed_at, notes)
  └─ set_logs(id, workout_log_id CASCADE, exercise_id, set_index,
              weight_kg, reps, rpe)
bodyweight_logs(id, booking_id, logged_on, weight_kg, UNIQUE(booking_id, logged_on))
measurements(id, booking_id, logged_on, waist/hip/chest/arm/thigh_cm)
progress_photos(id, booking_id, r2_key, taken_on)
```

Access is governed by two `security definer` helpers with a pinned `search_path`: `booking_belongs_to_me(b_id)` and `booking_coached_by_me(b_id)`.

### 3.6 Index discipline — currently violated

The rule is an index on every foreign key and every column used in `WHERE` / `ORDER BY`, in the same migration. About sixteen are missing. Two matter now: **`bookings(stripe_subscription_id)`**, scanned by every renewal webhook, and **`bookings(provider_id)`**, used by the coach RLS subquery on every coach page load. Full list in `docs/aafnai/CODEBASE_RECONCILIATION.md` R-45.

### 3.7 What the M00 decisions add — all REQUIRED, none built

| Concept | Why the current schema cannot carry it |
|---|---|
| **Coach-owned plans** | `services` is a platform-global catalog with **no provider foreign key**. Coach-created plans invert its ownership model |
| **Immutable plan versions** | No version column; `/admin/catalog` edits `price_cents` in place |
| **Entitlements** | No such concept. Call, check-in, and form-review allowances must be frozen per purchase |
| **Service type** | `billing_type` is `one_time`\|`subscription` — a *billing* attribute. A prepaid six-month term reads as `one_time` and would attract the 40% consultation rate |
| **Availability, slots, appointments** | Nothing exists. `bookings.scheduled_at` is one admin-set timestamp; the only timezone in the system is a free-text intake string |
| **Earned vs collected vs paid** | `payout_ledger` conflates immutable amounts with mutable workflow status |
| **Undelivered balance** | Prepaid terms need the unearned portion tracked separately from earned coach balances |
| **Check-ins, messaging, form-review media** | No tables |
| **Multi-currency** | `currency` defaults to `'usd'` and the TypeScript type is the **literal** `"usd"` |

---

## 4. Extension node registry

Tables, columns, and stubs that exist without a caller. **Each is listed with the trigger that activates it.** Per §5, none may be deleted or "cleaned up" without a written decision.

| Node | Kind | Status | Activation trigger |
|---|---|---|---|
| `ceremonies` | Table, zero references | Reserved | Pandit vertical gains per-ceremony tracking beyond the booking record |
| `intake_schemas` | Table, never read (schemas come from the registry) | Reserved | Intake forms need versioning independent of a code deploy |
| `workout_logs`, `set_logs` | Tables, **zero write paths** | **Activating now** | M12 — client workout logging is confirmed first-product scope |
| `bodyweight_logs` | Table, zero writes; read by the coach 7-day average | **Activating now** | M12 — confirmed first-product scope. Needs a unit-preference column |
| `measurements` | Table, zero writes | **Activating now** | M12 — confirmed first-product scope |
| `progress_photos` | Table, zero writes | **Activating now** | M08 + M12 — needs the quarantine pipeline in §6 first |
| `services.stripe_price_id` | Column, never set (checkout uses inline `price_data`) | Reserved | Moving to Stripe Price objects for per-product reporting |
| `services.capacity_limit` | Column, never read | **Activating now** | M05 — coach acceptance must be confirmed **before** payment |
| `bookings.video_link` | Column, never written | **Activating now** | M10 — video and audio calls are confirmed scope |
| `bookings.admin_notes` | Column, never written | Reserved | Ops needs per-booking annotation |
| `providers.founding` | Column, drives the 65% split | **Historical only** | Superseded by 70/30. Retained so historical ledger rows stay interpretable |
| `providers.payout_channel` | Column, defaults `'payoneer'` | Under review | Payout route is undecided; Remitly Business is an unverified candidate |
| `recordings.getUploadUrl` | Exported function, **called from nowhere** | Replace, don't activate | Its presigned-PUT shape cannot validate or strip metadata. See §6 |
| `verticals: tutoring, bookkeeping` | Catalog-only entries in `future.ts` | Reserved | A real provider and a real customer for that vertical |
| `bookings.intake_response` | jsonb blob | **Defect, not a node** | Holds grief data (`deceased_name`, `gotra`) readable by any assigned provider. Must move to typed protected storage — invariant 2 |

---

## 5. Node protection rule

No cleanup, deletion, or "simplification" of a registered node without a written decision recorded in the commit message and noted in `DEVLOG.md`. If a node cannot be built as specified, **do not remove it**: log a `⚠ ARCHITECTURE ISSUE` in `DEVLOG.md` and wait for human review.

This extends to the **pandit vertical as a whole**. It is not deleted for a fitness-first launch. And note the corollary: **hiding a vertical is not a data-access fix.** `catalog_status = 'hidden'` affects only the catalog listing policy (`0002_catalog.sql:53`); it does nothing to `bookings.intake_response` or `shraddha_dates`. The grief-data remediation is independent of visibility.

---

## 6. Storage architecture

**Current — BUILT, and inadequate.** Cloudflare R2 via the S3 client (`web/src/lib/recordings.ts`). `getDownloadUrl` issues 7-day signed URLs and is used for ceremony delivery. `getUploadUrl` issues a presigned PUT with no validation, no size cap, no re-encode, no metadata strip — **and is called from nowhere.**

**Required — the quarantine pipeline.** Progress photos and form-review video carry EXIF, including GPS. Stripping it is a privacy control, not an optimisation.

```
client → presigned PUT → QUARANTINE bucket (never served, never public)
       → server-side: validate magic bytes, enforce size cap,
                      re-encode, strip all metadata
       → write to PRIVATE serving bucket
       → delete the quarantine original
       → serve only via short-lived signed URLs scoped to the requester
```

A presigned upload is compatible with this requirement — the quarantine step is what makes it so. What is not compatible is exposing an unvalidated original, which is what the current helper would do.

---

## 7. Money flow

### 7.1 As built

```
Booking form → createBooking (service-role INSERT, status 'requested')
             → notification job queued
             → Stripe Checkout (inline price_data; booking_id in metadata)
             → customer pays
             → success_url → /received          [UI ONLY — grants nothing ✓]
             → webhook checkout.session.completed
                  → payments INSERT (succeeded)
                  → computePayout() via the vertical's registered rule
                  → payout_ledger INSERT (pending)
                  → booking_events INSERT (actor 'stripe')
             → founder assigns provider          [manual]
             → /admin/payouts/export             [batch, rows → exported, CSV]
             → founder pays via Payoneer         [outside the system]
             → "Mark paid"                       [rows → paid]
```

**Four defects on this path**, all confirmed in source:

1. **Renewals are not deduplicated.** The only guard is a partial unique index on `stripe_payment_intent_id`; `invoice.payment_succeeded` supplies no intent. A retried renewal double-inserts a payment **and** a ledger row.
2. **Refunds do not reverse.** `charge.refunded` updates `payments.status` and nothing else. The coach's ledger row stays `pending` and will be exported and paid.
3. **Payment insert errors are swallowed** and the webhook still returns `{received:true}`, so Stripe never retries.
4. **The payout export mutates state via `GET`**, linked as a plain anchor. A prefetch or refresh creates a duplicate batch.

### 7.2 As required by the M00 decisions

**Three ledgers, never conflated:**

```
CUSTOMER PAYMENTS   what the customer paid, and when it settled
EARNED BALANCES     what the coach has earned by delivering service
ACTUAL PAYOUTS      what has actually been transferred, and when
```

Commission: **70/30 recurring coaching, 60/40 one-off consultations**, computed on the coaching service amount excluding separately collected taxes. Ordinary processing and payout fees come from Aafnai's share. Arithmetic in integer minor units: `coach = round(base × rate)`, `aafnai = base − coach`, so the two always sum exactly.

**Earnings are recognised as service is delivered, not when money arrives.** A $510 six-month package allocates $85 per service month — $59.50 coach, $25.50 Aafnai — and the undelivered balance is tracked separately. After one delivered month, $425.00 remains undelivered.

**Payout schedule:** monthly in arrears, first seven days of the following month, for service delivered through the previous month-end. Partial months prorated consistently.

**Immutability:** financial amounts and history are never edited. Refunds, disputes, and adjustments are **new compensating entries**. Payout *workflow* state lives separately from the immutable amount record.

**Settlement is a chain, not an event:** customer payment → pending processor balance → available balance → payout to Aafnai's bank → a separate, separately approved transfer to the coach. Payout scheduling does not accelerate settlement. A processor balance buffer is not per-coach escrow and must never be shown to a coach as their money being held.

---

## 8. The tithi pipeline

The highest-consequence path in the product. A wrong shraddha date is a family's ancestral rite performed on the wrong day.

```
Customer states what they know (tithi, or a Gregorian date, or nothing)
   → stored on the booking, then transcribed by an admin into shraddha_dates
   → the BS calendar library produces a CANDIDATE for display only
   → A HUMAN enters and confirms next_gregorian_date
        → date_confirmed_by_human = true
   → only now can a reminder be scheduled (21 days ahead)
        → notification_jobs row created
   → Vercel Cron → /api/jobs/process → Resend
```

**The gate is real and server-side.** `scheduleReminder` re-reads the row and refuses unless both `next_gregorian_date` and `date_confirmed_by_human` are set — it does not trust the form. Nothing transitions into a scheduled reminder without a recorded human action.

**Two open weaknesses.** The transcription from `bookings.intake_response` into `shraddha_dates` is manual and unlogged. And `docs/HANDOVER.md` §7.1 specifies `nepali-calendar-engine` while the code uses `nepali-date-converter` at a floating `^3.4.0`, against `MIGRATION.md`'s pin-exactly rule.

---

## 9. Vendor boundaries

Every vendor sits behind a local `/lib/*` module so it can be replaced. **No vendor SDK call appears in a component.** This holds today.

| Concern | Vendor | Seam | Leak risk |
|---|---|---|---|
| Database, auth | Supabase | `lib/supabase/{client,server,admin}.ts` | **Partial leak** — query builders are used directly in page components, so the DB is not fully behind the seam |
| Payments | Stripe | `lib/payments/{stripe,checkout,webhook}.ts` | Clean |
| Email | Resend | `lib/email/index.ts` | Clean |
| Object storage | Cloudflare R2 | `lib/recordings.ts` | Clean |
| BS calendar | `nepali-date-converter` | `verticals/pandit/tithi.ts` | Clean, but the version floats |
| Payouts | Payoneer (manual CSV) | `lib/payouts/index.ts` | Route under review |
| Video calls | — | — | **REQUIRED**, unbuilt. Daily is an unverified candidate |

---

## 10. Performance architecture

Server Components by default; route-level code splitting; images through `next/image` with explicit dimensions; admin lists capped (`limit(100)`, `limit(10)`, jobs `limit(50)`).

**Known regression risk:** every marketing page calls `getVerticals()`, which reads `cookies()` when Supabase is configured — opting the whole public site out of static rendering. No `revalidate` and no caching strategy exist. This is invisible today only because nothing is configured.

**Not yet in place:** performance budgets (LCP, INP, first-load JS, CLS) checked at each module boundary, and the idle-timeout wrapper for hang-prone commands that `CLAUDE.md` requires. There is no `scripts/` directory.

---

## Changing this file

`ARCHITECTURE.md` and `MIGRATION.md` are foundational. If you discover an error or a conflict — a rule contradicts itself, a node cannot be built as specified, a performance budget appears impossible — write the problem to `DEVLOG.md` under a `⚠ ARCHITECTURE ISSUE` heading, STOP, and wait for human review.

Minor typo/wording fixes that change no meaning are allowed, tagged `[docs:]`. Never delete a node, never weaken an invariant, never remove a performance rule on your own.
