# TalentYak — Decision Register

> ### Amended 2026-09-25 (sixth pass) — read §L, then §M, then §N, then §O.
>
> **§T (2026-09-27)** records M12 client logging and progress. The founder decided that while coaching is paused for payment, **new tracking entries wait on the client's device** and save after renewal (TY-TRACK-06) — this amends TY-ACCESS-06.
>
> **§O (2026-09-25)** sets how agents report to the founder: short, plain language; what happened, how it affects users, a recommendation, and whether the founder must act. It simplifies the explanation, never the scope or the engineering.
>
> **§N (2026-09-22)** approves the paid-access rules: cancelling keeps access until the paid period ends; once it has run out and a renewal has failed, new service pauses and nothing is deleted; paying restores what was paused, never a suspension or a coach change. It **confirms** `cancellation.v2`, `payment_failure.v2` and `messaging.v2`, replacing the sandbox defaults they conflict with.
>
> **§M (2026-09-21)** records the private-messaging decisions: messaging is in scope and built, it is open to every paid relationship, a new coach never inherits a previous coach's thread, support reads a conversation only under an audited per-case grant, and pre-purchase enquiries stay off. It resolves the messaging half of `OPEN-06` and supersedes `HB:243` for the platform's own channel.
>
> **§L (2026-09-15)**: the product is now **TalentYak**, and the commission is **20% on both recurring coaching and one-off consultations**. **§L supersedes AAF-COMM-01, AAF-COMM-02, AAF-BRAND-06 and AAF-CAL-08, and narrows AAF-COMM-04.** Everything they replace is kept below, unedited, so historical records stay explicable.
>
> The file is still named for the Aafnai era on purpose: renaming it would break every citation in the code and documents that point at it. The name is a path, not a claim about the brand.

**Module:** M00 · **Authored against:** `master @ 2bb3d9f89f9588076d958def8f0bb444ef54f26f`

Every material rule, with its authority. **A source is treated as a founder decision only when it actually is one.** Prior assistant recommendations are not promoted to decisions merely because they appear in a handover document.

## Status vocabulary

| Status | Meaning | Build to it? |
|---|---|---|
| **CONFIRMED** | The founder decided this | Yes |
| **PROPOSED** | Recommendation with a stated tradeoff; not approved | No — do not implement as a requirement |
| **OPEN** | Undecided; blocks a named module | No |
| **SUPERSEDED** | Previously stated; no longer the rule | No — remove where encountered |

> **Amended 2026-09-09 (second pass).** The founder settled the business model, pre-payment coach selection, the commission base and payout timing, and long-term prepaid coaching. **`OPEN-01`, `OPEN-03`, and `OPEN-09` are now resolved**, `OPEN-02` is narrowed to one item, and the `docs/HANDOVER.md:194` browse-and-choose conflict is closed. New decisions are in **§K**. `docs/HANDOVER.md` has been amended accordingly and is no longer in conflict.

## Source keys

| Key | Document | Location | Protected? |
|---|---|---|---|
| **FM00** | Founder M00 instruction, 2026-09-09 | Conversation | — |
| **FM00b** | Founder decisions, 2026-09-09 second pass | Conversation | — |
| **HB** | `docs/HANDOVER.md` | In repo | **Yes — founder-only, not edited** |
| **APH** | `aafnai-project-handover.md` | `~/Downloads/aafnai-planning-documents/` | No (external reference) |
| **AUD** | `ghartira-codebase-audit.md`, 2026-09-09 | Same folder | No |
| **FM14** | Founder prompt, *M14 — Private messaging, full scope, one final verification*, revised 2026-09-21 | Supplied as PDF | — |
| **SRC** | Repository source, verified this session | Cited by path:line | — |
| **NOT-LOCATED** | Referenced by FM00 but **not found** in any inspected document | — | — |

## Owners

**Founder** — commercial, legal, and scope decisions. **Engineering** — technical rules derived from a confirmed founder decision. **Founder + qualified adviser** — items needing professional input.

---

## A. Coach plans and autonomy

| ID | Topic | Status | Rule | Source | Rationale | Modules | Gate | Owner |
|---|---|---|---|---|---|---|---|---|
| **AAF-PLAN-01** | Coach-created plans | **CONFIRMED** | Coaches create their own plans, set their own prices, and define their own inclusions. There is no single mandatory Aafnai coaching package. | FM00 §3.1 | Coach autonomy is the recruiting proposition; a fixed package is a weak offer to established coaches | M03, M05, M06, M15, M16 | — | Founder |
| **AAF-PLAN-02** | No price approval | **CONFIRMED** | No Aafnai price-approval workflow, price floor, or price ceiling. Aafnai does not approve commercial price changes. | FM00 §3.1 | Explicitly replaces the "subject to agreement" model | M05, M17 | — | Founder |
| **AAF-PLAN-03** | Comparability | **CONFIRMED** | The plan builder must make inclusions clear and comparable: name, description, service type, price/currency, billing structure, call frequency/duration if included, messaging/response commitment, programme services, check-ins if offered, form-review provision, coach-chosen long-term option. | FM00 §3.1 | Autonomy must not produce plans a client cannot compare | M05, M16 | — | Founder |
| **AAF-PLAN-04** | Technical validation | **CONFIRMED** | Price must be valid for supported payment processing; a plan may not advertise unavailable functionality. Technical constraints do not authorise invented commercial price controls. | FM00 §3.1 | Separates legitimate validation from re-imposed price control | M05, M06 | — | Founder |
| **AAF-PLAN-05** | Programme autonomy | **CONFIRMED** | The coach decides whether and when to change a programme. No mandatory replacement cadence, no Aafnai workout approval. "Continue the current programme" is a complete, legitimate review outcome. | FM00 §3.1 | Founder is not a fitness professional (APH §Quality gap) and does not direct training decisions | M11, M15 | — | Founder |
| **AAF-ENT-01** | Capability ≠ entitlement | **CONFIRMED** (derived) | A platform capability grants no entitlement. Gated actions authorise against the **purchased plan version's** entitlement record, never against feature existence or the coach's current plan. | Derived from AAF-PLAN-01 + AAF-CAL-05 | Prevents "we have calls" becoming "every plan has unlimited calls" | M05, M09, M10, M12, M13, M14 | — | Engineering |

---

## B. Commission

| ID | Topic | Status | Rule | Source | Rationale | Modules | Gate | Owner |
|---|---|---|---|---|---|---|---|---|
| **AAF-COMM-01** | Monthly rate | **CONFIRMED** | Monthly coaching: Aafnai **30%**, coach **70%**. | FM00 §3.2 | 60/40 left the coach near or below the local benchmark (APH:79) | M06, M07, M05, M15 | — | Founder |
| **AAF-COMM-02** | One-off rate | **CONFIRMED** | One-off consultations: Aafnai **40%**, coach **60%**. | FM00 §3.2 | Higher per-transaction servicing cost, no recurring relationship | M06, M07, M05 | — | Founder |
| **AAF-COMM-03** | Share disclosure | **CONFIRMED** | The plan builder displays Customer pays / Coach receives / Aafnai share, with clearly labelled assumptions and rounding. | FM00 §3.2 | `CLAUDE.md` invariant 8: economics are disclosed by us, never discovered | M05 | — *(base settled by AAF-COMM-06/07)* | Founder |
| **AAF-COMM-04** | Rounding | **CONFIRMED** | Integer minor units: `coach = round(base × rate)`, `aafnai = base − coach`. Guarantees exact summation. | Engineering; matches `SRC web/src/lib/payouts/index.ts:24-29` | No lost cent; continuity with existing arithmetic | M06, M07 | — *(confirmed 2026-09-09 with AAF-COMM-06)* | Engineering |
| **AAF-COMM-05** | Classification | **PROPOSED** | Commission is classified by **service type, not payment count**. A multi-month coaching commitment paid once is coaching (70/30), not a consultation (60/40). | FM00 §3.2 | A billing-shaped fact must not transfer ~$51 per $510 term away from the coach (PRODUCT_CONTRACT §5.4) | M05, M06, M07 | **OPEN-02** — six-month classification and billing need final confirmation | Founder |
| **AAF-PAY-01** | Payment ≠ payout | **CONFIRMED** (derived) | A client payment must never be displayed as an already-delivered coach payout. | FM00 §"Stripe buffer"; FM00 §5 acceptance 11 | Settlement is a chain, not an event | M07, M15 | — | Engineering |
| **AAF-PAY-02** | Prepaid payout | **CONFIRMED** | A prepayment must not trigger immediate transfer of the full term's coach compensation. Unearned service and refund exposure are modelled explicitly. | FM00 §"Stripe buffer" | Day-one exposure on a $510 term is ~$425 unearned | M07 | — *(restated as AAF-TERM-02; timing set by AAF-PAY-03)* | Founder |

---

## C. Calendar and calls

| ID | Topic | Status | Rule | Source | Rationale | Modules | Gate | Owner |
|---|---|---|---|---|---|---|---|---|
| **AAF-CAL-01** | Coach availability | **CONFIRMED** | Coaches set availability in their own local timezone. | FM00 §3.3 | Nepal-based coaches should not do mental TZ conversion | M09 | — | Founder |
| **AAF-CAL-02** | Client slot view | **CONFIRMED** | Clients see and select slots in their own local timezone. | FM00 §3.3 | US/UK/AU clients likewise | M09, M16 | — | Founder |
| **AAF-CAL-03** | Modalities | **CONFIRMED** | Both video and internet audio calls are supported. | FM00 §3.3 | Bandwidth and privacy vary | M10 | — | Founder |
| **AAF-CAL-04** | Weekly scheduling | **CONFIRMED** | Weekly-call scheduling is supported where the purchased plan includes it. | FM00 §3.3 | Recurring booking must exist as a capability | M09 | — | Founder |
| **AAF-CAL-05** | No universal allowance | **CONFIRMED** | Call allowance and duration belong to the plan. No universal weekly 30-minute call is imposed. | FM00 §3.3 | Follows AAF-PLAN-01 | M05, M09, M10 | — | Founder |
| **AAF-CAL-06** | Booking integrity | **CONFIRMED** | Clear timezone display with override, slot-conflict protection, and appointment history are required. | FM00 §3.3 | Double-booking and TZ error are the two failure modes that destroy trust fastest | M09 | — | Founder |
| **AAF-CAL-07** | Call provider | **PROPOSED** | Daily is a candidate call provider. **Not integrated, not contracted, not verified.** | FM00 §3.3; `HB:229` names Daily.co | Recommendation only | M10 | Separate authorisation for sandbox | Founder |
| **AAF-CAL-08** | Scheduling stack | **PROPOSED** | Own focused scheduling on Supabase; optional Google Calendar connection. Not live. | FM00 §3.3 | Recommendation only | M09 | — | Engineering |

---

## D. Progress and coaching workspace

All of D1–D8 are **CONFIRMED first-product capabilities**, per FM00 §3.4 ("requested for the first product, not casually deferred"). Owner: Founder. Gate: none for the capability; media rules gated by OPEN-10.

| ID | Capability | Status | Modules |
|---|---|---|---|
| **AAF-PROG-01** | Private progress photos | **CONFIRMED** | M08, M12 |
| **AAF-PROG-02** | Daily bodyweight entry with dates and unit preference | **CONFIRMED** | M12 |
| **AAF-PROG-03** | Body measurements with dated history | **CONFIRMED** | M12 |
| **AAF-PROG-04** | Coach-authored workout programmes | **CONFIRMED** | M11 |
| **AAF-PROG-05** | Client entry of actual sets, reps, weights, notes | **CONFIRMED** | M12 |
| **AAF-PROG-06** | Preserved previous programmes and historical workout records | **CONFIRMED** | M11, M12 |
| **AAF-PROG-07** | Progress/change graphs for client and assigned coach | **CONFIRMED** | M15 |
| **AAF-PROG-08** | Exercise/set videos for form review, with coach feedback | **CONFIRMED** | M08, M12 |

| ID | Constraint | Status | Rule | Source | Modules |
|---|---|---|---|---|---|
| **AAF-PROG-09** | Capability not obligation | **CONFIRMED** | Daily weighing is available, never required. No nagging, streaks, or feature gating on weigh-in frequency. | FM00 §3.4 | M12, M15 |
| **AAF-PROG-10** | Immutable prescription | **CONFIRMED** | A programme edit must not rewrite what was previously prescribed or logged. | FM00 §3.4 | M11, M12 |
| **AAF-PROG-11** | No automatic verdict | **CONFIRMED** | The product must not judge a weight increase or decrease as automatically good or bad. | FM00 §3.4 | M15 |
| **AAF-PROG-12** | Private media | **CONFIRMED** (rules OPEN) | All progress media is private. Access and retention rules are required specifications. | FM00 §3.4; `CLAUDE.md` invariant 3 | M08, M12 |

---

## E. Accounts, currency, brand

| ID | Topic | Status | Rule | Source | Modules | Gate | Owner |
|---|---|---|---|---|---|---|---|
| **AAF-ACCT-01** | Accounts + Google | **CONFIRMED** | Clients can create accounts and sign in with Google. | FM00 §3.5 | M04 | — | Founder |
| **AAF-ACCT-02** | Local-currency display | **CONFIRMED** | Client prices are shown in the client's own local currency. | FM00 §3.5 | M05, M06, M16 | Charge-currency mechanism gated by **OPEN-01a** | Founder |
| **AAF-ACCT-03** | Additional auth | **PROPOSED** | Email/password, optional Apple sign-in, verified email, optional phone verification, role-based MFA. **Recommended details, approval status not established.** | FM00 §3.5 | M04 | — | Founder |
| **AAF-ACCT-04** | Display ≠ charge | **CONFIRMED** (distinction) | Showing a converted estimate is not charging in that currency. Fixed supported-currency prices vs conversion/adaptive pricing, supported markets, and FX allocation remain **OPEN**. | FM00 §3.5 | M06 | **OPEN-01a** | Founder |
| **AAF-SEC-01** | Admin MFA | **CONFIRMED** (pre-existing) | Admin accounts require a second factor. Independent of AAF-ACCT-03. | `CLAUDE.md` → Security operating rules | M04, M17 | — | Engineering |
| **AAF-BRAND-01** | Continue on codebase | **CONFIRMED** | Continue the Aafnai direction on the existing Ghartira codebase. | FM00 §3.6 | M01, M02 | — | Founder |
| **AAF-BRAND-02** | UI replacement | **CONFIRMED** | The founder permits replacing unsuitable UI. | FM00 §3.6 | M02, M16 | — | Founder |
| **AAF-BRAND-03** | Preserve foundations | **CONFIRMED** | Preserve useful foundations and historical data. | FM00 §3.6 | M01, M03 | — | Founder |
| **AAF-BRAND-04** | Fitness-first | **PROPOSED** | Fitness-first launch with other verticals retained internally. **No founder-approved scope statement confirming this was located.** `HB:244-256` still describes a two-vertical January launch. | FM00 §3.6 | M16 | **OPEN-11** | Founder |
| **AAF-BRAND-05** | Pandit retention | **CONFIRMED** | Do not delete pandit code. Do not assume hiding its links secures existing sensitive data. | FM00 §3.6; `CLAUDE.md` node-protection | M01, M03 | — | Founder |
| **AAF-BRAND-06** | Visual direction | **PROPOSED** | Ivory `#F8F6F1`, deep teal `#0B5956`, charcoal `#182B2A`, restrained terracotta; lowercase `aafnai` wordmark and `a` monogram. Conceptual raster output, **not production vector assets**; name spelling and trademark unchecked. | APH:32-42 | M02 | — | Founder |

---

## F. Operational responsibility

| ID | Topic | Status | Rule | Source | Modules | Gate | Owner |
|---|---|---|---|---|---|---|---|
| **AAF-OPS-01** | Coach change | **CONFIRMED** | Aafnai handles client requests to change coaches. | FM00 §3.1 ("explicitly wants") | M17 | Mechanics: **OPEN-08** | Founder |
| **AAF-OPS-02** | Wider operations | **PROPOSED** | Aafnai also handles billing failures, complaints, missed service, and safety escalations. **Assistant recommendations; the founder has not explicitly accepted all of them.** | FM00 §3.1 | M17 | Needs confirmation | Founder |
| **AAF-OPS-03** | No liability waiver | **CONFIRMED** (statement of fact) | Limited operational involvement does **not** eliminate legal responsibility. This register gives no legal conclusion. | FM00 §3.1 | — | **AAF-OPS-06** — verification still required | Founder + qualified adviser |
| **AAF-OPS-04** | Truthful supervision claims | **CONFIRMED** | Aafnai describes only the screening and supervision it actually performs. No claim of expert technical oversight of coaching. | APH:67, :124; `CLAUDE.md` invariant 9 | M16, M17 | — | Founder |

---

## G. Data and integrity (derived engineering rules)

| ID | Topic | Status | Rule | Source | Modules | Owner |
|---|---|---|---|---|---|---|
| **AAF-DATA-01** | Financial immutability | **CONFIRMED** (derived) | Financial amounts and history are immutable. Corrections are new entries. Payout **workflow** state is separate structured state. | FM00 §5C; `CLAUDE.md` money discipline | M03, M07 | Engineering |
| **AAF-DATA-02** | Purchase-time freeze | **CONFIRMED** (derived) | Purchase-time price, inclusions, and entitlements are frozen. Editing a plan never alters an existing purchase. | FM00 §5D scenario 8 | M03, M05, M06 | Engineering |
| **AAF-DATA-03** | History immutability | **CONFIRMED** (derived) | Prescribed programmes and recorded logs are immutable history. | AAF-PROG-10 | M03, M11, M12 | Engineering |
| **AAF-DATA-04** | Historical preservation | **CONFIRMED** | Existing pandit rules and transactions remain reconstructible. New commission rates apply to new coaching plans and do **not** retroactively reinterpret past records. | FM00 §3.2, §3.6 | M03, M07 | Engineering |
| **AAF-TECH-01** | Event dedup | **CONFIRMED** (derived) | Deduplication must survive interrupted processing **and** deduplicate business effects across different event types. A unique index on event ID alone is insufficient. | FM00 §5C | M06 | Engineering |
| **AAF-TECH-02** | Upload pipeline | **CONFIRMED** (derived) | Secure quarantine plus server-side processing can support presigned uploads. Unvalidated public originals cannot. **Corrects `AUD` §7 finding 9, which wrongly claimed presigned uploads cannot strip EXIF.** | FM00 §5C | M08 | Engineering |
| **AAF-TECH-03** | Accessibility method | **CONFIRMED** (derived) | Accessibility requires semantic HTML, keyboard operability, visible focus, contrast, and announced errors — verified by testing. **Not indiscriminate ARIA attributes.** Corrects the framing in `AUD` §9. | FM00 §5C | M02, M16 | Engineering |
| **AAF-TECH-04** | Visibility ≠ security | **CONFIRMED** (derived) | Hiding a vertical is not a data-access fix. `catalog_status='hidden'` affects only catalog listing (`SRC web/supabase/migrations/0002_catalog.sql:53`) and does nothing to `bookings.intake_response` or `shraddha_dates`. | FM00 §5C; AAF-BRAND-05 | M01, M03 | Engineering |
| **AAF-DOC-01** | Spec location | **CONFIRMED** (process) | M00 records live in `docs/aafnai/`. `docs/specs/` remains the location for per-module build specs (`module-N.md`) per its own README. No competing specification is created. | This session | — | Engineering |

---

## H. SUPERSEDED — explicit revocations

These are no longer the rule. **Where any of them survives in a document, prompt, or code path, it must be removed or annotated.**

| ID | Superseded rule | Where it was stated | Superseded by | Verified in this session? |
|---|---|---|---|---|
| **SUP-01** | One mandatory monthly package; all coaches sell the same packages; one coach tier | `HB:150`, `HB:151` (**protected, unedited**); `APH:61` | **AAF-PLAN-01** | **Yes** — quoted from source |
| **SUP-02** | Mandatory Aafnai approval of each coach's price ("subject to agreement") | `APH:61` | **AAF-PLAN-02** | **Yes** — quoted from source |
| **SUP-03** | Forced four-week programme replacement | **NOT-LOCATED.** Not found in `HB`, `APH`, `AUD`, or repository source. Recorded on the founder's instruction (FM00 §5B). | **AAF-PLAN-05** | **No** — supersession recorded on founder authority only |
| **SUP-04** | Universal weekly 30-minute call; 45-minute onboarding call; two-video limit | Partially traceable: `HB:161` sets a platform-defined "2 live video calls/mo". The weekly-30-minute, 45-minute-onboarding, and two-video-limit specifics are **NOT-LOCATED**. | **AAF-CAL-05**, **AAF-PLAN-03** | **Partial** — `HB:161` verified; the rest on founder authority only |
| **SUP-05** | Fixed $99/month and $15/hour launch prices | `$99` and `$159`: `HB:160-161`, `SRC web/src/verticals/fitness/catalog.ts:38,54`, `SRC web/supabase/seed.sql`. `$15/hour`: **NOT-LOCATED** — FM00 §4 itself calls it "only a discussed pilot hypothesis". | **AAF-PLAN-01** | **Partial** — $99/$159 verified in code and doc; $15/hr not located |
| **SUP-06** | 60/40 and 65/35 splits for new monthly plans | `HB:152`, `HB:171`; `SRC web/src/verticals/fitness/payout.ts:11,18`; `SRC web/src/lib/payouts/index.ts:24,30` | **AAF-COMM-01**, **AAF-COMM-02** | **Yes** — verified in code and doc |

**Honesty note on SUP-03, SUP-04, SUP-05.** Some superseded items could not be located in any document available to this session; they presumably originate in a ChatGPT conversation not supplied. They are recorded as superseded **on the founder's explicit instruction**, and this register does not claim to have found them. This distinction matters: a future reader must not conclude that a document was searched and the rule confirmed present.

**Note on `docs/HANDOVER.md` — resolved 2026-09-09.** It was **amended under founder authorisation**. §6.1, §6.2, §6.3, §6.5 and §12 now carry the current rules; §6.7 was added for long-term prepaid coaching; a banner at the top points readers here. **Every superseded passage is preserved verbatim beneath its replacement**, so the history is intact and nothing was erased. SUP-01, SUP-04, SUP-05, and SUP-06 no longer appear there as live text. The file is no longer in conflict with this register.

---

## I. OPEN policies

Each: recommended default, tradeoff, gate.

### OPEN-01 · Commission base, fees, FX, rounding, tax — **RESOLVED 2026-09-09**

> Settled by **AAF-COMM-06** (base excludes separately collected taxes), **AAF-COMM-07** (fees from Aafnai's share), **AAF-COMM-08** (discount funding), **AAF-COMM-09** (refunds and disputes), and **AAF-COMM-04** (rounding). The recommended default below was adopted. **Remaining: OPEN-01a — multi-currency conversion and rounding presentation.** Original entry kept as history:
**Recommended default (PROPOSED):** commission on service revenue **excluding taxes**; ordinary processing costs from **Aafnai's share**; rounding per AAF-COMM-04.
**Tradeoff:** simple and coach-friendly, and it makes the coach's 70% mean what it says — but it puts all FX and processing variance on Aafnai's 30%, which on a $100 plan is roughly $30 before every other cost. At small volume, an FX-heavy corridor could consume much of it.
**Blocks:** M06 (charge construction, tax display), M07 (earnings computation). **Owner:** Founder.

### OPEN-02 · Long-term packages
Prepaid vs monthly-billed commitment; coach-controlled discounts; who funds a platform coupon; refund of unused service; coach replacement mid-term; auto-renewal; protection of existing prices.
**Recommended default (PROPOSED):** allow a coach-defined term with **monthly billing under commitment** rather than full prepayment; coach-funded discounts by default; pro-rata refund of undelivered months; no auto-renewal without explicit consent.
**Tradeoff:** monthly-under-commitment sharply reduces refund and payout exposure (PRODUCT_CONTRACT §5.4) but loses the cash-flow benefit of prepayment and adds `past_due` handling to a term.
**Blocks:** M05, M06. Also gates **AAF-COMM-05**. **Owner:** Founder.

### OPEN-03 · Coach earnings schedule — **RESOLVED 2026-09-09**

> Settled by **AAF-PAY-03**: monthly in arrears, first seven days of the following month, for service delivered through the previous month-end, prorating partial months. The recommended default below was adopted, with earnings recognised on delivery per **AAF-TERM-02**. Original entry kept as history:
States are specified (PRODUCT_CONTRACT §7.6); the **timing and thresholds are not**.
**Recommended default (PROPOSED):** monthly payout of `earned` amounts, with prepaid terms recognised as earned month by month rather than at purchase.
**Tradeoff:** limits refund/dispute exposure and matches manual operation at this scale, but a coach receiving a six-month client waits months for most of it — a real recruiting objection that must be stated honestly up front.
**Blocks:** M07. **Owner:** Founder. *Monthly payouts were recommended but not expressly finalised.*

### OPEN-04 · One-off sessions
Price, duration, purpose, and whether the coach chooses them.
**Recommended default (PROPOSED):** the coach sets price and duration, consistent with AAF-PLAN-01; Aafnai defines only the slot mechanics.
**Tradeoff:** consistent with coach autonomy; makes consultations harder to compare across coaches.
**Note:** `$15/hour` was **only a discussed pilot hypothesis** (FM00 §4). It is not a price, not a floor, and not a recommendation.
**Blocks:** M05, M09. **Owner:** Founder.

### OPEN-05 · Cancellation, no-show, failures, booking rules
Notice period, no-show consequences, technical-failure handling, make-up sessions, coach cancellations, entitlement carryover, booking buffers, minimum notice, booking window.
**Recommended default (PROPOSED):** 24-hour client notice to reschedule without consuming the entitlement; client no-show consumes it; coach no-show or verified technical failure never consumes it and is made up; 12-hour minimum booking notice; 30-day booking window; 15-minute buffer between calls.
**Tradeoff:** protects coach time while keeping platform-caused failures off the client — but every threshold is a guess with no operating data behind it.
**Blocks:** M09, M10. **Owner:** Founder.

### OPEN-06 · Plan inclusions and response commitments — **RESOLVED 2026-09-21 (messaging half); the rest stays open**
Which inclusions exist as first-class concepts; whether persistent in-app messaging is in scope.
**Resolved on the messaging question by FM14**, which commissions persistent in-app messaging in full scope and was built as M14. See §M. **Still open:** which inclusions are first-class concepts, and per-plan response commitments — a coach today states their response expectation in free text, and the plan's `messaging_channel` field remains free text.
**Recommended default (PROPOSED):** support programme, check-ins, form review, calls, and messaging as first-class inclusions, each with a coach-stated commitment.
**Tradeoff:** in-app messaging materially raises scope (M14, retention, moderation, safety) versus WhatsApp, which is what clients already use — but WhatsApp keeps the relationship off-platform and weakens the retention argument in `APH:109`.
**Important:** `HB:243` explicitly **defers** in-app messaging to WhatsApp. Persistent in-app messaging was an assistant recommendation; **do not record it as founder-approved.** If messaging stays out of scope, the claim "direct messaging with your coach" must be removed from `SRC web/src/verticals/fitness/catalog.ts:37`.
**Blocks:** M05, M13, M14. **Owner:** Founder.

### OPEN-07 · Plan versions and existing subscribers
**Recommended default (PROPOSED):** no silent retroactive change of price or inclusions; existing purchases stay on their frozen version (AAF-DATA-02); an increase requires notice and consent at the next renewal; a purely additive improvement may apply immediately.
**Tradeoff:** protects trust and matches `HB:164` ("price locked at signup"), but leaves long-tail legacy versions to support.
**Not reviewed by anyone qualified.** This is a product default, not a legal or consumer-protection opinion.
**Blocks:** M05, M06. **Owner:** Founder + qualified adviser.

### OPEN-08 · Coach change mechanics
Client consent, replacement price differences, records access, effective date, remaining prepaid value, compensation allocation.
**Recommended default (PROPOSED):** explicit client consent; no price change without consent; the new coach sees history from the effective date forward plus programme and log history but **not** prior private media unless the client re-consents; prepaid value transfers with the relationship; compensation splits at the effective date.
**Tradeoff:** the private-media rule is the most client-protective option and the most operationally awkward, since a new coach loses form-review context.
**Blocks:** M05, M07, M17. **Owner:** Founder.

### OPEN-09 · Actual business role — **RESOLVED 2026-09-09**

> Settled by **AAF-OPS-05**: contractor-delivered managed coaching service. **AAF-OPS-06** carries the standing obligation to verify contracts and payment-provider requirements before live payments — this is an intended business structure, not legal validation. Original entry kept as history:
Contractor-delivered Aafnai service vs intermediary marketplace.
**No recommended default.** This determines who contracts with the client, who is paid by whom, tax and reporting treatment, and where liability sits. **Coach autonomy over pricing does not by itself settle it** — a business can set no prices and still be the contracting party, or set all prices and still be an intermediary.
**Tradeoff not offered here.** Requires professional confirmation.
**Blocks:** M06, M07, legal terms, insurance. **Owner:** Founder + qualified adviser.

### OPEN-10 · Scope, vetting, safety, retention
Market scope; real coach onboarding/vetting evidence; adult/minor scope; service boundaries; support ownership; retention and deletion; recording consent. Also: **is the homepage testimonial at `SRC web/src/app/(marketing)/page.tsx:141` true?**
**Recommended defaults (PROPOSED):** one market at launch (`HB:262` favours Houston/DFW, and `HB:314` warns against launching US+UK+AU simultaneously); adults only; credentials verified with the issuing body and stated only at the precision verified; call recording **off by default** and only with the consent of everyone present.
**Tradeoff:** single-market and adults-only shrink the addressable pool but remove several compliance surfaces at once.
**Blocks:** M08, M16, M17. **Owner:** Founder + qualified adviser.

### OPEN-11 · Actual environment, live data, prior gates
Whether a production environment or live customer data exists; the status of prior founder-only rules including presales-before-build and the no-remote rule.
**Established this session:** the repository has **no git remote**, **no `web/.env.local`**, and **no `.vercel` directory**. **This is not evidence that no production exists** — an environment could exist entirely outside this checkout. Production and live-data presence are **UNKNOWN**.
`HB:283` Gate B (2–3 coaches + ≥10 presold clients by Nov 15) and `HB:308` ("do not build fitness before pandit pilot data + fitness presales") are founder-written gates whose status is **unknown**. **A future milestone is not a historical result.**
**Blocks:** M01. **Owner:** Founder.

### OPEN-12 · Stripe settlement and buffer
**Recommended default (PROPOSED):** model settlement as the explicit chain in PRODUCT_CONTRACT §11.1; hold a processor balance buffer sized to expected refunds, disputes, and fees; never present that buffer to coaches as per-coach escrow.
**Tradeoff:** a larger buffer reduces negative-balance risk and ties up cash the founder does not have.
**Unverified:** account eligibility, specific timing, and any holding limits are account-specific and were **not** checked.
**Blocks:** M07. **Owner:** Founder.

### OPEN-13 · Nepal payout route
**Candidate:** Remitly Business, **unverified**. Before specification, verify against official current sources: exact business model, permitted use, Nepal recipient route eligibility, fees, FX handling, documentation.
**Not claimed:** that the corridor works for this use case, that business recipients are eligible, or that an API integration exists.
**Note:** the existing schema already assumes a different provider — `SRC web/supabase/migrations/0001_core.sql:70` defaults `payout_channel` to `'payoneer'`, and `HB:227` names Payoneer. Any change is a decision, not a cleanup.
**Blocks:** M07. **Owner:** Founder.

---

## K. Second-pass decisions — 2026-09-09

All **CONFIRMED** unless stated. Source: **FM00b**. Owner: **Founder**.

### K1 · Business model

| ID | Topic | Status | Rule | Modules | Note |
|---|---|---|---|---|---|
| **AAF-OPS-05** | Business structure | **CONFIRMED** | For launch, Aafnai is a **contractor-delivered managed coaching service**: the customer purchases coaching from Aafnai, and their selected independent coach delivers it. Coaches control programmes, adjustments, plan prices, and inclusions. Aafnai handles discovery, billing, platform support, and coach-change requests. Routine programme changes stay between coach and client. | M06, M07, M16, M17 | **Resolves OPEN-09.** Treated as the intended structure, **not** legal validation — see AAF-OPS-06 |
| **AAF-OPS-06** | Verification before live payments | **CONFIRMED** (as an obligation) | Contracts and payment-provider requirements must be verified before live payments. The founder's instruction is a business decision, not legal advice, and does not discharge professional review. | M06 | Requirement list: `MIGRATION.md` §8 |

### K2 · Coach selection before payment

| ID | Topic | Status | Rule | Modules |
|---|---|---|---|---|
| **AAF-FLOW-01** | Selection precedes payment | **CONFIRMED** | The customer must see and select their coach **and** plan — qualifications, price, inclusions, and **compatible availability** — **before being charged**. | M05, M09, M16 |
| **AAF-FLOW-02** | Acceptance check at checkout | **CONFIRMED** | The system must confirm the coach **can accept this customer** before collecting payment. Capacity and availability are checked at checkout, not after. | M05, M06, M09 |

**Closes the `docs/HANDOVER.md:194` conflict.** Intake-then-assign is superseded; `docs/HANDOVER.md` §6.5 has been amended. The 48-hour assignment board (`web/src/app/admin/fitness/page.tsx`) becomes an exception tool for unassigned edge cases and transfers, not the main flow. **Activates `services.capacity_limit`**, a column that has never been read (`ARCHITECTURE.md` §4).

### K3 · Commission base, fees, discounts, refunds

| ID | Topic | Status | Rule | Modules |
|---|---|---|---|---|
| **AAF-COMM-06** | Commission base | **CONFIRMED** | The split is calculated on the **coaching service amount, excluding separately collected taxes**. | M06, M07 |
| **AAF-COMM-07** | Fee allocation | **CONFIRMED** | Aafnai covers **ordinary payment-processing and payout fees from its own share**. | M06, M07 |
| **AAF-COMM-08** | Discount funding | **CONFIRMED** | An **Aafnai-funded promotion must not reduce the coach's agreed earnings**. A **coach-funded discount requires the coach's explicit acceptance**. | M05, M06 |
| **AAF-COMM-09** | Refunds and disputes | **CONFIRMED** | A refund reverses the corresponding **service amount and its commission allocation**. Disputes and adjustments are tracked **explicitly**, as new entries. | M06, M07 |
| **AAF-COMM-05** | Classification | **CONFIRMED** *(was PROPOSED)* | Commission is classified by **service type, not payment count**. | M05, M06, M07 |

**Resolves OPEN-01** except multi-currency conversion and rounding presentation, which continue as **OPEN-01a**.

### K4 · Payout timing

| ID | Topic | Status | Rule | Modules |
|---|---|---|---|---|
| **AAF-PAY-03** | Payout schedule | **CONFIRMED** | Coaches are paid **monthly in arrears, during the first seven days of the following month**, for service delivered **through the previous month-end**. Partial service months are **prorated consistently**. | M07 |
| **AAF-PAY-04** | Arrival ≠ payable | **CONFIRMED** | A customer payment arriving does **not** immediately make the whole amount payable to the coach. | M07, M15 |
| **AAF-PAY-02** | Prepaid payout | **CONFIRMED** *(was PROPOSED)* | Superseded in substance by AAF-TERM-02: earnings release as service is delivered. | M07 |

**Resolves OPEN-03.**

### K5 · Long-term prepaid coaching

| ID | Topic | Status | Rule | Modules |
|---|---|---|---|---|
| **AAF-TERM-01** | Classification | **CONFIRMED** | A six-month coaching package is **ongoing coaching at 70/30**, even when purchased through one upfront payment. | M05, M06 |
| **AAF-TERM-02** | Allocation and release | **CONFIRMED** | Allocate the payment across the service period and **release coach earnings as service is delivered**. Worked example: **$510 over six months = $85 per service month → $59.50 coach / $25.50 Aafnai**. | M06, M07 |
| **AAF-TERM-03** | Undelivered balance | **CONFIRMED** | The undelivered balance is **tracked separately**. After one delivered month of the example above, **$425.00 remains undelivered**. | M03, M07 |
| **AAF-TERM-04** | Coach change mid-term | **CONFIRMED** | A coach change must **preserve the distinction between the original coach's earned amount and the remaining service funding**. | M07, M17 |
| **AAF-TERM-05** | Prepaid cancellation and refund | **OPEN — blocking** | Cancellation and refund rules for prepaid terms are **unresolved**. **Prepaid plans must not be enabled until they are decided.** | M06 |

**Narrows OPEN-02 to AAF-TERM-05**, plus auto-renewal and price protection, which remain **OPEN-02a**.

### K6 · Ledger separation and development mode

| ID | Topic | Status | Rule | Modules |
|---|---|---|---|---|
| **AAF-DATA-05** | Three ledgers | **CONFIRMED** | **Customer payments, earned coach balances, and actual payouts are three separate things** and are never conflated in storage or in any interface. | M03, M07, M15 |
| **AAF-DEV-01** | Mock payments first | **CONFIRMED** | Build and test with **mock payments now**. Live payments are enabled only after the documented requirement list is satisfied — `MIGRATION.md` §8. | M06, M18 |

### K7 · Status changes to earlier entries

| Entry | Was | Now |
|---|---|---|
| OPEN-01 | OPEN | **RESOLVED** by AAF-COMM-06/07/08/09. Remainder → **OPEN-01a** (multi-currency conversion, rounding presentation) |
| OPEN-02 | OPEN | **NARROWED** → **AAF-TERM-05** (prepaid cancellation/refund, blocking) and **OPEN-02a** (auto-renewal, price protection) |
| OPEN-03 | OPEN | **RESOLVED** by AAF-PAY-03 |
| OPEN-09 | OPEN | **RESOLVED** by AAF-OPS-05, with AAF-OPS-06 as the verification obligation |
| OPEN-08 | OPEN | **PARTIALLY RESOLVED** — earnings split at coach change settled by AAF-TERM-04. Consent, price difference, records access, and effective date remain open |
| AAF-COMM-05 | PROPOSED | **CONFIRMED** |
| AAF-PAY-02 | PROPOSED | **CONFIRMED**, restated as AAF-TERM-02 |
| `HB:194` conflict | Unresolved | **CLOSED** by AAF-FLOW-01; `docs/HANDOVER.md` §6.5 amended |

### K8 · Still open after this pass

| ID | Topic | Blocks |
|---|---|---|
| **AAF-TERM-05** | Prepaid cancellation and refund — **blocks enabling prepaid plans** | M06 |
| **OPEN-01a** | Multi-currency conversion, rounding presentation, charge-currency model | M06 |
| **OPEN-02a** | Auto-renewal and existing-price protection | M05, M06 |
| **OPEN-04** | One-off session duration and purpose (price is coach-set) | M05, M09 |
| **OPEN-05** | Cancellation, no-show, technical failure, make-up, buffers, notice, booking window | M09, M10 |
| **OPEN-06** | ~~Messaging in scope or WhatsApp~~ (**resolved by FM14 — see §M**); per-plan response commitments and first-class inclusions | M05, M13 |
| **OPEN-07** | Plan versioning consent for existing subscribers | M05, M06 |
| **OPEN-08** | Coach change: consent, price difference, records access, effective date | M05, M17 |
| **OPEN-10** | Market scope, vetting evidence, adult/minor, retention, recording consent, testimonial truth | M08, M16, M17 |
| **OPEN-11** | Actual environment, live data, prior gates | M01 |
| **OPEN-12** | Processor settlement and balance buffer | M07 |
| **OPEN-13** | Nepal payout route — **now urgent**, because a monthly payout date has been promised | M07 |

---

## J. Traceability check

Every CONFIRMED capability has an owning module and at least one acceptance scenario in `M00_ACCEPTANCE.md`.

| Decision | Modules | Acceptance scenario |
|---|---|---|
| AAF-PLAN-01, -02 | M03, M05, M06, M16 | AC-01 |
| AAF-PLAN-03, AAF-COMM-03 | M05 | AC-01, AC-02 |
| AAF-PLAN-04 | M05, M06 | AC-01, AC-12 |
| AAF-PLAN-05 | M11 | AC-03 |
| AAF-COMM-01, -02 | M06, M07 | AC-02 |
| AAF-COMM-05 | M06, M07 | AC-09 |
| AAF-ENT-01, AAF-CAL-05 | M05, M09, M10 | AC-05 |
| AAF-CAL-01, -02, -06 | M09 | AC-06 |
| AAF-CAL-03, -04 | M09, M10 | AC-05 |
| AAF-PROG-01, -08, -12 | M08, M12 | AC-07 |
| AAF-PROG-02, -03, -05 | M12 | AC-07, AC-04 |
| AAF-PROG-04, -06, -10 | M11, M12 | AC-04 |
| AAF-PROG-07, -09, -11 | M15 | AC-04, AC-07 |
| AAF-ACCT-01, -02, -04 | M04, M06, M16 | AC-02 |
| AAF-DATA-01, AAF-PAY-01 | M07 | AC-10, AC-11 |
| AAF-DATA-02, OPEN-07 | M05, M06 | AC-08 |
| AAF-OPS-01, OPEN-08 | M17 | AC-10 |
| AAF-BRAND-05, AAF-TECH-04 | M01, M03 | AC-13 |
| AAF-TECH-01 | M06 | AC-14 |
| Vendor-credential independence | all | AC-12 |

---

## L. Third-pass decisions — 2026-09-15 (TalentYak)

**Source key added:** **FM03** — Founder brief, *TalentYak — Complete M03–M07 implementation brief*, v1.0, supplied 2026-09-15. Founder-written. It states its own supersessions explicitly.

This pass changes the brand and the commission rate. Everything superseded below is **kept in place above**, unedited, so a reader can still reconstruct why a 2026 ledger row looks the way it does.

### L1 · Brand

| ID | Topic | Status | Rule | Source | Modules |
|---|---|---|---|---|---|
| **TY-BRAND-01** | Product and company name | **CONFIRMED** | The product and company are **TalentYak**, at **talentyak.com**. Capital T and capital Y. | FM03 §1 | all |
| **TY-BRAND-02** | Visual direction | **CONFIRMED** | Forest green `#124F43` and white, with the approved front-facing yak mark. **Supersedes AAF-BRAND-06** (ivory `#F8F6F1`, deep teal `#0B5956`, lowercase `aafnai` wordmark). | FM03 §4.2 | M02 |
| **TY-BRAND-03** | Asset reality | **CONFIRMED** (statement of fact) | The approved pack is **raster only — there are no SVG files.** Only `website/talentyak-symbol-transparent.png` is genuinely transparent; both horizontal files carry opaque backgrounds. No maskable icon has been produced or verified. | FM03 §4.2; pack README | M02 |
| **TY-REPO-01** | Repository | **CONFIRMED** | The GitHub repository `Niyog59/Aafnai` has been renamed to **`Niyog59/TalentYak`** (verified via the GitHub API, 2026-09-15). The local directory rename to `/Users/niyoguprety/dev/TalentYak` is authorised. | FM03 §4.1 | — |

### L2 · Commission — supersedes AAF-COMM-01, AAF-COMM-02

| ID | Topic | Status | Rule | Source | Modules |
|---|---|---|---|---|---|
| **TY-COMM-01** | Rate | **CONFIRMED** | **20% platform commission on recurring coaching AND 20% on one-off consultations.** Coaches receive 80% of both. **Supersedes AAF-COMM-01 (30%) and AAF-COMM-02 (40%)**, and every older 60/40, 65/35 and 70/30 assumption, for new offers. | FM03 §1 | M05, M06, M07 |
| **TY-COMM-02** | Rounding | **CONFIRMED** | **Commission is rounded first; the coach takes the exact remainder.** `commission = round(base × rate)` to the nearest minor unit, half away from zero; `coach = base − commission`. **Narrows AAF-COMM-04**, which rounded the coach's share first and produced a different answer on odd amounts. | FM03 §5 fixture 5 | M06, M07 |
| **TY-COMM-03** | Historical preservation | **CONFIRMED** | Actual historical contracts keep their original rates. Old ledger rows are never reinterpreted at the new rate. Superseded policy versions are retained in code so those rows stay explicable. | FM03 §1 | M03, M07 |
| **TY-COMM-04** | No customer fee | **CONFIRMED** | **No separate customer service fee and no hidden markup.** The customer sees a clear total before paying. Ordinary processing costs are borne by the platform out of its 20%, never deducted from the advertised coach 80%. *(Consistent with AAF-COMM-07.)* | FM03 §5 | M05, M06 |

**Worked fixtures (FM03 §5) — these are the authoritative test cases:**

| Case | Result |
|---|---|
| USD 100.00, no tax or discount | coach **80.00**, commission **20.00** |
| Coach discounts a USD 600.00 package to 540.00 | coach **432.00**, commission **108.00** |
| Platform funds a USD 10.00 promotion on a USD 100.00 service | customer pays **90.00**, coach entitlement **80.00**, platform net before processing **10.00** |
| Refund 25.00 from the first case | coach reversal **20.00**, commission reversal **5.00**; replay does not reverse again |
| USD 10.01 at 20% | commission **2.00**, coach **8.01** |

**Supersedes the Aafnai-era `$510` example.** A USD 510.00 six-month term now allocates **85.00 per service month → 68.00 coach / 17.00 platform**, with **425.00 undelivered** after one delivered month. **AAF-TERM-02's 59.50 / 25.50 figures are historical.** AAF-TERM-01 (a six-month package is coaching, not a consultation) and AAF-TERM-03 (undelivered balance tracked separately) are unchanged, and AAF-TERM-05 remains **OPEN and blocking** — prepaid terms stay disabled.

### L3 · Scope and vendors

| ID | Topic | Status | Rule | Source |
|---|---|---|---|---|
| **TY-SCOPE-01** | Launch vertical | **CONFIRMED** | Fitness is the only active launch vertical. Shared architecture is preserved for later services, but no empty vertical is advertised. **Resolves OPEN-11's vertical question**; the production-environment question remains open. | FM03 §1 |
| **TY-SCOPE-02** | Scheduling | **CONFIRMED** | Build our own narrow calendar in M09. **No Cal.com and no Calendly.** Google OAuth is for sign-in only, not Calendar sync. **Supersedes AAF-CAL-08's optional Google Calendar connection.** | FM03 §1 |
| **TY-SCOPE-03** | Stripe account | **CONFIRMED** (statement of fact) | The Stripe business account country is the **United States**. This does **not** by itself activate any customer market or any coach payout corridor. | FM03 §1, §5 |
| **TY-SCOPE-04** | Payout corridor | **CONFIRMED** (as an obligation) | Eligibility for US-business-to-Nepal-coach commercial payouts is **not established**. Neither Remitly, Payoneer, nor Stripe Connect is an approved route. **Sharpens OPEN-13**: build provider-neutral and manual-settlement-compatible; verify before designing any live transfer. | FM03 §10.4 |
| **TY-DEV-01** | Sandbox first | **CONFIRMED** | New purchase flows are fully tested in sandbox. **LIVE purchase stays disabled** until fulfilment, scheduling, business policies and payout eligibility are ready. *(Consistent with AAF-DEV-01.)* | FM03 §2 |

### L4 · Policies implemented as sandbox defaults

FM03 §5 distinguishes rules the founder has **confirmed** from working defaults that are **implemented and tested but blocked from live use** until approved. That distinction is enforced in code: `src/lib/policy/` carries a `status` of `confirmed` or `sandbox_default` on every policy, and `assertLiveBillingPermitted` refuses to take real money while any policy in the active set is still a sandbox default — an environment variable alone cannot open the gate.

**Awaiting founder approval:** fee presentation and FX/dispute cost allocation · commission base treatment of tax and settlement adjustments · platform-funded promotion campaigns · prepaid-term enablement · cancellation terms · payment-failure grace · earnings recognition and hold period · payout cutoff, minimum and negative-balance treatment · customer countries and coach payout corridors · adult-only onboarding.

### L5 · Status changes

| Entry | Was | Now |
|---|---|---|
| AAF-COMM-01 | CONFIRMED 70/30 | **SUPERSEDED** by TY-COMM-01 |
| AAF-COMM-02 | CONFIRMED 60/40 | **SUPERSEDED** by TY-COMM-01 |
| AAF-COMM-04 | CONFIRMED, coach rounded first | **NARROWED** by TY-COMM-02, commission rounded first |
| AAF-COMM-05 | CONFIRMED | **UNCHANGED** — classification is still by service type, and both types now carry the same rate |
| AAF-TERM-02 | CONFIRMED, 59.50 / 25.50 | **ARITHMETIC SUPERSEDED** by TY-COMM-01 → 68.00 / 17.00. The principle is unchanged |
| AAF-BRAND-06 | PROPOSED | **SUPERSEDED** by TY-BRAND-02 |
| AAF-BRAND-04 | PROPOSED, gated on OPEN-11 | **CONFIRMED** as TY-SCOPE-01 |
| AAF-CAL-08 | PROPOSED | **SUPERSEDED** by TY-SCOPE-02 — no Google Calendar connection |
| OPEN-13 | OPEN | **STILL OPEN**, sharpened by TY-SCOPE-04 |
| AAF-TERM-05 | OPEN, blocking | **STILL OPEN, STILL BLOCKING** — prepaid terms remain disabled in code |

---

## M. Fourth-pass decisions — 2026-09-21 (private messaging)

**Source key added:** **FM14** — Founder prompt, *M14 — Private messaging, full scope, one final verification*, revised 21 September 2026. Founder-supplied. Two further decisions (TY-MSG-02, TY-MSG-03) were taken by the founder in answer to questions asked before implementation began, and are recorded as such.

`HB:243` defers messaging to WhatsApp. FM14 supersedes that for the platform's own channel: it commissions persistent in-app messaging and describes it in detail. The handover document is founder-written and is **not edited** to match; this entry is where the change of direction is recorded.

| ID | Topic | Status | Rule | Source | Modules |
|---|---|---|---|---|---|
| **TY-MSG-01** | Messaging in scope | **CONFIRMED** | Persistent private in-app messaging between a client and their assigned coach is in scope and is built (M14). **Resolves the messaging half of OPEN-06** and supersedes `HB:243`'s deferral to WhatsApp for the platform's own channel. Nothing here stops a coach and client also using WhatsApp. | FM14 | M14 |
| **TY-MSG-02** | Who gets messaging | **CONFIRMED** | Messaging is available in **every paid coaching relationship**, not gated per plan. The plan's `messaging_channel` field is free text, so it cannot reliably gate anything; it stays the coach's own description of what they offer, and the coach's stated response expectation stays the coach's commitment, never a platform deadline. **This is a deliberate narrowing of AAF-ENT-01** for this one capability: the entitlement question returns if inclusions become first-class (the remaining half of OPEN-06). | Founder decision, 2026-09-21 | M05, M14 |
| **TY-MSG-03** | Previous coach's thread | **CONFIRMED** | On reassignment the new coach gets a **new, empty conversation** and can never read the previous coach's thread — **`history_scope = 'full'` does not open it**. That scope governs the client's own training record and media; a previous coach's private words are a third party's. The client keeps their old conversation to read. | Founder decision, 2026-09-21 | M14, M17 |
| **TY-MSG-04** | Support access to conversations | **CONFIRMED** | No blanket admin access to messages exists. Reading a conversation requires a grant tied to one support case, granted to one administrator, with a written reason, expiring on a clock, ending when the case is resolved, and audited — every grant, view and revocation. Attachments are listed to support, never served. | FM14 | M14, M17 |
| **TY-MSG-05** | Pre-purchase enquiries | **NOT APPROVED — off** | Messaging a coach before buying was discussed and is **not** approved. It is off by default and no path creates a conversation without a paid assignment. Turning it on is a founder decision with its own abuse and safety questions. | FM14 | M14 |
| **TY-MSG-06** | Read receipts | **CONFIRMED** | Read receipts are shown, and a message is marked read **only when it has actually been viewed in the open conversation** — never on delivery, an email, a background tab, or an open socket. State is synchronised across a person's devices. Typing indicators remain optional and are not built. | FM14 | M14 |
| **TY-MSG-07** | Honesty about protection | **CONFIRMED** | The product must not claim end-to-end encryption, because the architecture does not provide it, and must distinguish technical limits on already-downloaded data from claims about future access. Both statements appear in the conversation screen. | FM14 | M14, M16 |

### M1 · Policy implemented as a sandbox default

`messaging.v1` (in `src/lib/policy/registry.ts`, mirrored into `messaging_settings` and asserted equal by a database test) carries `status: sandbox_default`, under the L4 discipline. Its proposed values: after paid time runs out, **no new messages** and history stays readable; after coaching ends or the coach changes, the client keeps **read-only** access to their own history; support stays reachable throughout; pre-purchase enquiries off; 4,000-character messages; 20 sends a minute and 500 a day per person; unread-message email grouped over 15 minutes; support message-access grants last 72 hours.

**Awaiting founder approval** — this is the M14 addition to the L4 list. Unlike the commercial policies, it does not block live billing, because it is operational rather than a money rule. That makes it easier to forget, not less of a decision.

### M2 · Status changes

| Entry | Was | Now |
|---|---|---|
| OPEN-06 | OPEN, blocking M05, M13, M14 | **PARTLY RESOLVED** by TY-MSG-01 — the messaging question is answered; first-class inclusions and per-plan response commitments remain open for M05 and M13 |
| AAF-ENT-01 | CONFIRMED | **UNCHANGED in principle**, narrowed in one place by TY-MSG-02: messaging is a platform capability in every paid relationship, not a per-plan entitlement |
| `HB:243` (messaging deferred to WhatsApp) | Founder-written background | **SUPERSEDED for the platform channel** by TY-MSG-01. `docs/HANDOVER.md` is not edited; this row is the record |

---

## N. Fifth-pass decisions — 2026-09-22 (paid access: pause, preserve, restore)

**Source key added:** **FM-ACCESS** — Founder instruction, 2026-09-22: *"Update TalentYak's messaging and coaching access rules… Record this as my approved policy, replacing conflicting temporary defaults."* Founder-written, and the first policy in this project to move from `sandbox_default` to **confirmed**.

| ID | Topic | Status | Rule | Source | Modules |
|---|---|---|---|---|---|
| **TY-ACCESS-01** | Cancelling a renewal | **CONFIRMED** | Cancelling keeps access **active until the already-paid period ends**. Nothing is withdrawn early. Recorded as `cancellation.v2`, **superseding the `cancellation.v1` sandbox default** (same substance, now approved). | FM-ACCESS | M06, M14 |
| **TY-ACCESS-02** | Failed renewal after the paid period | **CONFIRMED** | When a renewal fails and the paid time has run out, **new service pauses**: no new messages, no new bookings, no new coaching activity. There is no grace period beyond the time already paid for — the paid period *is* the grace. Recorded as `payment_failure.v2`, **superseding `payment_failure.v1`**. | FM-ACCESS | M06, M09, M11–M14 |
| **TY-ACCESS-03** | The words the customer sees | **CONFIRMED** | Exactly: *"Your payment didn't go through. Renew to continue coaching. Your progress is saved."* Stored once (`PAUSED_FOR_PAYMENT_NOTICE` in the policy register, mirrored into `messaging_settings.paused_notice`) and shown, not paraphrased, wherever a customer meets the pause. | FM-ACCESS | M06, M14 |
| **TY-ACCESS-04** | Nothing is lost | **CONFIRMED** | Progress, plans, logs and message history are preserved and stay readable under the permissions that already apply. **A payment failure never triggers deletion** — it is not connected to retention, whose destructive execution remains off and unapproved (`OPEN-10`). | FM-ACCESS | M08, M11–M14 |
| **TY-ACCESS-05** | Restoring access | **CONFIRMED** | A successful payment restores the paused access with no loss of history, and **only** that: it never lifts a suspension, and never undoes or reverses a coach reassignment. A payment arriving for a relationship with no open coach assignment leaves it paused and raises an exception for a human to resolve. | FM-ACCESS | M06, M17 |
| **TY-ACCESS-06** | Who is paused | **CONFIRMED** (engineering reading of FM-ACCESS) — **amended 2026-09-27 by TY-TRACK-06**: new tracking entries are held on the device while paused | "Coaching activity" is what the **coach** delivers: while paused, the coach cannot add new programming, and neither side can send messages. The **customer keeps writing their own records** (their weight log, their own data) — a pause is a stop on service, not a lockout from one's own account. Flagged here because FM-ACCESS did not say so explicitly; correct it if this reading is wrong. | FM-ACCESS + engineering | M11–M14 |

### N1 · Enforcement

One database test decides the whole rule: `coaching_is_live(enrollment)` — relationship active, assignment open, neither party suspended. `coaches_enrollment_now()` (the coach write gate behind every programme policy in `0021`) now requires it, so a pause stops coach-side work everywhere at once; **reading is deliberately not gated by it**, which is what keeps TY-ACCESS-04 true. Bookings and any future coaching action must check the same function. `resume_paid_enrollment()` is the only restore path, and refuses without an open assignment.

### N2 · Status changes

| Entry | Was | Now |
|---|---|---|
| `cancellation.v1` | `sandbox_default` | **SUPERSEDED** by `cancellation.v2` (**confirmed**). The v1 record is kept, unedited |
| `payment_failure.v1` | `sandbox_default` | **SUPERSEDED** by `payment_failure.v2` (**confirmed**) |
| `messaging.v1` (§M1) | `sandbox_default`, awaiting approval | **SUPERSEDED** by `messaging.v2` (**confirmed**) — the pause and history rules it proposed are now approved, values unchanged |
| L4 "awaiting founder approval" list | included cancellation terms and payment-failure grace | **Both removed** — approved here. Still awaiting: fee presentation and FX/dispute allocation · commission base treatment of tax · platform-funded promotions · prepaid-term enablement · earnings recognition and hold · payout cutoff, minimum and negative balances · customer countries and payout corridors · adult-only onboarding |
| Live billing | refused | **STILL REFUSED.** Approving two policies does not open the gate: five remain sandbox defaults, and `LIVE_BILLING` is not set. A test asserts this |

---

## O. Sixth-pass decisions — 2026-09-25 (how agents report to the founder)

**Source key added:** **FM-REPORT** — Founder instruction, 2026-09-25: *"Explain updates and decisions in short, plain language for a nontechnical founder… Simplify the explanation, never the feature scope or engineering quality."* Founder-written. It governs every agent in the roster, in every session.

| ID | Topic | Status | Rule | Source |
|---|---|---|---|---|
| **TY-REPORT-01** | Audience and language | **CONFIRMED** | Every update and decision addressed to the founder is written in **short, plain language for a nontechnical reader**. | FM-REPORT |
| **TY-REPORT-02** | What every report says | **CONFIRMED** | Four things, in this order: **what happened**; **how it affects users**; **what the agent recommends**; **whether the founder needs to do anything** (and if so, exactly what). "Nothing needed" is said plainly when true. | FM-REPORT |
| **TY-REPORT-03** | What to leave out | **CONFIRMED** | No jargon, acronyms, internal file names or test counts **unless they are necessary**. A technical term that cannot be avoided is explained in the same sentence it first appears. | FM-REPORT |
| **TY-REPORT-04** | Options | **CONFIRMED** | When presenting options, **recommend one** and say briefly why. A bare list of choices is not a finished report. | FM-REPORT |
| **TY-REPORT-05** | Where detail goes | **CONFIRMED** | Technical detail — file paths, migrations, test names and counts, error text, commands — belongs in the **development notes** (the engineering journal and the batch status checklist), not in the founder's report, unless the founder asks for it. | FM-REPORT |
| **TY-REPORT-06** | What must not be simplified | **CONFIRMED** | **Simplify the explanation, never the feature scope or the engineering quality.** Security, testing, verification and the invariants are exactly as strict as before. Honesty is unchanged too: a plain report still says what was *not* done or *not* verified, and never rounds "mostly works" up to "done". | FM-REPORT |

### O1 · How this sits with the existing session rules

The existing working rules for agents are **kept**, and are now written to this standard:

- **Founder Checkpoints** keep their three-line shape, in plain words.
- **Stop-and-report** keeps its content (where it stopped, what went wrong, options), and now **leads with the recommendation** (TY-REPORT-04).
- **The end-of-work explanation** keeps its purpose. Where it asked for "where each piece lives — file by file", that list moves to the development notes unless the founder asks (TY-REPORT-03, -05). An analogy or a plain description of what each part does replaces the file list.
- **The CTO briefing** already follows this standard and is unchanged.

The project instructions file that every agent reads first is founder-owned. With the founder's go-ahead (2026-09-25) it now carries a one-line pointer to this section under its standing rules; where the two differ on how a report is written, this entry governs.

---

## P. Seventh-pass decisions — 2026-09-27 (Coaching Welcome & Expectations)

**Source key added:** **FB3** — Founder prompt, *Batch 3 of 5 — Coaching Welcome & Expectations, full scope, one final verification*, revised 21 September 2026. Founder-supplied. One further decision (TY-EXP-02) was taken by the founder in answer to a question asked before implementation began, and is recorded as such.

| ID | Topic | Status | Rule | Source | Modules |
|---|---|---|---|---|---|
| **TY-EXP-01** | What the document is | **CONFIRMED** | A mutual-expectations document titled *Coaching Welcome & Expectations*: TalentYak's section (coaches cannot change it), the coach's arrangement (matched to the plan bought), and the client's part with the coach's reciprocal commitments. **Not** a contract, a liability waiver, or a replacement for the platform terms, and no claim of legal enforceability is made. | FB3 | Batch 3 |
| **TY-EXP-02** | Sale requires a published document | **CONFIRMED** | A plan **cannot be bought** until both the coach's and TalentYak's sections are published. Checkout records the exact versions displayed, and refuses if either changed between reading and paying. | Founder decision, 2026-09-26 | Batch 3, M03 |
| **TY-EXP-03** | Acknowledgement is not consent to commercial change | **CONFIRMED** | Ticking "I've read and understand these expectations" records a reading only. It cannot change a price, add a fee, change refunds or reduce service; commercial terms stay fixed by the purchase and change only through the existing offer-versioning route. An unread document never removes paid access. | FB3 | Batch 3 |
| **TY-EXP-04** | Existing customers | **CONFIRMED** | No acknowledgement is fabricated and no document is attached to a purchase that never showed one. Relationships that predate Batch 3 are shown the current version when their coach publishes, labelled as published after they joined. | FB3 | Batch 3 |
| **TY-EXP-05** | TalentYak's section wording | **OPEN — needed before launch** | The test project carries **test wording marked "Not approved policy"**. Approved wording for conduct, privacy and the support route must be published from the admin page before live launch. The suggested starter text is a draft, not approved policy. | FB3 + engineering | Batch 3 |

---

## Q. Eighth-pass decisions — 2026-09-27 (M09 flexible scheduling)

**Source key added:** **FB4** — Founder prompt, *Batch 4 of 5 — M09 Flexible scheduling, full scope, one final verification*, revised 21 September 2026. Founder-supplied. Two decisions (TY-SCHED-02, -03) were taken by the founder in answer to questions asked before implementation began.

| ID | Topic | Status | Rule | Source | Modules |
|---|---|---|---|---|---|
| **TY-SCHED-01** | Proposals and bookings | **CONFIRMED** | Either person proposes; the other accepts, declines or counters. A proposal is pending, holds no time and expires; only mutual acceptance creates one confirmed session. Plain chat never changes the calendar. | FB4 | M09, M14 |
| **TY-SCHED-02** | Sessions after the paid period | **CONFIRMED** | They are **tentative** until the renewal is paid, then confirm automatically if the time is still free. Adjustable (`confirm_beyond_paid_through`). | Founder decision, 2026-09-27 | M09, M06 |
| **TY-SCHED-03** | Which plans have a quota | **CONFIRMED** | Only plans whose coach entered a number of calls per month; each booking uses one call of its paid period and cannot be used twice. All other coaching is flexible with no quota. | Founder decision, 2026-09-27 | M09, M05 |
| **TY-SCHED-04** | Client requests | **CONFIRMED as a starting workflow** | Client requests wait for the coach's confirmation; each coach may switch on auto-confirm for requests inside their hours. Not a platform business rule. | FB4 | M09 |
| **TY-SCHED-05** | Timings | **SANDBOX DEFAULT — awaiting approval** | `scheduling.v1`: 48-hour proposal expiry, reminders 24 h and 1 h before, 12 hours' notice, 28-day horizon, 10-minute buffers, 35-minute checkout hold. Illustrative; coaches set their own lengths, gaps, notice and horizon. | FB4 | M09 |
| **TY-SCHED-06** | No automatic consequences | **CONFIRMED** | No-show, cancellation and technical-failure records create no penalty, transfer, refund or assumption of delivery. A one-off paid after its held time lapsed goes to an admin to rebook or refund through the existing process. | FB4 | M09, M06 |


---

## R. Ninth-pass decisions — 2026-09-27 (M10 private calls)

**Source key added:** **FB5** — Founder prompt, *Batch 5 of 5 — M10 Private calls & integration, full scope, one final verification*, revised 21 September 2026. Founder-supplied. Three decisions (TY-CALL-02, -08 and recording this section) were taken by the founder in answer to questions asked before implementation began.

| ID | Topic | Status | Rule | Source | Modules |
|---|---|---|---|---|---|
| **TY-CALL-01** | Call provider | **CONFIRMED for the test project** — supersedes AAF-CAL-07's "not integrated" | Daily is integrated behind one provider boundary (`web/src/lib/calls/daily.ts`). The account (`talentyak`) exists on Daily's free plan. **It cannot host a call until a payment method is added in the Daily dashboard** — Daily refuses every meeting on the account until then. No paid plan was bought and nothing was signed up for by an agent. | FB5; Daily account checked 2026-09-27 | M10 |
| **TY-CALL-02** | Browser library | **CONFIRMED** | Daily's official browser library (`@daily-co/daily-js`) runs the call screen, loaded only on the session page. | Founder decision, 2026-09-27 | M10 |
| **TY-CALL-03** | Who may join | **CONFIRMED** | Only the two people on a confirmed, eligible session, inside its room's window. Each join asks the server for a pass that is personal, short-lived and never an owner or admin pass; the browser can choose only "audio only". A copied room address is useless without a pass. | FB5 | M10 |
| **TY-CALL-04** | Room window | **SANDBOX DEFAULT — awaiting approval** | `calls.v1`: the room opens 10 minutes before the start and stays open 30 minutes past the booked end, with warnings 10 and 2 minutes before it closes; then it is deleted. Passes last 2 minutes; 20 passes per person per session per 10 minutes. Mirrored in `call_settings`. | FB5 | M10 |
| **TY-CALL-05** | Losing access | **CONFIRMED** | Cancelling, moving or pausing a session, suspending either account, a coach change, the relationship ending or a one-off refund closes the room: new passes are refused at once, and a job removes anyone still in it and deletes the room at Daily. **Limitation, stated honestly:** that job runs straight after the request that caused it, with the five-minute worker as a backstop — prompt, not instantaneous. | FB5; Daily docs (deleting the room is the only way to invalidate a pass Daily signed) | M10 |
| **TY-CALL-06** | Attendance | **CONFIRMED** | Who connected and for how long is fetched from Daily after the room closes (and from Daily's webhook when one exists), once per Daily presence. It is shown to the two people and to TalentYak. **Joining is never evidence that coaching was delivered**; attendance moves no money; a dropped connection is never a no-show. | FB5 | M10 |
| **TY-CALL-07** | Outcomes and corrections | **CONFIRMED** | The coach (or TalentYak) records Completed, Client absent, Coach unavailable, Technically interrupted, or Something else. A second record is a correction: it keeps the first, points to it and needs a reason. The client can ask TalentYak to review an outcome, and either person can report a call problem, through the existing support cases. None of it charges, refunds, pays out or penalises anyone. | FB5 | M10, M14 |
| **TY-CALL-08** | Daily webhooks | **CONFIRMED** | Webhooks need a paid Daily plan. Attendance comes from the after-call fetch; the signed webhook receiver is built and tested with a stand-in, and stays inactive (refuses everything) until a paid plan and `DAILY_WEBHOOK_SECRET` exist. | Founder decision, 2026-09-27 | M10 |
| **TY-CALL-09** | Not in this batch | **CONFIRMED** | No recordings, transcripts, AI summaries, group calls or screen sharing. Rooms are created with recording off and screen sharing off. | FB5 | M10 |
| **TY-CALL-10** | Spending | **OPEN — founder** | Daily has **no hard spending cap**. 10,000 free participant-minutes a month; after that about $0.004 per participant-minute for video and $0.001 for audio-only (Daily's published pricing, 2026-09-27). The only brakes are ours: two people per room, rooms that exist only for their window, and the pass limits. | Daily pricing page | M10 |

### R1 · Status changes

| Entry | Was | Now |
|---|---|---|
| AAF-CAL-07 | PROPOSED — "Daily is a candidate… not integrated, not contracted, not verified" | **Integrated for the test project** (TY-CALL-01). Still not contracted; calls cannot run until the Daily account has a payment method |
| AAF-CAL-03 | CONFIRMED — video and audio calls | **Delivered** as private video calls with an audio-only choice |
| OPEN-05 | OPEN | **Narrowed:** technical failure is recorded, never counted against anyone, and never counts as delivered (TY-CALL-06, -07). Notice periods, make-ups and entitlement effects are still open |

---

## S. Tenth-pass decisions — 2026-09-27 (M11 programmes)

**Source key added:** **FM11** — Founder prompt, *Implement M11: coach-created workout and nutrition programmes*, 2026-09-27. Founder-supplied. Two decisions (TY-PROG-01, -02) were taken by the founder in answer to questions asked before implementation began.

| ID | Topic | Status | Rule | Source | Modules |
|---|---|---|---|---|---|
| **TY-PROG-01** | Plans after a coach change | **CONFIRMED** | The incoming coach may **read** the previous coach's published plan versions only within the client's existing sharing choice (`history_scope`), and may **start their own plan for that client from a copy**. The previous coach's versions stay credited to them and unchanged. Nobody may copy a client's plan into a personal template library, and a former coach keeps only their own templates. Private chat stays excluded (TY-MSG-03). | Founder decision, 2026-09-27 | M11, M17 |
| **TY-PROG-02** | Planning information | **CONFIRMED** | Plan purchases collect no questionnaire, so clients fill in and update a short **training & food profile**: experience, equipment, session length, days a week, food preferences, local affordable foods — and, in a separate private table, injuries/limitations and allergies. Readable by the client and their **current** coach only; never admin, never a former coach. | Founder decision, 2026-09-27 | M11 |
| **TY-PROG-03** | Versions and timing | **CONFIRMED** (FM11) | A published version never changes. The coach publishes **now or from a chosen day** (the start of that day in the client's timezone). Updates apply forward; a workout already started keeps the instructions it was started under. A newer publication withdraws any older update scheduled at or after its own start. A planned update can be cancelled only before it starts. A meaningful change needs a short note for the client; a minor correction may be published without a notice; the first version is always announced. Drafts tell nobody. | FM11 | M11, M12 |
| **TY-PROG-04** | Nutrition | **CONFIRMED** (FM11) | Three optional modes — written guidance, coach-entered daily targets, a structured meal plan (foods, amounts, units including *mana* and *pau*, cooked/raw, swaps, notes); any one is enough. Every number is shown as **the coach's estimate**; TalentYak has no food database, scanner or calculation, and says so. General wellness only (AAF scope: no medical nutrition). | FM11 | M11 |
| **TY-PROG-05** | Moving a session | **CONFIRMED** (FM11) | The client (or the current coach) may move a session to another day **for one week**; the prescription is untouched and every move is kept. A client may do this while coaching is paused (TY-ACCESS-06: a pause never locks a client out of their own records). | FM11 | M11 |
| **TY-PROG-06** | M12 references | **CONFIRMED** (engineering) | Workout records point at the exact published version and session; set records at the exercise or chosen alternative by a stable key that survives from version to version while the coach keeps the exercise. The database refuses a reference to another relationship's plan or to a session or exercise the version does not contain. No logging screens exist yet. | FM11 + engineering | M11, M12 |

### S1 · Status changes

| Entry | Was | Now |
|---|---|---|
| AAF-PROG-04 | CONFIRMED, unbuilt | **Delivered** (M11) |
| AAF-PROG-06, AAF-PROG-10 | CONFIRMED, unbuilt | **Delivered for prescriptions** (immutable published versions, full history). The logging half is M12 |
| `FULFILLMENT.programme` | not ready | **Ready.** Live sales remain refused: legal drafts, unapproved policies, calls and tracking (M12) still block them |

---

## T. Eleventh-pass decisions — 2026-09-27 (M12 client logging and progress)

**Source key added:** **FM12** — Founder prompt, *Implement M12: client logging and progress*, 2026-09-27. Founder-supplied. One decision (TY-TRACK-06) was taken by the founder in answer to a question asked before implementation began.

| ID | Topic | Status | Rule | Source | Modules |
|---|---|---|---|---|---|
| **TY-TRACK-01** | Prescribed vs actual | **CONFIRMED** (FM12) | The coach's targets and the client's last results are shown beside the entry and can be copied in with one tap, but a set is recorded **only when the client confirms it**. A workout records the published version and session it was started against; a later plan update never rewrites it, and a record can't be moved onto another version. Alternatives are recorded as the exercise actually performed; the client's own substitutes and added exercises are recorded by name and never compared with the planned exercise. | FM12 | M12 |
| **TY-TRACK-02** | What a load means | **CONFIRMED** (FM12) | Each exercise entry records whether its number is a weight, bodyweight (plus any added weight), an assisted movement (the assistance) or no load, and whether a dumbbell weight is per hand or both together; the unit (kg/lb) is kept per set as entered. History and charts only ever put records sharing exercise **and** load meaning on one line, converting units exactly (1 lb = 0.45359237 kg). | FM12 | M12, M15 |
| **TY-TRACK-03** | Saving and conflicts | **CONFIRMED** (FM12 + engineering) | Entries are kept on the device first, per account, and cleared on sign-out (with a warning if any are unsaved). Records carry ids chosen on the device so a retry never duplicates; a planned session is recorded at most once per day; a save based on an older version of a workout, food entry or day's body readings is refused and the client chooses which version to keep. Save states are shown honestly; "Saved" appears only after the server confirms. | FM12 | M12 |
| **TY-TRACK-04** | Completeness is never inferred | **CONFIRMED** (FM12) | Workouts are completed, partly done, skipped or not logged; the app suggests, the client decides. A food day with entries is a partial record until the client marks it complete; a day without entries is unrecorded — never zero. Calories and protein are only what the client typed; nothing is estimated from photos, looked up, or calculated (no body-fat estimates). Missing readings are never drawn as zero. | FM12 | M12 |
| **TY-TRACK-05** | Consistency | **CONFIRMED** (FM12 + engineering) | Planned sessions come from the client's weekly schedule as it sat each day (after moves; rest days excluded; the version in force that day). A session counts as done if recorded any day that week; days not yet over are not counted unless recorded; an unfinished record counts as partly done; unplanned workouts never change the figure. Plans done "in order" have no weekly target and say so. The method is shown on the page. | FM12 | M12, M15 |
| **TY-TRACK-06** | Tracking while paused | **CONFIRMED** — founder decision, 2026-09-27 | While a relationship is paused for a failed renewal (and when ended, suspended or without an open coach assignment), **new tracking entries of every kind are held on the device** and saved automatically once coaching is live again; nothing already recorded becomes unreadable or is deleted. Removing a mistaken photo through M08's deletion stays available. This **corrects TY-ACCESS-06** for tracking (it had read "the customer keeps writing their own records" during a pause). | Founder decision, 2026-09-27 | M12 |
| **TY-TRACK-07** | Coaches and tracking | **CONFIRMED** (FM12) | Coaches review and never write a client's results. Access is the existing rule (`coach_may_read_record`): the current coach only, earlier history only within the client's sharing choice, photos by the stricter media test; admin none. The current coach may mark fields they find useful ("useful to track"); every field stays optional for the client. Structured check-ins and written feedback are M13. | FM12 | M12, M13 |
| **TY-TRACK-08** | Reminders | **CONFIRMED** (FM12 + engineering) | One gentle in-app notice in the client's evening on a day their plan has a session and nothing is logged; at most one a day and three a week; never email; the client can switch it off. It never names the workout or anything recorded. | FM12, AAF-PROG-09 | M12 |

### T1 · Status changes

| Entry | Was | Now |
|---|---|---|
| TY-ACCESS-06 | Customer keeps writing own records while paused | **Amended by TY-TRACK-06** for tracking entries (held on the device until coaching is live). Moving a session in the plan (TY-PROG-05) is unchanged |
| AAF-PROG-01, -02, -03, -05 | CONFIRMED, unbuilt | **Delivered** (M12) |
| AAF-PROG-06, AAF-PROG-10 | Delivered for prescriptions | **Delivered** (logs record their version; plan changes never rewrite them) |
| AAF-PROG-08 | CONFIRMED, unbuilt | Unchanged — form-review clips with coach feedback are not part of FM12 |
| `FULFILLMENT.progressTracking` | not ready | **Ready.** Live sales remain refused: legal drafts, unapproved policies, calls, form review |

---

## U. Twelfth-pass decisions — 2026-09-28 (M13 check-ins and coach feedback)

**Source key added:** **FM13** — Founder prompt, *Implement M13: client check-ins and coach feedback*, 2026-09-27. Founder-supplied. It states the paid-access policy for check-ins and one **approved exception**, recorded here as confirmed.

| ID | Topic | Status | Rule | Source | Modules |
|---|---|---|---|---|---|
| **TY-CHECKIN-01** | Paid access and check-ins | **CONFIRMED** (FM13) | Cancelling keeps check-ins running through the paid period. Once access ends (paused for a failed renewal, or ended), **no new check-in requests are made**, client drafts and corrections are not saved (unfinished answers stay on the device and the saved draft is kept, to send after an eligible renewal), and past submissions and feedback stay readable under the privacy permissions that already apply. A payment failure never deletes anything; retention stays a separate policy. Missing a check-in never blocks paid coaching. Recorded as `checkin_access.v1` in the policy register. | FM13 | M13 |
| **TY-CHECKIN-02** | **Approved exception — finishing a review after paid time** | **CONFIRMED** (FM13) | The coach responsible for a check-in **submitted during the paid period** may finish that review (publish feedback and mark it complete) after the paid period expires, and the client can read the feedback and receives its notice. It covers a relationship paused for a failed renewal and one ended by a cancelled renewal running out. It **does not** reopen new check-ins, client revisions, messaging, bookings or programme changes, and it **never** survives a suspension (either side), a coach reassignment, a refund, or a review flagged after a coach change. It ends once the review is complete. **Narrows TY-ACCESS-02** ("no new coaching activity") for this one case. Enforced in the database (`checkin_review_exception`, 0051). | FM13 | M13, M06 |
| **TY-CHECKIN-03** | Check-ins after a coach change | **CONFIRMED** (FM13 + engineering) | Responsibility for an unanswered check-in moves to the new coach only when the client's sharing choice covers it: `full`, or `programme_and_logs` when it has no attachments. Otherwise it is **flagged** for TalentYak to resolve (close it and tell the client, or look again after the client changes what they share) and nobody new sees it; TalentYak sees only that it needs attention, never its content. A feedback link to the previous coach's conversation never opens it (TY-MSG-03). Unsent requests are closed and the client's draft kept for them. | FM13 | M13, M17 |
| **TY-CHECKIN-04** | Review timing | **CONFIRMED** (FM13) | A reply time is shown only when the coach set one, counted in the working days they publish (M14 availability), in their timezone, starting after any away period. With none set, nothing is promised and the coach's own words are shown. The client always sees a support route; reviews waiting on an away coach are listed for TalentYak. No platform-wide response guarantee exists. | FM13 | M13, M14 |
| **TY-CHECKIN-05** | Reviews and corrections | **CONFIRMED** (FM13 + engineering) | Opening never completes a review: the coach publishes feedback, then marks it complete; completion needs published feedback covering the latest substantive answers. Submissions and published feedback are never edited; a correction is a new version. The server (never the client) judges a correction substantive — a changed rating or attachment, an answer added or removed, or wording changed beyond a typo — and a substantive one reopens the review. A promised plan change shows as delivered only when the coach links a plan version actually published after the check-in; no step is marked done automatically. No automatic AI assessment. | FM13 | M13, M11 |
| **TY-CHECKIN-06** | Reminder timings | **SANDBOX DEFAULT — awaiting approval** | `checkin_reminders.v1`: due-soon notice 24 hours before; one "still open, late is fine" notice between 24 and 72 hours after; a coach with no stated reply time is nudged after 72 hours. Once each, re-checked before sending, switchable off (new optional category "Check-ins"). Operational, so it does not block live billing. | Engineering | M13 |

### U1 · Status changes

| Entry | Was | Now |
|---|---|---|
| TY-ACCESS-02 | No new coaching activity while paused | **Narrowed by TY-CHECKIN-02** for finishing a review submitted in paid time |
| OPEN-06 | Partly resolved; check-ins not first-class | **Unchanged.** Check-ins are available in every paid relationship where the coach sets a schedule; no per-plan entitlement gate was added |
| `FULFILLMENT.checkIns` | not ready | **Ready.** Live sales remain refused for the reasons already listed (legal drafts, unapproved policies, calls, form review) |
| AAF-PROG-08 (form review) | unbuilt | **Unchanged.** A check-in can carry an optional form-check clip; per-set form review with feedback is still separate |
