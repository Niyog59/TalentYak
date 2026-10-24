# Aafnai — M00 Acceptance Scenarios

**Module:** M00 · **Authored against:** `master @ 2bb3d9f89f9588076d958def8f0bb444ef54f26f`

**What these are.** Testable **product** scenarios in Given/When/Then form. They define what "correct" means for the confirmed M00 decisions, so a later module can be verified against intent rather than against "it runs."

**What these are not.** They are **not executable application tests**, and none has been executed. No application test suite exists in this repository (`web/package.json` scripts are `dev`, `build`, `start`, `lint`; there is no `scripts/` directory and no test file). Turning these into executable tests is work for the owning module and for M18.

**Reading the conditionals.** Several scenarios contain a clause conditioned on an OPEN decision. That is deliberate: the scenario is correct **as stated**, and the conditional marks the part that cannot be finalised until the founder decides. A scenario is never "passed" by assuming an open policy.

---

## AC-01 · Two coaches sell different plans, with no shared package and no price approval

**Decisions:** AAF-PLAN-01, AAF-PLAN-02, AAF-PLAN-03, AAF-PLAN-04 · **Modules:** M05, M16 · **Reconciliation:** R-01, R-04, R-05, R-35

> **Given** Coach A and Coach B are both active on the platform
> **And** Coach A defines a monthly plan named "Strength Build" at $85/month including weekly 30-minute video calls, weekly check-ins, and unlimited form review
> **And** Coach B defines a monthly plan named "Fat Loss Reset" at $60/month including one 45-minute call per month, fortnightly check-ins, and four form clips per month
> **When** each coach publishes their plan
> **Then** both plans publish **without any Aafnai approval step**
> **And** no minimum or maximum price is enforced, and no price is rejected for being higher or lower than another coach's
> **And** the only validation applied is technical: the price is processable in the chosen currency, every claimed inclusion maps to a real platform capability, and conditional fields are present
> **And** a prospective client viewing both plans sees the **same ordered comparison rows** for each (price and billing, service type, calls, messaging and response commitment, programme service, programme revision basis, check-ins, form review, nutrition guidance, language, coach timezone)
> **And** where a coach did not include something, the row reads **"Not included"** rather than being blank or omitted
> **And** neither plan is badged "recommended", "best value", or "most popular", and the two are not ranked by price

**Fails if:** any approval queue exists; a price bound is enforced; the two plans are forced onto a shared package shape; a comparison row is present for one coach and absent for the other; the platform editorialises between them.

**Precondition gap (R-35):** a coach cannot currently sign in at all — `providers.profile_id` is only ever read (`web/src/app/coach/layout.tsx:35`), never written. **M04/M17 must close this before AC-01 is testable.**

---

## AC-02 · Commission arithmetic is correct and honestly qualified

**Decisions:** AAF-COMM-01, AAF-COMM-02, AAF-COMM-03, AAF-COMM-04, AAF-ACCT-02 · **Modules:** M05, M06, M07 · **Reconciliation:** R-09, R-19

> **Given** the commission base is **the coaching service amount excluding separately collected taxes** (AAF-COMM-06)
> **And** Aafnai covers ordinary payment-processing and payout fees from its own share (AAF-COMM-07)
> **When** a coach enters a **monthly coaching** price of $100.00 in the plan builder
> **Then** the builder displays **Customer pays $100.00 · Coach receives $70.00 · Aafnai share $30.00**
> **And** the display states plainly that the coach's figure is **before nothing** — processing and payout fees do not come out of it
> **And** the display states that separately collected taxes are excluded from the base
>
> **When** a coach enters a **one-off consultation** price of $20.00
> **Then** the builder displays **Customer pays $20.00 · Coach receives $12.00 · Aafnai share $8.00**
>
> **When** a coach enters a monthly price of **$49.99**
> **Then** the coach share is **$34.99** and the Aafnai share is **$15.00**
> **And** the two shares sum **exactly** to $49.99 with no cent unaccounted for
>
> **And** in every case the arithmetic is performed in integer minor units, never in floating point
> **And** a client in the United Kingdom viewing the same plan sees the price in their own local currency, with any converted figure **labelled as an estimate** unless it is the amount that will actually be charged

**Fails if:** any share is computed at 60/40 or 65/35 for a new monthly plan; the two shares fail to sum to the total; float arithmetic introduces a rounding artefact; the share figures are presented as final take-home with no qualification; a converted price is presented as the charge amount when it is only an estimate.

**Current-code note (R-09):** today `web/src/verticals/fitness/payout.ts:11` computes `providerFounding ? 0.65 : 0.6`, and `web/src/lib/payouts/index.ts:24` falls back to `0.6`. Both **contradict AAF-COMM-01** and are scheduled for repair in M06/M07. Historical ledger rows keep their original `rule` string (AAF-DATA-04).

---

## AC-03 · A coach may leave a programme unchanged, and nothing forces a replacement

**Decisions:** AAF-PLAN-05 · **Modules:** M11, M15 · **Reconciliation:** R-24

> **Given** a client has been following programme version 1 for six weeks
> **And** the coach reviews the client's logs and judges the programme still appropriate
> **When** the coach records the review outcome as "continue unchanged"
> **Then** the review is recorded as **complete**
> **And** programme version 1 remains the active programme
> **And** no new version is created
> **And** the system does not prompt, warn, nag, flag the coach as overdue, escalate to Aafnai operations, or mark the client as neglected
> **And** no Aafnai review or approval of the programme's content occurs at any point

**Fails if:** any timer, cadence rule, or four-week cycle forces a programme change; "unchanged" is treated as an incomplete or failed review; a dashboard shows the coach or client as overdue; Aafnai reviews the exercise selection, sets, reps, or progression.

---

## AC-04 · A new programme version never rewrites history

**Decisions:** AAF-PROG-06, AAF-PROG-10, AAF-DATA-03 · **Modules:** M11, M12, M15 · **Reconciliation:** R-25, R-26, R-30

> **Given** a client was prescribed programme version 1, in which Monday's squat was 3 sets of 8 repetitions
> **And** on 12 March the client logged 3 sets of 8 repetitions at 60 kg against version 1
> **When** the coach publishes version 2, changing Monday's squat to 4 sets of 5 repetitions
> **Then** version 1 remains readable in full, showing 3 × 8
> **And** the 12 March log still shows 3 sets at 60 kg, still associated with **version 1**
> **And** the 12 March log is **not** re-associated with version 2 and is not re-interpreted against version 2's prescription
> **And** version 2 applies only to workouts performed on or after its publication
> **And** the client's progress graph spans both versions continuously, marking where the programme changed
> **And** the graph presents weight and volume as data and a trend, **without labelling any increase or decrease as good or bad**

**Fails if:** editing a programme mutates the prescription in place; a historical log's prescription changes retroactively; version 1 becomes unreadable; the graph asserts a verdict on the direction of change.

---

## AC-05 · A client can book only what the purchased plan includes

**Decisions:** AAF-ENT-01, AAF-CAL-04, AAF-CAL-05, AAF-PLAN-01 · **Modules:** M05, M09, M10, M13 · **Reconciliation:** R-03, R-23, R-32

> **Given** Client X purchased Coach A's plan, whose frozen entitlement includes **one 30-minute video call per week**
> **And** Client Y purchased Coach B's plan, whose frozen entitlement includes **no calls at all**
> **And** the platform supports both video and internet audio calls
> **When** Client X has already booked their call for the current week and attempts to book a second
> **Then** the second booking is refused with a clear explanation of the plan's allowance, and the client is told how to obtain more if their coach offers that
> **When** Client Y opens the coach workspace
> **Then** call booking is **not** offered, because their plan includes none
> **And** the mere existence of a working call system grants Client Y nothing
> **And** the same principle holds for check-ins and form review: the presence of the feature establishes no cadence and no allowance

**Fails if:** entitlement is derived from feature availability rather than from the purchased plan version; entitlement is read from the coach's **current** plan rather than the **purchased** version; any universal weekly call, universal check-in cadence, or universal form-review cap is applied.

---

## AC-06 · One appointment, two correct local times

**Decisions:** AAF-CAL-01, AAF-CAL-02, AAF-CAL-06 · **Modules:** M09 · **Reconciliation:** R-21, R-22

> **Given** Coach A is in Kathmandu and has set availability in **their own** local timezone
> **And** Client X is in Dallas
> **When** Client X views available slots
> **Then** the slots are displayed in **Client X's** local timezone, with the timezone named on screen and an override available
> **When** Client X books a slot
> **Then** the coach sees the appointment in **Kathmandu** local time and the client sees the **same** appointment in **Dallas** local time
> **And** both refer to the same absolute instant
> **And** the slot is no longer offered to anyone else
> **And** the coach cannot be double-booked across two plans or two clients
> **And** after a daylight-saving transition in the client's region, the **historical** appointment still displays the local time at which it actually occurred
> **And** both parties can see the appointment in their history after it has passed

**Fails if:** either party is shown the other's local time; a slot can be booked twice; a stored appointment shifts when a DST rule changes; timezone is inferred from a free-text field rather than a valid IANA identifier.

**Current-state note (R-21):** the only timezone in the system today is a free-text intake answer, `timezone_city` (`web/src/verticals/fitness/intake.ts:67-72`). No availability, slot, or appointment structure exists.

---

## AC-07 · Private media reaches exactly the right two people

**Decisions:** AAF-PROG-01, AAF-PROG-08, AAF-PROG-12, AAF-TECH-02 · **Modules:** M08, M12 · **Reconciliation:** R-28, R-29, R-31

> **Given** Client X is assigned to Coach A
> **And** Coach B is an active coach with no relationship to Client X
> **When** Client X uploads a progress photo and a squat form-check video
> **Then** the upload is placed in a private quarantine location and is not publicly reachable at any point
> **And** it is validated, re-encoded, and stripped of embedded metadata — including any location data — before it is viewable
> **And** the original, unprocessed file is not retained in a servable location
> **When** Client X views their own media
> **Then** access is granted
> **When** Coach A views the media of their assigned client
> **Then** access is granted, and Coach A can attach feedback to the form video
> **When** Coach B attempts to access Client X's media by any route, including a direct object reference
> **Then** access is **denied by the data layer**, not merely hidden in the interface
> **And** access remains denied when Coach B is signed in as a legitimate coach with their own clients

**Fails if:** an unprocessed original is ever servable; location metadata survives; an unrelated coach can retrieve media by guessing or by holding a stale link; access control lives only in the UI.

**Open (OPEN-08, OPEN-10):** whether a **former** coach retains access after reassignment, and the retention period, are undecided.

---

## AC-08 · Editing a plan never silently changes an existing purchase

**Decisions:** AAF-DATA-02, AAF-PLAN-01 · **Modules:** M05, M06 · **Reconciliation:** R-02, R-20

> **Given** Client X purchased Coach A's plan version 1 at $85/month, including weekly calls
> **When** Coach A publishes version 2 at $95/month, reducing calls to fortnightly
> **Then** Client X continues to be charged **$85/month**
> **And** Client X's entitlement remains **weekly** calls
> **And** Client X's account and receipts display **version 1's** terms, not version 2's
> **And** new clients purchasing after the change buy version 2 at $95/month
> **And** version 1 remains permanently readable for as long as any purchase references it
> **And** no notification implies that Client X's terms have changed, because they have not

**Fails if:** an existing purchase's price or inclusions change without explicit consent; the client's account renders the coach's *current* plan instead of the purchased version; version 1 becomes unreadable.

**Open (OPEN-07):** the consent, notice, and migration path for moving an existing subscriber onto a newer version is undecided. This scenario is correct as stated regardless of how that is resolved — **the default is that nothing changes silently.**

---

## AC-09 · A prepaid six-month plan is coaching, not a consultation

**Decisions:** AAF-COMM-05, AAF-COMM-01, AAF-COMM-02 · **Modules:** M06, M07 · **Reconciliation:** R-10

> **Given** Coach A offers a six-month coaching plan at $85/month, payable as a single charge of $510.00
> **And** Coach A also offers a one-off consultation at $35.00
> **When** Client X purchases the six-month plan and pays once
> **Then** the purchase is classified by **service type** as coaching, not by payment count
> **And** the coach's entitlement is computed at **70%** — $357.00 — not at 60% — $306.00
> **And** the $51.00 difference is not transferred away from the coach merely because the client paid a single time
> **When** Client Y purchases the one-off consultation
> **Then** it is classified as a consultation and the coach's entitlement is computed at **60%** — $21.00
> **And** the fact that a coaching plan and a consultation may both produce exactly one charge does not merge their treatment

**Fails if:** commission is derived from billing shape (`one_time` vs `subscription`) rather than declared service type.

> **And** the $357.00 is **not** released to the coach on day one
> **And** the payment is allocated across six service months at **$85.00 each — $59.50 coach, $25.50 Aafnai** (AAF-TERM-02)
> **And** after the first delivered month the coach has earned **$59.50**, and **$425.00 remains an undelivered balance tracked separately** (AAF-TERM-03)
> **And** the coach is paid for that month during the first seven days of the following month (AAF-PAY-03)

**Current-code note (R-10):** `services.billing_type` today is `one_time` | `subscription` — a **billing** attribute. A prepaid term would read as `one_time` and attract the consultation rate. A distinct service-type field is required.

**Confirmed 2026-09-09:** AAF-COMM-05, AAF-TERM-01, AAF-TERM-02, and AAF-TERM-03 are all now CONFIRMED.

**Still blocking (AAF-TERM-05):** cancellation and refund rules for prepaid terms are unresolved. **Prepaid plans must not be enabled until they are decided.** A monthly-billed term commitment is not affected by that block.

---

## AC-10 · Refund and coach replacement preserve unused value and never rewrite history

**Decisions:** AAF-DATA-01, AAF-OPS-01 · **Modules:** M06, M07, M17 · **Reconciliation:** R-12, R-15, R-38

> **Given** Client X prepaid $510.00 for six months and has received two months of service
> **When** Aafnai processes a refund of the unused portion
> **Then** the unused-service value is calculated from an **explicitly identified policy**, and the applicable policy is named in the record
> **And** if the policy is still **pending** (OPEN-02), the system records the calculation basis used and flags the decision as provisional — it does **not** silently apply an assumed rule
> **And** the coach's earnings are adjusted by a **new compensating entry**
> **And** no historical earnings amount is edited or deleted
> **And** the original entry, the compensating entry, and the resulting balance are all visible with their reasons
>
> **When** Client X instead requests a change of coach
> **Then** **Aafnai handles the request** rather than leaving it between client and coach
> **And** the client is told of any price or inclusion difference and consents before the change takes effect
> **And** an effective date is recorded
> **And** remaining prepaid value is allocated according to a named policy, provisional if that policy is pending
> **And** programme and log history is preserved in full across the transition
> **And** compensation for both coaches is split at the effective date by compensating entries, never by editing prior entries

**Fails if:** any historical financial amount is mutated; a refund leaves the outgoing coach's earnings untouched (the current defect at `web/src/lib/payments/webhook.ts:96-99`); an unresolved policy is applied as though settled; a coach change loses client history.

**Open (OPEN-02, OPEN-08):** the unused-value policy and every coach-change mechanic are undecided. **Only "Aafnai handles the request" is confirmed.**

---

## AC-11 · A client payment is never shown as a delivered coach payout

**Decisions:** AAF-PAY-01, AAF-PAY-02, AAF-DATA-01 · **Modules:** M07, M15 · **Reconciliation:** R-15, R-16, R-17, R-18

> **Given** Client X's card was charged $85.00 today
> **And** the funds have not settled to Aafnai's bank account
> **And** no transfer to the coach has been initiated
> **When** Coach A opens their earnings view
> **Then** the amount appears in a state that accurately reflects reality — **collected** or **pending service** — and **not** as **paid**
> **And** the view distinguishes what has been collected, what is pending service delivery, what is earned, what is payable, what is in transfer, and what has actually been transferred
> **And** no wording implies the coach has already received money they have not received
> **And** any processor balance held as a buffer against refunds, disputes, and fees is **not** described as the coach's money being held, and is not presented as per-coach escrow
>
> **When** Aafnai exports a payout batch
> **Then** the export is triggered by an explicit, confirmed action — **not by a link that mutates state when followed or prefetched**
> **And** repeating the action does not create a duplicate batch or double-mark entries
> **And** batch payment status is a real recorded state with a timestamp, not a free-text note

**Fails if:** a collected payment renders as a completed payout; a processor balance is called escrow; the export mutates via `GET` (the current defect at `web/src/app/admin/payouts/export/route.ts:10`); "paid" is inferred from the string `"Paid"` in a notes field (the current behaviour at `web/src/app/admin/payouts/page.tsx:76,142`).

---

## AC-12 · Missing vendor credentials block nothing they should not, and imply nothing

**Decisions:** AAF-PLAN-04, AAF-OPS-04, AAF-DOC-01 · **Modules:** M00, M01, M18 · **Reconciliation:** R-43, R-50, R-52, R-53

> **Given** no payment-processor account, call-provider account, payout-provider account, or live API credential exists
> **And** the repository contains no `web/.env.local`
> **When** M00 documentation is authored and reviewed
> **Then** all five M00 deliverables are complete
> **And** no deliverable claims that any integration works, was tested, or was configured
> **And** no vendor capability, corridor eligibility, account eligibility, fee, or timing figure is asserted as verified when it was not
>
> **When** the application runs without credentials
> **Then** each unconfigured capability degrades to a clear, honest unavailable state
> **And** no page presents unavailable functionality as working
> **And** no security control silently disables itself because a secret is absent
> **And** no marketing copy advertises an inclusion the platform cannot deliver

**Fails if:** documentation asserts an untested integration outcome; an absent secret causes a protection to fail **open** — the current defect at `web/src/app/api/jobs/process/route.ts:9-15`, where the cron guard is skipped entirely when `CRON_SECRET` is unset, and where `CRON_SECRET` is absent from `web/.env.example`; copy sells "direct messaging with your coach" (`web/src/verticals/fitness/catalog.ts:37`) while no messaging exists.

---

## AC-13 · Hiding a vertical does not secure its data

**Decisions:** AAF-BRAND-05, AAF-TECH-04 · **Modules:** M01, M03, M17 · **Reconciliation:** R-38, R-39, R-55

> **Given** the pandit vertical's catalog status is set to `hidden`
> **And** existing pandit bookings hold a deceased person's name, relationship, and gotra inside the generic booking intake record
> **When** an assigned provider signs in
> **Then** hiding the vertical has **not** changed what that provider can read
> **And** the restricted data is still reachable, because catalog visibility governs only catalog listing
> **Therefore** grief-data isolation is verified **independently** of any visibility setting, and is not considered addressed by hiding the vertical
> **And** pandit code and data are **not deleted** as part of any fitness-first change
> **And** existing pandit records remain readable by those legitimately entitled to them

**Fails if:** a fitness-first change is reported as having secured grief data; pandit code or data is removed; the restricted-data fix is closed on the basis of a visibility change.

**Related instruction defect (R-55):** the rules file lists the protected tables as `deceased_records`, `tithi_reminders`, `ceremonies`, and `health_records`. Only `ceremonies` exists. **The real grief table, `shraddha_dates`, is not named in the hard-stop list** — an agent obeying the rules file literally would not know it is protected. This should be corrected before any agent works on the pandit vertical.

---

## AC-14 · Payment events are applied exactly once, even when processing is interrupted

**Decisions:** AAF-TECH-01, AAF-DATA-01 · **Modules:** M06 · **Reconciliation:** R-11, R-13, R-14

> **Given** a subscription renewal has been paid
> **When** the processor delivers the same event more than once, as it does whenever it does not receive a timely acknowledgement
> **Then** exactly one payment record and exactly one earnings entry exist
> **When** processing is interrupted after the event is recorded but **before** its effects are applied
> **Then** a subsequent retry **completes** the work rather than discarding it as an already-seen duplicate
> **And** a retry after effects were applied does **not** apply them a second time
> **When** the same economic event arrives as two **different** event types — for example a checkout completion and an invoice payment for the same first cycle
> **Then** the business effect is applied once, because deduplication is keyed on the economic outcome and not only on the message identifier
> **When** a database error prevents a payment from being recorded
> **Then** the failure is surfaced and the event is **not** acknowledged as successfully processed, so the processor retries
> **And** a payment failure, a subscription cancellation, and a dispute each produce a recorded, visible outcome

**Fails if:** dedup relies solely on a unique message ID; an interruption loses a payment or double-applies one; two event types describing one cycle produce two earnings entries; an insert error is swallowed and acknowledged — the current defect at `web/src/lib/payments/webhook.ts:147`, which returns `{received:true}` regardless of outcome.

---

## AC-15 · A coach must be able to accept the customer before any money is taken

**Decisions:** AAF-FLOW-01, AAF-FLOW-02, AAF-OPS-05 · **Modules:** M05, M06, M09, M16 · **Reconciliation:** R-01, R-05, R-56

> **Given** Coach A publishes a plan with a capacity limit of 12 concurrent clients and currently has 12
> **And** Coach B publishes a plan with capacity remaining and availability that overlaps the client's working hours
> **When** a prospective client browses coaches
> **Then** each coach's **qualifications, price, inclusions, and compatible availability** are visible **before** any payment step
> **When** the client attempts to purchase Coach A's plan
> **Then** the purchase is **refused before any charge is attempted**, with a clear explanation and Coach B offered as an alternative
> **And** no card is charged, no authorisation is placed, and no booking is created in a state implying Coach A accepted them
> **When** the client purchases Coach B's plan
> **Then** the system confirms Coach B can accept this customer **before** collecting payment
> **And** only after that confirmation is payment collected
> **And** the coach-client relationship is established with Coach B named from the outset — not left unassigned for later matching

**Fails if:** payment is collected before coach acceptance is confirmed; a client is charged and then told no coach is available; capacity is checked after the fact by an operator; the coach is assigned post-purchase rather than chosen pre-purchase.

**Current-state note (R-56):** `services.capacity_limit` exists and is **read by no code**. The whole flow today is intake → pay → founder assigns within 48h (`web/src/app/admin/fitness/page.tsx`). This scenario inverts that.

---

## Coverage check

| Required scenario (M00 instruction §5D) | Scenario |
|---|---|
| 1. Two coaches, different plans, no forced package or approval | **AC-01** |
| 2. 70/30 and 60/40, conditioned on the open commission base | **AC-02** |
| 3. Coach leaves programme unchanged; no forced replacement | **AC-03** |
| 4. New version does not alter old workouts or prescriptions | **AC-04** |
| 5. Client books only the calls the plan includes | **AC-05** |
| 6. Coach and client see the same appointment in local times | **AC-06** |
| 7. Client and assigned coach access media; unrelated coach denied | **AC-07** |
| 8. Plan change does not silently alter an existing purchase | **AC-08** |
| 9. Six-month prepayment is not a consultation | **AC-09** |
| 10. Refund and coach replacement preserve unused value | **AC-10** |
| 11. Payment is not displayed as a delivered payout | **AC-11** |
| 12. Missing credentials block nothing and imply nothing | **AC-12** |
| *Added:* hiding a vertical is not a data fix | **AC-13** |
| *Added:* exactly-once payment application | **AC-14** |
| *Added 2026-09-09:* coach acceptance confirmed before any charge | **AC-15** |

---

## M00 completion versus launch readiness

**M00 is complete when** all five deliverables exist and are internally consistent; every rule is labelled CONFIRMED, PROPOSED, OPEN, or SUPERSEDED; every confirmed capability has an owning module and at least one scenario above; every superseded rule is explicitly revoked with its source stated honestly; and conflicts with existing documentation are recorded rather than resolved by assumption.

**By that standard, M00 is complete.**

**Launch readiness is a different bar** and is **not** met. It additionally requires the open policies in `DECISION_REGISTER.md` §K8 to be decided — including **AAF-TERM-05**, which blocks prepaid plans — the modules named in `CODEBASE_RECONCILIATION.md` §4 to be built and verified, the confirmed-but-absent capabilities to exist, and the safety defects in R-38 through R-46 to be closed.

**No policy in this module has been marked approved in order to close it.** Thirteen open decisions remain open, each with a named gate. A scenario above that depends on an open policy states that dependency rather than assuming an answer.
