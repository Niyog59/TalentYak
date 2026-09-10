# Handover Document: Diaspora ↔ Nepal Services Marketplace

**Prepared:** August 12, 2026  
**Founder context:** Data science student, Houston/Pearland TX; gas-station income; Nepali-speaking; built Mehenat (fitness tracker); shelved Volt for this business.  
**Purpose:** Single source of truth for decisions made across planning conversations. A new collaborator, future you, or an AI agent can continue from here without re-deriving context.

---

> ## ⚠ Amended 2026-09-09 — read this before §6
>
> The brand is moving from Ghartira to **Aafnai**, and the fitness/coaching model in **§6 has been replaced**. The sections below are amended in place, with the original text preserved beneath each change as history.
>
> **What changed in one breath:** coaches create their own plans, set their own prices, and define their own inclusions — there is no platform-defined package and no price approval. Commission is **70/30 on recurring coaching** and **60/40 on one-off consultations**, replacing 60/40 and 65/35. The customer **selects their coach and plan before paying**, replacing intake-then-assign. Aafnai is a **contractor-delivered managed coaching service**: the customer buys coaching from Aafnai, and their selected independent coach delivers it.
>
> **Sections amended:** §6.1, §6.2, §6.3, §6.5, §12. **Sections 1–5 (pandit) are unchanged.**
>
> The full rule set, with every decision's status and source, lives in **`docs/aafnai/DECISION_REGISTER.md`**. Where this file and that register ever disagree, **the register wins** — it is the current product authority.

---

## 1. Executive summary

A two-sided marketplace connecting the Nepali diaspora (US, UK, AU, JP, CA — ~250–300k households serviceable) with service providers in Nepal. Wage arbitrage exists but is **not** the moat. Real moats: cultural/tradition fit, trust, payment rails, and (for pandit) a tithi-reminder database nobody has built.

**Current strategic posture (agreed):**
- **Agency first, marketplace later** — founder sets prices, finds customers, matches supply, controls quality. Transition when founder becomes the bottleneck.
- **Pandit is the stronger vertical** — cultural moat, recurring revenue (annual shraddha on lunar tithi), price insensitivity, calendar-driven demand. Fitness is vertical two, gated on presales.
- **Launch both on-platform in January 2027** — but September 2026 shraddha season runs as a **manual pilot** (no product) while building.
- **$20k/month profit in 24 months is unlikely from diaspora verticals alone** — model says 4–5 years or pivot to B2B (bookkeeping). Founder has not resolved this tension; do not pretend it is solved.

**Honest survival levers (from Monte Carlo):**
1. Don't quit / keep day job (+18 pts survival)
2. Referral-led acquisition (+34 pts combined with persistence)
3. Churn ≤5–6% at ~25% effective take — business dies at 8% churn + 20% take around month 25

---

## 2. What is genuinely strong vs. overrated

### Strong
- Pandit research (tithi recurrence, tradition taxonomy, Gokarna vs US-pandit hybrid model)
- Regulatory homework (NRB $500/year cap, crypto ban, payment direction)
- Model honesty (fitness alone never standalone; persistence > idea selection)
- Disintermediation defense via payment rail (Nepal providers cannot take US cards)
- GTM discipline: one metro first, depth over breadth, recruit coaches/pandits for audience

### Overrated / fix
- "The arbitrage" as pitch — customer at $99 saves nothing vs US market; lead with cultural fit or price lower
- Fiverr-grade pricing machinery before customers exist — simplify at launch
- Multi-vertical cross-sell assumed default — fitness buyer ≠ shraddha arranger (often same household, different person; test in pilot)

---

## 3. Business model phases

### Phase A — Agency (now → ~100 customers)
- Founder is the product: sales, matching, quality control, refunds
- **One platform price list** — providers do not set customer-facing prices
- Take rate expressed as **payout terms**, not hidden margin
- Manual ops acceptable: WhatsApp, Zoom links, CSV payouts, hand matching

### Phase B — Assisted marketplace (~100+ customers, 5–10 providers)
- Public profiles, reviews, providers set price within bands
- Browse/choose replaces hand matching for some flows
- Platform take drops as providers do more of sales/service

### Phase C — Marketplace
- Self-serve signup, attribution, provider-owned relationships
- ~18–25% platform take (split-side or single-side — keep simple until scale)

**Transition trigger:** Founder is bottleneck on matching, support, or quality — not a calendar date.

---

## 4. Pricing philosophy (agreed)

| Principle | Rule |
|---|---|
| Pandit | All-inclusive public price. **No booking fee** on death rites. Recording **free** always. Never surge-price grief. |
| Fitness | Quarterly billing default. Signup price locked forever. Three service scopes only. |
| Provider happiness | Pay **above** local market, pay fast (48h), be transparent upfront. Generosity is **upward-only** (tenure ladder). |
| Validation | Presell with **money** before building fitness. Pilot pandit with real payments in September. |

---

## 5. Pandit vertical

### 5.1 Positioning
- **Nepali-tradition focus** — Bratabandha, Newar rites, BS tithi, Bikram Sambat — gap vs Indian platforms (99Pandit, Prayag Pandits, YatraDham)
- **Hybrid supply:** Nepal-remote for shraddha/pind daan at Gokarna; US-based pandits for physical ceremonies (wedding, bratabandha, griha pravesh) — phase 2 booking layer at ~15% take
- **Compounding asset:** Tithi reminder system — store deceased's tithi once → annual "your father's shraddha is Oct 3" → permanent CRM at ~$0 CAC

### 5.2 Fair payout model (agreed)

**Do not use flat 60% of ticket** — direct ritual costs (samagri, temple fees, assistant, Stripe, fixer) come out first.

**Split remaining pool 50/50 with pandit.**

Example — Shraddha Basic $149:
- Direct costs ~$26 (samagri, Stripe, fixer NPR 1,500)
- Remaining ~$123 → pandit ~$61 (NPR ~9,300), platform ~$61 (~41% of ticket)

Example — Gokarna Full $299:
- Direct costs ~$47 (pandit NPR 8k + assistant NPR 2.5k + samagri + Stripe + fixer)
- Remaining ~$252 → pandit ~$126 (NPR ~19,100), platform ~$126 (~42%)

**Pitch to pandits:** "After ritual costs, we split every booking equally." Pay 2–3× local dakshina (NPR 1,500–3,500 market → NPR 9,000–19,000 per ceremony). Tenure ladder: +NPR 1,000 after 10 flawless ceremonies, etc.

**When pandit sees customer price:** Math should confirm fairness, not contradict it. Never let them discover the split from a customer.

### 5.3 Service catalog & customer prices

**Launch SKUs (September manual pilot → platform by Oct–Jan):**

| Service | Customer price | Pandit payout (≈50/50 after costs) | Notes |
|---|---|---|---|
| Annual Shraddha — Basic | $149 | ~$61 (NPR 9,300) | Tarpan + pinda, live video, recording, tithi stored |
| Gokarna Shraddha — Full | $299 | ~$126 (NPR 19,100) | 90 min, senior pandit + assistant, samagri, photos |
| Gokarna — Complete | $499 | ~$324 platform / ~$175 COGS | + sida daan, brahmin bhojan, priority tithi |
| Sohra Shraddha 16-day bundle | $399 | ~$242 platform net | Seasonal; daily tarpan all Pitru Paksha |
| Tripindi / Pitru Dosh | $349 | ~$217 platform net | 2 pandits, extended ritual |
| Rudrabhishek @ Pashupatinath | $129 | ~$62 platform net | Temple fee NPR 7,500 is fixed COGS |
| Kundali PDF | $49 | ~$32 platform net | Jyotish; 65%+ margin |
| Muhurat selection (add-on) | $39 | ~$31 platform net | Attach to every ceremony flow |

**Not offered remotely:** Wedding, bratabandha, griha pravesh, funerals — US in-person network later at 15% take.

**Pricing rules:**
- Additional ancestor: +$49
- If pilot conversion weak on price, test $119/$249 in October — data-driven, not pre-discount
- Capacity caps during Sohra Shraddha, not price surges

### 5.4 September 2026 pilot (manual — no product)

**Deadline:** Marketing live by ~September 1. Sohra Shraddha: Sept 26 – Oct 10.

**Stack:** Carrd + Google Form + Stripe payment links + Zoom + WhatsApp

**Supply:** 2 Gokarna pandits + 1 backup; 1 Nepal fixer (NPR 18k base + NPR 1,500/booking); senior pandit quality gate

**Cap:** 10–15 bookings. Founder on every call first 10.

**Success criteria:**
- ≥8 completed ceremonies, zero ritual-correctness failures
- ≥60% opt into tithi reminders
- Document who booked vs. who paid (household cross-sell test)

**Risk:** One botched shraddha in tight-knit community = brand death. Dress rehearsals with own extended family first.

### 5.5 Revenue calendar
- **Sept–Oct:** Sohra Shraddha (peak)
- **Oct–Nov:** Dashain/Tihar cross-sell
- **Jan:** Maghe Sankranti
- **Feb–Mar:** Shivaratri (Rudrabhishek surge)
- **Year-round:** Death tithis (annual recurrence), birthdays (rudri + reminder)

---

## 6. Fitness / coaching vertical

### 6.1 Model — amended 2026-09-09

**Aafnai is a contractor-delivered managed coaching service.** The customer purchases coaching from Aafnai; their selected independent coach delivers it.

- **Coaches create their own plans**, set their own prices, and define their own inclusions. There is no platform-defined package, no price floor or ceiling, and **no Aafnai price approval**. Only technical validation applies: the price must be processable, and a plan may not advertise functionality the platform lacks.
- **Coaches control their programmes and adjustments.** Routine programme changes stay between coach and client. There is no mandated revision cadence and no Aafnai approval of workouts. "Continue unchanged" is a complete review outcome.
- **Aafnai handles** discovery, billing, platform support, and customer requests to change coaches.
- Pitch to coaches: **additive channel** — keep local clients; the platform adds diaspora demand, card billing, and no collections. *(unchanged)*

> **Superseded 2026-09-09** — original text, kept as history:
> *"Agency first; one coach tier (no Pro/Standard customer-facing split). Service tiers only — three scopes, platform-defined menu, all coaches sell same packages. Founding coaches: 65% payout (invisible to customers) to land established anchor; everyone else 60%."*
> Replaced by coach-created plans (`AAF-PLAN-01`, `AAF-PLAN-02`) and the commission rates in §6.3. The `founding` flag on the `providers` table is now historical only.

### 6.2 Pricing — amended 2026-09-09

**There is no platform price list.** Each coach sets their own price and inclusions per plan. The plan builder shows the coach **Customer pays / Coach receives / Aafnai share** before they publish.

Still binding:

- Existing subscribers: **price and inclusions locked at purchase.** Editing a plan never changes an existing purchase.
- Nutrition = general wellness only — **no medical or disease-specific meal plans** (US dietitian licensing risk).
- A plan may not claim an inclusion the platform cannot deliver.

> **Superseded 2026-09-09** — original text, kept as history:
> *"Plan (one-time) $49 ($79 both) · Coached $99/mo · Premium $159/mo (2 live video calls/mo, max ~5 slots/coach). Billing: quarterly default."*
> These were platform-set prices and a platform-set call allowance. Both are replaced by coach-set pricing and per-plan entitlements (`AAF-PLAN-01`, `AAF-CAL-05`). Quarterly billing is no longer a default — billing structure is a per-plan field. The old figures remain useful only as a sanity check on what the market might bear; they are **not** launch prices, and the code still carrying them (`web/src/verticals/fitness/catalog.ts`) is scheduled for replacement.

### 6.3 Commission and payout — amended 2026-09-09

| Service type | Coach | Aafnai |
|---|---|---|
| **Recurring coaching** (incl. multi-month packages) | **70%** | **30%** |
| **One-off consultations** | **60%** | **40%** |

- **Base:** the coaching service amount, **excluding separately collected taxes**.
- **Fees:** Aafnai covers ordinary payment-processing and payout fees **from its own share**.
- **Discounts:** an Aafnai-funded promotion **must not reduce the coach's agreed earnings**. A coach-funded discount requires the coach's explicit acceptance.
- **Refunds** reverse the corresponding service amount and its commission allocation. Disputes and adjustments are tracked explicitly, as new entries — never by editing history.
- **Payout timing:** coaches are paid **monthly in arrears, during the first seven days of the following month**, for service delivered through the previous month-end. Partial service months are prorated consistently. **A customer payment arriving does not make that amount payable to the coach.**
- **Classification is by service type, not payment count.** A six-month coaching package is recurring coaching at 70/30 even when bought in one payment — see §6.7.

> **Superseded 2026-09-09** — original text, kept as history:
> *"60% coach / 40% platform on all tiers (65% founding coaches). At Coached $99/mo: coach $59.40. At Premium $159/mo: coach $95.40."*
> Replaced by `AAF-COMM-01` and `AAF-COMM-02`. **Historical payout-ledger rows keep their original rule string** — the new rates apply to new plans only and do not retroactively reinterpret past records.

**Marketplace transition (unchanged intent):** if Aafnai ever becomes a true marketplace, the coach share rises toward 75–80% and the platform take falls to ~20–25%.

### 6.7 Long-term prepaid coaching — added 2026-09-09

A multi-month coaching package is **ongoing coaching**, not a consultation, and uses the **70/30** split even when purchased through a single upfront payment.

- **Allocate the payment across the service period**, and release coach earnings **as service is delivered**.
- Worked example: a **$510 six-month package** with equal monthly allocation is **$85 per service month** — **$59.50 to the coach, $25.50 to Aafnai**, recognised month by month. After the first delivered month, **$425.00 remains an undelivered balance.**
- **Track the undelivered balance separately.** Customer payments, earned coach balances, and actual payouts are three distinct things and are never conflated.
- **A coach change mid-term must preserve the distinction** between the original coach's earned amount and the remaining service funding.

> **Unresolved — blocks launch of prepaid plans.** Cancellation and refund rules for prepaid terms are **not decided**. Prepaid plans must not be enabled until they are.

### 6.4 Coaches & capacity

**Launch roster: 2 coaches + 1 on waitlist**

| Coach | Profile |
|---|---|
| #1 | Strength/hypertrophy specialist |
| #2 | Fat loss / diet-strong (most diaspora demand) |
| #3 (waitlist) | Preferably female — segment of diaspora women only train with female coaches |

- Cap **12–15 clients/coach** early
- Bring #3 when active clients hit ~20–24 or female demand appears in intake

### 6.5 Coach selection — amended 2026-09-09

**The customer selects their coach before paying.**

Before any charge is collected, the customer must see and select their coach **and** their plan, including:

- the coach's qualifications
- the plan's price
- the plan's inclusions
- **compatible availability**

**The system must confirm the coach can accept this customer before collecting payment** — capacity and availability are checked at checkout, not after.

**Intake still matters**, but it now informs the customer's choice rather than a back-office assignment: goal, coach gender preference, language, equipment, schedule and timezone, injuries.

**Policies:**
- **Free coach change anytime.** Aafnai handles the request. Mechanics — consent, price difference, records access, effective date, remaining prepaid value — are **not yet decided**.
- Founder involved early with each new coach-client pairing while volume is small.

> **Superseded 2026-09-09** — original text, kept as history:
> *"No browse-and-choose at launch. Intake quiz → founder assigns within 48h. Match priority: goal ↔ coach specialization, gender preference, load balance."*
> Coach-created plans with coach-set prices make the coach a purchase-time choice — you buy *that coach's* plan — so intake-then-assign is no longer coherent. Replaced by `AAF-FLOW-01`. The 48-hour assignment board at `web/src/app/admin/fitness/page.tsx` becomes an **exception tool** (unassigned edge cases, transfers), not the main flow.

### 6.6 Demand validation (UNRESOLVED — critical)

**Whether diaspora pays $99/mo is unproven.** Lead value prop: **diet/cultural fit** (dal bhat, Nepali grocery), not "Nepali-speaking coach."

**Before building fitness code:**
1. Ask anchor coach: existing diaspora clients paying from abroad? How many? What rate?
2. **$20 refundable deposit presale** for January slots via coach Instagram + Houston/DFW groups
3. 10 interviews: past fitness spending, not intent

**Gate (Nov 15):** 2–3 coaches signed + **≥10 presold committed clients** → build & January launch. Else delay fitness; pandit may be the business.

---

## 7. Technology & build

### 7.1 Stack (decided)
- **App:** Next.js + TypeScript, Vercel
- **DB/Auth/Storage:** Supabase (Postgres, RLS day one, pg_cron for reminders)
- **Payments in:** Stripe (Checkout one-time pandit; Billing subscriptions fitness, quarterly)
- **Payouts out:** Payoneer, manual CSV batch monthly — test $50 real payout in August
- **Video:** Zoom for September pilot; **Daily.co** at platform launch (10k free participant-min/mo; ~$0.004/min after; recording ~$1.50/90min ceremony)
- **Recordings storage:** Cloudflare R2 (~$0.015/GB-mo)
- **Email:** Resend (reminders, receipts)
- **Calendar/tithi:** `nepali-calendar-engine` (npm) — human confirms every shraddha date before send

**Infra cost:** ~$30/mo until scale

### 7.2 Architecture
```
core:     users, providers, bookings, payments, payouts, reviews, notification_jobs
fitness:  programs, program_days, exercises, workout_logs, set_logs, bodyweight_logs, measurements, progress_photos
pandit:   ceremonies, shraddha_dates (tithi, gotra, tradition_required, samagri)
```
Shared core + per-vertical tables. No generic JSON-blob service_type.

**Deferred:** In-app messaging (WhatsApp), automated payouts, search/ranking, mobile apps, macro tracking, wearables, tithi auto-send without human confirm.

### 7.3 Build phases (~235h, Aug–Dec 2026)

| Phase | When | Focus |
|---|---|---|
| 0 Foundations | Aug 13–31 | Auth, core schema, Stripe webhook, admin skeleton |
| 1 Pandit | Sept–mid Oct | Booking, tradition tags, tithi DB + cron, recording delivery |
| 2 Fitness | mid Oct–early Dec | Coach dashboard, programs, logging, 7-day weight avg, CSV import, subscriptions |
| 3 Harden | Dec | Daily.co, payout ledger, beta |
| 4 Launch | First week Jan 2027 | Both verticals public |

**Parallel non-build (August):** Texas LLC, Stripe, Payoneer test, pandit recruitment, Carrd pilot page.

---

## 8. Go-to-market

- **One metro first:** Houston/DFW (founder can show up in person)
- **CAC ceiling ~$45–55** — Meta ads for fitness don't clear; community/organic only
- **Channels:** Nepali FB groups (participate 3–4 weeks before asking), temples, grocery stores, NRNA, r/Nepal, coach/pandit Instagram audiences
- **Best channel:** Happy customer posting own results/testimonial
- **Seasonality sequence:** Shraddha pilot Aug–Oct → Dashain cross-sell Oct–Nov → build fitness Nov–Dec → launch fitness Jan

---

## 9. Regulatory (researched — do not re-litigate)

- Crypto/stablecoins illegal in Nepal — ruled out
- Money **into** Nepal encouraged; **out** restricted — platform direction is correct
- Nepal-resident **customers** cannot be onboarded ($500/year int'l spending cap)
- "Import existing clients" = diaspora clients only
- Structure: US LLC (Texas), Nepal providers as contractors, W-8BEN, providers handle own Nepal tax
- Payout: Payoneer → Nabil/Global IME

---

## 10. Open questions & decision gates

| Gate | Date | Question | If no |
|---|---|---|---|
| A Pandit demand | Oct 15 | ≥8 ceremonies, zero failures, ≥60% tithi opt-in? | Keep pandit manual; don't over-invest product |
| B Fitness presales | Nov 15 | 2–3 coaches + ≥10 committed Jan clients? | Delay fitness launch |
| C Post-launch | Mar 1 | Fitness month-2 retention >70%? Pandit repeats? | Kill or double down by data |

**Unresolved founder goals:**
- $20k/mo in 24 months requires bookkeeping B2B (84% of blended route) — not researched, no moat
- Direction-change pattern (Volt → marketplace → product → marketplace) — persistence beats idea selection per model

---

## 11. Key numbers reference

| Metric | Value | Confidence |
|---|---|---|
| Serviceable diaspora households | ~250–300k | Sourced (excludes Gulf/Malaysia labour) |
| Fitness churn assumption in model | 8% mo | **Likely wrong — expect 10–14%** |
| Model survival to month 60 | 48.4% | Sensitive to churn, persistence |
| Pandit blended gross margin | ~62% | After 50/50 post-cost split |
| Fitness platform net at $99/60-40 | ~$37/client/mo after Stripe | Before founder time, marketing |
| Imported client 12mo free + Stripe | −$3.52/mo | Pass processing through from day one (agreed) |
| USD/NPR | ~152 | Sourced |

---

## 12. What NOT to do (explicit)

- Build fitness before pandit pilot data + fitness presales
- Surge-price shraddha or charge for recording
- Offer remote wedding/bratabandha/griha pravesh/funeral
- ~~Create customer-facing coach tiers (Pro vs Standard)~~ — **superseded 2026-09-09.** Coaches now set their own prices and inclusions, which is customer-visible by design. The surviving intent: Aafnai does not *rank* coaches, badge a plan "recommended" or "best value", or sell premium placement.
- ~~More than 3 fitness service scopes at launch~~ — **superseded 2026-09-09.** With coach-created plans the live count is N coaches × M plans. The surviving intent: keep each coach's own menu short enough to compare, and launch with **one or two coaches**, not six.
- Six shallow coaches instead of two deep ones
- Launch UK+US+AU simultaneously
- Trust Monte Carlo percentile outputs as precision — directional only
- Ask established coaches to abandon local business for platform

---

## 13. Immediate next actions (as of Aug 12, 2026)

**This week:**
- [ ] Texas LLC + business bank + Stripe
- [ ] Payoneer test payout to Nepal
- [ ] Recruit 2 Gokarna pandits + backup + fixer
- [ ] Carrd shraddha page + Stripe links + Google Form
- [ ] 10 shraddha household interviews (who books, who pays, last year cost)

**By Sept 1:**
- [ ] Pilot marketing live (Houston/DFW groups, temples)
- [ ] 2–3 dress-rehearsal ceremonies (own network)
- [ ] Phase 0 foundations code started

**By Nov 15:**
- [ ] Fitness presale: 2 coaches, ≥10 deposits
- [ ] Pandit pilot success criteria evaluated

**January 2027:**
- [ ] Platform launch both verticals (if gates passed)

---

## 14. Related artifacts

| Document | Location |
|---|---|
| Original business briefing | `/Users/niyoguprety/Downloads/business-briefing-for-review.md` |
| Consultant review canvas | `~/.cursor/projects/empty-window/canvases/business-briefing-review.canvas.tsx` |
| Build roadmap canvas | `~/.cursor/projects/empty-window/canvases/build-roadmap.canvas.tsx` |
| Pandit services & pricing canvas | `~/.cursor/projects/empty-window/canvases/pandit-services-pricing.canvas.tsx` |
| Mehenat (founder fitness app) | mehenat.netlify.app |

---

## 15. One-paragraph pitch (internal)

We connect Nepali diaspora families to trusted providers in Nepal — starting with shraddha and ancestral rites nobody serves in our traditions, then fitness coaching where the real product is a diet that fits your kitchen. We run as a concierge agency until we've earned trust, then open into a marketplace. Providers earn well above local rates; customers get cultural fit and payment simplicity; we compound through tithi reminders and community referrals, not ads.

---

*End of handover. Update this document when gates pass/fail or pricing changes. Version 1.0 — conversation synthesis through Aug 12, 2026.*
