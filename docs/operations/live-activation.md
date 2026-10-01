# Pilot plan and live-payment activation checklist

**Written 2026-10-01 (M18). Nothing here has been executed.** Two separate stages:
1. An **unpaid private pilot**: one real coach and one real client, no money.
2. **Paid launch**: real cards.

A successful test payment proves the machinery. It does not prove that live payment is ready.

---

## Part A — Unpaid private pilot

### Who and how many (proposed — founder decides)

- **One coach and one client** for the first two weeks, then at most **3 coaches with 2 clients each**.
- **Coach capacity:** set each pilot coach's limit to 2 (Coaches → the coach → capacity) so nobody is over-committed.
- **How they get in:**
  - the coach: through the existing coach invitation;
  - the client: as a **named tester** (`TEST_CHECKOUT_EMAILS` on the production deployment), buying with a Stripe **test** card. No money moves, and the whole flow is exercised.
- **Support route:** `SUPPORT_EMAIL` must be set to a mailbox you read **before** inviting anyone (it is empty today). In-app support cases work regardless.
- **Who owns incoming issues:** you. Check the panel overview and Sentry once a day, and reply to support within 24 hours.
- **Pause new sign-ups if any of these happen:**
  - a privacy problem of any kind;
  - a wrong amount anywhere;
  - more than one failed call in a week;
  - a pilot user losing entered work;
  - Sentry showing a new error you can't explain within a day.

  To pause: Feature controls → New purchases **off**, plus the relevant feature **read-only**.

### Before inviting (pilot prerequisites)

| # | Item | Owner | State |
|---|---|---|---|
| P1 | `SUPPORT_EMAIL` set on the production deployment, to a monitored mailbox | Founder | Open |
| P2 | Sentry connected and the two test errors seen, with the alert email received (`launch-runbook.md` §2) | Founder | Open |
| P3 | Daily payment method added, then one real two-person call on two phones | Founder (+ next session) | Open — **every call is refused today** |
| P4 | Real coach profile approved: photo consent, checked qualifications, published welcome & expectations, one package | Founder + coach | Open |
| P5 | One real email round trip to an inbox you read (sign-up confirmation, password reset, a receipt) | Founder | Open — test addresses are never emailed |
| P6 | One real phone upload of a progress photo **and** a short clip, including an iPhone HEIC photo | Founder or pilot coach | Open — only test files have been used |
| P7 | A separate production database — **or** an explicit decision to run the unpaid pilot on the shared test database, knowing tests also write there | Founder | Open (decision) |

### The unaided walkthrough (give each person only this)

**Coach (about 20 minutes, on a phone):**
1. Open the invitation email and create your account.
2. Finish your profile and set your available hours.
3. When your client appears, open them and publish a first workout plan.
4. Set a weekly check-in.
5. Reply to their first message.
6. Book a short call with them, and join it at the time.
7. After their first check-in, write feedback.
8. Look at your earnings page. It should say test, with nothing paid out.

**Client (about 20 minutes, on a phone):**
1. Open talentyak.com and choose the coach.
2. Create an account, or use Google.
3. Pay with the test card you were given.
4. Fill in your training & food profile.
5. Open today's workout and log one set.
6. Add your weight, plus a progress photo from your camera roll.
7. Log one meal.
8. Message your coach.
9. Join the call at the booked time.
10. Send your first check-in, then read the feedback.

**Record, for each step:**
- Did they finish it without help? (yes / with a hint / no)
- What confused them, in their words.
- Anything broken.
- Phone model and browser.
- Anything hard to read or tap (accessibility).

Fix anything launch-blocking before inviting the next pair.

**Status:** not run. No real coach or client has used the product. This is **pending human validation**, not complete.

---

## Part B — Live-payment activation checklist (do not run until every prerequisite is ✔)

### Prerequisites (decisions and accounts — founder)

| # | Prerequisite | State on 2026-10-01 |
|---|---|---|
| L1 | Final, reviewed **terms of service and privacy notice** in the product (the drafts label disappears) | Open |
| L2 | The five sandbox policies approved (`discount.v1`, `billing_terms.v1`, `recognition.v1`, `payout.v1`, `eligibility.v1`), plus `scheduling.v1`, `calls.v1`, `checkin_reminders.v1` timings | Open |
| L3 | A payout route for coaches in Nepal chosen, with its fees and who absorbs them | Open |
| L4 | Customer countries decided (`eligibility.v1`) | Open |
| L5 | **Separate production database**, built from migrations, with its own auth settings (Site URL, redirect list, Google provider, SMTP), storage buckets, schedule secret, and **backups** (paid plan or nightly dump) — and one restore drill recorded | Open |
| L6 | Vercel plan suitable for commercial use (Pro), with a spend limit | Open |
| L7 | Daily payment method and a billing alert; calls marked ready only after a real two-person call on phones | Open |
| L8 | Sentry connected, with alerts and uptime confirmed (pilot item P2) | Open |
| L9 | Stripe account business verification complete, payouts to the business bank set | Stripe reports details submitted; payout bank not checked |
| L10 | Business GitHub account and commit identity (Vercel blocks deploys from non-members) | Open |
| L11 | `SUPPORT_EMAIL` monitored; unpaid pilot completed with no open launch blockers | Open |
| L12 | OPEN-08 (money for coach changes) decided, **or** "Changing coach" stays off — it already is | Off |

### Activation steps (in order; each one reversible until step 7)

1. Point the production deployment at the **production** database (Vercel env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). Apply all migrations there first (`npm run db:migrate` against the new project). Configure the worker schedule (`scripts/configure-worker-cron.mjs`). Smoke-check: public pages, sign-up, sign-in, the panel's environment label shows the production database.
2. In Stripe **live** mode, add the webhook endpoint `https://www.talentyak.com/api/webhooks/stripe` with the same event list as test mode. Put its signing secret in Vercel as `STRIPE_WEBHOOK_SECRET`, and set `STRIPE_ACCOUNT_ID`.
3. Put the live keys in Vercel production (`STRIPE_SECRET_KEY=sk_live_…`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…`). With `LIVE_BILLING` unset, purchasing is **closed** (live keys alone never open it). Redeploy and confirm that Choose shows the waitlist.
4. Panel → **Policies & launch**: every blocker listed must be gone (policies, legal, fulfilment readiness).
5. Set `LIVE_BILLING=true` and redeploy. Feature controls → New purchases **test accounts only**, with only you on the test list.
6. **One real-money validation** (proposed): you buy the cheapest package from a real pilot coach with your own card, for real. Confirm:
   - the receipt email arrives;
   - Stripe live shows the payment;
   - the panel shows one purchase and the 80/20 split in the ledger.

   Then refund it in full from the panel. Confirm the refund at Stripe, the reversed ledger rows, and the coach's share at zero. Stripe keeps its fee on a refunded payment — a small, real cost of this check.
7. Feature controls → New purchases **on**. This is the moment the public can pay.
8. For the first week: check the panel overview and Sentry daily; confirm each payment shows in Stripe and the ledger; keep the coach capacity limits.

**To stop sales at any time:** set New purchases to off. Existing clients keep their coaching, and their renewals keep being charged by Stripe and recorded as normal. Stopping renewals is a separate step, done per subscription in Stripe ("pause collection" or cancel at period end), never by switching the app off.

**Approval needed from you, once L1–L12 are done:** steps 1–7 above, and the real-money validation in step 6.
