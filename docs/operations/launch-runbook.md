# Launch runbook — alerts, problems, rollback, recovery, spending

**Written 2026-10-01 (M18).** For the founder. How you find out something is wrong, what to do about the common problems, how to undo a bad release, what is (and isn't) backed up, and what each service can cost. Day-to-day panel use is in `founder-operating-guide.md`; sign-in and recovery of your own account is in `founder-access.md`.

---

## 1. How you find out something is wrong

Three different questions, three different tools. None of them covers the other two.

| Question | What answers it | State today |
|---|---|---|
| **Did something break?** (a page crashed, a payment notification couldn't be applied, a job ran out of retries, an upload failed unexpectedly) | **Sentry** error reporting → email to you | **Built, not connected.** Needs a Sentry account (§2) |
| **Has the schedule stopped?** (reminders, renewals housekeeping, emails all wait on it) | **Sentry cron monitor** `scheduled-worker` (alerts when a run is missed) **and** *Jobs & deliveries → Is everything running?* in the panel | Panel view **works now**. Sentry monitor starts with Sentry |
| **Is the whole site down?** | **Sentry uptime check** on `https://www.talentyak.com/` (set up in Sentry's dashboard) | **Not set up.** Until it is, nothing tells you the site is down |

Also in the panel, every day: the **attention queue** on the overview (failed payment notifications, failed or blocked emails and jobs, past-due renewals, support cases).

### What is filtered out of every error report

Before a report leaves the app — in the browser or on the server — it is reduced to: the kind of error, a redacted message, the page path (no query string), the environment (production / preview / development) and the release (the deployed commit). Removed: names, emails, IP addresses, cookies, headers, request bodies, query strings, message text, health and food entries, private media links, card details, tokens and keys. Session replay, performance tracing and visitor session pings are off. This was proven on 2026-10-01 by sending deliberately sensitive test errors to a local stand-in for Sentry and reading exactly what arrived (`docs/implementation/M18-LAUNCH-READINESS.md`).

---

## 2. Connecting Sentry (founder, ~20 minutes, free)

1. Create a Sentry account on the **free Developer plan**. Do not start a trial of a paid plan and do not add a card: with no card, the free quota is a hard cap — when it's used up, reports stop rather than bills appear.
2. Create one project, platform **Next.js**. Copy its **DSN** (Settings → Client Keys).
3. In Vercel → project `talentyak` → Settings → Environment Variables, add for **Production** and **Preview**:
   - `NEXT_PUBLIC_SENTRY_DSN` = the DSN
   - `SENTRY_ORG`, `SENTRY_PROJECT` = the slugs from the Sentry URL
   - `SENTRY_AUTH_TOKEN` = an **organisation auth token** (Settings → Auth Tokens) — optional, gives readable stack traces. It is a secret; it goes only here.
4. Redeploy (Vercel → Deployments → latest → Redeploy). The DSN has to be there **at build time**.
5. In Sentry → Project Settings → Security & Privacy: turn on **Data Scrubber**, **Use Default Scrubbers**, and **Prevent Storing of IP Addresses**. (A second layer; the app already removes these.)
6. Alerts → check the default "new issue" alert emails **you**. Add an **Uptime** monitor for `https://www.talentyak.com/` if your plan allows one. The `scheduled-worker` cron monitor appears by itself after the first production run; set its alert to email you.
7. In the panel: **Jobs & deliveries → Is everything running? → Send a test error from the server** and **…from this browser**. Within a minute both should appear in Sentry, labelled `production` with the deployed commit, and you should get the alert email. Tell the next session what you saw; that closes the last unverified monitoring item.

The test buttons stay. They're only available to an administrator with two-step sign-in, carry no customer data, and each press is written to the change history.

**What I could not check:** whether your Sentry plan includes uptime and cron monitors, and how many. Look at Settings → Subscription once the account exists.

---

## 3. Common problems and what to do

| Problem | Where you see it | What to do |
|---|---|---|
| **A renewal failed** | Overview → "Renewals past due"; Purchases filter *past due* | Nothing at first: Stripe retries, and the customer got the "payment failed" email. Coaching continues until the paid month ends, then pauses with the approved message ("Your payment didn't go through. Renew to continue coaching. Your progress is saved."). Their history stays readable, and a coach may still finish a check-in sent while paid. When they pay, coaching resumes by itself — but never past a suspension or a coach change. |
| **A coach is unavailable** (ill, away, left) | Support case, or the coach's own away dates | Coaches → the coach: mark away / not accepting. Their check-in reviews waiting appear in *Check-ins* for you to reassign or tell the client. A permanent change of coach for a client is **Coach changes** (customer-requested changes stay **off** until the money decision OPEN-08 is made). |
| **A call failed** | Client reports "A problem with a call" from the session page → Support | A technical failure is never counted as a delivered session. Offer to rebook. If many fail: Feature controls → Calls, and check Daily's status page. Note: **today every call fails** because the Daily account has no payment method (§5). |
| **A refund request** | Support (category *Payment or billing*) | Purchases → the purchase → Refund, with the amount and a reason. The coach's share and the commission are reversed in proportion; nothing to do in Stripe. Use **part refunds** for part months. |
| **Someone asks for their data, or for it to be deleted** | Deletion: the person uses *Your photos and clips → Ask us to delete your data*; it appears on the overview ("Deletion requests to handle") and Data & retention. Export: arrives as a support case (*Something else*) | Deletion: review on Data & retention, confirm by email, then remove. Payment records stay (legally required), with the name removed. **Automatic deletion is off and stays off.** Export: the panel deliberately can't read health records, so an export is prepared from the Supabase dashboard (SQL editor) for that one person and sent to their verified email. Record both in the support case. |
| **Someone can't sign in** | Support | Ask them to use *Forgot password* (the link arrives from TalentYak's sending address within a minute; check spam). Google sign-in works only for the Google account they signed up with. You can't see or set passwords. |
| **An email didn't arrive** | Jobs & deliveries → "What actually reached people" | "Accepted" means Resend took it; "delivered", "bounced", "complained" come back from Resend. Retry is safe — it never sends twice for one event. |
| **A payment didn't show up** | Overview → "Stripe events that failed"; Jobs & deliveries | The scheduled job retries from Stripe's own copy. Never mark something paid by hand; the webhook is the only writer of payment truth. |

**Two Stripe dashboard rules:**
- Cancel a subscription **"at the end of the period"**, never **"immediately"**. Immediate cancellation ends the client's coaching at once, even if they have paid for the rest of the month (seen on 2026-10-01 in test mode).
- Refund from the TalentYak panel, not the Stripe dashboard. A dashboard refund is still recorded correctly, but without your reason.

---

## 4. Undoing a bad release — code rollback is not database recovery

**Code rollback (minutes, safe):** Vercel → project `talentyak` → Deployments → the last good **Production** deployment → **Instant Rollback** (or "Promote to Production"). This changes only the website code. Customer data is untouched. Afterwards, fix forward on a branch; the next push to `main` deploys again.

**Things to know before you roll back:**
- Database changes (migrations) are **never reversed**. They are always additive, so the older code keeps working against the newer database. Never ask anyone to "undo the migration" — that can erase customer data written since.
- If the bad release came with a migration that the older code doesn't understand (rare, and called out in that release's notes), roll forward with a fix instead.

**Database recovery (hours, last resort):** only for data loss or corruption, never for a bad release. See §5 — today there is **no backup to restore from**.

**Switches instead of a rollback:** for a single misbehaving area, Feature controls is faster and safer than a rollback. *Read-only* keeps everything visible but stops new writes; *Off* is the emergency stop. Work already underway is kept (drafts stay on the device; nothing is deleted).

---

## 5. Backups — what exists, and what doesn't

| What | Backed up? | Notes |
|---|---|---|
| **Database** (accounts, purchases, ledger, plans, logs, messages) | **No.** | The Supabase organisation is on the **free plan**, which has no automated backups and no point-in-time recovery. Today the database holds only test data (35 MB), so nothing real is at risk yet. |
| **Uploaded files** (progress photos, clips, coach photos) | **No.** | Stored in Supabase Storage (currently empty). **A database backup — even on a paid plan — does not include file contents.** |
| **Code and database structure** | Yes | GitHub holds the code and every migration; the structure can be rebuilt from them in minutes (`docs/operations/database-and-migrations.md`). That rebuilds the shape, **not** the data. |
| **Stripe records** | Yes, at Stripe | Stripe is the source of payment truth; payment events can be re-fetched. |

**Restore drill: not done.** A safe restore needs a backup to restore and a second, isolated project to restore into. Neither exists; I did not create one (it's your decision, see §7). Recovery is therefore **unverified**.

**Before real customers:** move the production database to a plan with daily backups (Supabase Pro: about $25/month, 7 days of daily backups), or schedule a nightly `pg_dump` to storage you control; add a periodic copy of the storage buckets; then run one restore into a throwaway project and record it.

---

## 6. External dashboards

| Service | What it's for | Look at |
|---|---|---|
| Vercel (`talentyak`) | Website hosting, deployments, rollback, environment settings | Deployments; Logs when something fails |
| Supabase (`TalentYak`, us-east-2) | Database, sign-in, file storage, the 5-minute schedule | Auth users; Storage; Database → Cron |
| Stripe (test mode) | Payments, subscriptions, refunds, disputes | Developers → Webhooks → `www.talentyak.com/api/webhooks/stripe` should show successes |
| Resend | Email sending and delivery results | Emails; Domains (`talentyak.com` verified) |
| Daily | Video/audio calls | Billing (payment method missing) |
| Sentry | Errors, schedule monitor, uptime | Issues; Crons; Uptime (once connected) |
| PostHog | Anonymous website and funnel counts | Not connected yet; payment records stay the authority for revenue |
| Cloudflare | DNS for `talentyak.com` | DNS records (Resend's records live here) |

---

## 7. Launch switches

- **Feature controls** (panel): Programmes, Logging, Check-ins, Messaging, Attachments, Bookings, Calls, New purchases, Public profiles, Waitlist, Changing coach. Launch defaults: all on except **Changing coach (off)**.
- **Who can buy**: nobody with live money until all of the following are true:
  - live Stripe keys;
  - `LIVE_BILLING=true`;
  - every policy approved;
  - final legal documents.

  The live gate checks all four on every purchase. Test purchases: administrators with two-step sign-in, plus anyone listed in `TEST_CHECKOUT_EMAILS`.
- **Waitlist** stays open and separate from sales.

The exact order for switching on real payments is in `live-activation.md`.

---

## 8. Spending and allowances

Figures are each provider's published free allowances as I understand them on 2026-10-01. **Confirm on each dashboard.** An alert is not a cap: only a free plan with no card on file actually stops at its limit.

| Service | Plan today | Allowance / cost driver | Hard cap? | Gap |
|---|---|---|---|---|
| Vercel | Hobby (free) | Generous for a pilot | Yes (free) | **Hobby is for non-commercial use.** Taking real payments means moving to Pro (about $20/month), which then has usage-based overage. Set a spend limit in Vercel billing |
| Supabase | Free | 500 MB database, 1 GB files, limited egress; no backups | Yes (free) | Free projects can be paused after a week of inactivity (the 5-minute schedule keeps it active). Production needs Pro for backups (§5). Leaked-password protection appears to need a paid plan |
| Daily | Free tier, **no card** | Free monthly participant minutes; calls refused until a card is added | **No cap once a card is added** | Add a billing alert in Daily once a card is on file. The app limits rooms to two people and to each session's window |
| Resend | Free | Daily and monthly sending limits | Yes (free) | A busy day of reminders could hit the daily limit; emails then wait as blocked jobs and show in the panel |
| Sentry | Not created | Free Developer plan quota | Yes, without a card | Don't add pay-as-you-go budget |
| PostHog | Not created | Large free monthly event allowance | Set a billing limit if a card is ever added | — |
| Stripe | Test mode | Per-transaction fees only when live | — | Fees aren't yet recorded in the ledger (panel says so) |
