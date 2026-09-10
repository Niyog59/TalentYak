# M00 Completion Report — Aafnai Product Contract and Scope

**Self-contained.** This report can be taken to another session without the repository open.

> ## Amended 2026-09-09 — second pass
>
> After this report was first written, the founder settled four things and authorised the documentation updates. **§6 (open policies) and §13 (next decisions) below are superseded by §14 at the end of this document.** Everything else — what was inspected, what exists in the code, how modules change — still stands.
>
> **Now decided:** Aafnai is a **contractor-delivered managed coaching service**. The customer **selects their coach and plan before being charged**, and the system confirms the coach can accept them first. Commission is calculated on the **coaching service amount excluding separately collected taxes**, with **processing and payout fees from Aafnai's share**; **Aafnai-funded promotions never reduce coach earnings**, and coach-funded discounts need the coach's explicit acceptance. Coaches are paid **monthly in arrears, first seven days of the following month**, for service delivered through the previous month-end. A **six-month package is coaching at 70/30**, allocated across the service period at **$85/month → $59.50 coach / $25.50 Aafnai**, with the undelivered balance tracked separately.
>
> **Resolved:** OPEN-01, OPEN-03, OPEN-09, and the `docs/HANDOVER.md:194` conflict. **New blocker:** `AAF-TERM-05` — prepaid cancellation and refund rules — **blocks enabling prepaid plans**.

---

## 1. Repository and commit inspected

| Item | Value |
|---|---|
| Repository root | `/Users/niyoguprety/dev/ghar-tira` |
| Branch | `master` |
| Commit (full SHA) | `2bb3d9f89f9588076d958def8f0bb444ef54f26f` |
| Commit subject | `docs: remove session handover file` |
| Working tree at start | **Clean** — `git status --porcelain` empty |
| Stash | Empty |
| Remote | **None configured** |
| Pre-existing uncommitted edits | **None.** Nothing was preserved-around, because nothing was there |

**Difference from the audited version: none.** The 2026-09-09 audit inspected this same commit. The tree is byte-identical, so every audit finding was re-checkable rather than assumed — and every finding cited in the new documents **was** re-verified this session against source, not carried over on trust.

**Supplied references located** (bounded search of `~/Downloads/aafnai-planning-documents/` only):

| Reference | Status |
|---|---|
| `aafnai-project-handover.md` | **Found** — 248 lines, read in full |
| `ghartira-codebase-audit.md` | **Found** — the 2026-09-09 audit |
| `aafnai-modular-build-plan.md` | **Not found.** Module IDs M00–M18 were taken from the M00 instruction itself |

---

## 2. What was read

**Instructions and conventions:** `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `README.md`, `ARCHITECTURE.md` (stub), `MIGRATION.md` (stub), `TASKS.md`, `docs/specs/README.md`, `DEVLOG.md`, `CTO-BRIEF.md`.

**Business:** `docs/HANDOVER.md` §§5–7, 10–14 (read in the first pass; **amended in the second pass under founder authorisation** — see §14); `aafnai-project-handover.md` in full.

**Source, re-verified this session:** vertical registry and both vertical modules (catalog, intake, payout, tithi); `lib/catalog`, `lib/payouts`, `lib/payments` (stripe, checkout, webhook), `lib/bookings`, `lib/auth`, `lib/env`, `lib/jobs`, `lib/email`, `lib/recordings`, `lib/supabase/*`, `proxy.ts`; coach layout and programme builder; all admin screens; account and auth routes; public marketing pages; `components/*`; `globals.css`; all seven migrations and `seed.sql`; `package.json`, `next.config.ts`, `vercel.json`, `.env.example`.

Every source path cited in the deliverables was confirmed to exist, and the specific lines quoted were re-read and matched exactly.

---

## 3. Documents created

All new. All under `docs/aafnai/`. **No existing file was overwritten.**

| File | Size | Contents |
|---|---|---|
| `docs/aafnai/PRODUCT_CONTRACT.md` | ~43 KB | Purpose, users, launch boundary, exclusions; confirmed vs proposed vs open; responsibility matrix; 26-field coach plan specification; capability-vs-entitlement rule; service-type classification with worked arithmetic; ten user journeys; six lifecycle contracts (labelled proposed logical contracts, **not** schemas); historical-record, privacy, failure, and truthful-marketing requirements; corrections to five prior audit remedies; recorded conflicts; Stripe/Remitly factual model |
| `docs/aafnai/DECISION_REGISTER.md` | ~29 KB | 57 `AAF-*` decision IDs, 6 `SUP-*` supersessions, 13 `OPEN-*` policies. Each with topic, status, exact rule, source key, rationale, affected modules, blocking gate, owner. Source-key table distinguishes founder decisions from assistant recommendations |
| `docs/aafnai/CODEBASE_RECONCILIATION.md` | ~31 KB | 55 `R-*` items mapping audit findings and new requirements to re-verified source, each with keep/repair/replace/new/defer, owning module, dependencies, data-preservation notes, acceptance scenario, and gating decision. Four structural-change analyses. Five corrected audit remedies. Module impact table. Explicit list of audit-deferred items now required |
| `docs/aafnai/M00_ACCEPTANCE.md` | ~25 KB | 14 Given/When/Then product scenarios (12 required + 2 added), each with fails-if criteria, decision and module links, and current-code notes. Coverage table. M00-complete vs launch-ready definition |
| `docs/aafnai/M00_COMPLETION_REPORT.md` | this file | — |

**Location rationale.** `docs/specs/` has an established, different purpose — per its own README it holds one build spec per module named `module-N.md`. These five are cross-module product and decision records, named by the founder. Putting them in `docs/aafnai/` avoids creating a competing specification inside `docs/specs/`. Recorded as `AAF-DOC-01`.

---

## 4. Confirmed decisions recorded

**Coach autonomy** — coaches create their own plans, set their own prices, define their own inclusions; **no** mandatory package, **no** price approval, **no** floor or ceiling; only technical validation and truthful description; the coach alone decides whether and when to change a programme, and "continue unchanged" is a complete review outcome.

**Commission** — monthly coaching **70% coach / 30% Aafnai**; one-off consultations **60% coach / 40% Aafnai**; the plan builder shows Customer pays / Coach receives / Aafnai share with labelled assumptions and rounding.

**Calendar and calls** — coach availability in the coach's timezone; client slots in the client's timezone; video and internet audio; weekly scheduling where the plan includes it; allowance and duration belong to the plan; timezone display with override, conflict protection, appointment history.

**Progress workspace** — all eight capabilities are first-product scope: private progress photos, daily bodyweight with unit preference, measurements with history, coach-authored programmes, client set/rep/weight/note logging, preserved programme and workout history, progress graphs for client and assigned coach, form-review video with feedback. Daily weighing is a capability, not an obligation. Programme edits never rewrite history. No automatic good/bad verdict on weight change. Media is private.

**Accounts, currency, brand** — client accounts with Google sign-in; prices shown in the client's local currency; continue Aafnai on this codebase; unsuitable UI may be replaced; useful foundations and historical data preserved; pandit code is not deleted, and hiding it secures nothing.

**Operations** — Aafnai handles coach-change requests (confirmed). Wider operational responsibilities are recorded as **proposed, needing confirmation**, and the founder is not portrayed as having accepted them.

---

## 5. Superseded assumptions

Six, each revoked explicitly with **honest provenance**:

| ID | Superseded | Traceable in an inspected document? |
|---|---|---|
| SUP-01 | One mandatory package; all coaches sell the same packages | **Yes** — `docs/HANDOVER.md:150-151`, `aafnai-project-handover.md:61` |
| SUP-02 | Mandatory Aafnai price approval ("subject to agreement") | **Yes** — `aafnai-project-handover.md:61` |
| SUP-03 | Forced four-week programme replacement | **No** — not found anywhere. Recorded on founder authority only |
| SUP-04 | Universal weekly 30-minute call; 45-minute onboarding; two-video limit | **Partial** — `docs/HANDOVER.md:161` sets a platform-defined "2 live video calls/mo"; the rest not found |
| SUP-05 | Fixed $99/month and $15/hour launch prices | **Partial** — $99/$159 in `docs/HANDOVER.md:160-161` and `web/src/verticals/fitness/catalog.ts:38,54`; $15/hour not found |
| SUP-06 | 60/40 and 65/35 splits for new monthly plans | **Yes** — `docs/HANDOVER.md:152,171`, `web/src/verticals/fitness/payout.ts:11,18`, `web/src/lib/payouts/index.ts:24,30` |

Three items could not be located in any document supplied to this session and presumably come from a ChatGPT conversation I do not have. They are recorded as superseded **on your instruction**, and the register says so rather than implying a search confirmed them.

**Resolved in the second pass.** `docs/HANDOVER.md` was **amended on 2026-09-09 under founder authorisation**. §6.1, §6.2, §6.3, §6.5 and §12 now state the current rules, §6.7 was added for long-term prepaid coaching, and every superseded passage is preserved verbatim beneath its replacement as history. The file is no longer in conflict, and a future agent reading it alone will now be pointed at `docs/aafnai/DECISION_REGISTER.md` as the current authority.

---

## 6. Open policies

Thirteen, each with a recommended default, its tradeoff, and the module it gates. **None is marked approved to close the module.**

| ID | Topic | Blocks |
|---|---|---|
| OPEN-01 | Commission base, fee allocation, FX, rounding, tax presentation | M06, M07 |
| OPEN-02 | Long-term packages: prepaid vs committed monthly, discounts, coupon funding, refunds, replacement, auto-renewal, protected prices | M05, M06 |
| OPEN-03 | Coach earnings schedule and payout timing | M07 |
| OPEN-04 | One-off session price, duration, purpose, coach choice | M05, M09 |
| OPEN-05 | Cancellation, no-show, technical failure, make-up, buffers, notice, window | M09, M10 |
| OPEN-06 | Per-plan inclusions and response commitments; whether in-app messaging is in scope | M05, M13, M14 |
| OPEN-07 | Plan versioning and existing subscribers | M05, M06 |
| OPEN-08 | Coach change: consent, price difference, records access, prepaid value, compensation | M05, M07, M17 |
| OPEN-09 | Business role — contractor-delivered service vs intermediary marketplace | M06, M07, legal |
| OPEN-10 | Market scope, vetting evidence, adult/minor, service boundaries, support ownership, retention, recording consent | M08, M16, M17 |
| OPEN-11 | Actual environment, live data, status of prior founder-only gates | M01 |
| OPEN-12 | Stripe settlement and balance-buffer model | M07 |
| OPEN-13 | Nepal payout route | M07 |

---

## 7. Current implementation facts versus proposed designs

**Source-inspected facts about what exists today.** None of these is a runtime observation.

| Fact | Evidence |
|---|---|
| `services` is a platform-global catalog with **no coach or provider foreign key** | `web/supabase/migrations/0002_catalog.sql:19-36`; exhaustive grep found `provider_id` on bookings, payout_ledger, ceremonies, programs — never on services |
| Fitness payout is **60/40, or 65/35 for founding coaches** | `web/src/verticals/fitness/payout.ts:11,18`; fallback `0.6` at `web/src/lib/payouts/index.ts:24,30` |
| Currency is USD-only at three layers | DB default `'usd'`; TypeScript **literal** type `currency: "usd"` at `web/src/lib/catalog/types.ts:23`; `$` hard-coded at `:58-67` |
| **No** scheduling exists | No availability, slot, appointment, or timezone table. `bookings.scheduled_at` is one admin-set timestamp. The only timezone is free text: `timezone_city`, `web/src/verticals/fitness/intake.ts:67-72` |
| **No** check-in or messaging table exists | All 22 tables enumerated from the seven migrations |
| Five fitness tables have **zero write paths** | `workout_logs`, `set_logs`, `bodyweight_logs`, `measurements`, `progress_photos` — grep of every `.insert`/`.update`/`.upsert` in `src/` |
| A coach **cannot sign in** | `providers.profile_id` is only ever read — one occurrence, `web/src/app/coach/layout.tsx:35`. No write, no invite UI |
| Guest purchases never become owned accounts | `customer_id: user?.id ?? null`, `web/src/lib/bookings/actions.ts:74`; RLS matches `customer_id = auth.uid()` only |
| Webhook handles three events; renewals are not deduplicated | Cases at `webhook.ts:37,64,89`; the only guard is a partial unique index on `stripe_payment_intent_id` (`0004_payments.sql:21`), which renewals do not supply |
| Payment insert errors are swallowed | `if (error || !payment) return;` — `webhook.ts:147`, then `{received:true}` regardless |
| Refunds do not reverse coach earnings | `charge.refunded` updates `payments.status` only — `webhook.ts:96-99` |
| Payout export mutates via `GET` | `export async function GET()` creates a batch and updates ledger status — `admin/payouts/export/route.ts:10,32-47` |
| Batch "paid" is a free-text string | `notes: "Paid"` written at `admin/payouts/page.tsx:76`, tested at `:142` |
| No security headers, no CSP, no rate limiting, no tests | `next.config.ts` empty of headers; grep clean; `web/package.json` has no test script and there is no `scripts/` directory |
| Cron guard fails **open** | `if (secret) { ... }` — `api/jobs/process/route.ts:9-15`; `CRON_SECRET` absent from `web/.env.example` |
| Grief data sits in generic intake JSON | Pandit intake collects `deceased_name`/`relation`/`gotra` (`verticals/pandit/intake.ts:22-77`) into `bookings.intake_response`, readable by any assigned provider (`0003_bookings.sql:63`) |
| Marketing claims exceed the product | Testimonial `page.tsx:141`; "direct messaging with your coach" `fitness/catalog.ts:37`; "named coordinator" `services/[vertical]/[service]/page.tsx:54` |

**Everything in the lifecycle sections of `PRODUCT_CONTRACT.md` §7 is a proposed logical contract, not a schema.** None of those states, tables, or fields exists.

---

## 8. How downstream modules change

| Module | Change |
|---|---|
| **M03** shared domain | **Substantially larger.** Plan ownership, immutable versions, entitlements, appointments, split earnings model, programme versions, media records |
| **M05** coach plans | **Largest new surface.** The plan builder does not exist in any form |
| **M06** payments | Must charge a specific coach's plan version and freeze its terms; classify by service type not billing shape; fix dedup, refunds, failures, swallowed errors |
| **M07** earnings/payouts | New rates; immutable entries plus a separate seven-state payout workflow; coach-facing statement; POST export |
| **M08** jobs/email/media | **Promoted from deferred.** A quarantine-and-process upload pipeline is now required |
| **M09** scheduling | **Entirely new** |
| **M10** calls | **Entirely new** |
| **M11** programmes | Keep the schema and RLS; replace the UI; add versioning |
| **M12** logging/progress | **Entirely new UI** over five schema-only tables |
| **M13** check-ins | New; cadence per plan |
| **M14** messaging | **Gated on OPEN-06.** The copy must be corrected either way |
| **M15** dashboards | Graphs, earnings statement, frozen-plan rendering |
| **M16** public journeys | Coach and plan discovery **before** purchase |
| **M17** operations | Coach invitation, coach change, grief-data remediation |
| **M04**, **M01**, **M02**, **M18** | Google sign-in, coach login linkage, guest→account, admin MFA; the safety defects; rebrand values and copy plus real nav/contrast fixes; nothing exists to build QA on |

**Six capabilities the audit recommended deferring are now required:** progress photos, measurements, form-review video, progress graphs, scheduling and calls, and local-currency display. None was marked deferred merely because the audit said so.

---

## 9. Validation actually performed, and its limits

**Performed:**

| Check | Result |
|---|---|
| Diff scope | `git status --porcelain` shows exactly one entry: `?? docs/aafnai/`. `git diff --stat` is **empty** — no tracked file modified |
| Arithmetic | All commission figures recomputed in integer minor units. Every pair sums exactly to its base, including the deliberate rounding cases $49.99 → $34.99 + $15.00 and $19.99 → $11.99 + $8.00. Six-month difference confirmed at exactly $51.00; unearned-after-one-month at $425.00 |
| ID integrity | `AAF-*` (57), `SUP-01…06`, `OPEN-01…13`, `AC-01…14`, `R-01…55`, `M00…M18` — contiguous, no gaps, no orphan references |
| Cited paths | All 44 distinct source paths cited were confirmed to exist |
| Cited lines | Spot-checked line-exact, including `page.tsx:141`, `site-nav.tsx:32`, `booking-form.tsx:69`, `fitness/catalog.ts:37`, `services/[vertical]/[service]/page.tsx:54` |
| Label hygiene | Every occurrence of 60/40, 65/35, price approval, four-week replacement, weekly-30-minute, and two-video is either a supersession record, a "current code contradicts M00" note, the confirmed one-off rate, or a coach's own free choice in an example. **No stale rule survives as a requirement** |
| Privacy | No secret value, key, token, personal email, real client data, or named individual appears. The recruiting names in `aafnai-project-handover.md` were deliberately **not** copied |
| Fabrication | No invented coach, testimonial, price, account eligibility, corridor confirmation, or test result |
| One broken cross-reference | Found and fixed in `CODEBASE_RECONCILIATION.md` — a pointer to "R-24 … R-28" now correctly points at §3 and its actual items |

**Not performed, and therefore not claimed:**

- **No application build, type-check, lint, or install was run.** Per your instruction, no build was run merely to validate a documentation module. TypeScript and build health are **unverified**.
- **No migration was applied, no database was queried, no RLS policy was executed.** All schema statements are read from SQL text.
- **No integration was contacted.** No Stripe, Daily, Google, Remitly, or Supabase call. No account created, no key used, no sandbox touched.
- **No browser or runtime test.** Every UI finding is from source.
- **No vendor or legal fact was newly verified.** Remitly Business eligibility, Nepal corridor viability, Stripe account eligibility, holding limits, fees, and timing are all marked **unverified** in the documents. I did not contact any provider.
- **Production and live-data presence are UNKNOWN.** The absent remote, absent `web/.env.local`, and absent `.vercel` directory are recorded as facts — and explicitly **not** treated as proof that no production environment exists. An environment could exist entirely outside this checkout.

---

## 10. Exact list of files changed

**Created (5, all new, all untracked):**

```
docs/aafnai/PRODUCT_CONTRACT.md
docs/aafnai/DECISION_REGISTER.md
docs/aafnai/CODEBASE_RECONCILIATION.md
docs/aafnai/M00_ACCEPTANCE.md
docs/aafnai/M00_COMPLETION_REPORT.md
```

Plus the containing directory `docs/aafnai/`.

**Modified:** `TASKS.md` (one appended section, following its own stated rule that anyone may append and agents may tick progress without approval) and `DEVLOG.md` (one session entry; gitignored, local-only, required by `CLAUDE.md`).

**Pre-existing edits left untouched:** none existed. The working tree was clean at start.

**Explicitly not changed:**

- No application source, component, CSS, or brand asset
- No dependency, lockfile, or `package.json`
- No migration, seed, or database object
- No runtime configuration or environment file
- No test (none exists)
- **`docs/HANDOVER.md` — founder-only, read but not edited**
- `CLAUDE.md`, `AGENTS.md`, `.cursorrules` — not edited, despite the defects found in them (§11)
- `README.md`, `ARCHITECTURE.md`, `MIGRATION.md` — `CLAUDE.md` requires approval before editing these; proposals are in §12 instead
- No commit, no branch, no remote, no push, no deployment
- No vendor account, no live data, no money movement, no email sent

---

## 11. Contradictions found in the agent instructions

Found while reading, outside M00 scope, reported per `CLAUDE.md` ("Flag every contradiction you find"). **These files were not edited.**

1. `AGENTS.md` and `.cursorrules` require reading `docs/STATE.md` and `docs/DIRECTION.md`. **Neither exists.**
2. `.cursorrules` requires updating `docs/DATA-MAP.md` and `docs/RUNBOOK.md` and extending `scripts/payout-test.ts`, `scripts/rls-test.ts`, and `scripts/lib/with-idle-timeout.mjs`. **None exists; there is no `scripts/` directory.**
3. `.cursorrules` cites a `CLAUDE.md` "Tone rules" section. **`CLAUDE.md` has no such section.**
4. **Safety defect.** `.cursorrules` names the protected tables as `deceased_records`, `tithi_reminders`, `ceremonies`, `health_records`. Only `ceremonies` exists. The real grief table is **`shraddha_dates`** and the real health tables are `progress_photos`, `measurements`, `bodyweight_logs`. **The actual grief table is not named in the hard-stop list.** An agent obeying `.cursorrules` literally would not know `shraddha_dates` is protected. Worth correcting before any agent touches the pandit vertical.

---

## 12. Proposed documentation updates awaiting your approval

`CLAUDE.md` requires approval before these are edited. **Not made.**

| File | Proposed change | Why |
|---|---|---|
| `README.md` | Add `docs/aafnai/` to the file guide, marking `PRODUCT_CONTRACT.md` and `DECISION_REGISTER.md` as current product authority | The guide is how a new agent orients; without it these records are invisible |
| `ARCHITECTURE.md` | Fill the stub, including §4's node registry with an activation trigger for each currently-dead table | Nothing today distinguishes a deliberate reservation from abandoned code |
| `MIGRATION.md` | Fill the stub: stack inventory, env inventory, exit procedure, **and a backup with a tested restore** | There is no backup of anything, and no git remote |
| `.cursorrules` | Correct the four defects in §11, especially the protected-table names | Item 4 is a live safety defect |
| `docs/HANDOVER.md` | **Founder action only.** §6.1, §6.2, §6.3, and §12 now contain superseded rules | A future agent reading it alone builds the wrong product |

**Approve these documentation updates?**

---

## 13. The three highest-priority founder decisions, in dependency order

Not a questionnaire — three, ordered so that each unblocks the next.

### First — OPEN-09: what is Aafnai, contractually?

Contractor-delivered Aafnai service, or intermediary marketplace between coach and client? **Coach autonomy over pricing does not settle this.** It determines who contracts with the client, who is paid by whom, tax and reporting treatment, and where liability sits — and therefore the shape of M06 and M07, which are the next real build modules. Deciding it later means rebuilding payments and payouts. Needs professional confirmation, not an internal judgement.

### Second — the `docs/HANDOVER.md:194` conflict: does the client choose their coach before paying?

Coach-created plans with coach-set prices make the coach a **purchase-time choice**. `docs/HANDOVER.md:194` says "No browse-and-choose at launch. Intake quiz → founder assigns within 48h." **These cannot both be true.** This is the most consequential unresolved conflict in the whole M00 record: it decides whether M16 is a coach-and-plan marketplace or an intake funnel, whether the 48-hour matching board is the main flow or an exception tool, and what M05 must build. It follows OPEN-09 because the answer differs depending on who is contracting with whom.

### Third — OPEN-01 and OPEN-03 together: what does 70% actually mean, and when does the coach get it?

The percentages are decided; **the base and the timing are not.** A coach cannot be recruited without an honest answer to "what do I receive, and when," and a six-month prepayment currently has no payout policy at all — day-one exposure on a $510 term is about $425 of undelivered service. These two travel together because a coach evaluating the offer weighs the rate and the wait as one thing. They gate M07 entirely.

**Deliberately not on this list:** OPEN-11 (whether a production environment and the prior presales gate exist). It is important and it is recorded — but it constrains M01 sequencing rather than product design, and it is a fact to establish rather than a decision to make.

---

**M00 specification completed; listed policy decisions remain open. No application implementation started.**


---

## 14. Second pass — 2026-09-09

Supersedes §6 and §13.

### 14.1 Documentation updates made (all previously proposed, now authorised)

| File | Change |
|---|---|
| `docs/HANDOVER.md` | **Amended under founder authorisation.** Banner at the top; §6.1 (model), §6.2 (pricing), §6.3 (commission and payout), §6.5 (coach selection) rewritten; **§6.7 added** (long-term prepaid coaching); two §12 prohibitions struck with their surviving intent stated. **Every superseded passage is preserved verbatim beneath its replacement.** §§1–5 (pandit) untouched |
| `README.md` | `docs/aafnai/` added to the reading order and file guide; a "product in one breath" section added; `DECISION_REGISTER.md` named as current product authority |
| `ARCHITECTURE.md` | **Stub replaced** with the real architecture, written from the codebase: invariant enforcement points with honest state, the data model, an **extension node registry with activation triggers**, the storage quarantine design, money flow as-built and as-required, the tithi pipeline, vendor boundaries, performance |
| `MIGRATION.md` | **Stub replaced**: stack inventory with honest exit costs, exit procedure, env inventory split client-safe vs server-only, vendor notes, correctness dependencies, backups, production checklist, and **§8 — the requirements for enabling live payments** |
| `.cursorrules` | Four defects fixed. The protected-table list now names the **real** tables — `shraddha_dates`, `ceremonies`, `progress_photos`, `measurements`, `bodyweight_logs`, `workout_logs`, `set_logs`, plus `bookings.intake_response` — instead of three tables that do not exist. Stale file references removed; tone rules stated where they live; money-math fixtures updated to the new rates |
| `AGENTS.md` | Reading order corrected; `docs/STATE.md` / `docs/DIRECTION.md` references removed |
| `docs/aafnai/*` | All five records updated with the second-pass decisions; stale references to now-resolved policies swept |

### 14.2 New decisions recorded

`AAF-OPS-05/06` (business model, verification obligation) · `AAF-FLOW-01/02` (selection and acceptance before payment) · `AAF-COMM-06/07/08/09` (base, fees, discounts, refunds) · `AAF-PAY-03/04` (monthly in arrears; arrival ≠ payable) · `AAF-TERM-01…05` (prepaid coaching) · `AAF-DATA-05` (three ledgers) · `AAF-DEV-01` (mock payments first). `AAF-COMM-05`, `AAF-COMM-04`, and `AAF-PAY-02` promoted from PROPOSED to CONFIRMED. Full detail in `DECISION_REGISTER.md` §K.

### 14.3 Open decisions after this pass

| ID | Question | Blocks | Urgency |
|---|---|---|---|
| **AAF-TERM-05** | Prepaid cancellation and refund rules | M06 | **Blocks prepaid plans specifically.** Monthly billing is unaffected |
| **OPEN-13** | Nepal payout route | M07 | **Now urgent** — a monthly payout date has been committed to, with no verified way to pay |
| **OPEN-05** | Cancellation, no-show, technical failure, make-up, buffers, notice, booking window | M09, M10 | High — scheduling is confirmed scope |
| **OPEN-06** | In-app messaging or WhatsApp; per-plan response commitments | M05, M13, M14 | High — changes the plan field vocabulary |
| **OPEN-10** | Market scope, vetting evidence, adult/minor, retention, recording consent, testimonial truth | M08, M16, M17 | High before any public traffic |
| OPEN-01a | Multi-currency conversion, rounding presentation, charge currency | M06 | Medium |
| OPEN-02a | Auto-renewal and existing-price protection | M05, M06 | Medium |
| OPEN-04 | One-off session duration and purpose (price is coach-set) | M05, M09 | Medium |
| OPEN-07 | Plan versioning consent for existing subscribers | M05, M06 | Medium |
| OPEN-08 | Coach change: consent, price difference, records access, effective date | M05, M17 | Medium — earnings split settled by AAF-TERM-04 |
| OPEN-11 | Actual environment, live data, prior gates | M01 | Fact to establish, not a decision |
| OPEN-12 | Processor settlement and balance buffer | M07 | Low until live payments |

### 14.4 State of the repository after this pass

Documentation only. **No application source, dependency, migration, seed, runtime configuration, or environment file was changed. No vendor account, live data, commit, or deployment.** No build, type-check, migration, database query, integration call, or browser test was run — and nothing here claims otherwise.

**Requirements for enabling live payments** are enumerated in `MIGRATION.md` §8: six business and legal items that must precede the rest, and twelve technical items each confirmed missing today.
