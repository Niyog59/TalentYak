# Aafnai — Product Contract

**Module:** M00 — Product contract and scope
**Status:** Specification complete; several commercial policies remain open (see `DECISION_REGISTER.md`).
**Repository state at authoring:** `master @ 2bb3d9f89f9588076d958def8f0bb444ef54f26f`, working tree clean.
**Authority:** Founder decisions of 2026-09-09 (both passes) are current. This document and `DECISION_REGISTER.md` take precedence over any other document. **`docs/HANDOVER.md` was amended on 2026-09-09** — §6.1, §6.2, §6.3, §6.5 and §12 were revised, §6.7 added, and superseded text preserved as history — so it is no longer in conflict.

**Amended 2026-09-09 (second pass):** the business model, pre-payment coach selection, commission base and payout timing, and long-term prepaid coaching are now settled. `OPEN-01`, `OPEN-03`, `OPEN-09`, and the `HB:194` selection conflict are **resolved**; `OPEN-02` is narrowed to `AAF-TERM-05`, which **blocks prepaid plans**. See `DECISION_REGISTER.md` §K.

**Label discipline used throughout:**

| Label | Meaning |
|---|---|
| **CONFIRMED** | The founder has decided this. Build to it. |
| **PROPOSED** | A recommendation with a stated tradeoff. Not approved. Do not implement as a requirement. |
| **OPEN** | Undecided. Named gate blocks a specific module. |
| **SUPERSEDED** | Previously written somewhere; no longer the rule. |

---

## 1. Product purpose, users, launch boundary

### 1.1 Purpose

Aafnai is an umbrella services brand for Nepalis living abroad. The first and only active launch vertical is **online fitness coaching**, delivered by Nepal-based coaches to diaspora clients. The differentiator under test is cultural and dietary fit (dal bhat, Nepali groceries, festival eating, vegetarian protein, language, family and shift-work routines), not merely "a Nepali-speaking coach."

**This document specifies what the product must do. It does not assert that demand has been validated.** See OPEN-11.

### 1.2 Users

| User | Description | Primary surfaces |
|---|---|---|
| **Client** | Diaspora customer purchasing coaching | Public site, checkout, My Aafnai account, fitness workspace |
| **Coach** | Nepal-based provider, autonomous in coaching and pricing | Coach workspace: plans, roster, programmes, check-ins, calls, earnings |
| **Aafnai operations** | The founder, initially sole operator | Admin console |
| **Integrations** | Payment processor, call provider, email, storage, payout route | No UI; contracts defined at module boundaries |

### 1.3 Launch boundary

**In scope for the first product:**

- Coach-created plans with coach-set prices and coach-defined inclusions (CONFIRMED, §2.1)
- Purchase of a monthly coaching plan and of a one-off consultation
- Scheduled video/audio calls where the purchased plan includes them
- Coach-authored programmes; client logging of sets, reps, weights, notes
- Bodyweight and body-measurement entry with dated history
- Private progress photos and exercise/set videos for form review, with coach feedback
- Progress graphs for client and assigned coach
- Preserved programme versions and historical workout records
- Client accounts with Google sign-in; prices displayed in the client's local currency
- Coach earnings visibility and an Aafnai-operated payout workflow

**Explicitly excluded from the first product:**

| Exclusion | Reason |
|---|---|
| Public multi-vertical marketplace | Premature; see `aafnai-project-handover.md` §"Scope discipline" |
| Tutoring and pandit as *public* verticals | Fitness-first is the working recommendation (PROPOSED, AAF-BRAND-04); public activation is OPEN |
| Deletion of pandit code or data | Forbidden (CONFIRMED, AAF-BRAND-05); `CLAUDE.md` node-protection rule also applies |
| Software-only subscription for coaches' own clients | A separate business; deferred (`aafnai-project-handover.md` §"Coach-owned clients") |
| Source-based commission (Aafnai-acquired vs coach-acquired) | Rejected in prior discussion; not reintroduced here |
| Medical or disease-specific nutrition guidance | Licensing exposure; general wellness only |
| Native mobile applications | Responsive web only |
| Automated payout execution | Manual, operator-approved transfers at this scale |

### 1.4 What Aafnai must not claim

Aafnai may describe only the screening and supervision it actually performs. The founder is not a fitness professional. No page, plan, or email may assert expert technical oversight of coaching, verified credentials that have not been verified with the issuer, testimonials that did not occur, client counts that are not real, or coaches who do not exist. This restates `CLAUDE.md` invariant 9 and extends it to credential and supervision claims.

---

## 2. Confirmed decisions

Each carries its `DECISION_REGISTER.md` ID.

### 2.1 Coach autonomy over plans and pricing — **AAF-PLAN-01 … 05**

- **AAF-PLAN-01 (CONFIRMED).** Coaches create their own plans, set their own prices, and define their own inclusions. **There is no single mandatory Aafnai coaching package.**
- **AAF-PLAN-02 (CONFIRMED).** There is **no** Aafnai price-approval workflow, price floor, or price ceiling. Aafnai does not approve commercial price changes.
- **AAF-PLAN-03 (CONFIRMED).** The plan builder must make inclusions clear and comparable across coaches (field list in §4).
- **AAF-PLAN-04 (CONFIRMED).** Technical validation and truthful service descriptions are still required: a price must be valid for supported payment processing, and a plan may not advertise functionality the platform does not provide. **Technical constraints do not authorise invented commercial price controls.**
- **AAF-PLAN-05 (CONFIRMED).** The coach decides whether and when to change a programme. There is no mandatory four-week replacement cycle and no Aafnai approval of workouts. The founder does not direct exercise selection, sets, reps, progression, or training decisions. **"The current programme should continue" is a legitimate and complete outcome of a programme review.**

### 2.2 Commission — **AAF-COMM-01 … 03**

- **AAF-COMM-01 (CONFIRMED).** Monthly coaching: **Aafnai 30% / coach 70%.**
- **AAF-COMM-02 (CONFIRMED).** One-off consultations: **Aafnai 40% / coach 60%.**
- **AAF-COMM-03 (CONFIRMED).** The plan builder displays **Customer pays / Coach receives / Aafnai share**, with clearly labelled assumptions and rounding.

Worked examples and the classification rule are in §5. The **commission base is CONFIRMED** — see §5.2 (AAF-COMM-06 … 09).

### 2.3 Calendar and calls — **AAF-CAL-01 … 06**

- **AAF-CAL-01 (CONFIRMED).** Coaches set availability in their own local timezone.
- **AAF-CAL-02 (CONFIRMED).** Clients see and select slots in their own local timezone.
- **AAF-CAL-03 (CONFIRMED).** Video calls and internet audio calls are both supported.
- **AAF-CAL-04 (CONFIRMED).** Weekly-call scheduling is supported where the purchased plan includes it.
- **AAF-CAL-05 (CONFIRMED).** Call allowance and duration belong to the plan. **No universal weekly 30-minute call is imposed.**
- **AAF-CAL-06 (CONFIRMED).** Clear timezone display with an override, slot-conflict protection, and appointment history are required.

### 2.4 Progress and coaching workspace — **AAF-PROG-01 … 12**

The following are **required capabilities of the first product**, not deferrals:

| ID | Capability |
|---|---|
| AAF-PROG-01 | Private progress photos |
| AAF-PROG-02 | Daily bodyweight entry with dates and unit preference (kg/lb) |
| AAF-PROG-03 | Body measurements with dated history |
| AAF-PROG-04 | Coach-authored workout programmes |
| AAF-PROG-05 | Client entry of actual sets, repetitions, weights, and notes |
| AAF-PROG-06 | Preserved previous programmes and historical workout records |
| AAF-PROG-07 | Progress/change graphs visible to client and assigned coach |
| AAF-PROG-08 | Exercise/set videos for coach form review, with coach feedback |

Constraints:

- **AAF-PROG-09 (CONFIRMED).** Daily weight entry is a *capability*, not an obligation. No client is required to weigh in daily; the product must not nag, streak-shame, or gate features on weigh-in frequency.
- **AAF-PROG-10 (CONFIRMED).** A programme edit must never rewrite what a client was previously prescribed or previously logged. Prior versions and prior logs are immutable history.
- **AAF-PROG-11 (CONFIRMED).** The product must not automatically characterise a weight increase or decrease as good or bad. Present the data and the trend; the coach supplies interpretation.
- **AAF-PROG-12 (CONFIRMED).** All progress media is private. Access rules and retention rules are required specifications; **their content is OPEN** (OPEN-10).

### 2.5 Accounts and currency — **AAF-ACCT-01 … 02**

- **AAF-ACCT-01 (CONFIRMED).** Clients can create accounts and sign in with Google.
- **AAF-ACCT-02 (CONFIRMED).** Client prices are shown in the client's own local currency.

**AAF-ACCT-04 (CONFIRMED as a distinction, OPEN as a mechanism).** Showing a converted estimate is not the same as charging in that currency. Whether Aafnai holds fixed per-currency prices or converts at display time, which markets are supported, and who bears FX cost are OPEN (**OPEN-01a**).

Email/password sign-in, Apple sign-in, verified email, optional phone verification, and role-based MFA are **PROPOSED** (AAF-ACCT-03), not confirmed. Note that `CLAUDE.md` → Security operating rules independently requires a second factor for admin accounts; that requirement stands regardless of AAF-ACCT-03's status.

### 2.6 Brand and verticals — **AAF-BRAND-01 … 05**

- **AAF-BRAND-01 (CONFIRMED).** Continue the Aafnai direction on the existing Ghartira codebase.
- **AAF-BRAND-02 (CONFIRMED).** The founder permits replacing unsuitable UI.
- **AAF-BRAND-03 (CONFIRMED).** Preserve useful foundations and historical data.
- **AAF-BRAND-04 (PROPOSED).** Fitness-first launch with other verticals retained internally. *No founder-approved scope statement confirming this was located; `docs/HANDOVER.md` §7.3 and §10 still describe a two-vertical January launch. Final public-vertical activation is **pending**.*
- **AAF-BRAND-05 (CONFIRMED).** Do not delete pandit code, and **do not assume that hiding its links secures any existing sensitive data** (see §9.3 and `CODEBASE_RECONCILIATION.md` R-19).

### 2.7 Operational responsibility — **AAF-OPS-01 … 02**

- **AAF-OPS-01 (CONFIRMED).** Aafnai handles client requests to change coaches.
- **AAF-OPS-02 (PROPOSED, needs confirmation).** Aafnai also handles billing failures, complaints, missed service, and safety escalations. *These were assistant recommendations. The founder has not explicitly accepted all of them and must not be portrayed as having done so.*

**Limited operational involvement does not eliminate legal responsibility.** Whatever Aafnai does or does not operationally handle, the contractual and regulatory position depends on OPEN-09 (business role) and requires qualified professional advice. This document gives no legal conclusion.

---

## 3. Responsibility matrix

C = carries the obligation · S = supports · — = no role. **Rows marked ‡ depend on OPEN-09 and may move.**

| Responsibility | Client | Coach | Aafnai ops | Integrations |
|---|---|---|---|---|
| Set plan price and inclusions | — | **C** | — | — |
| Coaching quality, exercise selection, progression | — | **C** | — | — |
| Deciding whether to revise a programme | — | **C** | — | — |
| Reviewing form videos, giving feedback | — | **C** | S | — |
| Honouring the response commitment stated in the plan | — | **C** | S | — |
| Setting availability | — | **C** | — | — |
| Attending booked calls | **C** | **C** | — | S |
| Accurate self-reported logs, weights, measurements | **C** | S | — | — |
| Disclosing injuries, conditions, medical constraints | **C** | S | — | — |
| Truthful plan descriptions | — | **C** | **C** | — |
| Billing, checkout, receipts | — | — | **C** | **C** |
| Failed-payment recovery ‡ | S | — | **C** (AAF-OPS-02, PROPOSED) | **C** |
| Refund decisions ‡ | — | S | **C** | S |
| Coach change requests | S | S | **C** (AAF-OPS-01) | — |
| Complaints and service failures ‡ | — | S | **C** (AAF-OPS-02, PROPOSED) | — |
| Safety escalation and referral ‡ | S | **C** | S (AAF-OPS-02, PROPOSED) | — |
| Coach compensation calculation and transfer | — | S | **C** | **C** |
| Credential verification with the issuing body | — | S | **C** | — |
| Privacy, access control, retention of health media | — | S | **C** | **C** |
| Platform availability and data durability | — | — | **C** | **C** |

**Known gap.** `aafnai-project-handover.md` §"Quality and responsibility gap" states the founder cannot credibly claim expert technical oversight of coaching. The matrix therefore assigns coaching quality to the coach. **Who reviews a technical coaching complaint — one where the client alleges the programming itself was unsafe or incompetent — has no owner in this matrix.** That is OPEN-10 and is a launch-gating question, not a documentation defect.

---

## 4. Coach-created plan: field specification

The plan is the commercial and entitlement contract. Requirements below satisfy AAF-PLAN-03 (comparability) **without** forcing identical packages (AAF-PLAN-01).

**Vis** = visibility: `public` (shown pre-purchase), `client` (shown to purchasers), `internal` (coach/ops only).
**Ver** = versioned at purchase: if `yes`, the value is frozen into the purchase record and later plan edits do not alter an existing purchase (AAF-DATA-02).

| Field | Type / meaning | Req. | Validation | Vis | Ver |
|---|---|---|---|---|---|
| `plan_id` | Stable identifier | required | immutable | internal | yes |
| `coach_id` | Owning coach | required | must be an active coach | public | yes |
| `version` | Monotonic integer | required | increments on any published change | client | yes |
| `name` | Coach-chosen plan name | required | 3–60 chars; no unsupported claims | public | yes |
| `description` | What the client gets, in prose | required | 50–1500 chars | public | yes |
| `service_type` | `monthly_coaching` \| `one_off_consultation` \| `long_term_coaching` | required | drives commission (§5.3) | public | yes |
| `price_amount` | Integer minor units | required | > 0; within processor min/max for the currency | public | yes |
| `price_currency` | ISO 4217 | required | must be a supported charge currency (**OPEN-01a**) | public | yes |
| `billing_structure` | `one_time` \| `recurring_monthly` \| `recurring_interval` \| `prepaid_term` | required | must be supported by the processor | public | yes |
| `billing_interval_count` | e.g. 1 or 3 | conditional | required when `recurring_interval` | public | yes |
| `term_length_months` | e.g. 6 | conditional | required when `prepaid_term` or `long_term_coaching` | public | yes |
| `calls_included` | boolean | required | — | public | yes |
| `call_frequency` | e.g. weekly, fortnightly, monthly, N per term | conditional | required when `calls_included`; must be schedulable | public | yes |
| `call_duration_minutes` | integer | conditional | required when `calls_included`; must fit slot rules | public | yes |
| `call_modality` | `video` \| `audio` \| `either` | conditional | must be a supported modality (AAF-CAL-03) | public | yes |
| `messaging_included` | boolean | required | — | public | yes |
| `messaging_response_commitment` | e.g. "within 24h on weekdays" | conditional | required when `messaging_included` | public | yes |
| `programme_service` | What programming is provided and how it is delivered | required | must map to real platform capability | public | yes |
| `programme_revision_basis` | e.g. "reviewed monthly; revised when the coach judges it useful" | required | **must not be rendered as a guaranteed replacement cadence unless the coach states one** (AAF-PLAN-05) | public | yes |
| `check_ins_included` | boolean | required | — | public | yes |
| `check_in_cadence` | e.g. weekly | conditional | required when `check_ins_included` | public | yes |
| `form_review_included` | boolean | required | — | public | yes |
| `form_review_allowance` | e.g. "unlimited", "4 clips/month" | conditional | required when `form_review_included`; **no platform-imposed two-video cap** | public | yes |
| `nutrition_guidance_included` | boolean | required | general wellness only; no medical/disease plans | public | yes |
| `long_term_option` | Coach-chosen longer commitment, if offered | optional | must state term, total price, and refund basis (OPEN-02) | public | yes |
| `capacity_limit` | Max concurrent clients on this plan | optional | ≥ 1 when set; enforced at checkout | internal | no |
| `status` | `draft` \| `published` \| `paused` \| `retired` | required | see §7.1 | internal | no |
| `languages` | Nepali / English / either | required | — | public | yes |
| `coach_timezone` | IANA zone | required | valid IANA identifier | client | no |

### 4.1 Standard comparison fields

The public plan card and the plan-comparison view render a **fixed set of rows in a fixed order** so that two different coaches' plans are legible side by side. Every row is always shown; a coach who does not include something produces **"Not included"**, never a blank.

Order: price and billing → service type → calls (frequency, duration, modality) → messaging and response commitment → programme service → programme revision basis → check-ins and cadence → form review and allowance → nutrition guidance → language → coach timezone.

**This standardises the *questions*, not the *answers*.** Aafnai does not require any coach to include any particular item, does not compare plans on price rank, and does not badge a plan as "best value," "recommended," or "most popular."

### 4.2 Capability versus entitlement — a hard rule

**AAF-ENT-01 (CONFIRMED, derived from AAF-CAL-05 and AAF-PLAN-01).**

A platform capability is not an entitlement. Concretely:

- The platform having a call system does **not** give every plan calls, nor unlimited calls.
- The platform having a check-in form does **not** establish a universal check-in cadence.
- The platform having form-review video does **not** grant every plan form review, nor an unlimited allowance.
- The platform having messaging does **not** imply any response time.

Every gated action must be authorised against **the purchased plan version's** entitlement record, never against the existence of the feature and never against the coach's *current* plan definition.

---

## 5. Service type, commission, and worked examples

### 5.1 Rates (CONFIRMED)

| Service type | Coach | Aafnai |
|---|---|---|
| Monthly coaching | **70%** | **30%** |
| One-off consultation | **60%** | **40%** |
| Long-term coaching (multi-month) | **70%** (proposed — treated as coaching, AAF-COMM-05) | **30%** |

### 5.2 Commission base — **CONFIRMED 2026-09-09**

- **Base (AAF-COMM-06).** The split is calculated on the **coaching service amount, excluding separately collected taxes**.
- **Fees (AAF-COMM-07).** Aafnai covers **ordinary payment-processing and payout fees from its own share**.
- **Discounts (AAF-COMM-08).** An **Aafnai-funded promotion must not reduce the coach's agreed earnings.** A **coach-funded discount requires the coach's explicit acceptance.**
- **Refunds (AAF-COMM-09).** A refund reverses the corresponding **service amount and its commission allocation**. Disputes and adjustments are tracked **explicitly**, as new entries, never by editing history.

**Rounding rule (AAF-COMM-04).** Compute in integer minor units: `coach = round(base × rate)`, then `aafnai = base − coach`. The two shares always sum exactly to the base with no lost cent. This matches the arithmetic already used in `web/src/lib/payouts/index.ts:24-29`.

**What is still open:** multi-currency conversion and rounding presentation (**OPEN-01a**). Charging in a currency is not the same as displaying a converted estimate.

### 5.2a Payout timing — **CONFIRMED 2026-09-09 (AAF-PAY-03)**

Coaches are paid **monthly in arrears, during the first seven days of the following month**, for service delivered **through the previous month-end**. Partial service months are **prorated consistently**.

**A customer payment arriving does not make that amount payable to the coach** (AAF-PAY-04). Customer payments, earned coach balances, and actual payouts are three separate things (AAF-DATA-05).

### 5.3 Classification rule — **AAF-COMM-05 (CONFIRMED 2026-09-09)**

**Commission is classified by service type, not by payment count.**

A six-month coaching commitment paid once is **coaching**, not a consultation. Without this rule, a prepaid long-term plan would silently attract the 40% consultation rate simply because the client paid a single time — transferring value away from the coach for a purely billing-shaped reason.

**Confirmed 2026-09-09 (AAF-TERM-01 … 04).** A six-month coaching package is **ongoing coaching at 70/30**, even when purchased through one upfront payment. Additionally:

- **Allocate the payment across the service period** and **release coach earnings as service is delivered** (AAF-TERM-02).
- **Track the undelivered balance separately** (AAF-TERM-03).
- **A coach change mid-term must preserve the distinction** between the original coach's earned amount and the remaining service funding (AAF-TERM-04).

> **Still blocking (AAF-TERM-05).** Cancellation and refund rules for prepaid terms are **unresolved**. **Prepaid plans must not be enabled until they are decided.** A monthly-billed term commitment is not affected by this block.

### 5.4 Worked examples — **arithmetic proofs of the confirmed percentages, not launch prices**

> Every figure below is a **synthetic example**. No coach has set these prices. No price here is offered to any customer. All are computed **before** the unresolved fee and tax adjustments in OPEN-01.

**Monthly coaching at 70/30:**

| Customer pays | Coach receives | Aafnai share | Check |
|---|---|---|---|
| $100.00 | $70.00 | $30.00 | 7000 + 3000 = 10000 ✓ |
| $85.00 | $59.50 | $25.50 | 5950 + 2550 = 8500 ✓ |
| $75.00 | $52.50 | $22.50 | 5250 + 2250 = 7500 ✓ |
| $49.99 | $34.99 | $15.00 | round(4999×0.70)=3499; 4999−3499=1500 ✓ |

**One-off consultation at 60/40:**

| Customer pays | Coach receives | Aafnai share | Check |
|---|---|---|---|
| $20.00 | $12.00 | $8.00 | 1200 + 800 = 2000 ✓ |
| $35.00 | $21.00 | $14.00 | 2100 + 1400 = 3500 ✓ |
| $19.99 | $11.99 | $8.00 | round(1999×0.60)=1199; 1999−1199=800 ✓ |

**Why classification matters — a six-month plan at $85/month:**

| Treatment | Customer pays | Coach receives | Aafnai share |
|---|---|---|---|
| Classified as **coaching** (70/30) — **confirmed rule** | $510.00 | **$357.00** | $153.00 |
| Misclassified as **one-off consultation** (60/40) | $510.00 | **$306.00** | $204.00 |
| **Difference to the coach** | — | **$51.00** | — |

**How that $357.00 is actually released (AAF-TERM-02).** Not on day one. The payment is allocated across the six service months and earnings are recognised as service is delivered:

| Per service month | Amount |
|---|---|
| Service amount allocated | **$85.00** |
| Coach earns | **$59.50** |
| Aafnai earns | **$25.50** |

After the **first** delivered month the coach has earned **$59.50**, and **$425.00 of the $510.00 remains an undelivered balance** — tracked separately from earned coach balances and from actual payouts (AAF-DATA-05). The coach is paid in the first seven days of the following month for what was delivered through the previous month-end (AAF-PAY-03).

---

## 6. User journeys

Each journey states the trigger, the steps, and the decisions it depends on. Acceptance scenarios are in `M00_ACCEPTANCE.md`.

### 6.1 Coach creates a plan
Coach opens the plan builder → enters the §4 fields → the builder computes and displays **Customer pays / Coach receives / Aafnai share** with labelled assumptions and rounding (AAF-COMM-03) → **technical** validation only: price processable in the chosen currency, claimed inclusions map to real capabilities, conditional fields present (AAF-PLAN-04) → coach publishes.
**No Aafnai commercial approval step exists** (AAF-PLAN-02). *Depends on: OPEN-06 (inclusion vocabulary). The share figures' assumptions are settled — §5.2.*

### 6.2 Client purchases a monthly plan
Client browses coaches and their plans → **sees qualifications, price, inclusions, and compatible availability** → compares on the standard fields (§4.1) → selects a coach and plan → **the system confirms the coach can accept this customer** (capacity and availability, AAF-FLOW-02) → **only then is payment collected** → **entitlements are frozen from that plan version** (AAF-DATA-02) → the coach-client relationship becomes active → workspace opens.

**Confirmed 2026-09-09 (AAF-FLOW-01).** The client selects their coach **before being charged**. The coach is known at purchase, not assigned afterward. This closes the former conflict with `docs/HANDOVER.md`:194, which has been amended.

### 6.3 Client purchases a prepaid long-term plan
As 6.2, with the full term charged once, classified as coaching (AAF-COMM-05), and the entitlement covering the whole term. The payment is allocated across the service period and earnings release as service is delivered (AAF-TERM-02); the undelivered balance is tracked separately (AAF-TERM-03). ***Blocked: prepaid plans must not be enabled until AAF-TERM-05 — cancellation and refund rules — is decided.***

### 6.4 Client purchases a one-off consultation
Client selects a coach's consultation → sees price, duration, and purpose → pays → books a slot from the coach's availability in the client's own timezone → both parties see the appointment in their local times. Commission is 60/40. *Depends on: OPEN-04, OPEN-05.*

### 6.5 Client logs a workout
Client opens the current programme → logs actual sets, reps, weights, and notes (AAF-PROG-05) → the log is written against the **programme version in force at that moment** → history is immutable (AAF-PROG-10). Optional: bodyweight (AAF-PROG-02), measurements (AAF-PROG-03), photos (AAF-PROG-01), form clips (AAF-PROG-08).
Nothing requires a daily weigh-in (AAF-PROG-09); no automatic good/bad verdict on weight change (AAF-PROG-11).

### 6.6 Coach revises a programme
Coach reviews the client's logs and progress → **decides whether to change anything** → if changed, a **new version** is published and prior versions and logs are untouched → if unchanged, the review is recorded and **the programme simply continues, which is a complete and valid outcome** (AAF-PLAN-05). No cadence is imposed and no Aafnai approval is sought.

### 6.7 Form review
Client uploads an exercise/set video against a specific exercise → upload is validated and processed in a private pipeline (§8.2) → assigned coach views it and returns feedback → the clip and feedback are retained per the retention policy. Consumption counts against the plan's `form_review_allowance` **only when the plan states one**. *Depends on: OPEN-10.*

### 6.8 Coach change
Client requests a change, or ops initiates one → **Aafnai handles the request** (AAF-OPS-01) → a replacement coach is identified → the client is informed of any price or inclusion difference and consents → an effective date is set → records access is resolved → remaining prepaid value is allocated → the coach-client relationship transitions with full history preserved.
*Every mechanic in this journey is OPEN-08. The confirmed part is only that Aafnai handles the request.*

### 6.9 Cancellation and refund
Client cancels, or a payment fails, or ops issues a refund → entitlement end date is determined → coach earnings are adjusted by a **compensating entry, never by editing history** (AAF-DATA-01) → the client is notified.
*Refund allocation is settled by AAF-COMM-09. Notice and no-show rules are OPEN-05. Unused prepaid value is **AAF-TERM-05**, which blocks prepaid plans.*

### 6.10 Coach reads an earnings statement
Coach opens earnings → sees entries by state — collected, pending service, earned, payable, transfer pending, paid, adjusted (§7.6) → sees which purchases produced them and what has actually been transferred.
**A client payment must never be displayed as an already-delivered coach payout** (AAF-PAY-01). *Payout timing is set by AAF-PAY-03. Depends on: OPEN-12 (settlement buffer), OPEN-13 (Nepal route).*

---

## 7. Lifecycle contracts

> **These are proposed *logical* contracts describing required states and legal transitions. They are NOT existing database schemas and NOT a migration plan.** The current schema (`web/supabase/migrations/0001`–`0007`) contains none of these; see `CODEBASE_RECONCILIATION.md`. Physical design belongs to M03.

### 7.1 Plan
`draft → published → paused → retired`; `paused → published`; `retired` is terminal.
Publishing a change creates a **new version**. A version that has ever been purchased is immutable forever. `paused` blocks new purchases and does not affect existing ones. `retired` blocks new purchases and does not terminate existing ones.
*There is no `pending_approval` state — AAF-PLAN-02.*

### 7.2 Purchase / subscription
`pending_payment → active → past_due → active` (recovery) · `active → cancelled_pending_end → ended` · `past_due → ended` · `active|ended → refunded_partial|refunded_full`.
Carries the frozen plan version and the frozen entitlement set. *`past_due` handling is OPEN-02/OPEN-05.*

### 7.3 Service relationship (coach ↔ client)
`pending_start → active → transition_requested → transferred → ended`; `active → ended`.
A transfer ends one relationship and starts another; **both retain their history**. Records access at transfer is OPEN-08.

### 7.4 Appointment
`proposed → booked → confirmed → completed`; exits: `cancelled_client`, `cancelled_coach`, `no_show_client`, `no_show_coach`, `technical_failure`; recovery: `technical_failure|no_show_coach → made_up`.
Every appointment stores an absolute instant plus **both** parties' IANA timezones, so each sees their own local time (AAF-CAL-02) and history remains correct across DST. *Consequences of each exit are OPEN-05.*

### 7.5 Programme
`draft → published(v1) → superseded(v2…)`; superseded versions are immutable and permanently readable.
A workout log references the programme version in force when it was recorded (AAF-PROG-10). **There is no forced transition out of `published`** (AAF-PLAN-05).

### 7.6 Coach earnings
`collected → pending_service → earned → payable → transfer_pending → paid`; plus `adjusted` reachable from any state via a **new compensating entry**.

| State | Meaning |
|---|---|
| `collected` | Client paid; funds not yet settled to Aafnai |
| `pending_service` | Settled, but the service period is not yet delivered |
| `earned` | Service delivered; the coach has a claim |
| `payable` | Approved for transfer under the payout policy |
| `transfer_pending` | Transfer initiated, not confirmed |
| `paid` | Transfer confirmed |
| `adjusted` | A correcting entry (refund, dispute, error) — never an edit |

*Schedule set by **AAF-PAY-03**: monthly in arrears, first seven days of the following month, for service delivered through the previous month-end.*

---

## 8. Cross-cutting requirements

### 8.1 Historical record

**AAF-DATA-01 (CONFIRMED, derived).** Financial amounts and their history are immutable. Corrections are new entries. Payout *workflow* state may change, but it lives separately from the immutable amount record.

**AAF-DATA-02 (CONFIRMED, derived).** Purchase-time terms are frozen. Editing a plan never alters an existing purchase's price, inclusions, or entitlements.

**AAF-DATA-03 (CONFIRMED, derived).** Prescribed programmes and recorded logs are immutable history (AAF-PROG-10).

**AAF-DATA-04 (CONFIRMED).** Historical Ghartira data is preserved (AAF-BRAND-03). Existing pandit rules and transactions must remain reconstructible; the new commission rates apply to new coaching plans and **do not** retroactively reinterpret past records.

### 8.2 Privacy and access

- Progress photos, form videos, measurements, bodyweight, and injury disclosures are **health-adjacent personal data**. `CLAUDE.md` invariant 3 restricts them to the owning client and the **currently assigned** coach.
- Private storage only. No permanent public URLs, no guessable paths.
- Uploads go to a **quarantine location** and are only exposed after validation and processing (§8.5, item 3).
- A coach who is no longer assigned loses access on the transfer effective date. Whether prior clips remain visible to a former coach is OPEN-08.
- Grief data (`shraddha_dates`, and any pandit intake) remains under `CLAUDE.md` invariant 2 regardless of whether the pandit vertical is publicly visible (§9.3).
- Retention and deletion periods are **OPEN-10**.

### 8.3 Failure and recovery

- **Payment webhook processing** must be idempotent against retries *and* against interrupted processing, and must deduplicate **business effects** across different event types (§8.5, item 1).
- A failed background job must be visible and retryable, not silently terminal.
- A call-provider failure is a first-class appointment outcome (`technical_failure`), not a no-show.
- A failed upload must not leave a client believing a form video was submitted.
- Missing vendor credentials must degrade visibly and safely; they must never present unavailable functionality as working.

### 8.4 Truthful marketing

Restating and extending `CLAUDE.md` invariant 9: no fabricated testimonials, reviews, coach names, credentials, client counts, or prices. A plan may not advertise an inclusion the platform cannot deliver (AAF-PLAN-04). Credentials are stated only after verification with the issuing body, and stated at the precision verified.

> **Open item carried from the audit:** `web/src/app/(marketing)/page.tsx:141` renders a testimonial attributed to "Early family, Houston — September pilot." Its truth is unestablished (OPEN-10). It must be verified or removed before any traffic.

### 8.5 Corrections to prior audit remedies

The 2026-09-09 audit proposed several fixes that are **incomplete as stated**. These corrected requirements govern.

1. **Event deduplication.** A bare unique index on an event ID is not sufficient. Required: (a) a durable event record with explicit processing state, so a crash *mid-processing* does not leave an event marked complete or cause re-application on retry; and (b) a **business-effect** idempotency key — because two *different* event types can describe the same economic event (a first subscription cycle can arrive as both a checkout completion and an invoice payment). Deduplicate the effect, not merely the message.

2. **Financial immutability.** "Make the ledger append-only" understates it. Amounts and history are immutable (AAF-DATA-01); payout workflow is **separate** structured state. One table that is both append-only and status-mutable cannot be either.

3. **Uploads.** The audit's claim that presigned uploads *cannot* support EXIF stripping and re-encoding was **wrong** and is corrected here: a presigned upload into a **secure quarantine** bucket followed by server-side validation, re-encode, metadata stripping, and promotion to a private serving location **does** satisfy the requirement. What cannot satisfy it is exposing unvalidated originals directly.

4. **Accessibility.** "Zero ARIA attributes" is a poor diagnosis and indiscriminately adding ARIA would make things worse. The real requirements are semantic HTML, full keyboard operability, visible focus, sufficient contrast, and programmatically announced errors — verified by testing, not by attribute count. The concrete known defect is that the public navigation is hidden below 640px with no alternative, making content unreachable on a phone.

5. **Vertical visibility.** Hiding a vertical is **not** a data-access fix. `catalog_status = 'hidden'` affects only catalog listing (`web/supabase/migrations/0002_catalog.sql:53`); it does nothing to `bookings.intake_response` or `shraddha_dates`. Grief-data isolation is an independent requirement that survives any visibility change (AAF-BRAND-05).

---

## 9. Conflicts with existing documentation

Recorded, not resolved. `docs/HANDOVER.md` is founder-only and **was not edited**; it now contains statements superseded by §2.

### 9.1 Conflicts with `docs/HANDOVER.md` (protected, unedited)

| Location | Existing statement | Conflicts with | Resolution |
|---|---|---|---|
| `:151` | "Service tiers only — three scopes, platform-defined menu, **all coaches sell same packages**" | AAF-PLAN-01 | Superseded (SUP-01) |
| `:150` | "one coach tier (no Pro/Standard customer-facing split)" | AAF-PLAN-01 | Superseded (SUP-01) |
| `:152`, `:171` | "Founding coaches 65% … everyone else 60%" / "60% coach / 40% platform on all tiers" | AAF-COMM-01 | Superseded (SUP-06) |
| `:160`, `:161` | Fixed "$99/mo", "$159/mo" | AAF-PLAN-01 | Superseded (SUP-05) |
| `:161` | "Premium: 2 live video calls/mo" as a platform-set allowance | AAF-CAL-05 | Superseded (SUP-04) |
| `:194` | "**No browse-and-choose at launch.** Intake quiz → founder assigns within 48h" | §6.2 — coach-created plans require choosing a coach's plan before paying | **RESOLVED 2026-09-09** by AAF-FLOW-01. `docs/HANDOVER.md` §6.5 amended; the client now selects their coach before payment |
| §12 `:312` | "Do not create customer-facing coach tiers" | AAF-PLAN-01 — coach-set prices are customer-visible differentiation | Founder decision supersedes; recorded |
| §12 `:313` | "No more than 3 fitness service scopes at launch" | AAF-PLAN-01 — N coaches × M plans | Founder decision supersedes; recorded |
| §7.3, §10 | Two-vertical January launch; Gate B (2–3 coaches + ≥10 presold) before building fitness | AAF-BRAND-04 (PROPOSED) | **OPEN-11.** Whether Gate B was met is not established |

**The `:194` conflict was the most consequential in this document, and it is now settled.** The founder confirmed on 2026-09-09 that the client selects their coach and plan — with qualifications, price, inclusions, and compatible availability visible — before being charged, and that the system confirms the coach can accept the customer before collecting payment. `docs/HANDOVER.md` §6.5 has been amended accordingly. M05 and M16 build to selection-before-payment; the 48-hour assignment board becomes an exception tool.

### 9.2 Conflicts with `aafnai-project-handover.md` (external reference, not in repo)

| Location | Statement | Conflicts with | Resolution |
|---|---|---|---|
| `:61` | "Coaches can propose their monthly price, **subject to agreement**" | AAF-PLAN-02 | Superseded (SUP-02) |
| `:71-75` | 70/30 for Aafnai-acquired clients | AAF-COMM-01 | **Consistent** — this is now the unconditional monthly rate |
| `:62`, `:149` | "Show the coach, qualifications, price and inclusions before the client pays" | — | **Consistent** with coach-created plans; and it contradicts `docs/HANDOVER.md:194`, reinforcing §9.1 |

### 9.3 Contradictions between agent instructions and the repository

Found while reading instructions; unrelated to M00 scope but recorded per `CLAUDE.md` ("Flag every contradiction you find").

1. `AGENTS.md` and `.cursorrules` require reading `docs/STATE.md` and `docs/DIRECTION.md`. **Neither file exists.**
2. `.cursorrules` requires updating `docs/DATA-MAP.md` and `docs/RUNBOOK.md`, and extending `scripts/payout-test.ts`, `scripts/rls-test.ts`, and `scripts/lib/with-idle-timeout.mjs`. **None of these exist; there is no `scripts/` directory.**
3. `.cursorrules` cites `CLAUDE.md` → "Tone rules" and "design & tone rules". **`CLAUDE.md` contains no such section.**
4. `.cursorrules` names the protected tables as `deceased_records`, `tithi_reminders`, `ceremonies`, `health_records`. **Only `ceremonies` exists.** The actual grief table is `shraddha_dates` and the actual health tables are `progress_photos`, `measurements`, `bodyweight_logs`. **The real grief table is not named in the hard-stop list** — an agent obeying `.cursorrules` literally would not know `shraddha_dates` is protected.

Item 4 is a live safety defect in the agent instructions and should be corrected before any agent touches the pandit vertical. `.cursorrules` was not edited in this task.

---

## 10. Business questions requiring a founder decision

Full detail, recommended defaults, tradeoffs, and gates are in `DECISION_REGISTER.md`. Summary:

**Resolved on 2026-09-09 (second pass):** OPEN-01 (base, fees, discounts, refunds), OPEN-03 (payout timing), OPEN-09 (business model), and the `HB:194` selection conflict. Details in `DECISION_REGISTER.md` §K.

Still open:

| ID | Question | Blocks |
|---|---|---|
| **AAF-TERM-05** | **Prepaid cancellation and refund rules — blocks enabling prepaid plans** | M06 |
| OPEN-01a | Multi-currency conversion, rounding presentation, charge-currency model | M06 |
| OPEN-02a | Auto-renewal and existing-price protection | M05, M06 |
| OPEN-04 | One-off session duration and purpose (price is coach-set) | M05, M09 |
| OPEN-05 | Cancellation, no-show, technical failure, make-up, buffers, notice, booking window | M09, M10 |
| OPEN-06 | Per-plan response commitments; whether in-app messaging is in scope | M05, M13, M14 |
| OPEN-07 | Plan versioning and existing subscribers: consent, notice, migration | M05, M06 |
| OPEN-08 | Coach change: consent, price difference, records access, effective date *(earnings split settled by AAF-TERM-04)* | M05, M17 |
| OPEN-10 | Market scope, vetting evidence, adult/minor scope, retention/deletion, recording consent, testimonial truth | M08, M16, M17 |
| OPEN-11 | Actual environment and live data; status of prior founder-only gates | M01 |
| OPEN-12 | Processor settlement and balance-buffer model | M07 |
| OPEN-13 | Nepal payout route — **now urgent**, because a monthly payout date has been committed to | M07 |

**No approval is fabricated.** Nothing above is treated as decided.

---

## 11. Payments and payouts — factual model

Documented for specification only. **Nothing was configured, no account was created, and no integration was contacted.**

### 11.1 Settlement is a chain, not an event

```
Client payment authorised
  → funds appear in the processor's PENDING balance
  → funds become AVAILABLE on the processor's settlement schedule
  → payout from processor to Aafnai's business bank account
  → SEPARATE, SEPARATELY APPROVED transfer from Aafnai to the coach
```

Consequences that must be reflected in the product:

- **Changing payout scheduling does not accelerate settlement.** It changes when available funds leave, not when pending funds become available.
- **Processor payout timing and coach compensation timing are independent.** Coach compensation follows AAF-PAY-03, which is Aafnai's own policy and does not track the processor's schedule.
- A processor **minimum balance** can be held to cover anticipated refunds, disputes, and fees. **It is not automatically a per-coach escrow allocation** and must not be presented to coaches as their money being held.
- A client's payment must **never** be displayed as an already-delivered coach payout (AAF-PAY-01).

**Terminology discipline.** Do not call a processor balance "escrow." Do not assume indefinite holding, specific account eligibility, or a universal holding limit. These are **unverified** and account-specific.

### 11.2 Nepal payout route

**Remitly Business is a candidate**, not a confirmed route. Before it can be specified, the following must be verified against official current sources: the exact business model and permitted use, eligibility for the Nepal recipient route, fee structure, FX handling, and documentation requirements.

**Not claimed here:** that the corridor works for this use case, that business recipients are eligible, or that any API integration exists. All are **unverified** (OPEN-13).

### 11.3 Prepayment does not imply immediate full payout

**AAF-PAY-02 (CONFIRMED).** A prepayment does not trigger immediate transfer of the full term's coach compensation. The payment is allocated across the service period and earnings release as service is delivered (AAF-TERM-02); the undelivered portion is tracked separately (AAF-TERM-03); the coach is paid monthly in arrears (AAF-PAY-03).

### 11.4 M00 needs no vendor setup

M00 requires **no** Stripe account, no live keys, and no vendor provisioning. Later integration modules may begin with sandbox accounts under separate, explicit authorisation.

---

## 12. Module completion and gates

**M00 is complete when** the five deliverables exist, are internally consistent, correctly label every rule as confirmed/proposed/open/superseded, map every confirmed capability to an owning module and an acceptance scenario, and record conflicts without inventing approvals.

**M00 completion is not launch readiness.** M00 can be complete — and is — while the open policies in §10 remain unanswered. Each open item names the module it gates. **No policy is marked approved in order to close this module.**

---

## 13. Related documents

| Document | Contents |
|---|---|
| `DECISION_REGISTER.md` | Every rule with ID, status, source, rationale, affected modules, gate, owner |
| `CODEBASE_RECONCILIATION.md` | Audit findings and new requirements mapped to current source, with keep/repair/replace/new/defer |
| `M00_ACCEPTANCE.md` | Given/When/Then product scenarios |
| `M00_COMPLETION_REPORT.md` | What was inspected, changed, verified, and what remains |
| `docs/HANDOVER.md` | Founder-only business source of truth. **Protected. Contains superseded statements — see §9.1** |
| `docs/specs/` | Per-module build specs (`module-N.md`), written before each module is implemented |
