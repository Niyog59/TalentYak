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

> **Superseded in part on 2026-09-21 ("Media uploads and processing", below).** The upload path described here went through our own server, which on Vercel cannot accept a request over 4.5 MB, and video was stored unprocessed. Both are replaced. The access rules, the reassignment behaviour and the tests in this section still hold.

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

## Media uploads and processing — built and verified on the deployed site, 2026-09-21

**What changed.** Files no longer pass through our server. The browser uploads straight to a private holding bucket in resumable chunks; the server then validates, cleans and compresses the file, stores the result, checks it, and only then deletes the original. Video is now actually re-encoded — the earlier "stored unchanged" limitation is gone.

### Limits, and where each one comes from

| Limit | Value | Source |
|---|---|---|
| Request body through our functions | 4.5 MB | Vercel. Why files no longer go through them |
| One file in storage | **50 MB** | Supabase free plan. **Measured**: 49 MB accepted, 51 MB refused `EntityTooLarge`. The API token in use cannot read the setting directly |
| Photo | 30 MB | Ours; decoding is also bounded at 80 megapixels |
| Clip | 50 MB and **2 minutes** | Storage ceiling, and **measured** encode speed on the deployed function (below) |
| Function time for processing | 300 s configured, 230 s encode cut-off | A 78-second processing run completed after the response, so the deployed function is **not** capped at 60 s |
| Signed viewing link | 120 s | Ours |

### How video is processed

`ffmpeg-static` 5.3.0 (maintained; last release November 2025) ships FFmpeg 6.0 with libx264 and AAC. It is added to the three processing routes only (`/api/media/complete`, `/api/media/retry`, `/api/jobs/process`) — about 115 MB per route including the image library, inside Vercel's 250 MB limit. A bundling fix stopped the build tracing the entire project into those routes (it had been 120 MB of unrelated files). `ffprobe-static` was rejected: 350 MB and unmaintained; ffmpeg reports the same stream facts.

Output: H.264 High / yuv420p / AAC, MP4 with the index at the front, upright (the rotation matrix is applied to the pixels, not kept as a flag), at most 1280 px on the long edge, frame rate kept up to 60 fps, audio kept. Every container and stream tag is dropped; the only tag left in the output is `encoder: Lavc libx264`, which names our tool, not the person or device.

**Measured on the deployed function (one CPU):**

| Clip | Source | Output | Saved | Encode time |
|---|---|---|---|---|
| 30.5 s, 1080p60 portrait, 13 Mbps, location + make/model | 48.0 MB (50,307,290 B) | 16.7 MB (17,489,893 B), 720×1280, 60 fps, stereo AAC | 65.2 % | 41.3 s |
| 75 s, 1080p60 landscape, 5 Mbps, location | 44.1 MB (46,192,162 B) | 16.5 MB (17,277,349 B), 1280×720, 60 fps | 62.6 % | 73.4 s |

Encode runs at roughly **1.0–1.35× the clip's length**. That is why clips are capped at 2 minutes (worst case ~160 s against the 230 s cut-off); 3 minutes would not fit reliably. Test clips are synthetic (generated to carry a phone's rotation matrix, location, make, model and creation-time tags, at phone bitrates), and are deliberately hard to compress; real footage usually compresses better.

### Photos

**Measured on the deployed site** — a 12-megapixel JPEG stored sideways (orientation 6) with a GPS block, make, model and artist, as a phone writes a portrait shot:

| | Bytes | Dimensions (as shown) | Metadata |
|---|---|---|---|
| Uploaded | 9,391,759 (9.0 MB) | 3024×4032 | EXIF, GPS, colour profile, orientation 6 |
| Stored | 936,242 (0.9 MB) | 1536×2048 | none |

**90 % smaller**, upright, exact 3:4 proportions (no crop, no stretch), long edge 2048 px, WebP quality 82. Downloaded independently afterwards: `exif=false xmp=false iptc=false icc=false orientation=none`, and a raw byte search for "GPS", "iPhone", "Apple" and the artist's name finds nothing.

**Formats.** *(Superseded by the completion pass below: HEIC is now accepted.)* Accepted at the time: JPEG, PNG, WebP, AVIF; MP4, MOV, 3GP, WebM. **iPhone HEIC was refused, not accepted**: the image library on our servers has no HEVC decoder. It is refused instantly in the browser with instructions ("Settings → Camera → Formats → Most Compatible, or share as JPEG"), and — if the browser check is bypassed — refused again by the server, with the original deleted. Earlier code would have misread a HEIC as a video (same container family); that is fixed and tested. The HEIC test file is a HEIC-branded container, not a real iPhone capture: no HEVC encoder is available to produce one.

### Security and cleanup

- Upload tokens are single-use, for one path, issued only for the signed-in person's own reserved row. The owner is the session, never a form field.
- **Overwrite after upload is refused** by storage (measured: reusing the token → 409). Processed files are written with `upsert: false` at new paths, and a retry never writes over an earlier result.
- The holding bucket has no storage policy: a browser session cannot read or list it (database test, as the owner and as a coach).
- The original is deleted **only after** the cleaned copy is stored, downloaded back, compared byte for byte, and recorded. A retryable failure keeps the original for retry; **a permanent refusal deletes it immediately** (`0034`).
- A processing claim holds a 10-minute lease; a processor that dies is requeued by the scheduled sweep after 15 minutes, which also processes up to two stranded uploads per run. An upload that never finished is failed after 24 hours and its partial bytes removed; a failed file's original is released after 14 days. **None of this is retention**, whose deletion stays off.
- Viewing, preview and download all go through `/api/media/<id>`, which reads the row **as the viewer** and redirects to a 120-second link, or returns 404 for any refusal.

**Residual validity of issued links, measured:** a 120-second link returned 200 at issue and at 60 s, and was **refused at 125 s** (400). When a coach is reassigned, new requests are refused at once; a link they already hold works for at most the rest of its two minutes.

### Deployed verification — `www.talentyak.com`, commits `5f4d6fc` and `0e97c0e`, signed in as synthetic test accounts

| Check | Result |
|---|---|
| Photo over 4.5 MB (9.4 MB) | Uploaded as two 6 MB chunks straight to storage; our server saw only two small JSON calls. Processed as in the photo table |
| Clip near the cap (48.0 MB) | Uploaded in 9 chunks, processed in 41.3 s, as in the video table |
| Oversized, via the page | 55 MB clip refused instantly with the 50 MB message; **no request made** |
| Unsupported, via the page | HEIC refused with instructions; a PDF renamed `.jpg` refused. **No request made** for either |
| Oversized, bypassing the page | Declaring 60 MB → 422. Declaring 31 MB for a photo → 422. Declaring 1,000 bytes then sending 51 MB → **storage refused, 413** |
| Unsupported, bypassing the page | HEIC and PDF uploaded to holding, then **refused by the server**, permanent, never marked clean. On `5f4d6fc` their originals were still held for 14 days; that is what `0034` fixed |
| Interrupted upload and retry | Third chunk of the 48 MB clip failed as a dropped connection → "The connection dropped at 12.0 of 48.0 MB. Try again…". **Try again** asked storage for its offset (HEAD 200) and resumed at byte 12,582,912, not 0. The finished file encoded to exactly the same 17,489,893 bytes as the uninterrupted upload — the resumed file was byte-identical |
| Processing failure and retry | A clip cut short mid-export failed: "Processing check failed (the duration changed). Nothing was stored." **Try processing again** reprocessed it (attempt 2); it failed again, correctly, because the file is damaged. Permanent refusals show no retry button |
| Authorised viewing | Thumbnail loaded (360×480); both clips loaded through the view route (720×1280 and 1280×720, correct durations); **played 4 s with an audio track**, 18 s buffered |
| Unrelated account | 12 of 12 requests — original, preview and download for each of 4 files — **404**; their page lists nothing; retrying the owner's failed clip → 409 |
| Over-length clip (after `0e97c0e`) | A 130-second clip refused: "That clip is 130 seconds long. Clips can be up to 2 minutes — trim it and upload again." Permanent; **original deleted at once** |
| Refused originals (after `0e97c0e`) | A HEIC sent around the browser check was refused and its original deleted immediately: the account's holding folder was empty afterwards, and the object could not be fetched even with the server key |
| Coach-change access | Unchanged rule, reused; covered by 25 database tests as real users, including a reassigned coach losing access and an incoming coach seeing earlier media only with full history shared. Not re-driven in the browser: there is no coach media screen yet (M11–M13) |

### Tests

Unit **214** (was 213; media tests replaced and extended: format detection incl. HEIC-vs-video, photo orientation/metadata/proportions/no-enlarge, clip rotation/metadata/audio/fps, junk refused permanently, truncated clip refused retryably). Database **media 25/25** (holding path ownership, completion ownership, concurrent claims take a file once, coaches never see unprocessed uploads, only completion marks a file clean, retry rules, crashed-processor requeue, abandoned-upload cleanup, holding bucket unreadable from a browser).

### What was still not done at this point

*(Resolved or reassigned in the completion pass below.)* HEIC was refused; pause/resume had not been exercised on the deployed site; coach-side media screens did not exist.

### Decisions and costs — nothing needed today

Nothing was bought or upgraded. If clips longer than 2 minutes or larger than 50 MB become necessary:

1. **The storage ceiling comes first.** Supabase Pro (**$25/month**) makes the per-file limit configurable. Nothing else fixes it.
2. **Then encode time.** Recommended: move `processVideo()` — unchanged — to one small always-on worker with FFmpeg, e.g. a Fly.io shared-CPU machine (**about $2–6/month** at this volume), polling the same `uploaded` queue. Setup: a Dockerfile with the Node runtime, the service key as a secret, and the processing routes stop calling FFmpeg themselves. A managed service (Mux, Cloudflare Stream) was not chosen: per-minute pricing, and the originals would leave our storage.

---

## Gaps this batch must close

Ordered as they will be built — one usable workflow finished at a time.

| # | Gap | Where it lands | State |
|---|---|---|---|
| 1 | **In-app notification inbox.** No `notifications` table, no screen. Email is the only channel today. | new migration + `/account` surface | **done (pass A–C)** |
| 2 | **Notification preferences**, separating essential service/account mail from optional. No `notification_preferences` table. | same migration + preferences screen | **done (pass A–C)** |
| 3 | **Pre-delivery recheck.** Handlers send what the payload says. Nothing rechecks appointment version, recipient authorisation, cancellation/reschedule state, or preferences at delivery time. Obsolete reminders are not skipped. | `src/lib/worker/handlers.ts` + a shared recheck module | **done (pass A–C)** |
| 4 | **Unread-message debounce/aggregation.** No aggregation window, no read-status recheck. | worker + sweep | **done (M14)** — producer in `send_message`, one job per unread run, 15-minute delay, live count + access recheck at send |
| 5 | **Appointment job family** — confirmation, change requested, change accepted, cancellation, reminder, expired reservation/proposal. Table exists; no handlers, no templates. | handlers + templates | handlers, templates and rechecks **done**; **producers pending (Batch 4)** |
| 6 | **Media assets.** No `media_assets` table, no ownership/purpose metadata, no processing states, no chat/video path, no abandoned-upload cleanup, no thumbnail/preview authorisation, no signed-link policy. | new migration + `src/lib/media/` + upload UI | **done** — photos and clips processed, including HEIC and HDR (completion pass) |
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
| Unread-message notifications | Batch 2 (conversations) | **connected in M14** |
| Appointment proposals / links to confirmed appointments inside a conversation | Batch 4 | message `kind` boundary in `0037`; database refuses structured kinds until built |
| Links to agreed expectations inside a conversation | Batch 3 | same boundary |
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

**Unattended processing is now evidenced.** An outbox job queued on 2026-09-20 at 22:39 UTC was completed at **04:18 UTC on 2026-09-21** by the scheduled job, with nobody invoking it — the daily cron fires on its own. (Vercel's Hobby plan runs a daily cron somewhere within its scheduled hour, hence 04:18 rather than 04:00.)

### Options, with real cost

| Option | Cost | What it buys |
|---|---|---|
| **Stay on Hobby, daily sweep** | **$0** | Fine until Batch 4 needs reminders at a specific hour. Everything request-triggered already works. |
| **Vercel Pro** | **$20/month per member** | Cron at any interval, including every minute. The least moving parts: same endpoint, same secret, one line in `vercel.json`. |
| **External scheduler** (GitHub Actions cron, cron-job.org, Supabase `pg_cron` + `pg_net`) | **$0–$5/month** | Calls the same protected endpoint on any schedule. GitHub Actions is free on a private repo within the monthly minutes allowance. Adds a second place to hold `CRON_SECRET`. |

**Recommendation: do nothing yet.** This is not blocking anything in this pass, and it does not become real until Batch 4 builds appointment reminders. When it does, the external scheduler is the cheaper answer and needs no plan change; Pro is worth it only if Vercel is being paid for anyway. Nothing here was upgraded or purchased.

### RESOLVED 2026-09-22 (M14): Supabase Cron, every five minutes, at no extra cost

`0038_scheduled_worker.sql` schedules `pg_cron` + `pg_net` to call the same protected endpoint every five minutes, with the bearer secret held in Supabase Vault (`worker_cron_secret`, mirroring `CRON_SECRET` in Vercel; written by `scripts/configure-worker-cron.mjs`, never in a file or a commit). The daily Vercel cron stays as an independent second trigger — every sweep and job is idempotent, so two schedulers cannot double-send.

**Verified on the live project, nobody invoking anything:** `cron.job` shows `talentyak-job-worker */5 * * * * active`; runs at **17:25:00 and 17:30:00 UTC succeeded** and `net._http_response` recorded **200** for each. End to end on the deployed site: a queued unread-message job was picked up by the 17:30 run, the handler counted the message against live read markers, wrote the in-app notification ("You have 1 unread message", linking to the conversation), and refused the email because the fixture address is on a reserved test domain — no real email was sent. Cost: one small function call every five minutes (~8,640/month), inside the free allowance. **Still open for Batch 4:** nothing here proves a reminder fires at a specific hour; that now depends only on a producer, not on the schedule.

---

## Blockers — founder action required

1. ~~**Designated test inbox for the email-delivery proof.**~~ **Resolved 2026-09-20:** `talentyak@gmail.com`; one message delivered and accepted by Resend.
2. ~~**`SUPPORT_EMAIL` is empty.**~~ **Resolved 2026-09-20:** set to `talentyak@gmail.com` in Vercel (production and preview) and redeployed.
3. ~~**`RESEND_WEBHOOK_SECRET`.**~~ **Resolved 2026-09-21.** The founder added the Resend webhook (`email.delivered`, `email.bounced`, `email.complained`, `email.failed` → `https://www.talentyak.com/api/webhooks/resend`) and set the secret in Vercel production. Verified: an unsigned request and a forged signature are both refused (401, previously 503). A delivery-check email to `talentyak@gmail.com` (Resend id `01a0c675-fb94-746a-9e4f-4be7c237ae94`) was sent through the worker and its record moved from **accepted to delivered** on the signed event Resend sent to the live site. The test-send script now uses a dedicated, clearly labelled `email.delivery_check` message rather than a founder alert, which since this pass only goes to current administrators.
4. **An account exists for `talentyak@gmail.com` in the test project** (profile `3c0b7f0d-…`), created by the delivery check, with no admin role. **One consequence, now fixed:** a founder alert queued during the single minute in which the check had briefly given that account the admin role was sent to it at 04:18 UTC on 2026-09-21 ("Needs attention: Coach change requested", about a test fixture). The handler now re-checks that the recipient is still an administrator at send time. Delete the account if it is not wanted.

### Housekeeping — resolved

The outbox's 29 `failed` jobs ("coach not found" / "recipient not found") were all messages to test accounts deleted after queueing. Handlers now treat a deleted recipient as **skipped**, not failed (a missing purchase or appointment still fails visibly), and those 29 rows were reclassified accordingly with a note. The founder console's failed-or-blocked count went from 29 to **0**.

---

## M08 completion pass — 2026-09-21

### Built

- **HEIC photos accepted.** `lib/media/heic.ts` decodes with libheif compiled to WebAssembly (`libheif-js` 1.23.2, with the libde265 HEVC decoder) in a **separate worker thread** with a 30 s deadline and a 50-megapixel cap checked before the pixel buffer is allocated. The camera's rotation is applied by the decoder; only bare pixels come back, which are re-encoded, so no metadata can survive. The 30 MB photo cap is unchanged.
- **iPhone HDR video.** 10-bit HLG/PQ clips are tone-mapped to standard-range BT.709 H.264 (`zscale` + `tonemap`) instead of coming out grey; if the filter were missing the clip would still be made playable and the report would say it was not converted.
- **Processed clips always fit storage.** A maximum bitrate guarantees the output is under ~44 MB whatever the clip. (A faster encoder preset was tried for heavy clips, deployed, and **reverted**: on a 119 s clip it produced 79.7 MB, which storage refused, for a 7 % time saving.) A storage size refusal is reported as such and is not offered a retry. Encode cut-off 265 s, inside the 300 s function limit.
- **No endless requeue** (`0035`): a processing claim that has outlived its function three times is failed with a reason; the original is kept for a manual retry.
- **Delivery events** (`/api/webhooks/resend`, `lib/email/events.ts`): Svix signature verified in constant time, 5-minute replay window, fails closed without a secret, and a delivery never moves backwards (a late "delivered" cannot undo a bounce).
- **Recipient authorisation rechecked for founder alerts** at send time; **deleted recipients skipped, not failed** (above).
- **Security updates:** `next` 16.3.0 → **16.3.5** (two critical advisories, including remote code execution in the image optimiser with AVIF files), `sharp` → **0.35.4** as a direct dependency (libheif advisory), `js-yaml` → 4.3.2. `npm audit`: **0 vulnerabilities**.

### Residual risk, stated

`libheif-js` 1.23.2 is the newest published, and bundles libheif 1.23.2. libheif released further fixes (1.23.3–1.23.5, the last on 2026-09-21), some in parsing code every HEIC passes through. They are not yet in any published `libheif-js`. Mitigation in place: WebAssembly cannot corrupt memory outside its sandbox, the decode runs in its own thread with a deadline and a pixel cap, and the file is size-capped. Upgrade `libheif-js` when a release carrying libheif ≥ 1.23.5 appears (`TASKS.md`).

### Samples used — and what they are not

No real phone captures were available to this work. Samples were produced with **Apple's own encoders on this Mac**: HEIC by `sips` (brands `heic mif1 MiPr miaf MiHB`, as an iPhone writes, carrying GPS, make/model and a rotation box), HEVC video by `avconvert`. The HDR clip is 10-bit HLG HEVC with BT.2020 tags and a rotation matrix, made with x265 to match an iPhone's stream parameters. These exercise the same decode paths as phone files, but they are not phone captures; see "Samples needed from the founder" below.

### Verified on the deployed site (commits `2ec88ed`, `aec968c`, `0acfc6d`)

| Check | Result |
|---|---|
| Apple HEIC, 8.3 MB, GPS + EXIF + rotation box | Upright **1536×2048 WebP, 0.96 MB (88.5 % smaller)**; downloaded independently: no EXIF, XMP, IPTC, ICC or orientation flag; no GPS/Apple/iPhone strings in the bytes |
| iPhone-style HDR clip, 10-bit HLG HEVC, portrait, 5 identifying tags | **Tone-mapped** to 8-bit BT.709 H.264, upright 720×1280, stereo kept, 9.1 → 3.3 MB (63.9 %), **31.7 s** for 20 s; no tags |
| Apple-encoded HEVC clip, 44.4 MB, 1080p60 | 8.5 MB (80.9 %), 60 fps kept, tags removed, **48.0 s** for 26 s |
| Worst case: 119 s of 1080p60 HEVC, 45.8 MB | **163 s** alone (cut-off 265 s), 48.0 → 23.8 MB, 60 fps. Under the reverted fast preset it had **failed** — "The processed file couldn't be stored" — keeping its original; **Try processing again** then succeeded on attempt 2 |
| Pause / resume with the real buttons | Paused at 12.0 of 48.0 MB with a clear message; **Resume** continued from byte 12,582,912; the result was **byte-identical** (17,489,915 bytes) to an uninterrupted upload of the same file |
| Founder console behind two-factor sign-in | `/admin/retention` (switch Off, proposed rules, dry run computed, no delete button), `/admin/finance` delivery panel, overview bounced-email tile — all rendered for a two-factor test admin |
| Resend webhook | Deployed; **503 without the secret**, as designed |

Measured processing rates on the deployed function: H.264 1080p60 ~1.35× the clip's length, HEVC 1080p60 ~1.85×, HDR tone-mapping ~1.6× at 1080p30. At the 50 MB cap an ordinary iPhone clip is only 15–30 s long; the 2-minute limit is only reachable by a heavily compressed clip, and the measured worst case fits with ~100 s to spare. Two uploads processed at the same moment share the machine and take roughly twice as long each.

### Tests

Unit **228/228**. Database **155/155** before this pass's final fixes, then media 26/26 after them; worker and delivery events 10/10 (concurrent claims never overlap, a dead worker's job is reclaimed, a stale worker cannot overwrite the outcome, backoff, visible final failure, future jobs not taken early, a person cannot claim or queue work, delivery states move only forward).

### Samples needed from the founder

The code paths are proven with Apple-encoded samples. To confirm against genuine captures, please provide:

1. **One iPhone photo as HEIC** — straight from the Photos app via AirDrop or "Save to Files" (not shared through a messaging app, which converts it), taken in **portrait orientation with Location Services on for the Camera**.
2. **One iPhone video** — portrait, **15–25 seconds**, recorded at the default settings (HEVC, HDR on), under 50 MB, also shared as the original file.
3. *(Optional)* **One Android photo and one Android video**, originals.

Put them in a folder and give me the path; nothing will be uploaded anywhere but the test project, and they will be deleted afterwards.

---

## M14 — private messaging, built and verified 2026-09-21/22

Founder prompt: *02-M14 Private Messaging, full scope, one final verification* (21 Sept 2026). Decisions taken with the founder at plan time: messaging is available to **every paid relationship** (the plan's free-text `messaging_channel` is the coach's promise, not a gate); a new coach **never** sees a previous coach's thread, whatever `history_scope` says; a plain-text **export** for participants; the worker is scheduled by **Supabase Cron**. The prompt is treated as the founder's answer to `OPEN-06` (messaging in scope) — recording that in the decision register is a proposal, not done here.

### Security fix shipped first (separate commit `f21e08c`)

Found while planning chat attachments: the `media_assets` owner policy was `FOR ALL`, so any signed-in person could insert or edit a row in their own name — including `storage_path` and `state`. The viewing route signs the path a readable row names, so a **reassigned coach who had seen a client's file path could forge a `ready` row and keep viewing it**. `0036` makes owners read-only (every write already went through server functions) and revokes the table write privileges. Verified: media database suite 31/31 (5 new: forged insert refused, repoint/re-state refused, owner still reads and deletes through `delete_own_media`, nobody edits another's row); live through the real routes on a local server against the hosted project, 12/12 — real upload processed, owner and coach get links, **the former coach gets 404 on the same session**, forged insert "permission denied", owner self-edit changes nothing.

### Built

**`0037_messaging.sql`**
- `conversations` — one per coach **assignment**, created by trigger on `enrollment_assignments` (backfilled). A reassignment opens an empty thread with the new coach.
- `conversation_access(conversation, person)` — the single decision every policy and function uses. It reuses `enrollments.state` (kept by `end_lapsed_enrollments` from the purchase), so there is no second billing authority. States: active, paused, pending, ended, reassigned, suspended, each with a reason for the screen.
- `messages` — gapless per-conversation sequence under a row lock; `client_message_id` unique per sender (a retried send returns the original); plain text ≤ 4,000 characters; `kind` limited to text/attachment/system (structured kinds refused until Batches 3/4). **No write policy**: `send_message()` checks access, length, per-minute and per-day limits, and that an attachment is the sender's own, in this relationship, **processed and ready**, and unused.
- `conversation_reads` — forward-only read markers, visible to both participants (read receipts).
- `conversation_signals` — **content-free** rows in the `supabase_realtime` publication; row-level security is evaluated per delivered change.
- `coach_messaging_profiles` — working hours, the coach's own response statement, away-until and note.
- `support_cases`, `support_message_access`, `support_access_log` — cases are visible to the reporter and admins only; reading a conversation needs a **per-admin, per-case, expiring grant with a reason**, every grant/view/revocation is logged, attachments are listed but never served to support, and resolving a case ends its grants. No admin policy exists on `messages`.
- Media: chat attachments are judged by the conversation (`chat_attachment_readable`), and excluded from `coach_may_read_record`, so an incoming coach with `full` history does not see what a client sent the previous coach. `reserve_media_upload` lets the current coach upload a chat attachment into a relationship they coach — nothing else.
- `messaging_settings` mirrors `messaging.v1` (new, `sandbox_default`) in the policy register; a database test asserts they agree.

**`0038_scheduled_worker.sql`** — `pg_cron` + `pg_net` call `/api/jobs/process` every five minutes with the same bearer secret, read from Supabase Vault (`worker_url`, `worker_cron_secret`, written by `scripts/configure-worker-cron.mjs`; the secret is never in a file or commit). The daily Vercel cron stays as an independent second trigger; both are idempotent.

**Application** — `/account/messages` and `/account/messages/[id]` (client), `/coach/messages`, `/coach/messages/[id]`, `/coach/messages/availability` (coach), `/account/support` and `/coach/support` (report a problem), `/admin/support` and `/admin/support/[id]` (case resolution), `/api/messages/[id]/export`. Linked from the account page, the coach navigation and the founder console. The worker's unread email is now real: counted at send time against live read markers and access, message text never included, link to the right screen per role; `email.support_case_opened` fans out to current admins with category and role only. `FULFILLMENT.messaging.ready` is now `true`.

**Conversation screen** — history paged 40 at a time with scroll position kept; day headings and times in the reader's own timezone; sending/sent/failed states with explicit retry and delete; unsent messages kept on the device until confirmed; realtime prompt → catch-up fetch, plus catch-up on reconnect, focus, visibility and every 60 s (20 s when not live); a message counts as read only when ≥ 60 % on screen **in a visible tab**, and the marker advances only across a contiguous run the reader actually saw; opens at the first unread message; attachments through the M08 uploader with processing states, sendable only once ready; composer that works with screen readers (Enter = new line, Ctrl/⌘+Enter = send); sized to the visible viewport so the composer stays above a phone keyboard; coach availability shown as the coach's own words; privacy notes (not end-to-end encrypted; downloaded content cannot be recalled; ending access stops future access only). Typing indicators: **not built** (optional in the prompt).

### Tested here

| Suite | Result |
|---|---|
| `npm run verify` (typecheck, lint, migration check, unit) | clean; **unit 240/240** (was 228) |
| `next build` | succeeds; the 10 new routes registered |
| Database, all 7 files, as real users | **190/190** across three runs: 70 (access matrix, media) · 120 (messaging, notifications, retention, worker, workflows). The first full run was killed by the idle watchdog after a realtime test failed — see below |

Messaging database suite (31): policy mirror; outsiders (visitor, other customer, unrelated coach) see nothing in any of the four tables and cannot send, mark read or read state; `conversation_access` not callable with another person's id; ordered gapless history; retried and **raced** duplicate sends make one message; direct insert/update/delete refused; empty/oversized/structured refused; markers forward-only and capped; unread counts clear across **two sessions of one person**; one email job per unread run, delayed, no message text, recheck returns 0 after reading; two relationships kept apart, each coach's inbox holds only their own client; attachment rules (current coach may upload, unrelated coach may not, coach cannot file a progress photo, unprocessed file cannot be sent, sent once, visible to both participants only, someone else's file cannot be attached); support (other participant never sees the case, no admin reads without a grant, grant is personal, logged and expires, resolution needs a note and ends grants); lifecycle (paid time out: both read, nobody sends; **suspension stops an open session's reads, writes and signals**; reassignment: neither coach reaches the old thread even with `full` history, client keeps it read-only, new thread starts empty; ended: client reads, coach loses access); realtime (a participant receives a content-free signal; a **suspended participant's open subscription receives nothing** while a control signal is emitted); per-person send rate limit.

**Corrected during verification, stated plainly.** The first version of the suspended-subscription test ignored whether its control message was sent — and it was not, because a client cannot send to a suspended coach — so its earlier pass proved nothing. The test now uses a read by the client as the control event and asserts the signal was emitted.

### Verified in two independent browser sessions (production build, `next start`, against the hosted project)

Client on `localhost`, coach on `127.0.0.1` (separate cookie jars), synthetic accounts, sessions set by a local cookie helper — no password typed.

| Check | Result |
|---|---|
| Send / receive | Client message appears in the coach inbox with unread count 1 and a preview; times correct in Chicago and Kathmandu |
| Realtime | A message sent from outside the browser appeared in the coach's screen **and the client's other session within 3 s, no reload** |
| Hidden tab | Conversation open in a hidden tab: message shown, **no read marker written**, sender still sees "Sent" |
| Read receipts across sessions | Coach tab made visible → marker moved → client's receipts turned "Read" live |
| Opening with unread history | 60 seeded messages: opened at the "New messages" line, loaded back to include it; the marker advanced only over the reader's own messages while the tab was hidden |
| Paging | 40 loaded, "Show earlier messages" loaded the rest, the anchored message moved **0 px** |
| Response lost after the server stored it | Screen showed the failure, then reconciled by client id on the realtime prompt: one message |
| Explicit retry with catch-up held off | "Try again" → one stored copy (database count 1) |
| Refresh / reconnect catch-up | A message missed while a tab's network was down appeared on reload |
| Photo | Uploaded through the real uploader, processed (WebP 900×1200, metadata stripped), sent with a caption, rendered for both; original 200 for the coach; signed-out 404 |
| Clip | Coach's WebM clip processed, reached the client live, loaded through the authorised route (3 s, 640×360, no error) |
| Failed attachment | A PDF disguised as `.jpg` refused before upload; nothing sent; Send disabled |
| Coach availability | Saved; client sees the coach's words, hours in Kathmandu time, away notice in their own time |
| Mobile, 375 px | No horizontal overflow; header and composer both on screen |
| Suspension with an open session | Page load → "Account paused"; an already-open tab's send refused, nothing stored |
| Report a problem → resolution | Client filed a case from the conversation; two-factor admin saw it, granted access with a reason, read the thread (attachments listed, not shown), resolved with a note; access record shows granted, viewed ×2, revoked (case resolved) |
| Non-participant admin | Conversation page, export and attachment: **404** |
| Export | Participant gets a text file with their own times; signed-out 404 |

**Bugs found by this browser pass and fixed before commit:** (1) the realtime channel subscribed before the session was attached, so row-level security filtered every signal while the screen claimed "Up to date" — the token is now set before subscribing and on refresh; (2) a dropped network left the label "Up to date" and stopped polling — offline now shows as paused and a 60 s catch-up always runs; (3) opening at the first unread used `scrollIntoView`, which scrolled the page off the header on phones, and the composer sat below the fold — both fixed; (4) a suspended session was told "You've been signed out" — it now says the account is paused.

**Not verified in a browser:** typing on a real phone keyboard (layout measured at 375 px only); the reassignment and paid-period-end paths (database tests as real users only); the video *playing* (it loaded and decoded, but browsers pause media in a background tab and the test pane was hidden).

### Honest limits

- **Not end-to-end encrypted**, and the screen says so. Support can read a conversation only under a logged, expiring, per-case grant.
- **Already downloaded content cannot be recalled.** Revocation stops new reads, links (two-minute media links; see M08) and signals.
- The realtime server checks access **per delivered change**, which is what makes suspension immediate; at much larger scale this per-change check costs database time.
- Unsent drafts and failed messages are kept in the browser's local storage on that device until confirmed or deleted.
- Pre-purchase messaging is **off** (`messaging.v1`), and no path creates a conversation without a paid assignment.

### Costs

Nothing bought. Supabase Realtime, `pg_cron`, `pg_net` and Vault are included in the current plan. Every five minutes the scheduler calls one Vercel function (≈ 8,640 invocations/month, each seconds long), within the free allowance.


### Live-alert outage, 2026-09-25 — found, investigated, hardened

The full database suite (rerun after the founder replaced the Supabase access token) showed live alerts not reaching signed-in participants, twice. The server-key listener still received them, so delivery itself worked and the per-person check was not letting them through. The next day the same test, instrumented, measured arrival at **0.2–0.4 s** twice and passed; a clean reproduction and a manual replay of the permission check as the coach both passed. **Cause not confirmed** — the platform's live-update logs were not reachable through the management API — and the evidence points to a temporary fault on the provider's side. No database change was needed.

What it exposed, now fixed: (1) the conversation screen trusted the connection's "subscribed" state, so it would say "Up to date" while alerts silently stopped — it now expects the echo of its own sent message, and the prompt for anything the periodic check finds, within 8 seconds; if none comes it shows "Live updates paused — checking every 20 seconds", and returns to live on the next alert. **Verified in a browser** by silently dropping alerts in one tab (label changed within the window) and restoring them (label recovered on the coach's next message), with no false alarm in the normal case. (2) The realtime tests now assert their control message was sent, wait with a 10-second deadline, and prove an active participant receives the change before judging a suspended participant's silence — which previously would have passed during an outage for the wrong reason. Full database suite afterwards: all passing.

---

## Next unfinished action

**M08 and M14 are complete.** Nothing in their scope remains; delivery states are live, and private messaging is built, verified in two browser sessions and deployed (`063a469`), with the worker now running every five minutes. The only optional item is confirmation with genuine phone captures. Work assigned elsewhere, and its owner:

| Deferred item | Owning batch |
|---|---|
| Expectations-updated notifications, and links to agreed expectations inside a conversation | **Batch 3** — expectations |
| Session confirmations, changes, cancellations, reminders, expired holds (producers); reminders at a specific hour, which need scheduling finer than daily | **Batch 4** — scheduling |
| Call-outcome notifications | **Batch 5** — calls |
| Coach-side screens that view a client's photos and clips; progress and form-review workflows | **M11–M13** — progress and form review |
| Appointment proposals and links to confirmed appointments inside a conversation (the message-kind boundary exists; the database refuses structured kinds until then) | **Batch 4** — scheduling |
| Recording the messaging decisions in `docs/aafnai/DECISION_REGISTER.md` (`OPEN-06`, and `messaging.v1` as an approved policy rather than a sandbox default) | **Founder decision** |
| An approved retention policy, then a deletion job written and reviewed against it | **Founder decision**; destructive execution stays off until then |
| Fulfilling deletion requests end to end | **Founder-supervised process**; requests are recorded and visible now |

Do not start Batch 2 from this file; it has its own prompt.

### Cleanup after the deployed checks

All synthetic accounts used above were deleted, with their rows and 21 stored objects across both buckets; the staged test files were removed from the holding bucket. Nothing test-made remains in storage.
