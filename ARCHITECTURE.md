# TalentYak — Architecture

**Written from the codebase at `master @ 2bb3d9f`, 2026-09-09. Sections 3 and 7 were rewritten on 2026-09-19 after M03–M07 were built, applied to a real database and exercised end to end.**

Two truth markers are used throughout. **BUILT** means it exists in the repository. **REQUIRED** means a confirmed decision demands it and it does **not** exist yet. Unlike the first version of this file, sections 3 and 7 have been checked against a running system: 30 migrations applied, 95 database tests run as real signed-in users, and a full payment, refund, dispute and payout cycle driven through Stripe in test mode. What each module was and was not verified against is recorded in `docs/implementation/M03-M07-STATUS.md`.

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
| 7 · Service-role key never reaches the browser | `web/src/lib/supabase/admin.ts` now carries all three guards: `import "server-only"`, a runtime `window` check that throws, and a non-`NEXT_PUBLIC_` env var name | **BUILT** (repaired 2026-09-15) |
| 8 · Payout economics disclosed, never discovered | `previewEarnings()` in `web/src/lib/policy/` computes Customer pays / TalentYak share / coach share from the same code that computes real money, and `/become-a-coach` renders it rather than a typed-in percentage | **PARTIAL** — the offer builder itself does not exist yet |
| 9 · No fake data in production | The testimonial and the unbuilt "direct messaging" claim are both gone; messaging is built (§3.7c) and `FULFILLMENT.messaging.ready` is true, so live billing no longer refuses an offer that includes it. What remains is the standing rule, not a known breach | **BUILT** (repaired 2026-09-22) |

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

### 3.6 Index discipline

The rule is an index on every foreign key and every column used in `WHERE` / `ORDER BY`, in the same migration. The sixteen that were missing were added in `0008` onwards, including `bookings(stripe_subscription_id)` (scanned by every renewal) and `bookings(provider_id)` (used by the coach RLS subquery). Every table added since carries its own.

### 3.7 The commercial model — `0008`–`0028`

Everything the M00 decisions required and the original schema could not carry now exists. Thirty migrations, additive, never edited after being applied; a checksum in `schema_migrations` enforces that.

**Identity and coaches — `0008`, `0009`, `0024`, `0026`**

```
profiles            + role (server-controlled), timezone, locale,
                      display_currency, terms/privacy version, suspended_at
role_changes        who changed a role, when, and why
admin_bootstrap     the ONE email address that may ever claim the admin role
providers           + status (invited→onboarding→submitted→in_review→approved
                      →suspended→retired), slug, capacity, capacity_ceiling,
                      accepting_new_clients, approved_at/by, published_at
provider_public_profiles   what the world sees; photo_path only ever set by review
provider_private           vetting notes — admin only
provider_payout_destinations   DENY-ALL; server functions only; masked on read
provider_credentials       claims vs what was actually verified
coach_invitations          hashed token, bound to one email, expiring
provider_status_events     every approval decision, with reason and actor
```

**Offers — `0010`**

```
offers          coach-owned, per vertical, draft|published|paused|archived
offer_versions  IMMUTABLE once published; one live version per offer
offer_prices    per currency, integer minor units; frozen with their version
capacity_reservations   a place held while a checkout is in flight
```

**Purchases and coaching relationships — `0011`, `0019`**

```
checkout_attempts   idempotent by (customer, key); holds a reservation
purchases           a full snapshot: price, currency, interval, inclusions,
                    term, renewal rule and every policy id in force
subscriptions       mirrors Stripe; last_event_at guards stale events
billing_cycles      one row per paid period, keyed by source_key
enrollments         the coaching relationship
enrollment_assignments   non-overlapping intervals, previous/new coach,
                    reason, actor, and history_scope — what a new coach may see
```

**Money — `0012`, `0019`, `0020`**

```
provider_events     durable Stripe receipts: state, attempts, lease, last_error
outbox              transactional background work
ledger_entries      APPEND-ONLY. unique effect_key is the anti-double-count rule
earning_states      pending|held|eligible|batched|paid — workflow, kept apart
                    from the immutable amount
refunds, disputes   requested ≠ succeeded; both recorded from Stripe's answer
payout_batches      prepared→exported→submitted→paid; exported is NOT paid
payout_batch_items  destination as it stood, evidence required before 'paid'
payout_batch_events every operator action, with actor
reconciliation_exceptions   anything the system could not settle by itself
coach_balances      per provider AND per currency; never sums across currencies
```

**Contracts for later modules — `0021`, `0022`**

```
protected_intake    grief and health answers, moved out of booking JSON
call_entitlements, appointments   M09's shape, deliberately inert
consents, retention_policies, retention_candidates, retention_notices,
deletion_requests   destructive execution switched OFF
rate_limit_counters   database-backed, works across serverless instances
```

### 3.7b Notifications — `0029`

```
notification_categories(id, label, description, essential, default_email)
notification_preferences(profile_id, category_id, email_enabled)
notifications(id, profile_id, category_id, title, body, path, outbox_id,
              dedupe_key, read_at, created_at)
```

**Two channels, one of them not optional.** The inbox is the record; email is a
delivery choice. Everything lands in the inbox, including notices a person has
switched off by email — turning an email off changes *how* somebody is told,
never *whether*. A category is either `essential` (security, billing, coaching,
session changes, data notices — an account cannot be operated safely without
them) or optional. The essential rule is enforced in
`set_notification_preference()`, not in the screen, so a direct RPC call cannot
switch off a failed-payment email.

**What must never reach these tables.** `title` and `body` are summaries the
server wrote. No message text, no health or body data, no grief data, no
ceremony detail: the rows are readable by the person, are quoted into email
subjects, and appear on lock screens. Invariants 2 and 3 apply here in full. A
notification says a message arrived; it never says what it said. `path` is
constrained to a same-site path, because a stored absolute URL is an open
redirect waiting to be rendered as a link.

**The pre-delivery recheck (`src/lib/worker/recheck.ts`) is the non-obvious
part.** A queued job describes the world as it was when something happened; by
the time a worker picks it up the session may have moved, been cancelled, or the
coach may have been reassigned off the client. So `send()` rechecks immediately
before calling the provider: recipient still valid, preference still allows it,
appointment still live, still at the stated time, recipient still party to it.

**A failed recheck finishes the job as `done`, not `failed`.** This looks wrong
and is deliberate: skipping an obsolete reminder is the correct outcome, and
recording it as a failure would fill the founder console with rows nobody should
act on. Do not "fix" this. The skip reason is recorded in the job's `result`.

The inbox row is written *before* the provider is called and regardless of the
preference, so a person is told even when the provider is unreachable and the
job retries for hours.

### 3.7c Private messaging — `0037`, `0038`

```
conversations(id, assignment_id UNIQUE, enrollment_id, customer_id, provider_id,
              last_seq, last_message_at)
messages(id, conversation_id, seq, sender_profile_id, sender_role, kind,
         body, media_asset_id UNIQUE, client_message_id, created_at)
conversation_reads(conversation_id, profile_id, last_read_seq, read_at)
conversation_signals(id, conversation_id, kind, created_at)     -- no content
coach_messaging_profiles(provider_id, working_hours, response_expectation,
                         away_until, away_note)
support_cases / support_message_access / support_access_log
messaging_settings   -- mirrors messaging.v1 in src/lib/policy/registry.ts
```

**One conversation per coach ASSIGNMENT, not per client.** A reassignment opens
an empty thread with the new coach. The client keeps the old one to read; the
previous coach loses it when their assignment closes, and the incoming coach
never gets it — **`history_scope = 'full'` does not open it**, because that
scope governs the client's training record and media, not a third party's
private words. This is a founder decision (2026-09-21), and the database
enforces it by keying access to the assignment rather than the enrollment.

**One access decision, reused everywhere.** `conversation_access(conversation,
person)` returns role, `can_read`, `can_send`, a lifecycle state and a reason
for the screen. Every policy, every action and the worker's recheck call it, so
there is exactly one place where "may this person see this" is decided. It
derives the state from `enrollments.state`, which `end_lapsed_enrollments()`
already maintains from the purchase — **messaging invents no second billing
authority** (invariant: money state stays server-side, and paid-access rules
stay in one place).

**`messages` has no write policy at all.** Sending goes through
`send_message()`, which takes the conversation's row lock (so `seq` is gapless
and ordered), refuses a duplicate `client_message_id` by returning the original
message, enforces length and per-minute/per-day limits in the database, and
accepts an attachment only if it is the sender's own, filed under this
relationship, processed and `ready`, and not already sent. **A failed or
unfinished upload can therefore never appear as a sent message.**

**Realtime carries no content.** Browsers subscribe to `conversation_signals`,
whose rows say only "something changed here". Row-level security is evaluated
for *every change delivered*, so a suspended or reassigned person stops
receiving them immediately — the reason this table exists instead of
subscribing to `messages`, which would push message bodies down the socket. A
signal is only ever a prompt to fetch; the fetch goes through the same rules.
**The database is the record; the socket is a hint.** The browser must attach
the signed-in session to the realtime connection *before* subscribing: without
it the channel still reports "subscribed" while row-level security silently
filters out everything.

**Read means seen.** `conversation_reads` is a forward-only high-water mark,
moved only by `mark_conversation_read()`. The screen advances it only across a
contiguous run of messages that were actually on screen in a visible tab —
never for a delivered email, a background tab, or an open socket.

**Support cannot browse conversations.** There is no admin policy on
`messages`. Reading one requires `admin_grant_case_message_access()`: tied to a
single case and its conversation, granted to one admin, with a reason, expiring
on a clock, revoked when the case is resolved, and with every grant, view and
revocation written to `support_access_log`. Attachments are listed, never
served, to support.

**Chat attachments are judged by the conversation**
(`chat_attachment_readable()`), and excluded from `coach_may_read_record()`, so
the media rules for progress photos and the rules for chat attachments cannot
be confused with each other.

**`0038` schedules the worker from the database.** `pg_cron` + `pg_net` call
`/api/jobs/process` every five minutes with the bearer secret held in Supabase
Vault — never in a file or a commit. The daily Vercel cron remains an
independent second trigger; every sweep and job is idempotent, so two
schedulers cannot double-send.

### 3.7d Coaching Welcome & Expectations — `0040`, `0041`

```
platform_expectation_versions(id, version, conduct, privacy, support,
                              policy_links[], material, change_summary,
                              published_at, published_by, superseded_at)
coach_expectation_versions(id, provider_id, version, provides, meeting_approach,
                           typical_duration, appointments, messaging_availability,
                           response_expectation, changes, client_part[], coach_part[],
                           material, change_summary, published_at, published_by, superseded_at)
enrollment_expectations(id, enrollment_id, provider_id, coach_version_id,
                        platform_version_id, purchase_id, offer_version_id,
                        source, acknowledgement_requested, previous_id, presented_at)
expectation_acknowledgements(id, presentation_id UNIQUE, actor_profile_id,
                             coach_version_id, platform_version_id, acknowledged_at)
purchases.expectations_coach_version_id / expectations_platform_version_id
messages.kind 'expectations_link' + messages.expectations_presentation_id
```

A mutual-expectations document in three parts: TalentYak's section (admin at
aal2 only), the coach's arrangement (the coach's own words, plus the facts of
the plan from the purchase snapshot, so it always matches what was bought), and
the client's part with the coach's reciprocal commitments. **It is not a
contract, and nothing in it touches money or access.**

**Published versions are immutable**, like offer versions: one draft and at
most one live version at a time (per coach; one platform-wide), a freeze
trigger on everything but `superseded_at`, and no deletion once published.
Coaches and admins write only through functions (`save_my_expectations_draft`,
`publish_my_expectations`, `admin_save_platform_expectations_draft`,
`admin_publish_platform_expectations`). Policy links must be internal paths
(`internal_paths_only()`), so an external link cannot be stored.

**What was shown is what is bought.** The checkout page names the two versions
it displayed; `create_checkout_records()` refuses with `expectations_missing`
(nothing published) or `expectations_changed` (a publish landed in between).
Both it and the coach's publish take the provider row lock, so the check and
the publish serialise. The purchase stores both ids, frozen by
`freeze_purchase_snapshot()`.

**Presentation is one path.** `present_expectations()` (internal: EXECUTE is
revoked from every API role; reached only from the security-definer publish
functions and the assignment trigger) records what a relationship was shown,
posts an `expectations_link` system message into the open conversation, and —
except at purchase — queues `email.expectations_updated` with identifiers
only. Sources: `purchase` (from the snapshot, when the first assignment
opens), `revision`, `reassignment` (the incoming coach's version) and `legacy`
(a relationship that predates this — nothing is ever backfilled).

**Acknowledging records a reading and nothing else.** `acknowledge_expectations()`
is the client's only write: idempotent, server time, append-only (updates and
deletes refused except by cascade). No access function reads acknowledgements,
so an unread document never withholds anything. Reading is decided by
`expectations_readable()` — the client, or the currently assigned coach;
`0041` grants it to `anon` because a sibling policy calls it and anonymous
visitors must read the public live versions before purchase.

Authored text is stored and rendered as plain text (React-escaped, invisible
bidirectional/zero-width characters stripped, no links or embeds).

### 3.7e Scheduling (M09) — `0042`, `0043`

```
scheduling_settings        singleton, mirrors scheduling.v1 (sandbox default)
coach_schedule_settings    durations, buffers, notice, horizon, daily limit, auto-confirm
availability_windows       weekday + local start/end, in providers.timezone
availability_exceptions    unavailable | extra, date range, optional times
appointment_proposals      pending|accepted|declined|countered|withdrawn|expired|conflicted
appointments               held|booked|tentative|on_hold|cancelled|replaced|expired
                           kind coaching|consultation, blocked_from/blocked_to, series_id
appointment_series         reference_timezone, weekday, local_start, interval_weeks
appointment_events         append-only history
appointment_outcomes       append-only, no consequences
messages.kind              + appointment_proposal, appointment_link
```

**A proposal is not an appointment.** It holds no time and expires. Accepting
re-checks eligibility (`meeting_eligibility`) and availability (`slot_problem`)
under the coach's row lock, then inserts; two exclusion constraints — coach and
client, over the meeting plus the coach's buffers (`blocked_from/to`) — make a
double booking impossible, so simultaneous acceptances produce one winner and
a `conflicted` proposal with a reason.

**Lifecycle, history, outcome, payment and eligibility are separate.** State
changes only through the functions (`propose_appointment`,
`respond_to_proposal`, `cancel_appointment`, `record_appointment_outcome`,
`reconcile_appointments`), each writing `appointment_events`. Rescheduling
replaces the original in the same savepoint as the insert, so a failure keeps
it.

**Time.** Instants are stored; zones are IANA only (`is_iana_zone`). A weekly
series is anchored to an explicit reference zone; `local_to_instant` moves a
missing local time forward and uses the first of a repeated one, labelling
both. Display-zone changes and travel never move a series.

**Paid eligibility.** Sessions after `paid_through_at` are `tentative` (they
hold no time) and confirm on renewal if free; `reconcile_appointments` (every
five minutes from the worker) puts sessions on hold when coaching pauses or a
party is suspended, restores them, cancels them when the relationship ends,
extends series, and lapses proposals and holds. A coach change cancels the
outgoing coach's future sessions by trigger.

**Allowances.** Only a purchase whose snapshot names calls per month is
counted (`claim_call_allowance`, per paid billing cycle, under a lock); flexible
coaching has no quota. A one-off session is consumed once.

**One-off sessions.** `create_checkout_records` takes the chosen slot and
inserts a `held` appointment in the same transaction; closing the checkout
releases it (trigger on `checkout_attempts`); the paid billing cycle confirms
it (trigger on `billing_cycles`); a payment after the hold lapsed flags the
purchase `consultation_slot_expired` for an admin (`admin_resolve_consultation`)
— never an automatic refund.

**Calendar availability is not selling capacity.** `max_active_clients` and
`reserve_capacity` are untouched by scheduling.

### 3.7f Programmes (M11) — `0046`

```
plan_templates           coach-owned; kind workout|nutrition; archived_at, never deleted
client_plans             one per (assignment, kind) — each coaching stint has its own
client_plan_versions     draft → published (frozen); effective_from; withdrawn_at;
                         change_summary; notified; source_template_id / source_version_id
plan_session_moves       one session, one week, to another day; append-only
client_training_profiles experience, equipment, session length, days, food prefs, local foods
client_health_profiles   limitations, allergies — client + current coach only
workout_logs  + plan_version_id, session_key      (M12 seam; trigger-checked)
set_logs      + exercise_key, alternative_key     (M12 seam; trigger-checked)
```

Content is one JSON document per version (sessions → exercises → alternatives; guidance, targets, meals → foods), validated in the application and shape-checked by `plan_content_ok()`. Every item carries a stable key. All writes go through security-definer functions (`save_plan_draft`, `start_plan_draft_from`, `publish_plan_draft`, `withdraw_scheduled_plan_version`, `move_plan_session`) gated by `plan_writable_by_me()` → `coaches_enrollment_now()`; reads by `plan_access()` → `coach_may_read_record()` / `enrollment_belongs_to_me()`. Publishing and cancelling queue `email.plan_updated` (category `coaching`). A published version can be removed only when its whole plan is, which happens only with the relationship.

### 3.7g Client logging and progress (M12) — `0047`–`0049`

```
workout_logs          + status (in_progress|completed|partial|skipped), title (unplanned),
                        revision, last_save_id, started_at, finished_at, timezone
                        unique (enrollment, session_key, performed_at) for planned sessions
workout_exercise_logs one exercise in a workout: exercise_key | alternative_key |
                        performed_name (own substitute / added), skipped, load_kind
                        (weight|bodyweight|assisted|none), load_basis (per_hand|total), notes
set_logs              + exercise_log_id, load_value + load_unit as entered, duration_seconds, extra
bodyweight_logs       + entered_value, entered_unit; one per (enrollment, date)
measurements          + entered_unit; one per (enrollment, date)
progress_photos       + media_id (M08 asset), pose
food_entries          dated photo (M08, purpose food_photo) and/or text, optional kcal/protein, revision
food_diary_days       complete flag per day — partial until marked
tracking_preferences  kg/lb, cm/in, log_reminders (client; current coach reads)
tracking_focus        per assignment: fields the coach finds useful + note (advice only)
```

Every client write goes through a security-definer function — `save_workout_log`, `delete_workout_log`, `save_body_entry`, `save_progress_photo`, `remove_progress_photo`, `save_food_entry`, `delete_food_entry`, `set_food_day` — and direct inserts/updates/deletes on these tables are revoked from `authenticated`. Each checks ownership and `tracking_write_state()` (built on `coaching_is_live()`): only `live` may write; `paused`/`ended`/`suspended`/`unavailable` are refused with `tracking_<state>`, and the device holds the entry. Dates are checked against the client's own day (`client_local_today`). Workouts and food entries carry a `revision` (stale save → conflict returned as data, not an error); a workout save also carries a `save_id`, so a re-sent save whose answer was lost is recognised. Body entries use a change token (`body_entry_token`, microseconds since 1970). Coaches read through the existing `coach_may_read_record()` policies; `set_tracking_focus` is the only coach write. The browser talks to one route, `POST /api/tracking`, which maps outcomes to 200 / 409 conflict / 423 held / 422 refused; the device store is `lib/tracking/device.ts` (keys `talentyak:track:<user>:…`, cleared with all `talentyak:` keys on sign-out). Evening reminders run in the worker sweep (`lib/tracking/reminders.ts`, in-app only, deduped per day, capped per week).

### 3.7h Check-ins and coach feedback (M13) — `0050`–`0052`

```
checkin_templates / _versions   coach question sets; a version is frozen (trigger)
checkin_schedules / _versions   one per assignment; cadence 1/2/4 weeks, ISO due weekday + time,
                                explicit client timezone, anchor date, optional response_days
checkin_breaks                  planned breaks (coach or client)
checkins                        one per (schedule, period_start); period, due_at and questions fixed
                                at creation; responsible assignment/provider; status open|submitted|
                                reviewed|reopened|missed|cancelled; needs_resolution after a coach change
checkin_drafts                  client only; revision + save_id
checkin_submissions             append-only versions: answers, media_ids, substantive, progress_snapshot,
                                submit_id (unique), in_paid_time
checkin_feedback                coach drafts, then frozen published versions; next_steps, plan_id,
                                conversation_id, refers_to_revision
checkin_step_links              promised plan change → an M11 version published after the check-in
checkin_events                  what happened, never content
media_purpose                   + checkin_attachment (coach sees it only once sent)
```

Requests are made by `materialize_checkins_for()` (worker sweep, and `refresh_checkins()` on page load) only for the period running now, only while `coaching_is_live()`, never inside a break or pause, never overlapping an earlier request — so no backlog. Clients save drafts with `save_checkin_draft` (live only; paused → held on the device, draft kept). Sending goes through `POST /api/checkins`, which builds the M12 progress summary with the client's own session and calls the service-only `submit_checkin(p_actor, …)` — a device can never write the summary; `submit_id` makes a retry one submission. Coaches read by `coach_may_read_record()` with attachments judged as media, write only feedback (`save_/publish_checkin_feedback`, `complete_checkin_review`, `link_checkin_step`) under `checkin_coach_may_review()`, which includes the approved paid-time exception `checkin_review_exception()`. A trigger on `enrollment_assignments` hands unanswered reviews to the new coach within `history_scope` or flags them; `admin_checkin_attention()` gives TalentYak metadata only. Notices: `email.checkin_notice` through the outbox with per-event dedupe keys, re-checked by `checkin_notice_still_true()` before sending; category `checkins` (optional). Policy: `checkin_access.v1` (confirmed), `checkin_reminders.v1` (sandbox default).

### 3.7i Client and coach dashboards (M15) — `0053`

```
dashboard_marks            a person's own snoozed / handled / dismissed marks (owner reads; written only by set_dashboard_mark)
coach_message_attention()  per coach conversation: unread vs unanswered, waiting since, handled reach — no text
coach_client_activity(ts)  per current client: last dates and counts (security INVOKER: the coach's own RLS)
my_call_allowance(e)       calls left in the current paid cycle, fixed-allowance packages only
```

Both dashboards are server-rendered summaries of the existing modules, read with the person's own session (`web/src/lib/dashboard/client.ts`, `coach.ts`). Each section loads through `attempt()` and fails on its own with a retry (`SectionFailed`); a failed source makes the coach's affected counts read "N+" instead of pretending to be complete. The coach queue is derived by the pure `buildQueue()` (`web/src/lib/dashboard/tasks.ts`): check-ins awaiting feedback (`coach_checkin_queue`, including the M13 paid-time exception), re-reviews (`reopened`), form-check clips (a video in the latest submission that the media policy lets the coach read), unanswered messages, client booking requests (`loadSchedule`), and plans not yet written or drafts. Marks never change the underlying record; a snooze never hides an item that is due, and "handled" covers messages up to the seq the database recorded. Nothing on either dashboard writes a read marker. Today's workout reuses `currentPlanOf` / `weekLayout` / `loggedSessions` (moved from the plan page into `web/src/lib/programmes/server.ts`). Join is offered only for a booked session whose room is open (`appointment_call_info` + `callClock`) and whose coaching is live. `LiveRefresh` re-reads on reconnect, on return to the tab and every two minutes while visible.

### 3.8 How the database defends itself

Three mechanisms, all exercised by the test suite:

1. **Row-level security on every table**, deny by default, written in the same migration as the table. `scripts/check-migrations.mjs` fails the build otherwise.
2. **Action guards.** `in_action('offer_publication')` and friends let the database tell "the coach used the publish action, which validated everything" from "somebody wrote to the table directly". A bug where this returned NULL on a fresh connection made guards pass intermittently; fixed in `0023` and regression-tested.
3. **Assurance levels.** `is_admin()` is false unless the session completed a second factor, so admin reach is a database fact, not a UI decision.

Views run as the **caller** (`security_invoker`) unless documented otherwise — a view that did not leaked every coach's earnings to anonymous visitors, fixed in `0025` and now checked automatically.

---

## 4. Extension node registry

Tables, columns, and stubs that exist without a caller. **Each is listed with the trigger that activates it.** Per §5, none may be deleted or "cleaned up" without a written decision.

| Node | Kind | Status | Activation trigger |
|---|---|---|---|
| `ceremonies` | Table, zero references | Reserved | Pandit vertical gains per-ceremony tracking beyond the booking record |
| `intake_schemas` | Table, never read (schemas come from the registry) | Reserved | Intake forms need versioning independent of a code deploy |
| `workout_logs`, `set_logs` | **Active** (M12): written only through `save_workout_log()`; checked references to plan versions, sessions and exercise keys (`0046`) | Active | See §3.7g |
| `programs`, `program_days`, `exercises` | Tables (`0007`), superseded for new work by `client_plans` (`0046`); still read and written by the legacy booking page `/coach/clients/[bookingId]` | Reserved | Retire with the legacy booking path, by written decision |
| `bodyweight_logs` | **Active** (M12): written only through `save_body_entry()`; unit as entered + `tracking_preferences` | Active | See §3.7g |
| `measurements` | **Active** (M12): written only through `save_body_entry()` | Active | See §3.7g |
| `progress_photos` | **Active** (M12): a date and pose on an M08 asset; `save_progress_photo()` / `remove_progress_photo()` | Active | See §3.7g |
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

**Ceremony recordings — unchanged.** Cloudflare R2 via `web/src/lib/recordings.ts`, retained pandit vertical only, not configured in any environment. Its 7-day links are far too long-lived for body data and it is not used for fitness media.

**Private media — BUILT (`0030`, `0032`–`0036`).** Progress photos, form-review clips and chat attachments live in Supabase Storage in two private buckets, neither with any storage policy, so no browser session can read, list or write them directly.

**Media rows are written by the server only (`0036`).** The owner's policy is
`SELECT`; reservation, completion, processing and deletion all run through
security-definer functions. It was `FOR ALL` until 2026-09-22, which let any
signed-in person insert a row in their own name naming **someone else's**
`storage_path` with `state = 'ready'` — and since `/api/media/<id>` signs
whatever path a readable row names, a coach who had been reassigned away (and
had therefore already seen their former client's paths in the links their
browser followed) could have kept viewing those files indefinitely. A
revocation is only as good as the rows the viewing route will sign.

```
browser ──(1) POST /api/media/uploads ──> reserve row + single-use token for ONE path
browser ──(2) resumable 6 MB chunks (tus) ──> media-uploads/<owner>/<asset>/source   (holding area, never served)
browser ──(3) POST /api/media/complete ──> server confirms the object exists and measures it
server  ──(4) processMedia(): claim (atomic, 10-min lease)
             → read bytes, decide type from bytes (lib/media/sniff.ts)
             → photo: sharp — orient, ≤2048 px long edge, no crop, WebP q82, no metadata
                      (HEIC: decoded first by libheif/WebAssembly in a worker thread, lib/media/heic.ts)
               clip:  ffmpeg — upright, ≤1280 px, ≤60 fps, H.264 High + AAC, faststart, no tags,
                      HDR (HLG/PQ) tone-mapped to BT.709, bitrate capped so the output fits storage
             → re-read the output and check it (format, no metadata, no rotation flag, proportions/duration)
             → write to private-media (upsert false), download it back, compare byte for byte
             → mark ready (the ONLY place metadata_stripped becomes true)
             → only then delete the original
viewer  ──(5) GET /api/media/<id> ──> RLS read AS THE VIEWER → 302 to a 120-second signed link, or 404
```

Why this shape: our hosting refuses request bodies over 4.5 MB, so bytes must not pass through our functions. The storage plan's own per-file ceiling is **50 MB** (measured: 49 MB accepted, 51 MB refused), which is the clip cap; photos are capped at 30 MB and clips at 2 minutes. The length cap comes from measurement on the deployed function: re-encoding runs at 1.0–1.35× the clip's length (30.5 s of 1080p60 took 41.3 s; 75 s took 73.4 s), HEVC runs at ~1.85× and HDR tone-mapping at ~1.6×; the measured worst case (119 s of 1080p60 HEVC) took 163 s against a 265-second encode cut-off, inside the 300-second function limit. A token cannot overwrite an object once written (measured: 409 duplicate). Nothing unprocessed is ever visible to a coach: the coach policy only matches `ready` rows.

**Who may see media.** The owner, always. The current coach, via `coach_may_read_record(enrollment, recorded_at, p_media => true)` from `0021` — reused, not re-implemented. A reassigned coach matches nothing from the moment of reassignment; an incoming coach sees media from before their takeover only when the customer chose the `full` history scope.

**Signed-link residual validity.** A signed link is a bearer token. When access changes, new requests are refused at once, but a link already issued keeps working until it expires: **at most 120 seconds**. Links are minted per request and redirected to, never written into HTML or stored records, so that window is the whole exposure. Uploaded content is served from the storage origin, never from ours, and `X-Content-Type-Options: nosniff` applies.

**Failure and recovery.** A failure retrying could fix keeps the original so the owner can retry (up to five attempts). A permanent refusal — a document, an over-length clip, a file storage refuses as too large — deletes the original immediately (`0034`), because nothing can ever be done with it. A processing claim that has outlived its function three times is failed rather than requeued forever (`0035`). A processor that dies mid-job is requeued after its lease by the scheduled sweep, which also processes up to two stranded uploads per run. Upload tokens that never became a file are failed after 24 hours with their partial bytes removed, and a failed file's held original is released after 14 days. **None of this is retention** — see below.

**Retention — operations built, deletion OFF (`0022`, `0031`).** The order is fixed: *dry run* (who a proposed rule would catch; creates nothing) → *schedule* (approved policies only) → *advance notice* (a failed notice stops the clock) → *holds* (a reason is required; they outrank the schedule) → *final eligibility check* → *execution*. Execution does not exist: `retention_settings.destructive_execution_enabled` is false, every policy is `proposed`, and `retention_execution_allowed()` — the guard any future deletion job must pass — refuses on the switch first. Retention expiry, a person's own deletion request, and housekeeping of abandoned uploads are three different things and are never handled by the same code.

---

## 7. Money flow

### 7.1 As built, and exercised

```
/coaches → coach page → /checkout/<offer version>?currency=USD
   → startCheckout()  [server derives price, interval, capacity from the DB;
                       the browser supplies only an id, a currency and a key]
   → capacity held (~35 min) · checkout_attempt + pending purchase written
   → Stripe-hosted payment   [card details never reach TalentYak]
   → /checkout/return         [UI ONLY — grants nothing; reads the DB and waits]
   → webhook, signature verified, receipt recorded, lease taken
        → the CURRENT object is fetched back from Stripe
        → record_cycle_payment(): billing cycle, enrolment, ledger,
          earning state, purchase state — one transaction
   → recognise_delivered_cycles()   earnings become eligible when the period ends
   → admin_prepare_payout_batch()   claims eligible earnings transactionally
   → CSV export (POST, audited, masked references)   [exported is NOT paid]
   → founder transfers the money in their own service
   → admin_record_payout_paid(reference, time, evidence)   → coach notified
```

The four defects the first version of this file recorded are gone, and each is now covered by a test:

1. **Renewals cannot double-count.** Effects are keyed by what they describe (`cycle:<invoice>:coach_earned`), not by which event carried them, so a replay, a retry, or two different events describing one payment converge on one row. Proven by replaying a real `invoice.paid`.
2. **Refunds reverse.** A refund writes new negative entries against the coach and the platform in the same proportion, and the reversal comes out of future earnings.
3. **Failures are visible.** A webhook that cannot be applied marks its receipt failed and returns 500 so Stripe retries; the scheduled sweep also re-fetches stuck events from Stripe. An event describing a payment we have no record of raises a reconciliation exception instead of being dropped.
4. **The payout export is a POST**, same-origin, admin-only, and audited. The old `GET` route is deleted.

### 7.2 The rules the money obeys

**Three records, never conflated:** what the customer paid · what the coach has earned by delivering · what has actually been transferred.

Commission: **20% on recurring coaching and 20% on one-off consultations**, on the service amount excluding separately identified taxes, after any coach-funded discount. Processing fees come out of TalentYak's share. Integer minor units, **commission rounded first**: `commission = round(base × rate)` half away from zero, `coach = base − commission`, so the two always sum exactly and USD 10.01 splits 2.00 / 8.01.

> **Superseded, kept for reading old rows.** The Aafnai-era rule was 70/30 recurring and 60/40 one-off, rounding the *coach's* share first. Both live in `web/src/lib/policy/registry.ts` as `commission.coaching.v2` and `.v1`. A purchase snapshots the policy id it was written under, so an old row is still computed at its own rate.

**Earnings are recognised as service is delivered, not when money arrives.** A payment sits `pending` until the period it paid for has ended. One-off consultations stay pending until M09 can say an appointment happened.

**Immutability:** amounts are never edited. Refunds, disputes and adjustments are new compensating entries. Workflow state (`earning_states`) lives apart from the immutable amount.

**Settlement is a chain, not an event:** customer payment → processor balance → TalentYak's bank → a separate, separately recorded transfer to the coach. A processor balance is not per-coach escrow and is never shown to a coach as their money.

**Live payments are refused** unless all four locks are open: `LIVE_BILLING=true`, every commercial policy approved, final legal documents, and the ability to deliver what the plan promises (`web/src/lib/fulfillment.ts`). The fourth cannot be unlocked by approving anything.

Detail, including what happens when things go wrong: `docs/operations/payments-and-payouts.md`.

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
| Object storage — media | Supabase Storage | `lib/media/{index,process}.ts` | Clean. Direct resumable uploads use the tus protocol, which other stores also speak |
| Object storage — recordings | Cloudflare R2 | `lib/recordings.ts` | Clean; retained pandit vertical only |
| Media processing | sharp; libheif via `libheif-js` (HEIC); FFmpeg 6.0 via `ffmpeg-static` | `lib/media/{process,heic,ffmpeg}.ts` | Clean. Runs inside our own functions; see §6 for limits |
| Email delivery events | Resend (Svix-signed webhooks) | `lib/email/events.ts`, `app/api/webhooks/resend/route.ts` | Clean. Fails closed without `RESEND_WEBHOOK_SECRET` |
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
