# M18 — Coach applications

Scope: founder brief FM18 ("Become a coach", 2026-09-29) with the founder's answers (`docs/specs/M18-coach-applications.md` §0). Decisions: `docs/aafnai/DECISION_REGISTER.md` §Y. Migration `0062_coach_applications.sql`, **applied to the hosted TEST project** (recorded in `schema_migrations`). No new dependencies. Branch `claude/bold-franklin-nukw4j`, **not merged to `main`**.

## Built

- **Header and phone menu**: "Become a coach". The full header now starts at laptop width (≥1024px); tablets get the menu, because five links no longer fit at 768px.
- **Public page** `/become-a-coach`: who we're looking for, who they'd coach, five steps, "good to know" (free, openings, no guarantee, no timeline), privacy notice. No commission or payout figures. Closed message when the switch is off.
- **Applicant** `/account/coach-application` (account with a confirmed email required): application form (only essentials required; accessible tick-box groups with "Other"; everything typed survives a refused save), draft → add up to 5 qualifications with optional photo/PDF → send; status in plain words; correct until a decision; withdraw (deletes files); delete everything.
- **Agreement** `/account/coach-application/agreement` (approved applicants only): how TalentYak works, what you earn and when (from `lib/policy`), the draft coach agreement, sign (tick + typed name, version recorded) or decline.
- **Founder panel**: `/admin/coach-applications` list (status, specialty, language, country filters; name/email search), detail with answers, private certificates, per-qualification checks, reviewer checklist, decisions with private reasons, onboarding progress and "send onboarding invitation again", private notes, history. Added to the sidebar and the attention queue.
- **Emails**: receipt, founder alert (names no one), approved / waitlisted / declined — each once per decision, skipped if the decision changed or was superseded before sending.
- **Switch**: "Accept coach applications" in Feature controls, **on**; enforced on the page, in the actions and in the database.
- **Fix**: the invitation page and invitation email read the commission from `lib/policy` instead of a typed "20%".

## Verified

| Check | How | Result |
|---|---|---|
| Typecheck, lint, migration structure, unit tests | `npm run verify` | pass — **407** (371 before; new: form rules and status changes, certificate file checks incl. EXIF/GPS removal and risky PDFs, agreement figures from policy, emails, send-once/stale-decision guards) |
| Production build | `npm run build` | pass |
| Database rules on TEST | 39 scenario checks run as real roles (anonymous, applicant, other applicant, founder without / with second factor, server) **inside a transaction that was rolled back** — nothing left behind (confirmed) | **39/39**: public reads nothing; unconfirmed email refused; one open application; bad links refused; no direct writes or self-approval; other applicants see and touch nothing; drafts hidden from founders; sending twice → one receipt + one alert; founder without second factor refused; notes, checklist, qualification checks (note required); repeated decision refused, one email; applicant can't read notes/history/checklist; approval creates no coach; signing (server only) creates one unpublished onboarding coach, repeat harmless, customer → coach, check carried over; signed application can't be withdrawn or reversed; an administrator keeps their role; withdraw; switch off refuses new applications while status stays visible; delete removes everything and leaves a data-free trace |
| Supabase security advisor | after applying | no new errors; 4 "search path" warnings on new helpers fixed; "signed-in users can run" notes are intended (each function checks the caller) |
| Pages | local production build, 375 / 800 / 1024 / 1280px | no sideways scrolling; header fits; phone menu shows "Become a coach" |

## Not verified / needs the founder

- **App database suite** `test/db/coach-applications.db.test.ts` — written, **not run**: this cloud session has no database keys and its network can't reach the database. Run it on the laptop.
- **Signed-in click-through against the database** (form, uploads, founder decisions, signing) — not run, same reason. The rules underneath were checked directly (above).
- A real email arriving; real phones and screen readers.
- Retention period for closed applications and the agreement's legal review (register §Y1).
