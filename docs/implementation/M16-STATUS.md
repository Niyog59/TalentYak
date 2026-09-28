# M16 — Public launch website

Scope: the founder brief (FM16, 2026-09-28). Migrations `0054_public_launch.sql`, `0055_public_availability_fix.sql`, applied to the hosted TEST project. No new dependencies, no paid services. Decisions: `docs/aafnai/DECISION_REGISTER.md` §W.

## Built

- **Homepage** in the founder's order: who it's for and what you get (plan around your goals, week, equipment and food) → Meet your coaches (founding coaches, availability, link to each profile; an honest "being confirmed" state when there are none) → How coaching works (you train on your own schedule; workouts aren't live sessions; messaging, check-ins and calls per package) → What a package can include (each package lists exactly what it includes) → Common questions (cost, renewal, cancellation, refunds, food, coach away, changing coach, privacy, pre-purchase contact) → next action. The primary action is "Join the waitlist" until the public can buy, then "Start coaching".
- **Start coaching** (`/coaches`): each founding coach with their packages — price and currency, how often, automatic renewal, inclusions, calls, reply time, cancellation and refund terms (approved `cancellation.v2`) — and Choose only when that person can actually buy; otherwise the reason and "Join the waitlist" with the coach and package carried over. No search, filters or comparison tool.
- **Coach profiles**: introduction, approach, specialties, languages, coaching since, time zone, availability (taking clients / full / away until a date / not taking clients — never a count), qualifications only once checked ("Checked by TalentYak" and what was checked), packages, the coach's published reply time and welcome & expectations, pre-purchase contact through TalentYak.
- **Qualifications**: coaches add them on their profile page; administrators record what was checked on the coach's admin page. A new claim can't be created already "checked".
- **Purchase journey**: Choose → sign in or create an account → (email confirmation) → onboarding → back to the same package and currency. Checkout re-checks, on the server, that this person may buy, the package is still on sale and the coach still has room; the database re-checks price, capacity and eligibility. Checkout shows the total and charge currency, renewal, billing and cancellation terms, and what happens after paying (profile, first contact and first plan in the coach's own published words). The return page repeats those steps with links to the Today page and the welcome & expectations.
- **Waitlist** (`/waitlist`): email, optional first name, optional coach/plan; the consent line says exactly what they'll get; a hidden field and rate limits against abuse; the same answer whether or not the address was already there. Confirmation email through the outbox; confirming is a button press; every email has a link that deletes the entry. **Founder page** (`/admin/waitlist`, administrators with a second factor): entries, counts, and one hand-sent availability notice — only while the public can buy, only for a coach who actually has room — that reserves nothing.
- **Launch state**: `lib/launch.ts` — `live` only with live keys and `LIVE_BILLING`; `test` only for local development, an administrator, or `TEST_CHECKOUT_EMAILS`; otherwise `closed`.
- **Test coaches kept off the live site**: on the production deployment, coaches whose accounts use a reserved test address are never listed, shown or sold.
- **Search and sharing**: page titles and descriptions, canonical URLs, Open Graph/Twitter previews with the real logo (a coach's approved photo on their profile), sitemap with the public pages and each public profile, robots rules excluding private, test and token pages, Organization + FAQ structured data on the homepage and Person/credential data on profiles — no ratings.
- **Counts**: `/api/events` and server-side counters, as in TY-LAUNCH-06.
- **Fixes**: About said the name means "our own" (the old name's meaning); `robots.txt` blocked `/coaches` by prefix; the header now says "Join the waitlist" instead of "Find a coach" while buying is closed.

## Verified

| Check | How | Result |
|---|---|---|
| Typecheck, lint, migrations, unit tests | `npm run verify` | pass — **347** (7 new: who may buy in each mode, live keys alone never open buying, Choose only with room + published expectations + permission, sale locks still refuse in live mode, renewal/availability wording, counters accept only page kinds/slugs/ids, the chosen package survives every sign-up hop and an outside address is refused) |
| Production build | `npm run build` | pass |
| M16 database suite | `test/db/public-launch.db.test.ts` on TEST | **4/4**: availability is a state (no counts) for public coaches only, full/away/not accepting; only checked unexpired qualifications public, a coach's pre-checked insert forced to unchecked; waitlist and counters closed to the public and to signed-in users, counters reject anything but a page kind/slug/id; no duplicate entry, no repeat email within 10 minutes, hidden-coach interest dropped, confirm once, withdraw deletes |
| Walkthrough, local site against TEST (test mode), desktop and 375 px | browser, fixture coaches (taking clients / full / away), removed afterwards | homepage order and wording; profiles with availability, the checked qualification shown and the unchecked one hidden; Choose → sign-in and sign-up both carry the package; a new account → onboarding → back to the same package; checkout with total, renewal and next steps; **coach closed mid-checkout → refused, nothing charged**; reopened → Stripe **test** checkout; payment recorded as the webhook would → "You're in" with next steps → one account, one attempt, one purchase, one relationship; full and away coaches show the waitlist; waitlist join → confirmation queued (not sent to the test address, no address in the job) → confirm by button → founder page → notice queued, nothing reserved → withdraw deleted the entry; qualification "checked" refused without a note; counters recorded once each, marked not real; no horizontal scroll |
| As the live site | production build run locally with the production flag | "Join the waitlist" everywhere, "founding coaches are being confirmed", test coaches' profiles 404 and absent from the sitemap |

## Found and fixed during verification

- **195 synthetic test coaches were public on www.talentyak.com** (from earlier automated runs in the shared database). Hidden on 2026-09-28 and guarded on the production deployment from now on.
- 0054 counted checkout holds twice in "full" → 0055.
- A coach could insert a qualification already marked checked (only edits were guarded) → insert guard.
- Raw "in_app" shown as the messaging line; a coach profile without a photo had no share image; coach header squeezed on phones.

## Not verified

- A real email arriving (test addresses are never emailed) — confirmation and notice emails were rendered and queued, not delivered.
- A test payment completed on Stripe's page with the webhook (the relay isn't set up locally; payment was recorded directly, as the webhook does). Covered in earlier modules.
- Real phones and screen readers (labels, focus, 44 px targets and landmarks checked).
- Search engines actually indexing, and social previews rendered by the platforms.

## What's needed from the founder

1. **Founding coaches** — for each: invite, approved profile (introduction, how they coach, specialties, languages, year started, a photo they consent to publish), qualifications with evidence to check, published welcome & expectations, and at least one package with its price. Until then the site honestly shows "being confirmed".
2. **A separate production database** before public launch.
3. **For purchases**: final reviewed terms and privacy notice; approval of the five sandbox policies; live Stripe keys and `LIVE_BILLING=true`; a payment method on Daily before selling packages with calls.
4. **Support email**: confirm `SUPPORT_EMAIL` is set in production and someone reads it.
5. Optional: `TEST_CHECKOUT_EMAILS` for named testers.

## Deployed

See below once pushed.
