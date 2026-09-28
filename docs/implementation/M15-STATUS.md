# M15 — Client and coach dashboards

Scope: the founder brief (FM15, 2026-09-28). Migration `0053_dashboards.sql`, applied to the hosted TEST project. No new dependencies. Decisions: `docs/aafnai/DECISION_REGISTER.md` §V. Founder-wide analytics and operations remain M17.

## Built

- **Client (`/account`, "Today")**: today's workout first (Start / Continue / view, rest day, plan still being prepared, in-order plans), a week strip with previous/next week links into the plan; a to-do list (payment pause with the approved wording and billing link, check-in due or draft, session suggestions to answer with expiry, unread per conversation); getting-started steps (training profile, expectations acknowledgement where asked, first booking where calls are included — never blocking). Then each relationship, labelled with its coach: next session in the client's zone with the coach's alongside, Join only for a booked session whose room is open and whose coaching is live, own pending suggestions, declined/expired ones and cancellations; check-ins (due, waiting, feedback — including feedback finished under the M13 exception); messages per conversation (no text); nutrition guidance and today's food diary; last 4 weeks of progress by the coach's focus, weight only where recorded or asked, no verdicts; plan, paid-through and renewal state, calls left where the package has a fixed number. Updates (plan versions the coach chose to announce, expectations updates) with dismiss that accepts nothing. Support routes that preselect a category, shown also while paused. Earlier and pending coaching. The existing billing and coach-change section stays below, now naming the coach delivering the coaching.
- **Coach (`/coach`)**: one queue with filters and exact counts — check-ins awaiting feedback (reply time from the coach's own commitment), updated check-ins to look at again, form-check clips, unanswered messages (unread shown separately), client booking requests (expiry), plans not written or drafts to finish — each opening the real record; "Not now" snooze (4 h / 1 day / 3 days) and "No reply needed" for messages; snoozed and handled lists with undo. Today's sessions in the coach's zone with Join when allowed. Searchable client list: status, factual last activity, next item, links to plans, progress, check-ins and messages. Plans (awaiting, drafts, scheduled). Recent activity, one line per client. Capacity, accepting status, links to hours, days off, away and reply times; limit form. Earnings by currency (pending / earned not yet paid / paid) and latest payouts. Setup checklist first while unfinished, folded away once done.
- **Both**: role switch for coach-and-client accounts (also a "My own coaching" link in the coach navigation); each section loads separately with an honest failure and retry; refresh on reconnect, on return to the tab and every two minutes; offline notice with the time the screen was loaded.

## Verified

| Check | How | Result |
|---|---|---|
| Typecheck, lint, migration structure, unit tests | `npm run verify` | pass — **340** (9 new: snooze never hides a due item and never moves its deadline, expired snooze ignored, "handled" resurfaces on a new message and applies only to conversations, counts equal what each filter lists, ordering, wording, dismiss never hides a required step, earnings per currency with paid/pending apart) |
| Production build | `npm run build` | pass |
| M15 database suite, real signed-in users | `test/db/dashboards.db.test.ts` on TEST | **5/5**: unread vs unanswered (reading clears unread only; a reply clears unanswered; no text returned; other coach and the client get nothing); "handled" reach set by the database, refused for another coach or a client; marks private, bounded, function-only; activity is dates and counts through the coach's access (no values; nothing for others); calls left only for a fixed allowance, counted as booking counts |
| Walkthrough, local site against TEST, desktop and 375 px | browser, fixture (one client with two coaches, a coach who is also a client), removed afterwards | client: today's workout first, Start opened the logger, one set saved → "Continue workout"; week strip; Join on the session starting now; calls "1 of 2 left"; check-in waiting; coach's suggestion to answer; unread per coach; dismiss removed only that update. Coach: 3 tasks with matching counts, form-check tag, snooze moved the request to "Snoozed" and counts updated, "No reply needed" moved the conversation aside and a new client message brought it back as 2 unread; dashboard views left the unread count unchanged (no read receipt). **Payment pause**: approved wording, logging paused, workout readable, Join replaced by Details, message task dropped (can't reply), check-in tagged "you can still finish this review", coach finished it, client read the feedback. **Restore**: back to active. **Coach change** (second relationship to the other coach, sharing nothing): client sees it labelled with the new coach, the old conversation read-only; the previous coach no longer lists the client; the new coach gets "no workout plan from you yet". Role switch showed only the coach's own coaching. Forced failure of two coach sources: named, counts "N+" only where affected, other sections usable. New account: clear "No coaching yet" start. Keyboard focus ring visible; no horizontal scroll at 375 px |

## Found and fixed during verification

- Join was still offered on a paused relationship's session (the call itself would have been refused) → offered only while coaching is live.
- On phones, hidden screen-reader labels inside the scrolling filter row widened the whole coach page → the row now contains them.
- Today's workout sat below the to-do list on phones → moved to the top, a relationship with a workout today first.
- The billing section named the coach the plan was bought from, not the coach after a change → current coach.
- Two relationships with the same coach or client weren't told apart → plan names added where needed.
- "Logged" tick on a workout still in progress; "coaching already active" while one was paused; paused coach view said only "not shown" → worded precisely.
- A new account saw coach-specific help before how to start → "No coaching yet" with Find a coach.

## Not verified

- A signed-in journey on the deployed site (checked locally against the same database).
- Real phones, real offline and screen readers (labels, landmarks, 44 px targets and focus checked).
- A payment pause through the real Stripe path (states were changed directly; the real path also puts booked sessions on hold).
- The plan page after its week helpers moved into the shared library: typecheck and build only, plus the same helpers exercised on the dashboard.

## Deployed — `78b1686`, www.talentyak.com

Vercel production deployment: **success**. Signed out, the home page answers 200 and the client dashboard, coach dashboard (with a filter) and support page redirect to sign-in. Migration `0053` was applied before the push. Not checked on the live domain: a signed-in client or coach journey (done locally against the same database).
