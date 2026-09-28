# M12 — Client logging and progress

Scope: the full founder brief (FM12, 2026-09-27). Migrations `0047_media_food_photo.sql`, `0048_progress_tracking.sql`, `0049_progress_tracking_fixes.sql`, applied to the hosted TEST project. No new dependencies. Decisions: `docs/aafnai/DECISION_REGISTER.md` §T.

## Built

- **Workout logging** (`/account/progress/[id]/workouts/[workoutId]`), started from Today on the plan page, from any past day this week, from "planned sessions not logged yet", or as an unplanned workout. Per exercise: the coach's target → last comparable result → today's entry (steppers, "Same as last time", "Use target") → **Complete set**. Only confirmed sets are recorded. Extra sets, skipped exercises, the coach's alternatives, the client's own substitute, added exercises, per-exercise and session notes, effort (optional). Load meaning per exercise: weight / bodyweight (+added) / assisted (assistance) / none; per hand / both together; kg or lb per exercise. Optional rest timer (per device). Finish as completed / partly done / skipped, with a suggestion; backdating; delete a mistaken record.
- **Version preserved**: a workout names the published version and session it followed; the logger always shows that version's instructions, and the record can't be moved to another version.
- **Reliable saving**: every change kept on the device first (per account), then sent; states shown: saved, saving, saving shortly, no connection, coaching paused, not saved + reason, changed on another device. Retries re-send the unanswered save exactly (server recognises it); one record per planned session per day; revision check on every save with a "keep this device's / use the saved" choice. Pending entries listed on every tracking page. Drafts cleared on sign-out (with a warning if any are unsaved) — on all three sign-out buttons.
- **Body** (`/body`): weight and optional waist/hips/chest/arm per date, kg/lb and cm/in (stored as entered and in kg/cm), corrections and removal, conflict check per date.
- **Progress photos**: dated, optional pose, uploaded through M08 (images only), removal through M08's deletion, side-by-side comparison.
- **Food diary** (`/food`): photo and/or text per meal, optional calories/protein typed by the client, partial vs "this is everything for the day", unrecorded days shown as unrecorded, the coach's M11 nutrition guidance beside it, last-two-weeks strip.
- **Progress** (`/account/progress/[id]`): consistency from the client's schedule (moves and rest days respected, late-in-week counts, future days not counted, unplanned never counted) with its method explained; weight trend on a true date axis; measurement first/latest/change; exercise performance per exercise *and* load meaning; date ranges and custom dates; empty states. Units and reminder preferences.
- **Coach review** (`/coach/programmes/clients/[id]/progress` and workout detail): read-only view of everything the database lets the current coach see; "useful to track" form (advice only); a record changed after it was finished is marked.
- **Reminders**: one in-app notice in the client's evening (19:00–22:00) on a planned day with nothing logged; at most one a day and three a week; never email; switch-off on the progress page. Runs in the existing worker sweep.
- `FULFILLMENT.progressTracking` is now ready. Live sales stay refused (legal drafts, sandbox policies, calls, form review).

## Verified

| Check | How | Result |
|---|---|---|
| Typecheck, lint, migration structure, unit tests | `npm run verify` | pass — **315** tests (13 new: exact unit round trips, change-token parity with the database, workout validation, status suggestion, identity separation, per-hand vs combined, assisted, missing ≠ zero, consistency with a moved session and an unplanned workout; 2 sale-readiness tests updated) |
| Production build | `npm run build` | pass; nine new routes |
| M12 database suite, real signed-in users | `test/db/tracking.db.test.ts` on TEST | **12/12**: planned save keeps prescribed and actual apart, alternative and own substitute filed correctly; exact retry = no change; stale save = conflict; second device → duplicate pointer; unknown exercise / another record's rows / future date / other relationship refused; direct table writes refused for client and coach; plan update never rewrites a started workout; current coach reads, other coach / visitor / admin / other client don't; body units and change token; food numbers optional, partial until marked, only own food photos; photos and coach focus; **pause holds every write, reads stay, recovery saves, suspension still holds**; coach change: former coach nothing, new coach logs-only scope sees logs but not photos, `none` hides earlier history |
| Suites touching the same tables | paid-access, programmes, workflows, access-matrix, media on TEST | **150/150** (three updated for function-only writes and the new pause rule) |
| Walkthrough, 375 px, local site against TEST | browser, fresh fixture (removed afterwards) | client started today's session from the plan; target filled, set completed, saved; rest timer; **lost response simulated → refresh → typed value kept, pending save landed once (2 sets, no duplicate)**; pounds per hand; **second-device edit → conflict shown, nothing overwritten → kept this device's version**; finished as "partly done" (suggested), device copy cleared; backdated weight in lb + waist in inches, correction without false conflict, unit switch converts; today's weight; progress photo through M08 (processed, shown); food text entry with protein only, partial → complete; progress page: consistency 0 of 1 (partly done), weight −0.8 kg, exercise chart; **paused: approved wording, entry kept on device, listed as waiting → payment recovery (`resume_paid_enrollment`) → saved automatically**; sign-out cleared the device; coach: read-only review, focus saved, workout detail with targets beside actuals; no horizontal scroll |

## Found and fixed during verification

- Body-entry change token compared Postgres's own timestamp text with the API's ISO text (would have shown a false conflict on every edit) → microsecond tokens on both sides (`0049`).
- Lazy-loaded photos didn't load in the embedded browser; the M08 page doesn't lazy-load either → removed.
- "1 sets" wording.
- Records are dated by the client's calendar day, so on the day of a coach change a new coach on the "share nothing" choice doesn't see that day's entries. Kept (it errs on privacy); recorded in TASKS.

## Not verified

- The evening reminder by a live send (logic reviewed; not run against real accounts).
- Real phones, real offline (simulated by dropping responses), and screen readers (labels, headings, 44 px controls checked).
- HEIC food/progress photos in this flow (the M08 processor is unchanged and already tested for HEIC).

## Deployed — `5109a00`, www.talentyak.com

Vercel production deployment: **success**. Signed out, the new client and coach pages redirect to sign-in; the home page answers 200; the save route refuses an unauthenticated request (401). Migrations `0047`–`0049` were applied before the push. Not checked on the live domain: a signed-in client or coach journey (done locally against the same database).
