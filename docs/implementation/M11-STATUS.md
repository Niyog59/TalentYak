# M11 — Coach-created workout and nutrition programmes

Scope: the full founder brief (FM11, 2026-09-27). Migration `0046_programmes.sql`, applied to the hosted TEST project. No new dependencies. Decisions: `docs/aafnai/DECISION_REGISTER.md` §S.

## Built

- **Coach — Programmes** (`/coach/programmes`): every current client with the state of their workout and nutrition plans (current version, scheduled update, draft); the coach's templates, with archive.
- **Templates**: workout or nutrition, the coach's own. "Copy into a draft" makes an independent copy for one client; editing the template later never reaches it.
- **Client page** (`/coach/programmes/clients/[id]`): what the client has told the coach (training & food profile, private health notes, older booking answers where they exist); plan status; start from a template; the previous coach's plans when the client's sharing choice allows, with "start my draft from a copy"; version history with cancel-before-start.
- **Editor**: workout — weekly (Mon–Sun, rest days with optional notes) or in-order; sessions; exercises with sets, rep range or time, rest, optional weight (kg/lb), weight guidance, effort, progression, notes, demonstration link (http(s) only), and up to five alternatives with their own instructions and sets. Nutrition — written guidance, daily targets, structured meal plan (foods, amounts, units incl. *mana*/*pau*, cooked/raw, swaps, notes, optional per-food estimates), and a note on allergies, preferences and local foods. Publish now or from a date (start of the client's day), with a note for the client or as a quiet minor correction. Preview as the client sees it.
- **Client — Your plan** (`/account/plan/[id]`): Today; a Monday–Sunday week with navigation, rest days, "moved from" labels and one-week moves; exercise details and alternatives; nutrition with every number labelled as the coach's estimate; scheduled-update notice with the coach's note; history of every published version; paused and ended states. **Training & food profile** at `/account/training-profile`.
- **Notices**: `email.plan_updated` (in-app + email where allowed, category "Your coaching"): first plan ready, plan updated / changes on a date, planned change cancelled. Never plan content.
- **M12 seam**: `workout_logs.plan_version_id/session_key`, `set_logs.exercise_key/alternative_key`, checked by triggers; `plan_version_exercise()` resolves a key. The client week already shows a workout started under an earlier version with that version's instructions.
- `FULFILLMENT.programme` is now ready. Live sales stay refused (legal drafts, sandbox policies, calls, M12 tracking).

## Verified

| Check | How | Result |
|---|---|---|
| Typecheck, lint, migration structure, unit tests | `npm run verify` | pass — **302** tests (9 new: link safety, key identity, rep ranges, nutrition modes, version in force, client-day start incl. Kathmandu and a US clock change, week layout with moves, mid-week updates, started workouts) |
| Production build | `npm run build` | pass; ten new routes |
| Programmes database suite, real signed-in users | `test/db/programmes.db.test.ts` on TEST | **12/12**: template privacy and forgery refused; malformed content refused; draft invisible to client, other coach, visitor and admin; template edits don't reach the copy; first publish announced, notice carries no content; published version unchangeable and undeletable even by the service role; summary required / quiet correction; schedule, replace, cancel-before-start, no backdating; one-week move without touching the prescription, stranger refused; M12 references checked; profile readable by current coach only (not admin, not another coach); paused = coach read-only, client still reads and moves; coach change: former coach loses everything, new coach reads published history within scope but never drafts, can't write the old plan, can't copy another client's plan or the old coach's template, can copy this client's plan with exercise identity kept; `none` scope hides it; ended = client keeps all, coach nothing |
| Existing suites touching the same tables | access-matrix + paid-access on TEST | **51/51** |
| Walkthrough, phone width (375 px), local site against TEST | browser, fresh paid fixture | client profile saved; coach built a template on the phone (unsafe link refused with a clear message, nothing lost), copied it, published; worker delivered "Your workout plan is ready"; client week showed the session, details, demonstration link and alternative; client moved it Monday → Wednesday; coach scheduled an update for 5 Oct with a note; nutrition published with guidance + protein target only; client saw the scheduled notice, estimates labelled, history; client sent away from coach pages; another relationship's plan "not found"; no horizontal scroll on the plan page or the editor |

## Found and fixed during verification

- The coach's sticky Save bar sat under the phone tab bar — a tap on Save hit "Clients". Lifted above the tab bar.
- Preview with no draft returned "not found"; it now shows the current version.
- Scheduled starts read "00:00" / "10:45" (midnight in the client's zone shown in the coach's); now shown as the client's day.
- A published version blocked deletion of its whole relationship (needed for future retention work); it may now go only when its plan does.

## Not verified

- Real email delivery of the plan notice (fixture addresses are reserved and never mailed; the in-app notice was verified).
- Physical phones and screen readers (built-in browser only; labels, headings and 44 px controls checked).
- The coach-change screens in the browser (proven in the database suite only).

## Deployed — `fa288ea`, www.talentyak.com

Vercel production deployment: **success**. Signed out, the four new pages redirect to sign-in (`/account/plan`, `/account/training-profile`, `/coach/programmes`, a template page); the home page answers 200; the worker still refuses an unauthenticated call (401). Migration `0046` was applied before the push. Not checked on the live domain: a signed-in coach or client journey (done locally against the same database).
