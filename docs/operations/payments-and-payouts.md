# Money: how it moves, who may write it, and what each word means

**Written 2026-09-18. Describes the system as built and exercised, not as planned.**

Nothing in this document is a business decision. Where a commercial rule is involved it points at `web/src/lib/policy/`, which is the only place such a rule may live.

---

## 1. The one rule everything else hangs off

**The Stripe webhook is the only thing that may write payment truth.** Not the browser coming back from checkout, not a button in the founder console, not a support conversation.

A customer returning from Stripe proves only that their browser followed a link. The return page therefore reads the database and reports what it finds; if the payment has not been confirmed yet, it says so and checks again.

Practically:

| Fact | Written by | Never written by |
|---|---|---|
| A period is paid | The webhook, from Stripe's own object | A person, a redirect |
| Coaching access exists | The webhook, in the same transaction as the payment | A screen |
| Earnings are owed | The webhook, from the payment | An admin |
| Earnings are payable | The recognition sweep, once the period has ended | An admin |
| A payout happened | A person, recording a real transfer reference | The system, automatically |

---

## 2. What a customer buys

A **coach** publishes an **offer**. Publishing freezes an **offer version**: its wording, its inclusions and its prices can never change again. Editing means publishing a new version, and everyone already signed up keeps the version they bought.

A **purchase** copies all of it at the moment of sale — price, currency, interval, inclusions, and which commercial policies applied — so an old contract stays explicable years later, even after prices and policies have moved on.

**Checkout, step by step**

1. The browser sends an offer version identifier, a currency and a one-per-page-load key. Nothing else is trusted from it.
2. The server checks that the service is publicly sellable, the coach is approved, published and accepting clients, the plan is on sale, the price exists in that currency, and the customer does not already have an ongoing plan with that coach.
3. For ongoing coaching, a place in that coach's client list is **held** (about 35 minutes).
4. A checkout attempt and a pending purchase are written, then Stripe's hosted payment page is created from the database's own numbers.
5. If Stripe fails, the held place is released immediately.
6. The customer pays on Stripe's page. **Card details never reach TalentYak** (invariant 4).
7. Stripe confirms by webhook. That is when the purchase becomes active, the coaching relationship starts, and the ledger is written — all in one database transaction.

Pressing the button twice, or a retried request, reuses the same checkout rather than creating a second one.

---

## 3. The split

**TalentYak keeps 20% of the service amount. The coach receives the exact remainder.** (`commission.coaching.v3`.)

The commission is rounded first, and the coach takes what is left, so the two shares always add back to the payment exactly. On USD 10.01 that is 2.00 and 8.01.

- Tax, if ever charged, is not part of either share.
- Card processing fees come out of TalentYak's share, never the coach's 80%.
- A promotion TalentYak funds reduces TalentYak's share and is recorded as a subsidy. It never reduces the coach's entitlement.
- Each currency stands alone. Nothing is ever converted, and two currencies are never added together.

A coach is told their share before they publish, on the same screen where they set the price. They never have to work it out from a page.

---

## 4. What the money words mean to a coach

| Word | Meaning |
|---|---|
| **Pending** | The customer has paid, but the coaching period it pays for has not finished. Not yet payable. |
| **Held** | Frozen while something is unresolved — usually an open card dispute. |
| **Ready to be paid** | The period has been delivered. This is what a payout batch can claim. |
| **In a payout** | Claimed into a batch that is being prepared or sent. |
| **Paid** | A transfer was actually made and recorded with its reference. Nothing else sets this. |

A refund or a lost dispute produces a **new, negative** ledger row — the original is never edited. That negative amount comes out of future earnings; a coach is never asked to pay money back directly.

---

## 5. When things go wrong

| Situation | What happens |
|---|---|
| The same webhook arrives twice | The second is recognised and ignored |
| Two different events describe one payment | Both apply the same effects, which are keyed by what they describe, so nothing is counted twice |
| Processing crashes half way | The event is re-fetched from Stripe by the scheduled sweep and finished |
| An event arrives out of order (a dispute before its payment) | A reconciliation exception is raised and the event is retried; it is never silently dropped |
| A renewal payment fails | The plan goes `past_due`, no new period is granted, no earnings are recorded for it, and the customer is told to update their card |
| The customer pays after their held place expired | The payment is honoured and the purchase is flagged for review rather than quietly failing |
| A refund is issued | Requested with a reason and an author, sent to Stripe with an idempotency key, and recorded from Stripe's answer |
| A card dispute opens | The disputed amount is held from the coach's earnings until it closes |

---

## 6. Paying coaches

**The system does not send money.** No transfer route from a US Stripe account to a coach in Nepal has been verified, and none is assumed.

1. The coach enters payout details. Changing them needs their authenticator app, so a stolen password alone cannot redirect their earnings. Afterwards only the last few characters are ever shown.
2. The founder checks those details. Until they are checked, that coach is held out of every batch.
3. The founder prepares a batch for one currency. Eligible earnings are claimed in one transaction, so nothing can be paid twice. Anyone left out is listed with the reason: a negative balance, no payout details, details not yet checked, or below the minimum.
4. The founder downloads the file. **The file carries masked references, every row says `NOT PAID`, and downloading pays nobody.** The batch becomes `exported`, which is not `paid`.
5. For each coach, the founder reveals the full reference (each reveal is logged), makes the transfer in whatever service they use, and records it with its reference, the time and where the receipt is kept. The coach is then notified, with the reference.
6. If a transfer fails or comes back later, that is recorded too and the earnings return to the coach's balance for a future payout.

Every step is written to the batch's audit trail with who did it.

---

## 7. Before real money is possible

The live gate refuses unless **all** of these are true:

1. `LIVE_BILLING=true` in the server environment.
2. No commercial policy in the active set is still a default this codebase invented.
3. The terms of service and privacy notice are final, reviewed documents rather than drafts.
4. Everything the plan being sold promises can actually be delivered.

The fourth cannot be unlocked by approving anything. Selling a weekly call before calls exist would take real money for a promise the product cannot keep.

---

## 8. Where this lives in the code

| Area | File |
|---|---|
| Commercial rules, versioned | `web/src/lib/policy/registry.ts` |
| The live gate | `web/src/lib/policy/live-gate.ts` |
| What can actually be delivered | `web/src/lib/fulfillment.ts` |
| Money arithmetic | `web/src/lib/money/` |
| The split and refund reversals | `web/src/lib/money/split.ts`, `web/src/lib/ledger/effects.ts` |
| Starting a checkout | `web/src/lib/checkout/service.ts` |
| The webhook | `web/src/lib/payments/webhook.ts` |
| Customer billing and admin refunds | `web/src/lib/payments/billing.ts` |
| Payout batching | `web/src/lib/payouts/`, migration `0020` |
| The money functions themselves | `web/supabase/migrations/0019`–`0020` |
