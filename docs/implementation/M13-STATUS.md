# M13 — Client check-ins and coach feedback

Scope: the full founder brief (FM13, 2026-09-27). Migrations `0050_media_checkin_attachment.sql`, `0051_checkins.sql`, `0052_checkin_hand_over_fix.sql`, applied to the hosted TEST project. No new dependencies. Decisions: `docs/aafnai/DECISION_REGISTER.md` §U. Policies: `checkin_access.v1` (confirmed — includes the approved paid-time review exception), `checkin_reminders.v1` (sandbox default).

## Built

- **Coach setup** (`/coach/check-ins`): reusable templates with frozen versions (text, longer text, 1–5 ratings, optional photos, optional form-check clip); a one-tap weekly starter (energy, sleep, hunger, recovery, what was hardest, what would help; about two minutes). Photos, clips and anything marked sensitive can never be required. Per-client schedule (`/coach/check-ins/clients/[id]`): every 1/2/4 weeks, due weekday and time, explicit client timezone, optional reply time in the coach's own working days. Pause/resume and planned breaks (coach or client). Changes apply forward.
- **Requests**: only for the period running now, only while coaching is live, never inside a break or pause, never overlapping — no backlog after a pause, a break or a payment pause. Each request keeps its due time and questions, so nothing becomes late retroactively. Older unstarted requests close as "Not sent" (no penalty wording); started ones stay open for late sending.
- **Client** (`/account/progress/[id]/check-ins`): states Ready for you / Draft saved / Sent — waiting for feedback / Feedback received / Updated — coach will look again. Reporting period shown separately from the sent date. Form saves on the device first, then as a server draft; honest save states; conflict choice between devices; sending retried with the same id (never twice). The period's workouts, weight, measurements and food come from M12 automatically, with gaps named as gaps. The summary is stored as sent; later additions are listed separately. Corrections keep every version; substantive ones reopen the review.
- **Coach review** (`/coach/check-ins/[id]`): queue by awaiting / past your reply time / reopened / feedback sent / reviewed, with the responsible coach; answers with changes marked, earlier versions, progress summary; dated feedback drafts and published versions with next steps; plan link and follow-up conversation link; a promised plan change shows as delivered only when linked to a version actually published afterwards; explicit "Mark review complete".
- **Notices** through the outbox (new optional "Check-ins" email category): due soon, late, new check-in, substantive correction, review waiting, handed over, feedback published, closed after a coach change. Each once; re-checked for status and permission immediately before sending.
- **Coach absence**: expected reply moves past the away date; client always sees the support route; waiting reviews listed for TalentYak.
- **Coach change**: handed on within the client's sharing choice, otherwise flagged; `/admin/check-ins` shows metadata only with "check again" / "close and tell the client".
- **Payment**: see TY-CHECKIN-01/-02. Enforced in the database, the attachment policy and the save route.
- `FULFILLMENT.checkIns` is now ready. Live sales stay refused for the other listed reasons.

## Verified

| Check | How | Result |
|---|---|---|
| Typecheck, lint, migration structure, unit tests | `npm run verify` | pass — **331** (16 new: required rules, starter, blanks never zero, typo vs substantive correction, client/coach states, period label, missing-data wording, summary unchanged by key order, policy status) |
| Production build | `npm run build` | pass; eight new pages |
| M13 database suite, real signed-in users | `test/db/checkins.db.test.ts` on TEST | **13/13**: template rules and versions; one request for the current period in Kathmandu and Chicago time, repeats create nothing, a change applies forward; pause withdraws unstarted / keeps started, resume adds no backlog; draft replay and conflict; one submission per retry, stale second send refused, only the server sends, coaches can't add or rewrite answers, nobody else reads them; completion needs published feedback, one feedback notice; typo doesn't reopen, substantive does and keeps originals; payment pause holds drafts/corrections/new requests and keeps the draft, exception lets the coach finish, never across a suspension or for a check-in not sent in paid time; notices once and re-checked; coach change hands on or flags, attachments stay hidden, previous chat stays private, admin sees metadata only; cancelled renewal that ended — exception allowed, refund — refused, access ends once finished |
| Suites touching the same rules | media, access-matrix, tracking, messaging, paid-access, workflows on TEST | 178/179, then the one realtime timing test passed on rerun (29/29) |
| Walkthrough, 375 px, local site against TEST | browser, fresh fixture (removed afterwards) | coach created the starter and a schedule (first period starts that day, no reaching back); client form: required answers enforced; **save route blocked → "No connection — kept on this device" → reload restored and saved**; progress summary shown; **send with lost reply → retried once, one version recorded**; expected reply from the coach's working days + support route; coach opened it (still awaiting), published feedback with a promised plan change (shown as not published), marked complete; client "replied" notice in inbox (email correctly withheld for a test address); stale "new check-in" notice skipped by the recheck; **substantive correction → reopened**, original feedback kept and labelled; **paid time ended → approved wording shown, corrections held, coach finished the review, client read both dated versions**; coach settings read-only while paused; no horizontal scroll |

## Found and fixed during verification

- `checkin_hand_over` used a table alias that clashed with a variable, so **every new coach assignment was refused** — caught by the first database run before any real coach change; fixed in `0052`.
- A send retried after a lost reply was checked as a correction first and refused as "nothing changed" (no duplicate, but a wrong message) → the route now recognises the repeat first.
- "Measurements changed since sent" false alarm: the stored summary returns with keys reordered → compared by value.
- Duplicate "(optional)" labels, doubled help text on the clip question, redundant "extra workout" line with no plan, missing approved pause wording on a sent check-in.

## Not verified

- Emails by a live send (test addresses are never emailed); reminder timing on a real week.
- Real phones, real offline, screen readers (labels, fieldsets, 44 px targets checked).
- Uploading a photo or clip inside the check-in form in the browser (M08 uploader unchanged; attachment access rules verified in the database suite).
- Linking a promised step to a real published plan version end to end (refusal of an invalid version verified; M11 publishing unchanged).
