# M08 / M10 / M14 — status of record

**Opened 2026-09-20 (UTC). This is the single checklist for the notifications, workers and private-media batch.** No other plan or report file is to be created for this work. Where a chat summary and this file disagree, this file is the one that was checked against the running system.

Same five-part discipline as `M03-M07-STATUS.md`: **Built** (exists and compiles) · **Tested here** (actually executed) · **Verified against real services** · **Not done** · **Blocked on**. "Complete" is used only where the database behaviour, the server action and the screen all exist and were exercised.

---

## Baseline verified before any work in this batch

| | |
|---|---|
| Date | 2026-09-20 UTC |
| Working tree | `/Users/niyoguprety/dev/TalentYak`, branch `main`, clean at start |
| Commands | `npm run verify` (typecheck + lint + unit tests) |
| Results | typecheck clean · lint clean · **unit 196/196 pass, 42 suites** |
| Migrations | 29 files, `0000` → `0028` |
| Deployment | Live at `www.talentyak.com`; Resend domain verified; app email and Supabase Auth email both send (per `docs/FOUNDER-NEXT-STEPS.md`, 2026-09-20) |

---

## What M08 already has — verified by reading the code, not assumed

This batch is **mostly extension, not new construction**. The following exist and are good. Nothing here is to be rebuilt or duplicated.

### Job system — substantially complete

`web/supabase/migrations/0018_worker.sql` + `web/src/lib/worker/`

- Six-state outbox: `pending` · `processing` · `done` · `blocked` · `failed` · `cancelled`. `blocked` is a first-class state for "unconfigured, not broken" and does **not** consume an attempt.
- `enqueue_outbox` — dedupe key with `on conflict do nothing`, scheduled time, expiry.
- `claim_outbox_jobs` — `for update skip locked` leases, so concurrent workers take different jobs. Expired leases are reclaimed; a lease that expires on the final attempt fails **visibly** rather than being reclaimed forever. Expired-past-`expires_at` jobs are cancelled, not sent late.
- `complete_outbox_job` / `fail_outbox_job` — **only the lease holder may complete**, so a reclaimed job cannot have its outcome overwritten by the stale worker. Exponential backoff from 30s, capped at 6h, with up to 20% jitter.
- `admin_retry_outbox_job` — admin-gated, grants three more attempts, records who and when.
- `notification_deliveries` — records `accepted` / `delivered` / `bounced` / `complained` / `failed` / **`uncertain`** as five different facts. One record per job (unique on `outbox_id`), so a retry updates rather than implying a second send.
- `rate_limit_counters` + `hit_rate_limit` — atomic, database-backed (in-memory counters do not work on serverless), bucket keys pre-hashed.
- All functions `revoke`d from `public, anon, authenticated` and granted to `service_role` only.

**Provider-send ambiguity is already handled honestly.** `SendResult` has no `sent` variant — the union is `accepted` / `unconfigured` / `failed`, with the comment stating that acceptance is not delivery. Resend is called with an `idempotencyKey`. Reserved test domains (`.test`, `.invalid`, `.example`, `example.com`) are refused before send and recorded as such.

### Worker invocation — built, scheduling is the open question

- `web/src/app/api/jobs/process/route.ts` — **fails closed**: with no `CRON_SECRET` it returns 503 rather than serving an unauthenticated endpoint that sends mail. Bearer token compared with `timingSafeEqual`. GET and POST both authenticated identically. Runs sweeps, then up to two bounded worker passes.
- `kickWorker()` uses `after()` to run a pass once the response is sent; if that nudge dies, the scheduled sweep catches the job. **Not browser-dependent.**
- `web/vercel.json` schedules `/api/jobs/process` **daily at 04:00** — the comment in the route states this is what every Vercel plan allows.

### Email — 16 topics live

`email.coach_invitation` · `purchase_confirmed` · `new_client` · `payment_failed` · `subscription_changed` · `refund_processed` · `coach_change_requested` · `coach_changed` (+ `_customer` / `_previous` / `_new`) · `payout_paid` · `profile_approved` · `admin_alert` · `retention_notice` · `shraddha_reminder`. A test asserts **every topic the database can queue has a handler**.

### Retention — contracts built, execution deliberately off

`0022_contracts_and_storage.sql`: `retention_settings` (`destructive_execution_enabled` **false**), `retention_policies` (all three seeded `proposed`, never `approved`), `retention_candidates` (`scheduled` / `notice_failed` / `held` / `export_requested` / `cancelled` / `deleted`, with `is_synthetic`), `retention_notices`, `deletion_requests`. `schedule_retention_notices()` **refuses to schedule a notice for a real person under a proposed policy**. No universal 90/365/730-day rule is asserted as live — each is labelled PROPOSAL.

### Media — images only, and only for coaches

- `src/lib/uploads/image.ts` — magic-byte validation, size cap checked before decode, re-encode, **EXIF/GPS stripped** (tested: "a real photo is re-encoded, and its location data does not survive").
- Buckets: `coach-photos-pending` (private), `coach-photos` (public, admin-approved copies only), `provider-evidence` (private). **No `storage.objects` policy exists for the private buckets**, so `anon`/`authenticated` can neither read nor write them — deny-by-default in storage itself, matching the invariant.
- `guard_profile_photo()` trigger stops a coach pointing their public profile at an arbitrary path.

### Reassignment — the transition model already exists

`0020_payouts_and_reassignment.sql`: `coach_change_requests.history_scope` is `none` / `programme_and_logs` / `full`, chosen explicitly at apply time. **This is the contract media access must honour** — it is not to be re-invented.

---

## Pass A–C — built and verified 2026-09-20

**Scope of this pass:** the notification inbox, preferences, the pre-delivery recheck, and the founder console's delivery visibility. D–F (private media, retention execution, the remaining verification) were a separate pass, recorded below.

### How these checks were run

| | |
|---|---|
| Environment | `next dev` on port 3001 against the hosted Supabase project used as the test environment |
| Commands | `npm run verify` · `npx next build` · `npm run test:db` · `npm run db:migrate` |
| Results | typecheck clean · lint clean · **unit 204/204** (was 196) · **database 107/107** (was 95) · production build succeeds |
| Browser | Built-in browser pane at 1024px and 375px, driven as a real signed-in customer through sign-in, onboarding, inbox and preferences |
| Email | **One real message sent, to the founder-designated address `talentyak@gmail.com`.** Accepted by Resend, message id `01a0c0f9-0e31-70a8-92d4-5fb1c192338b` |
| Money | Nothing touched. No payment, payout or ledger code changed |

### Built

**Migration `0029_notifications.sql`**, applied to the test project (31 files now).

- `notification_categories` — nine categories, each marked `essential` or not. Essential means an account cannot be operated safely without it (security, billing, coaching, session changes, data notices); those have no switch, and the screen does not render one that would do nothing.
- `notification_preferences` — a row exists only where a person differs from the default. No insert/update policy: changes go through `set_notification_preference()`, which **refuses to switch off an essential category**. A direct write could not enforce that rule.
- `notifications` — the inbox. RLS select-own, **no update policy**, so a person cannot rewrite their own audit trail. `path` is constrained to a same-site path, because a stored absolute URL is an open redirect waiting to be rendered as a link.
- `create_notification()` / `notification_email_allowed()` are service-role only; `mark_notification_read()`, `mark_all_notifications_read()` and `set_notification_preference()` are the person's own.

**`src/lib/worker/recheck.ts`** — what must still be true at the moment of sending. Recipient still valid, preference still allows it, appointment still exists, still live, still at the stated time, recipient still party to it. **A failed recheck finishes the job as `done`, not `failed`** — skipping was the correct outcome, and marking it failed would fill the founder console with things nobody should act on.

**`send()` in `handlers.ts` restructured.** Recheck → recipient check → **write the inbox row** → preference recheck → send. The inbox row is written before the provider is called and regardless of whether email is allowed, so switching an email off stops the email, not the telling. All 16 existing topics were given a category and a destination; every one of them is essential, so **no existing auth or billing notification changed behaviour**.

**Seven new handlers and templates**, with producers deliberately not wired: `appointment_confirmed`, `appointment_changed`, `appointment_cancelled`, `appointment_reminder`, `reservation_expired`, `unread_messages`, `expectations_updated`.

**Screens.** `/account/notifications` (inbox, unread count, mark one/all read), `/account/notifications/preferences` (optional toggles, plus the essential list shown as locked), an unread badge on `/account`, and a "What actually reached people" panel plus a bounced-email tile on the founder console.

### Tested here

- **Unit, 204 pass.** Eight new ones covering: a reminder for a moved session is skipped; for a cancelled session is skipped; for a session that already started is skipped; a cancellation still sends because the session being gone is the point; an optional email switched off is suppressed **but the inbox row is still written**; a suspended recipient gets neither; an unread-message email cannot be sent while conversations are unbuilt; a session time is stated in the recipient's own zone (09:00 UTC renders as 04:00 for a Chicago client) with the zone named.
- **Database, 107 pass**, 14 of them new and run as real signed-in people: one person cannot read another's inbox; a person cannot write to their own inbox or rewrite what it says; marking read cannot reach another person's row; the server-only functions refuse a signed-in caller; an optional email can be switched off and **the worker's own check then returns false**; an essential one cannot; a preference row cannot be written directly to bypass that; an ordinary person cannot read delivery records.

### Verified against real services

- **Migration applied** to the hosted test project: `0029_notifications.sql applied. 1 applied, 30 already present.`
- **Real browser, real session.** Signed in as a synthetic customer, completed onboarding, saw the unread badge read 3, opened the inbox, marked one read (3 → 2), turned "Session reminders" off and saved. Then confirmed with a service-role call that `notification_email_allowed` returns **false** for `appointment_reminders` and **true** for `billing` for that person — the browser toggle genuinely reaches the worker's decision.
- **Real email delivered.** Queued `email.admin_alert` to `talentyak@gmail.com`, ran the worker through its real protected endpoint, and it came back `sent: true, accepted: true` with Resend message id `01a0c0f9-0e31-70a8-92d4-5fb1c192338b`. The delivery row records `accepted`, which is **not** proof it landed in the inbox — that is the honest limit of what the system can know, and the founder console says so in those words.
- **Worker endpoint protected.** Locally: 401 with no token and 401 with a wrong token. In production at `www.talentyak.com`: **401, not 503**, which proves `CRON_SECRET` is configured in the production environment.
- **Mobile.** 375px, no horizontal overflow, buttons reachable.

### Not done in this pass (D–F)

Private media, retention execution, export/deletion plumbing, reassignment media revocation — all untouched and unstarted. Destructive retention execution **remains off**, as instructed.

---

## Pass D–F — built and verified 2026-09-21

**Scope:** private media (D), retention operations (E), and verification (F). **Automatic deletion remains switched off**, as the founder instructed; no deletion executor exists.

### How these checks were run

| | |
|---|---|
| Environment | `next dev` on port 3001 against the hosted Supabase test project |
| Commands | `npm run verify` · `npx next build` · `npm run test:db` · `npm run db:migrate` |
| Results | typecheck clean · lint clean · **unit 213/213** (was 204) · **database 136/136** (was 107) · production build succeeds with `/account/media`, `/admin/retention` and `/api/media/upload` registered |
| Migrations | `0030_media.sql`, `0031_retention_operations.sql` applied — 33 files |
| Browser | Built-in browser pane as a real signed-in customer |

### D — Private media

**Built.** `media_assets` with an owner, a coaching relationship, a purpose (`progress_photo` / `form_review_clip` / `chat_attachment`) and processing states (`reserved` → `ready` / `failed` / `deleted`). One private bucket, `private-media`, with **no storage policy of any kind**, so browsers can neither read nor write it. `src/lib/media/accept.ts` decides a file's type from its leading bytes, caps images at 12 MB and clips at 150 MB, re-encodes photos to WebP keeping their **whole frame and proportions** (unlike the square-cropped profile photo), applies camera orientation before dropping metadata, and makes a 400px thumbnail held under the same protection. `src/lib/media/index.ts` reserves the row before any bytes are written, removes the bytes if anything after that fails, and issues links **only after the viewer's own session has read the row**. `POST /api/media/upload` (a route handler rather than a server action, because only XHR reports upload progress), `components/media/uploader.tsx` (progress bar, explicit retry, never automatic), `/account/media` (upload, thumbnails, download, delete), abandoned-upload sweep in the scheduled job. CSP gained `media-src` for clip playback.

**The reassignment rule was reused, not invented.** `coach_may_read_record()` from `0021` already required the customer's `full` history scope before a new coach sees media from before their takeover. `0030` applies that same function; there is no second rule to drift.

**Signed-link residual validity, stated plainly.** Links last **120 seconds**. When a coach is reassigned, new fetches stop at once (the row read fails, no link is issued), but a link already in their browser keeps working until it expires — at most two minutes. Policy cannot close that window; only the lifetime shrinks it. Links are minted on request and redirected to, never written into stored records.

**Honest limits.**
- **Video is not compressed.** Re-encoding video needs ffmpeg, which the hosting does not provide. Clips are checked by magic bytes, size-capped and stored unchanged, and every such row carries `compression_skipped = true`. The upload screen says so.
- **Video metadata is not stripped**, for the same reason. Photos are.
- **No content scanning** of any kind is implemented, and none is claimed.
- **No poster frame for clips**, so the grid shows a labelled placeholder.
- **Chat, progress screens and form review are not built** (M11–M13). This is the reusable layer they will sit on.

**Tested here.** Unit (9 new): a script named `progress.jpg` is refused; a PDF is refused; the kind comes from bytes not extension; an oversized clip is refused **without reading it into memory**; a real photo loses its EXIF and keeps its 2:3 shape; a sideways photo (orientation 6) is stored upright; a clip is stored unchanged and flagged; QuickTime is not mislabelled MP4. Database (16 new), as real users: a visitor and another customer see nothing; the owner sees all of theirs; the current coach sees their client's media; an unrelated coach sees nothing; **a coach cannot create, re-file or delete a client's media**; **a reassigned coach loses access immediately**; the new coach sees media from their own time but **not from before it** on the `programme_and_logs` scope, and **does** once the customer shares `full` history; the customer keeps everything throughout; media cannot be filed under someone else's enrollment; abandoned uploads are swept with a reason; delete returns paths so bytes go too; one person cannot delete another's.

**Verified against real services.** A real 900×1350 JPEG was posted to `/api/media/upload` with a real session and came back 200; it was stored as **WebP, 900×1350, 17.3 KB → 6.8 KB**, and its thumbnail rendered from a signed link under the site's CSP. Through the same live endpoint: a disguised script → 422; a PDF → 422; filing under an enrollment that is not yours → 422. The stored object is refused with no credentials, with the anon key a browser holds, and as a guessed public URL. Deleting through the real button tombstoned the row **and left zero files in the bucket**.

### E — Retention operations

**Built** (`0031`), on the `0022` contracts, deleting nothing:
- `retention_dry_run()` — who a proposed rule would catch, **creating nothing**; two-factor admin only; refuses rules with no implemented eligibility rather than guessing (only `progress_media` has one — programmes and form clips are contracts without data yet).
- `place_retention_hold()` / `release_retention_hold()` — a hold needs a reason, outranks the clock, and **cancels the pending notices and their queued emails**. Release does not revive old notices.
- `retention_ineligible_reason()` and `recheck_retention_candidates()` — the scheduled sweep lets items off when their reason has gone (held, owner already deleted it, no longer past its period, policy not approved). This step can only ever let something off.
- `record_notice_outcome()` — an undelivered notice moves its item to `notice_failed`, which **stops the clock**.
- `retention_execution_allowed()` — the guard a future deletion job must pass. It refuses on four independent grounds; the first is the off switch.
- `request_own_deletion()` — a person's own request, separate from retention, one open request at a time.
- `/admin/retention` — the off switch shown read-only, the proposed rules, the dry-run count, tracked items with hold/release, failed notices, and deletion requests. **There is no delete button, because there is nothing for one to call.**
- `/account/media` — "Ask us to delete your data", stating that payment records are kept by law and anonymised.

**Tested here.** Database (11 new): the switch is still off; a dry run finds a 400-day-old photo and **leaves the candidate count unchanged**; a customer cannot run it; it refuses a rule with no eligibility logic; a hold without a reason is refused, and a hold cancels both notices and their outbox jobs; a customer cannot hold or release; an owner-deleted file and a not-yet-due file are both let off by the recheck; a failed notice stops the clock; the execution guard refuses while the switch is off even for an eligible item; a deletion request is private and asking twice is one request.

**Verified in the browser.** Submitting the deletion request without ticking the confirmation is refused in words; ticked, it is filed and the page shows "We received your request on 21 Sept 2026 … waiting to be reviewed".

**Not verified in a browser:** `/admin/retention` itself. It needs a two-factor admin session, which the automated browser cannot complete; its functions are covered by the database tests as a real two-factor admin, and the page builds.

### F — Scheduled work

The sweep was run through the protected endpoint after these changes: `abandonedMediaCleared: 0`, `retentionCancelled: 0`, `errors: []`. The scheduling gap is unchanged and stated above: once a day on the current plan.

---

## Gaps this batch must close

Ordered as they will be built — one usable workflow finished at a time.

| # | Gap | Where it lands | State |
|---|---|---|---|
| 1 | **In-app notification inbox.** No `notifications` table, no screen. Email is the only channel today. | new migration + `/account` surface | **done (pass A–C)** |
| 2 | **Notification preferences**, separating essential service/account mail from optional. No `notification_preferences` table. | same migration + preferences screen | **done (pass A–C)** |
| 3 | **Pre-delivery recheck.** Handlers send what the payload says. Nothing rechecks appointment version, recipient authorisation, cancellation/reschedule state, or preferences at delivery time. Obsolete reminders are not skipped. | `src/lib/worker/handlers.ts` + a shared recheck module | **done (pass A–C)** |
| 4 | **Unread-message debounce/aggregation.** No aggregation window, no read-status recheck. | worker + sweep | handler + recheck built and **refuses to send**; **producer and debounce window pending (Batch 2)** |
| 5 | **Appointment job family** — confirmation, change requested, change accepted, cancellation, reminder, expired reservation/proposal. Table exists; no handlers, no templates. | handlers + templates | handlers, templates and rechecks **done**; **producers pending (Batch 4)** |
| 6 | **Media assets.** No `media_assets` table, no ownership/purpose metadata, no processing states, no chat/video path, no abandoned-upload cleanup, no thumbnail/preview authorisation, no signed-link policy. | new migration + `src/lib/media/` + upload UI | **done (pass D)** — video uncompressed, stated |
| 7 | **Reassignment media revocation** honouring `history_scope`, covering new fetches and subscriptions. | media authorisation layer | **done (pass D)** — reuses `coach_may_read_record`; 2-minute residual link window documented |
| 8 | **Retention execution** — dry-run eligibility, notice retry/failure handling, holds, cancellation on changed eligibility, final eligibility recheck. Destructive execution stays **off**. | sweeps + admin screen | **done (pass E)** — destructive execution still off |
| 9 | **Admin failed-job / delivery screen.** `retryJobAction` and a failed/blocked **count** exist; there is no screen listing jobs or deliveries to act on. | `/admin` surface | **done (pass A–C)** |
| 10 | **Scheduled invocation evidence** on the real deployment, or the exact scheduler gap stated. | verification | **stated below — the gap is the plan's daily limit** |
| 11 | **Controlled real email delivery** to a founder-designated inbox. | verification | **done — delivered to `talentyak@gmail.com`** |

---

## Integration contracts — pending, deliberately

These are wired as reusable hooks now and connected when their owning batch is built. **They are not to be marked complete in this batch, and no table is to be invented to make them look done.**

| Producer | Owner | Hook prepared here |
|---|---|---|
| Unread-message notifications | Batch 2 (conversations) | aggregation window + read-status recheck |
| Expectations updates | Batch 3 | scheduling + dedupe |
| Appointment reminders / expiry | Batch 4 | scheduling + authorisation recheck |
| Call outcomes | Batch 5 | delivery recheck |

---

## Scheduling — what runs the worker, and what it would cost

### What is true today, verified against the Vercel API on 2026-09-20

The cron **is registered and enabled** on the live deployment. Not "configured in a file" — actually registered:

```
crons.enabledAt   set        crons.disabledAt  null
definitions       [{ path: "/api/jobs/process", schedule: "0 4 * * *" }]
```

The endpoint is reachable and protected in production: `https://www.talentyak.com/api/jobs/process` returns **401**, not 503, which means `CRON_SECRET` is set in the production environment and the cron will authenticate when it fires.

The account shows no billing plan, which is the **Hobby (free)** tier.

### The gap, stated exactly

**Vercel Hobby allows cron jobs to run at most once per day.** `0 4 * * *` is not a preference — it is the finest schedule the plan permits. So today:

- Anything queued by a request is processed **within seconds**, by the `after()` pass that runs once the response is sent. That covers nearly everything a person does: a purchase, a coach change, a payout.
- The **daily 04:00 UTC sweep** is only the safety net for work that missed that pass.
- What this does **not** support is **time-based work that must fire at a particular hour** — chiefly session reminders (Batch 4). A reminder queued for 15:00 would not be sent until the following 04:00, by which point the recheck built in this pass would correctly **skip it as obsolete**. The system would behave honestly; the reminder simply would not arrive.

**A manual run does not prove unattended processing.** What was proven here is that the worker endpoint works, is protected, and processes queued work correctly when invoked. The current deployment is about an hour old, so no scheduled firing has occurred under it yet — the next is 04:00 UTC.

### Options, with real cost

| Option | Cost | What it buys |
|---|---|---|
| **Stay on Hobby, daily sweep** | **$0** | Fine until Batch 4 needs reminders at a specific hour. Everything request-triggered already works. |
| **Vercel Pro** | **$20/month per member** | Cron at any interval, including every minute. The least moving parts: same endpoint, same secret, one line in `vercel.json`. |
| **External scheduler** (GitHub Actions cron, cron-job.org, Supabase `pg_cron` + `pg_net`) | **$0–$5/month** | Calls the same protected endpoint on any schedule. GitHub Actions is free on a private repo within the monthly minutes allowance. Adds a second place to hold `CRON_SECRET`. |

**Recommendation: do nothing yet.** This is not blocking anything in this pass, and it does not become real until Batch 4 builds appointment reminders. When it does, the external scheduler is the cheaper answer and needs no plan change; Pro is worth it only if Vercel is being paid for anyway. Nothing here was upgraded or purchased.

---

## Blockers — founder action required

1. ~~**Designated test inbox for the email-delivery proof.**~~ **Resolved 2026-09-20:** the founder designated `talentyak@gmail.com`, and one message was delivered to it and accepted by Resend.
2. **`SUPPORT_EMAIL` is still empty** (`docs/FOUNDER-NEXT-STEPS.md` item 2). Mail therefore carries no reply address — the delivery-check message that arrived has no address to reply to. Not blocking code; visible in every message sent.
3. **An account now exists for `talentyak@gmail.com` in the test project**, created by the delivery check (profile `3c0b7f0d-aae8-47ff-a212-581337118a9c`). It has a random password nobody holds and **no admin role** — the check briefly set one and it was removed the same session; the script no longer grants it. Delete the account if it is not wanted; deleting an account is a founder action and was not done unilaterally.

### Housekeeping noticed, not fixed

The outbox holds several `failed` jobs reading `coach not found` / `recipient not found`, dated 2026-09-17 and 2026-09-20. These are **orphaned test fixtures** — jobs queued during database test runs whose users were deleted in teardown. They are the system behaving correctly (failing visibly rather than disappearing), not a defect, and they were not caused by this pass. They do make the founder console's "failed or blocked" count read higher than reality. Worth a teardown fix in `test/db/` later; noted in `TASKS.md`.

---

## Next unfinished action

**M08 is finished as far as this batch can take it.** What remains is owned elsewhere or needs a decision:

- **Producers** for the handlers built here — unread messages (Batch 2), expectations (Batch 3), session reminders and expiry (Batch 4), call outcomes (Batch 5).
- **Video compression** needs a transcoding service; none is available on the current hosting.
- **A retention policy** must be approved by the founder before any notice reaches a real person, and a deletion job must then be written and reviewed against it.
- **Processing deletion requests** end to end (what is erased, what is anonymised) — the request is recorded and visible; fulfilling it is a founder-supervised process not built here.
- **Scheduling** below daily — see the scheduling section.

Do not start Batch 2 from this file; it has its own prompt.
