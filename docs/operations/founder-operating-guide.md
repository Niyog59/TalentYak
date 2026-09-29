# Founder operating guide — the TalentYak founder panel

**Written 2026-09-28 (M17).** Sign in at `/admin` (see `founder-access.md`).

## Every day (5 minutes)

1. **Overview → Needs attention.** Work down the list; each line opens the place it's handled. Red lines touch money or a customer right now. "Couldn't check" means the count couldn't be read — it doesn't mean zero.
2. **Support cases.** Take ownership ("Me") of anything new, add an internal note of what you did, resolve with a note to the person.
3. **Coach changes.** Decide any request (see below).

## Every week

- **Overview → 7 days.** New accounts, people who signed in, paying clients, cancellations (asked to stop) versus coaching that actually ended, failed renewals, money by currency.
- **Jobs & deliveries.** Retry anything failed once the cause is fixed. Retrying never sends an email twice or repeats a charge, refund or payout.

## Reading the money

- Every figure comes from Stripe's signed payment records and the ledger — never from website analytics.
- **Collected** is what customers paid, before refunds. It is **not** revenue or profit.
- **Platform commission** and **coach earnings** are the ledger's 20/80 split, after refunds. **Payment fees** aren't imported from Stripe yet; check Stripe for them.
- Currencies are never added together or converted.
- Test purchases are left out unless you tick "include test activity".

## Payouts

**Recording a payout is not sending money.** Send the money yourself through the transfer service, then record it in *Payouts* with the amount, currency, date and the transfer service's reference. Automatic transfers are off (no payout route is approved yet).

## Coach changes

1. The client asks from their account (only when *Changing coach* is switched on for them). They choose a coach who can take them, or let you suggest one, and choose what the new coach may see from before.
2. On *Coach changes* you see their reason, their choices, and exactly what the move will touch: sessions, requests, check-ins, plans and earnings.
3. Confirm with the client **and** the new coach, then **Apply**. The move happens all at once; the former coach loses access immediately; the new coach gets a new conversation and never sees the old one.
4. Earnings for the part-finished paid period are held; split them in *Finance* until the money rule is decided.

**Changing coach is off.** You can turn on "Test accounts only" to try it. Turning it on for everyone needs your decision on the money rules first (OPEN-08).

## Feature controls

- Each feature shows **readiness** (built / needs setup / not built) and your **setting**. A switch can't turn on something unbuilt or unconfigured, and can't approve a policy.
- **Change** opens a panel with each mode explained, what's blocked and why, and live counts of who's affected. Write a reason; tick the confirmation for anything that reduces what people can do.
- **Normal pause** (read-only / off) stops new activity and lets work already under way finish. **Emergency** modes (marked) also stop work in progress — use them only when something is actually wrong.
- Changes apply to the next thing anyone does. No deployment needed.
- **Restore** puts an earlier setting back. It never undoes refunds, cancellations, messages or coach changes that already happened.
- **Test accounts only** means accounts on the test list. Add them from their account page; add both the test client and the test coach.

What starts off: **changing coach**. Everything else that's built starts on. Calls need setup (a payment method on Daily) before they can actually run.

## Privacy rules you'll notice

- You can't see health records, logged values, check-in answers, progress photos or messages from the panel, and search never looks inside them.
- To read a conversation, open the support case, give a specific reason, and take a time-limited grant. Every grant and view is recorded.
- Don't paste private details into internal notes.

## Analytics

PostHog shows website visits, coach profile views, package choices, sign-ups, sign-ins, checkout starts and confirmed purchases. It's anonymous and only counts the real production site. Use **Open analytics** in the sidebar once PostHog is connected (see *Website & launch → Analytics*).

## Where things are

| You want to… | Go to |
|---|---|
| Find a person or record | Search box at the top of every page |
| Suspend or reinstate a client | Accounts → the person |
| Suspend a coach | Coaches → the coach |
| Refund | Purchases → the purchase |
| See who changed what | Change history |
| See what still blocks real payments | Policies & launch |
| Pause a feature | Feature controls |
