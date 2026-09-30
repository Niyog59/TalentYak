# M18 — Coach applications ("Become a coach")

**Status: BUILT on branch `claude/bold-franklin-nukw4j` — see `docs/implementation/M18-STATUS.md`. Founder answers applied 2026-09-29.**

## 0. Founder answers (2026-09-29)

- **Applicants need an account** (founder proposal; agent agrees). Replaces the no-account token/session design in §2.3.
- **No second "accept" step.** After approval the applicant signs the coaching agreement (commission, payouts, coach duties). Signing is the only step; then the account becomes a coach in onboarding.
- **Write a coaching agreement:** yes — draft, versioned, labelled draft until approved with an adviser.
- **Certificates:** photos (cleaned) + PDF (byte-checked, download-only for founders).
- **Switch "Accept coach applications": ON** at deploy, for testing.
- **Retention:** proposed 12 months after the final decision, inactive until approved.
- **Invitation page:** read the commission from `lib/policy` instead of typed "20%".

### Revised flow with accounts
1. "Apply" → sign up or sign in (existing; email confirmation already works on any device and resists mail scanners) → short account setup → application form.
2. Submitting needs a confirmed email; the application goes straight to the founder queue. One active application per account.
3. Status, edit, add/remove certificates, withdraw and delete-my-data live on the applicant's account page. Changing email uses the existing account email change (fresh confirmation).
4. Founder approves → "accepted" email → applicant reads and signs the agreement on their account (tick + typed name, version and time recorded) or declines.
5. Signing turns the same account into a coach in onboarding (existing roles and data kept; no invitation link needed) → existing onboarding → founder final approval → active.
6. Founder control "Send onboarding invitation" becomes "Resend acceptance email" (deduped).

Written 2026-09-29. Branch `claude/bold-franklin-nukw4j`.

## 1. What exists today (reused, not rebuilt)

| Need | Existing piece reused |
|---|---|
| Public page | `/become-a-coach` exists. It says "Applications aren't open yet" and shows commission publicly. It will be rewritten. |
| Nav | `components/site-nav.tsx` + `shell/mobile-menu` |
| Email without an account | Waitlist pattern: hashed tokens, button-press confirm, same answer whether or not the email is known (`lib/waitlist/*`, migration 0054) |
| Scanner-proof, cross-device links | `/auth/confirm` pattern: token in the URL **fragment**, used only when the person presses a button (commit 4f46aa9) |
| Email sending | outbox + worker + Resend, dedupe keys, idempotency keys, test-address block (`lib/worker`, `lib/email`) |
| Founder alerts | `email.admin_alert` job (rechecks the recipient is still admin) |
| Rate limits / spam | `lib/rate-limit.ts` (IP + email), hidden honeypot field |
| Feature switch | M17 feature register + `feature_settings` + DB guard trigger pattern |
| Private files | private `provider-evidence` bucket (WebP + PDF, already exists, never public), `lib/uploads/image.ts` (magic bytes, re-encode, strips EXIF/GPS), short signed links |
| Founder panel | `/admin` shell, `requireAdmin` (admin + second factor), `is_admin()` (aal2), `admin_record_audit` |
| Onboarding after acceptance | coach invitations → `/invite/[token]` → sign up **or** existing account → coach profile, prices, availability, payout → submit → founder **final approval** (existing `providerStatusAction`). `accept_coach_invitation` already keeps an admin's role. |
| Qualification checks | `provider_credentials.verification_state`; public profile shows only checked ones |
| Commission / payouts text | `lib/policy` (`previewEarnings`, commission policy) — never typed-in numbers |
| Retention | `retention_policies` (proposed/approved); nothing deletes real data under a proposed policy |

## 2. What gets built

### 2.1 Public page and nav
- "Become a coach" added to desktop nav and phone menu.
- `/become-a-coach` rewritten: who we're looking for, who they'd coach (busy Nepalis abroad), the steps (apply → confirm email → review → possible short call → decision → onboarding). States: applying is free; reviews depend on openings; acceptance doesn't guarantee clients; **no review deadline promised**. Short privacy notice.
- **Commission, payout and terms are removed from the public page** and shown only after acceptance (your instruction).
- When the switch is off: a clear "applications are closed" message, no form. Link for existing applicants to their status still works.

### 2.2 The form (no account)
Required: name, email, country, time zone, languages, coaching experience, specialties, weekly availability, the "busy beginner" answer, privacy tick.
Optional: online-coaching experience, capacity for new clients, Instagram / website / profile link, certificates (qualification, issuing organisation, expiry, optional file; up to 5).
Never asked: bank details, ID documents, client photos, client health records. The form says so, and the text answers warn not to include client details.
Clear field errors, accessible labels, entered text kept after any recoverable error (a chosen file must be re-picked — browsers don't allow keeping it; the message says so).

### 2.3 Email confirmation and applicant access
- Submitting always shows the same message: "Check your inbox." Nothing reveals whether that email has applied before.
  - New email → saved as *unconfirmed*, confirm email sent.
  - Email with an active application → no new application; that inbox gets a "you already have an application — here's your link" email.
- Only confirmed applications reach your queue. Unconfirmed ones are deleted automatically after 7 days (housekeeping, like abandoned uploads).
- Every link: single use, time-limited, token in the fragment, used only on a button press (mail scanners can't consume it), works on any device. Pressing it gives a short private session (cookie, 1 hour) for that one application.
- Status page: see status, edit answers (until a decision), add/remove certificates, withdraw, delete data. "Email me a link" to get back in.
- Changing email: the new address must be confirmed before it replaces the old one.
- Receipt email after confirmation explains what happens next.
- Decision emails for Approved / Waitlisted / Declined. Never include private notes. Each decision emails once: repeating an action or a job retry cannot send twice (outbox dedupe + provider idempotency key).

### 2.4 Founder panel — "Coach applications"
- Statuses: New, Reviewing, Interview, Approved, Waitlisted, Declined, Withdrawn.
- Search (name/email) and filters: status, specialty, language, country.
- Detail: answers, certificates (view through 2-minute private links, admin + second factor), private notes (admin-only, never shown or emailed to the applicant), decision history (append-only).
- Reviewer checklist: qualification checked; communication; fictional beginner-client scenario; knows when to refer to a healthcare professional. Follower count is not on it and the page says it isn't a requirement.
- Qualification verification is per certificate and separate from the application decision. An upload alone never shows as checked.
- Email alert to founders when an application is confirmed.
- Controls: change status, "Send onboarding invitation" (re-send after approval). Interviews arranged by hand (status + notes only).

### 2.5 Acceptance and onboarding
1. Founder approves → applicant gets an "accepted" email with a secure link. **Nothing is activated; no customer data is visible.**
2. Welcome page: what TalentYak is, how commission and payouts work (read from `lib/policy`), and the coach agreement. Buttons: **Accept** or **Decline**.
3. Accept → records the agreement version → hands over to the existing invitation flow (create an account or sign in with the same email; an existing account keeps its roles and data).
4. Existing onboarding: profile, plans/prices, availability, payout details → submit for review.
5. Founder gives final approval (existing) → coach is active. Showing in the public directory still follows the separate "Coach profiles" switch and the coach's own publish setting.
- Checked certificates carry over to the coach's credentials with the same checked/unchecked state.
- The application page shows onboarding progress.

### 2.6 Privacy and controls
- Database: all new tables have row security on; applicants and the public have **no** direct access (server functions only); founders read through `is_admin()` (second factor). Private notes: admin-only table.
- Files: private bucket, images re-encoded (EXIF/GPS removed), PDF checked by its real bytes, max 4 MB, served only as short-lived links.
- No emails, names or tokens in analytics or logs. Only an anonymous "application confirmed" count.
- New founder switch **"Accept coach applications"** (on/off), separate from coach discovery. Off = server and database refuse new applications; existing applicants keep status/withdraw; founders keep review.
- Withdraw: stops review and deletes certificate files. Delete my data: erases the application's personal details immediately.
- Retention: a **proposed** policy for closed applications, period configurable, **no automatic deletion until you approve it**.

### 2.7 Database (one new migration, `0062_coach_applications.sql`)
`coach_applications`, `coach_application_certificates`, `coach_application_links` (hashed tokens/sessions), `coach_application_notes`, `coach_application_events` (append-only), feature key `coach_applications`, proposed retention policy, server functions, indexes. Never edits an earlier migration.

## 3. Decisions I need from you

1. **Coach agreement text.** None exists in the codebase. I'd write a short draft from your confirmed rules, clearly labelled *draft*, versioned so each acceptance records which text was agreed (same as the terms/privacy drafts). You or an adviser must approve the final text. **OK?**
2. **Certificate files.** Recommend: photos (JPG/PNG/WebP, cleaned) **and** PDF (checked by its bytes, opened only as a download by you). PDF metadata can't be stripped without adding a new library. **OK, or photos only?**
3. **Switch default.** Recommend **off** when deployed; you turn it on from Feature controls when ready. **OK?**
4. **Retention period for closed applications.** Recommend a *proposed* 12 months after the final decision, not active until you approve it. **Your number?**
5. **Database access for testing.** This session has no database keys, so the database tests and a real walkthrough can't run here. Options: (a) you add the test-database secrets to this environment; (b) I use the connected Supabase tool to apply the migration to the shared TEST project (also used by the live site — the migration only adds new things); (c) I build and run all non-database checks, and you run the database suite from your laptop. **Recommend (a) or (c).**

Also noticed (will fix only if you agree, it's in files I'd touch): the invitation page has "20%" typed in directly, against the one-pricing-source rule. I'd read it from `lib/policy` instead.

## 4. Verification plan (one focused pass)
Unit tests (validation, statuses, emails, token handling), `npm run verify`, `npm run build`, a database test file covering: submission, cross-device confirmation, duplicates, applicant isolation, private files, founder decisions + no duplicate emails, alerts, withdrawal, closed switch, approval → terms → invitation → onboarding → final approval → active. Browser walkthrough at desktop and phone width. **Anything that can't run here will be reported as not run.**
