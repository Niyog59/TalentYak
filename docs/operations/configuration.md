# Configuration

**Updated 2026-09-20.** Variable names and non-secret values only. **No real secret appears in this file, and none may be added to it.**

## 0. What is actually configured today

| | State |
|---|---|
| Supabase (hosted project, used as the **test** environment) | Working. 30 migrations applied |
| Stripe | Working, **test mode only**. Checkout, webhook, refunds and disputes exercised |
| Stripe webhook secret | Deployed endpoint `we_1UHZwi…` at `https://www.talentyak.com/api/webhooks/stripe`, 23 events, its own signing secret. §7's relay value remains local-only |
| Resend (app email) | Working. Domain verified, `EMAIL_FROM` set to `TalentYak <notifications@talentyak.com>`. Proven end to end through the deployed worker |
| Supabase Auth email | Working. Custom SMTP through Resend (§4). Username is the literal word `resend`, port 587 |
| Google sign-in | **Enabled.** Authorisation handoff verified, button live on sign-in and sign-up |
| Supabase redirect allowlist | `https://www.talentyak.com/**` plus `http://localhost:3001/**` for development |
| Supabase Site URL | `https://www.talentyak.com` — auth email links are built from this |
| Deployment | Vercel project `talentyak`, root `web/`. `www.talentyak.com` serves it; apex redirects to www; `talentyak.vercel.app` preserved |
| Live payments | Refused by the gate (§5). The Stripe account has not submitted business details either |
| `SUPPORT_EMAIL` | **Still empty** — outgoing email carries no reply address |

Actual values live in `web/.env.local`, which is gitignored. If a value ever reaches a commit, a log, a screenshot, or a chat message, it is **rotated, not excused**.

---

## 1. The rule that matters most

**Only `NEXT_PUBLIC_`-prefixed variables reach the browser.** Everything else is server-only, and the naming is the first line of defence. A secret must never be given a `NEXT_PUBLIC_` name to make something work on the client — if a value is needed in the browser, the design is wrong, not the prefix.

`SUPABASE_SERVICE_ROLE_KEY` deserves its own sentence: it bypasses every row-level security policy in the database. It can read every customer's grief data, every progress photo, and every payout detail. It is guarded three ways in `web/src/lib/supabase/admin.ts` — `import "server-only"`, a runtime `window` check that throws, and its non-public variable name.

---

## 2. Variables

| Variable | Reaches browser | Required for | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Everything | Project URL from Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Everything | Publishable/anon key. Safe in the browser **because RLS is enforced** — that is the whole bargain |
| `SUPABASE_SERVICE_ROLE_KEY` | **No** | Webhooks, background jobs | Bypasses all RLS |
| `STRIPE_SECRET_KEY` | **No** | Checkout, webhooks | `sk_test_…` until live billing is approved |
| `STRIPE_WEBHOOK_SECRET` | **No** | Webhook signature check | Currently a **locally generated value for `scripts/stripe-event-relay.mjs`**, labelled as such in the file. It is not a Stripe secret. The deployed endpoint gets its own secret from the Stripe dashboard — these are different values for different endpoints |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Yes | Client-side Stripe, if used | |
| `RESEND_API_KEY` | **No** | Transactional email | App email only. **This is not Supabase Auth's SMTP** — see §4 |
| `EMAIL_FROM` | **No** | Transactional email | Must be on a domain verified in Resend. No default: email stays off until it and the API key are both set |
| `SUPPORT_EMAIL` | **No** | Shown to customers | Hidden until set. **Only fill this with an address a person actually reads** — it is presented as somewhere to reply |
| `CRON_SECRET` | **No** | Scheduled jobs | **Required.** The processor refuses to run without it. Generate with `openssl rand -base64 32` |
| `LIVE_BILLING` | **No** | Taking real money | Defaults off. Necessary but **not sufficient** — see §5 |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | **No** | Ceremony recordings | Cloudflare R2 |
| `R2_BUCKET` | **No** | Ceremony recordings | Default `talentyak-recordings`. Only the retained pandit vertical uses it, nothing has ever been stored, and R2 is not configured. Not needed for fitness |
| `NEXT_PUBLIC_SITE_URL` | Yes | Metadata, emails, Stripe redirects | The origin this deployment serves from |
| `SUPABASE_ACCESS_TOKEN` | **No** | Applying migrations, and nothing else | A personal access token, scoped to database work. **The running application never reads it.** Revoke it once schema work is finished |

---

## 3. Local development

```
http://localhost:3001
```

Started by `.claude/launch.json` (`talentyak-web`), which runs `npm --prefix web run dev`. **Not 3000** — older documents say 3000; the launch configuration says 3001.

Verification: `npm run verify` in `web/` runs typecheck, lint and the test suite.

---

## 4. Two email systems that are easy to confuse

They are configured in different places and neither implies the other.

| | Sends | Configured where |
|---|---|---|
| **App transactional email** | Booking confirmations, reminders, recording delivery | `RESEND_API_KEY` + `EMAIL_FROM` in this app's environment |
| **Supabase Auth email** | Sign-up confirmation, password reset, magic links | **Supabase dashboard → Authentication → Emails → SMTP Settings.** Resend's SMTP credentials go here, separately |

Setting the app's Resend key does **not** configure Supabase Auth's SMTP. Without the dashboard SMTP, auth mail goes through Supabase's shared sender, which is heavily rate-limited and not suitable for real users.

Both are now pointed at Resend. The settings that work, recorded because two of them are easy to get wrong:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `587` |
| **Username** | **`resend`** — the literal word, not a mailbox address |
| Password | the Resend API key (the same one the app uses) |
| Sender | `notifications@talentyak.com`, name `TalentYak` |

A mailbox address in the username field fails with a bare `500 Error sending recovery email`, which names neither the field nor the cause. **Supabase's Site URL is what auth email links are built from** — if it points at localhost, every confirmation link in every email is dead, and nothing in the send path reports a problem.

**A sending address is not a receiving mailbox.** `notifications@talentyak.com` can send without anyone being able to read replies to it. Do not promise a reply reaches someone unless a real inbox exists.

---

## 5. The live-billing gate

**Four** independent locks, all of which must open before real money moves:

1. `LIVE_BILLING=true` in the server environment.
2. **No policy in the active set may still carry `sandbox_default`** — see `web/src/lib/policy/registry.ts`.
3. The terms of service and privacy notice are **final, approved documents**, not drafts — see `web/src/lib/legal.ts`.
4. Everything the plan being sold promises can actually be **delivered** — see `web/src/lib/fulfillment.ts`. Programmes, calls, check-ins, messaging, form review and progress tracking arrive in M09–M14; until then, plans that include them cannot be sold for real money.

Lock 4 is the one approvals cannot open, and it is the point: a commercial policy can be signed off in an afternoon, a scheduled-call system cannot.

The second lock exists so a working default this codebase invented — a cancellation rule, a payout schedule, a grace period — cannot reach a customer because someone flipped an environment variable. Approving a policy is an edit to the register, and that is reviewable.

`assertLiveBillingPermitted()` throws and names every blocker. Call it on the server, before the provider call.

---

## 6. Callback and endpoint URLs

The **test** project's reference is `lbqgucirksrafxscgkzg` (a project reference is public — it is part of the URL the browser already talks to; the keys are the secrets). Production will have its own reference, and every row below changes with it.

| Purpose | Value (test project / intended production) | Set in |
|---|---|---|
| Google OAuth redirect | `https://lbqgucirksrafxscgkzg.supabase.co/auth/v1/callback` | **Google Cloud Console**, not this app |
| Supabase redirect allowlist | `https://talentyak.com/auth/callback`, `http://localhost:3001/auth/callback` | Supabase → Authentication → URL Configuration |
| Stripe webhook endpoint | `https://talentyak.com/api/webhooks/stripe` | Stripe → Developers → Webhooks |
| Scheduled job endpoint | `https://talentyak.com/api/jobs/process` | The scheduler, with `Authorization: Bearer $CRON_SECRET` |

Two distinct redirects, routinely confused: **Google redirects to Supabase**, and **Supabase redirects to this app**. Google's OAuth client secret belongs in the Supabase provider settings and nowhere near a frontend variable.

Google scopes are limited to `openid`, `email`, `profile`. **No Calendar scope** — TalentYak builds its own scheduling, and asking for Calendar access would be requesting permission we have no use for.


---

## 7. Stripe events during development

There is no public URL yet, and the Stripe CLI is not installed on this machine. `scripts/stripe-event-relay.mjs` bridges that gap: it reads **real events from the Stripe test account**, signs them exactly as Stripe signs a webhook, and delivers them to `http://localhost:3001/api/webhooks/stripe`.

```bash
cd web && node ../scripts/stripe-event-relay.mjs             # follow new events
node ../scripts/stripe-event-relay.mjs --event=evt_…          # replay one event
node ../scripts/stripe-event-relay.mjs --event=evt_… --mutate-signature   # prove a bad signature is refused
```

It refuses to run against a live key, and it only ever delivers to localhost.

**What it proves:** the signature check, receipts, leases, the authoritative re-fetch from Stripe and every database effect.
**What it does not prove:** that Stripe can reach a deployed URL, or that the deployed endpoint's signing secret is correct. Both are checked the day the app is deployed.

---

## 8. Test accounts and fixtures

Synthetic accounts use `@example.test`, a reserved domain that cannot receive mail. The worker refuses to send to reserved domains and records the job as `sent: false, reason: reserved_test_address` rather than pretending.

Helper scripts used for end-to-end checks live in `web/test/journey/` and are development-only: they create synthetic people, sign them in through the auth API (so no password is typed into a form), complete a Stripe **test-mode** payment with Stripe's own test tokens, drive a Stripe test clock for renewals, and create one clearly labelled payout fixture. None of them runs against live keys.
