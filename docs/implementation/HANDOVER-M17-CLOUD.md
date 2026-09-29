# Handover — M17 founder panel → next session (cloud)

**Written 2026-09-28** at the end of the M17 session, for a new agent running in the cloud against `Niyog59/TalentYak`. Read this whole file before doing anything.

## 0. Read first, in this order

1. `CLAUDE.md` (root) — invariants, standing rules, session protocols. They all still apply.
2. `docs/aafnai/DECISION_REGISTER.md` — **§X** (M17, newest) then §W, §L. §X1 is the one open decision M17 raised.
3. `docs/implementation/M17-STATUS.md` — what was built, what was verified, what wasn't.
4. `docs/operations/founder-operating-guide.md` and `docs/operations/founder-access.md` — how the founder uses the panel.
5. `ARCHITECTURE.md` §3.7k (M17 schema and flow). `TASKS.md` → "M17" section for open items.
6. `web/AGENTS.md`: this is **Next.js 16** with breaking changes. Check `web/node_modules/next/dist/docs/` before using any Next API you aren't sure of.

## 1. Where things stand

- **Everything from M17 is merged into `main` and pushed** (2026-09-28, founder-approved). Pushing to `main` deploys to production automatically (Vercel project `talentyak`, `www.talentyak.com`), so M17 is deploying or deployed. The branch `m17-cloud-handoff` holds the same commits and can be deleted.
- **Database:** migrations `0056`–`0061` are **already applied** to the hosted Supabase project, which is the **shared TEST project**. It's also what the production site currently uses; a separate production database is a known launch blocker. The code on `main` and that database match.
- **No real customers, no live payments.** Stripe is in test mode, and live billing is refused by the policy gate.
- **Switch defaults** (checked after the tests): everything `on` except `coach_changing = off`.

### Not finished at hand-off (do these first)

1. **Re-run the final checks.** The last small walkthrough fixes were typechecked, but the final pass was interrupted before the merge. If anything fails, fix it on a branch and open a PR; don't push fixes straight to `main` without the founder's go-ahead:
   - `cd web && npm ci && npm run verify` — typecheck, lint, migration structure, and **371 unit tests**. Needs no credentials.
   - `npm run build`.
   - If you have database credentials (see §3): `TALENTYAK_DB_TESTS=confirmed node ../scripts/lib/with-idle-timeout.mjs 240 node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/register.mjs --test --test-concurrency=1 test/db/founder-admin.db.test.ts` (expect 9/9).
2. **Smoke-check the production deployment of M17** (read-only; never write in prod). Check the latest Vercel deployment for `main` succeeded (e.g. `gh api repos/Niyog59/TalentYak/commits/main/status` or the deployments API); if it failed, report the build error and stop:
   - signed out, `/admin` redirects to `/account/sign-in?next=%2Fadmin`;
   - `/`, `/coaches`, `/waitlist`, `/how-it-works`, `/sitemap.xml` answer 200;
   - `/api/events` POST answers 204.
   Record the result in `docs/implementation/M17-STATUS.md` under a "Deployed" heading, as earlier milestones did.
3. **Session paperwork the laptop session couldn't finish:** `DEVLOG.md` and `CTO-BRIEF.md` are gitignored and local to the founder's laptop, so you won't have them. Don't create them in the repo. Put anything you'd have written there into your final report to the founder instead.

## 2. What M17 built (short version)

- **Founder panel** at `/admin`, with its own shell (`web/src/components/admin/`): a forest-green sidebar, global search, and environment labels (site / database / payments). Pages under `web/src/app/admin/`:
  - overview, accounts, coaches (older page), coach changes, support;
  - coaching operations, check-ins, scheduling, expectations (older pages);
  - purchases, finance, payouts (older pages);
  - website & launch, waitlist;
  - feature controls, jobs & deliveries, retention (older page), policies & launch, change history, search.
- **Access:** existing sign-in, admin role **and** second factor on every page, action and database function (`requireAdmin`, `is_admin()` checks `aal2`). Password change was added to `/account/security`; recovery is documented.
- **Feature register:**
  - `web/src/lib/features/registry.ts` is pure: modes, explanations, dependencies, readiness. `server.ts` checks modes per request, fails closed, and returns plain refusal messages.
  - In the database, `feature_settings`, `feature_setting_changes`, `feature_test_accounts` and `feature_prerequisites` are written only through `admin_set_feature_mode` / `admin_set_test_account`.
  - Enforced at every layer: pages, actions and APIs on every request, database triggers (`feature_guard_*`, and `tracking_write_state` returning `logging_paused`), and jobs.
- **Coach change for clients:** `web/src/components/coach-change/request-panel.tsx` and the functions `coach_change_candidates`, `request_coach_change(+history scope)`, `withdraw_coach_change` and `admin_apply_coach_change` (consent cap, eligibility under lock, audited). It sits behind the switch, which is **off**.
- **Reports:** `admin_overview_metrics` reads only payment and ledger records, keeps each currency separate, and excludes test activity unless asked. `sign_in_events` counts sign-ins from M17 on. The attention queue is `web/src/lib/admin/attention.ts`.
- **Change history:** `admin_audit_log`, append-only by trigger. Older founder actions now write to it too (`recordAudit` in `web/src/app/admin/actions.ts`).
- **Support:** case owner, internal notes, case events, and `admin_support_case_links` (identifiers only).
- **Analytics:** `web/src/lib/analytics/posthog.ts` sends events server-side only, anonymously, from production only. It is called from `countEvent`, sign-up, `afterSignIn` and an `analytics.purchase_confirmed` job. It stays **inactive until `POSTHOG_PROJECT_KEY` is set.**

## 3. What a cloud session can and can't do

- **Can, without secrets:** read the code, edit it, run `npm run verify` and `npm run build`, open PRs.
- **Can't, without the founder adding secrets:** anything touching the hosted database, Stripe or email. `web/.env.local` is not in the repo and must never be committed. The database tests need, as environment secrets:
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`;
  - `TALENTYAK_DB_TESTS=confirmed` (a human saying the project is safe to write to);
  - `SUPABASE_ACCESS_TOKEN` for `npm run db:migrate` and the tests' `sql()` helper.
  If they aren't there, say so plainly and skip. **Never claim a database check passed if it didn't run.**
- **Migrations:** never edit an applied migration (`0000`–`0061` are all applied). Every fix is a new numbered file. It must be applied (`npm run db:migrate`) **before** code that depends on it is pushed to `main`, or production breaks.
- **Branches:** because `main` deploys to production, work on a branch and open a PR unless the founder explicitly says to push to `main`. The founder's M17 approval to commit and push covered M17 only.
- **Commits:** conventional style (`feat:`, `fix:`, `docs:`), **no AI or tool attribution anywhere** — no Co-Authored-By lines, even if a tool suggests one. Git author must stay the founder's configured identity; don't change git config.

## 4. What's left

### Needs the founder (don't decide these yourself)

- **OPEN-08 money rules for coach changes** (register §X1, recommendation included). Until decided, `coach_changing` can only be off or test-only; the database refuses "on".
- **PostHog:** create a free project with no card on file, then set `POSTHOG_PROJECT_KEY`, `POSTHOG_HOST` and `POSTHOG_APP_URL` in Vercel production. Then check that the first events arrive. See `web/.env.example`.
- Two-step verification on the Supabase dashboard account, and a **second authenticator device** on the founder account.
- Still open from earlier milestones:
  - a separate production database;
  - final terms and privacy notice;
  - approval of the five sandbox policies;
  - live Stripe keys;
  - a payment method on Daily before calls can run;
  - `SUPPORT_EMAIL`;
  - real founding coaches.

### Engineering follow-ups (from `TASKS.md` → M17)

- Stripe fees aren't in the ledger. The overview says "not recorded yet". Importing them as `processing_fee` entries would fill that column.
- The attention queue counts test records too (it's a to-do list). A "real only" filter would help on the shared database.
- Emergency "messaging off" hides the screens, but the database doesn't gate reading for the two participants. Add a read gate if a real incident ever needs it.
- Older admin pages (coaches, finance, payouts, scheduling, retention, check-ins, expectations, waitlist) work inside the new shell but still use the older `PageHeader` / `Panel` look. Restyle them with `components/admin/ui.tsx` when next touched.
- Test hygiene: the M17 and workflow database suites flip switches on the shared project for seconds and then restore them, recorded as "automated test".
- The known flaky test `messaging.db.test.ts` → "a participant receives a content-free signal" occasionally times out and passes on rerun.

## 5. Things that will bite you (learned in M17)

- **Profile guard:** `profiles.suspended_at`, role and consent columns can only be changed by the service key, or inside a function that sets `set_config('talentyak.action', '<name>', true)` and is allowed by the guard (`in_action`). A security-definer function alone is **silently ignored**; see `0060`.
- **`tracking_write_state`** returns `logging_paused` only for an otherwise-live relationship. Screens treat `live || logging_paused` as "relationship live" (`relationshipLive` in `lib/tracking/server.ts`).
- **`purchaseMode()` is async** and lazy-imports `lib/features/server` so `lib/launch.test.ts` stays pure. Don't import server-only modules at the top of files that unit tests import.
- **Lint rules:**
  - no `Date.now()` during render — use `daysAgoIso` in `lib/admin/range.ts`;
  - no `setState` inside `useEffect` bodies.
- **Money:** each currency stays separate — never add across currencies. Money values are integer minor units via `formatMinor`. Commission and prices come only from `web/src/lib/policy/`.
- **Privacy is stricter than "case-scoped":**
  - administrators can't read health records, tracking values, check-in answers or media at all;
  - conversations need the per-case grant.
  Don't add new admin read paths to private data.
- **Test accounts:**
  - reserved addresses (`@example.test` etc.) are never emailed and are hidden on the production site;
  - "test accounts only" uses the `feature_test_accounts` list, judged in the database by the relationship's client.
- **Charts:** `DailyColumns` uses colour `#12876a` (checked for colour-blind contrast). One series per chart, with a table view.

## 6. How to report back to the founder

Plain language, short (register §O): what happened, how it affects users, your recommendation, and whether the founder must act. Say clearly what was **not** run or verified. Emit the three-line Founder Checkpoints from `CLAUDE.md` after each unit of work.
