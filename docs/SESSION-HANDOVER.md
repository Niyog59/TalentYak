# Session Handover — 2026-08-13

**For the next chat.** Read this, then `CLAUDE.md`, then the code. Not to be confused with `docs/HANDOVER.md`, which is the *business* source of truth (pricing, gates, regulatory) and is founder-written.

---

## Start here

```bash
cd ~/dev/ghar-tira/web
npm install          # only if node_modules is missing
PORT=3005 npm run dev
```

Then open **http://localhost:3005**. Logs go to `~/dev/ghar-tira/dev-server.log` (gitignored).

**Open the next Claude session rooted at `~/dev/ghar-tira`, not the Desktop folder.** This session ran from `~/Desktop/Ghar Tira` and it caused real problems — see Gotchas.

---

## What this project is

Ghar Tira: a two-sided marketplace connecting the Nepali diaspora with providers in Nepal. Two verticals — **pandit** (shraddha and ancestral rites, the lead vertical) and **fitness coaching** (gated on presales until Nov 15, 2026). Agency-first; the founder is the product until he becomes the bottleneck.

Founder: Niyog, Houston. Business detail in `docs/HANDOVER.md`.

---

## Current state

| | |
|---|---|
| Repo | `~/dev/ghar-tira` — 4 commits, clean tree, **no remote** |
| App | Next.js 16.3.0 + React 19.2.8 + Tailwind 4, in `web/` |
| Code | ~4,250 lines, 66 source files |
| Database | 7 migrations, 22 tables, RLS on every table, 37 policies |
| Runtime | All 12 routes return 200, zero errors |
| Config | **No `.env.local`** — no Supabase, no Stripe |

Commits:
```
da04058  chore: stop tracking local dev server log
446f8de  style: use Inter as the single Latin typeface
4960e05  fix: restore fitness catalog module corrupted during migration
c95829e  chore: initial commit — MVP scaffold, migrations, and documentation system
```

Because there's no `.env.local`, the catalog falls back to local seed data, `/admin` shows "Supabase is not configured" instead of crashing, and checkout can't complete. That graceful degradation is deliberate and works well. To see admin, coach, and real bookings, create a Supabase project and apply `web/supabase/migrations/`.

---

## What was done this session

1. **Ported the meet-merchants documentation practice** — `CLAUDE.md` (invariants, security operating rules, money discipline, session protocols), `.cursorrules`, `AGENTS.md`, `TASKS.md`, `ARCHITECTURE.md` + `MIGRATION.md` (stubs), `DEVLOG.md`, `CTO-BRIEF.md`.
2. **Discovered an existing codebase.** A near-complete MVP, written by Fable in a parallel Cursor session, sitting in iCloud with no git repo. It was not a build plan — it was the product.
3. **Moved it out of iCloud** to `~/dev/ghar-tira` and put it under git for the first time.
4. **Fixed a corruption I caused** (see Gotchas) and got the app running.
5. **Changed the typeface to Inter.**
6. **Set `permissions.defaultMode: "bypassPermissions"`** in `~/.claude/settings.json` globally, at the founder's request. No more permission prompts, in any project.

---

## Assessment of the code

Better than "one-shotted MVP" suggests. Things it got right:

- **Vertical registry pattern** (`web/src/verticals/registry.ts`) — a single composition root. Each vertical supplies catalog, intake schemas, payout rule, admin href. Core code never imports a vertical directly. Tutoring and Bookkeeping already exist as catalog-only entries rendering "Coming soon" with zero code behind them. This is exactly the branch-out-from-a-common-base structure the founder wanted.
- **RLS on all 22 tables in the same migration that creates them.** The expensive-to-retrofit invariant is actually met.
- **Payout math matches `docs/HANDOVER.md` §5.2 exactly** — post-cost 50/50 for pandit, not the flat-60% shortcut the handover warns against.
- **All 8 pandit prices match HANDOVER §5.3 exactly.** Fable invented no pricing.
- **The human-confirmation invariant is real** — `shraddha_dates.date_confirmed_by_human` exists and `admin/pandit/page.tsx:85` refuses to schedule a reminder without it. It even surfaces as customer-facing copy on the booking form.

---

## Known bugs — none fixed, all real

Ordered by severity. These are in Fable's code, not artifacts of the migration.

1. **`web/src/lib/supabase/admin.ts` is missing `import "server-only"`.** It creates the RLS-bypassing service-role client. Every other money file has the guard — `payments/webhook.ts`, `payments/checkout.ts`, `payouts/index.ts` — this one, the most dangerous file in the repo, does not. One careless import from a client component ships the service-role key to the browser and nothing fails the build. **One line.**

2. **No unique index on `stripe_invoice_id`.** `web/supabase/migrations/0004_payments.sql` has a unique index on `stripe_payment_intent_id`, which protects one-time pandit bookings. Subscription cycles insert keyed on invoice ID with no uniqueness — so a replayed `invoice.payment_succeeded` (Stripe retries on any non-200) writes a duplicate payment **and** a duplicate payout ledger row. Fitness subscriptions are the exposed path.

3. **Refunds don't reverse the payout ledger.** `charge.refunded` marks the payment refunded but leaves the `payout_ledger` row intact, so a refunded booking still shows money owed to the pandit. **Needs a founder decision:** does a refund void the payout, or write a reversing entry? Reversing entry is more correct — the ledger is append-only.

4. **Swallowed webhook errors.** `web/src/lib/payments/webhook.ts:147` — `if (error || !payment) return;` treats "duplicate insert" and "database unreachable" identically, then returns 200 to Stripe. A dropped payment is indistinguishable from a successful dedupe.

Also: **no admin 2FA** (role check only, and it will guard contractor tax documents and grief data), and **zero tests** — no `test:rls`, no `test:payout`, no `scripts/` directory. The payout math is correct today with nothing preventing it from silently becoming wrong.

---

## Gotchas — read before touching files

**The Desktop folder IS the iCloud folder.** `~/Desktop/Ghar Tira` and `~/Library/Mobile Documents/com~apple~CloudDocs/Desktop/Ghar Tira` are the same inode. Desktop & Documents sync is on.

**iCloud evicts file contents.** Files show correct sizes in `ls` while their bytes live only in Apple's cloud. Reading them returns empty or blocks. `du` on the Desktop copy currently reports 68K for a directory containing 27,495 files — that's eviction, not deletion.

**This corrupted a file during the migration.** `verticals/fitness/catalog.ts` came across as 746 bytes of unrelated compiled JavaScript from `aria-query` instead of its real 2,369 bytes, leaving `fitnessVertical` undefined and 500-ing every page that lists verticals. Restored in `4960e05`. A full `diff -rq` confirmed it was the only file affected. **If you ever copy from that folder again, checksum afterward.**

**iCloud left sync-conflict copies** in the Desktop folder — `registry 2.ts`, `.gitignore 2`, `eslint.config 2.mjs`, `package-lock 2.json`. These were checked: `registry 2.ts` is an *older* iteration using a `registerIntakeSchemas()` late-registration pattern that Fable refactored away from. Nothing was lost by not copying them. They still sit in the Desktop folder.

**The preview MCP tooling cannot start a server from the Desktop folder** — node's `process.cwd()` fails with `EPERM` inside the iCloud container. Run the dev server via Bash, or open the session from `~/dev/ghar-tira`.

---

## Open decisions for the founder

- **Delete the iCloud original?** `~/Desktop/Ghar Tira` still holds the full project. Everything is safely in git at `~/dev/ghar-tira`. Nothing was deleted this session.
- **Turn off iCloud Desktop & Documents sync?** A System Settings change only the founder can make. Without it, anything new on the Desktop repeats today's problems.
- **Refund → payout ledger semantics** (bug #3 above).
- **Direct-cost assumptions need real numbers.** `verticals/pandit/payout.ts` hardcodes estimates ($26 shraddha-basic, $47 gokarna-full, $175 gokarna-complete) with a comment saying "adjustable as real costs come in from the pilot." These drive the 50/50 split. The founder should ask 2–3 Gokarna pandits for actual samagri cost, temple fees, assistant rate, and current per-ceremony earnings. **Customer prices are researched; cost assumptions are guesses.**
- **Git identity and remote.** `CLAUDE.md` → ACCOUNTS is still a TODO block. Commits currently use a placeholder `Ghar Tira <dev@ghartira.local>` so no personal email is baked into history. Do not push until the business GitHub account, SSH alias, and Vercel team exist.

---

## Recommended next steps

1. Fix bugs #1 and #2 — a few lines each, both close real security/money holes.
2. Decide #3 with the founder, then fix.
3. Stand up a dev Supabase project, apply the migrations, and see admin and coach for real.
4. Write `scripts/rls-test.ts` and `scripts/payout-test.ts` — both required by `CLAUDE.md` and neither exists.
5. Fill in `ARCHITECTURE.md` from the actual codebase; it is currently a stub.

**Do not start fitness work.** It is gated behind Nov 15, 2026 (2–3 coaches signed + ≥10 presold clients). Building it early is the named failure pattern in `docs/HANDOVER.md`.

**The real deadline is the September manual pilot**, which needs no product code at all — Carrd, Stripe payment links, Google Form, Zoom, WhatsApp. Platform work is parallel, not on that critical path.
