# Handover — after M03–M07

**Written 2026-09-18.** For whoever picks this up next, human or agent. Read `CLAUDE.md` first, then `docs/aafnai/DECISION_REGISTER.md` §L, then `docs/implementation/M03-M07-STATUS.md` (what is actually true), then this.

---

## 1. Getting the project running

```bash
cd web
npm install                 # unchanged lockfile; nothing new was added in this batch
npm run verify              # typecheck + lint + unit tests (196)
npm run dev                 # http://localhost:3001
```

Against the hosted test database:

```bash
node scripts/check-migrations.mjs        # structural check on migrations
npm --prefix web run db:migrate:dry      # what would apply
TALENTYAK_DB_TESTS=confirmed npm --prefix web run test:db    # 95 tests as real users
```

`web/.env.local` holds the values (gitignored, chmod 600). `docs/operations/configuration.md` lists every variable and what is and is not configured.

---

## 2. The shape of the code

| Area | Where |
|---|---|
| Commercial rules, versioned, with a live gate | `web/src/lib/policy/` |
| What can actually be delivered (gates live sales) | `web/src/lib/fulfillment.ts` |
| Money arithmetic, splits, allocation | `web/src/lib/money/` |
| Ledger effects (what each event means financially) | `web/src/lib/ledger/effects.ts` |
| Checkout | `web/src/lib/checkout/service.ts` |
| Stripe webhook — the only writer of payment truth | `web/src/lib/payments/webhook.ts` |
| Customer billing, admin refunds | `web/src/lib/payments/billing.ts` |
| Background worker, email templates, sweeps | `web/src/lib/worker/`, `web/src/lib/email/` |
| Who is signed in and what they may do | `web/src/lib/auth.ts` |
| Coach area | `web/src/app/coach/` |
| Founder console | `web/src/app/admin/` |
| Public and customer screens | `web/src/app/(marketing)/` |
| Database | `web/supabase/migrations/` (30 files, additive, never edited after applying) |

Two conventions worth knowing before changing anything:

- **Every mutation is a server action wrapped in `ActionForm`.** Fields pick up their own error messages by name, the button disables itself, and a refusal keeps what the person typed.
- **The database is the security boundary, not the screens.** Every rule enforced in a page is enforced again in row-level security or in a database function. A page that forgot a check would still show nothing it should not.

---

## 3. End-to-end test tooling (development only)

`web/test/journey/` holds the scripts used to prove the whole path:

| Script | What it does |
|---|---|
| `setup.ts` | Creates synthetic admin (with an authenticator), coach and customer on `@example.test` |
| `enrol-mfa.ts` | Adds an authenticator factor to one of them |
| `session.ts` | Signs one of them in through the auth API (completing the real TOTP challenge) and writes the browser session cookies |
| `cookie-helper.mjs` | A localhost-only page that hands those cookies to a browser, so **no password or code is ever typed into a form** |
| `pay.mjs` | Completes a pending purchase using Stripe's own test tokens, with the same metadata the hosted checkout carries |
| `clock.mjs` | Renewal, declined renewal and dispute scenarios on a Stripe test clock |
| `payout-fixture.mjs` | One clearly labelled payable earning, so the payout screens can be exercised |

And `scripts/stripe-event-relay.mjs` delivers **real Stripe test events** to the local webhook, with a correct signature. It refuses live keys and only ever delivers to localhost.

---

## 4. What the next module should not have to rediscover

- **A payment is not an earning.** Earnings become payable when the period they paid for has ended (`recognise_delivered_cycles`). One-off consultations stay pending until an appointment-completion event exists — which is M09's job.
- **Effect keys are the thing that stops double counting.** They name the business effect (`cycle:<invoice>:coach_earned`), not the Stripe event, so two different events describing one payment converge instead of accruing twice.
- **A published offer version is immutable.** Any change is a new version. Old customers keep theirs, and the ledger can always explain an old row.
- **`in_action()` guards** (`talentyak.action`) are how the database tells "the coach used the publish action" from "somebody wrote to the table directly". They must never return NULL — that bug existed and is now regression-tested.
- **The health and grief invariants are enforced in SQL**, including the rule that an admin cannot read health data at all.

---

## 5. Immediate follow-on work (not started)

1. **M08 proper** — the retention and deletion machinery exists as contracts with destructive execution switched off. Turning it on is a deliberate, separately reviewed step.
2. **M09 scheduling** — appointment and call-entitlement tables exist and are deliberately inert. Building the scheduler unlocks one-off earnings recognition, and its own fulfilment flag.
3. **M11–M14** — programmes, progress tracking, check-ins, messaging. Each has a flag in `web/src/lib/fulfillment.ts`; flipping one to `ready: true` is what allows plans promising it to be sold for real money.
4. **Coach credential evidence upload** — the database and the review screen exist; the coach-facing upload does not.
5. **Photo upload through a real browser** — proven by unit tests (including that EXIF is stripped), not yet clicked through a file picker.

---

## 6. Things that will bite if forgotten

- **The test project is not production.** Build production from the migrations; see `docs/operations/database-and-migrations.md`.
- **Migration `0013` names the first administrator.** Production needs its own.
- **The Stripe webhook secret is per endpoint.** The local value is a relay value and means nothing to a deployed endpoint.
- **Email is blocked, not broken.** Once the sending domain is verified and `EMAIL_FROM` is set, queued jobs will start going out — including any that have been piling up.
- **Uncommitted work.** This batch is not committed: the founder's rules say stop before committing. `git status` will look alarming until it is reviewed and committed.
