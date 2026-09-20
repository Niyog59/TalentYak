# The database: how it is built, and how to build it again for real customers

**Written 2026-09-18.**

---

## 1. Where things stand

The project's **existing Supabase project is being used as the test environment**, at the founder's instruction. It holds synthetic accounts, synthetic coaches, synthetic purchases and Stripe **test-mode** references created while building and checking M03–M07.

**That project must never become the production project.** Production is a new, clean project, built from the same migration files and configured by hand. This document is how.

---

## 2. What defines the database

Everything is in `web/supabase/migrations/`, applied in filename order. **30 files** as of writing.

Rules that are enforced, not merely intended:

- **Migrations are additive and are never edited after being applied.** `scripts/apply-migrations.mjs` records a checksum for each applied file and refuses to continue if one changes.
- **Every table gets row-level security in the same migration that creates it.** `scripts/check-migrations.mjs` fails the build otherwise.
- **A table with RLS and no policy is a deliberate deny-all**, reachable only through server functions — the pattern used for payout destinations and billing customers. The checker reports these rather than failing them.
- **Views must run as the caller** (`security_invoker`) unless they carry a written justification. This rule exists because a view that did not leaked every coach's earnings to anonymous visitors (fixed in `0025`).

```bash
node scripts/check-migrations.mjs        # structure only; does not prove the SQL runs
npm --prefix web run db:migrate:dry      # what would be applied
npm --prefix web run db:migrate          # apply
```

The runner talks to Supabase's Management API using `SUPABASE_ACCESS_TOKEN`. That token is **not** used by the running application and should be revoked once schema work is finished.

---

## 3. Building the production project

Nothing here copies test data. No synthetic user, no test payment and no test credential is carried across.

1. **Create a new Supabase project.** Choose the region closest to most customers. Record its project reference.
2. **Put its values in the production environment** (Vercel, not a file on a laptop): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
3. **Apply the migrations** with a Management API token scoped to that project, then revoke the token.
4. **Set the first administrator.** Migration `0013` records one email address as the only account that may claim the admin role, and it must have a confirmed email address. Change that line for production **before** applying, or apply a follow-up migration recording the production admin address. Nothing promotes the first account to sign up.
5. **Configure authentication** in the dashboard: Site URL and the redirect allowlist (`https://talentyak.com/auth/callback`), the Google provider with the callback `https://<project-ref>.supabase.co/auth/v1/callback`, and SMTP for auth email (separate from the app's own email — see `configuration.md`).
6. **Check the storage buckets exist** — migration `0022` creates `coach-photos-pending` (private), `coach-photos` (public) and `provider-evidence` (private). No storage policy is created on purpose: uploads go through the server, which re-encodes every image.
7. **Register the Stripe webhook** at `https://talentyak.com/api/webhooks/stripe` and put *that endpoint's* signing secret in the production environment. It is not the same value as any local one.
8. **Schedule the background job** to POST `https://talentyak.com/api/jobs/process` with `Authorization: Bearer $CRON_SECRET`. `vercel.json` already declares a daily run; the endpoint refuses to run without the secret.
9. **Verify before opening the doors**, on the production project: an anonymous visitor sees only published coaches; a customer cannot read another customer; a coach cannot reach a client who is not theirs; the admin area demands a second factor. `npm run test:db` does exactly this — point it at the new project, in a maintenance window, before any real person has an account.

---

## 4. What is configuration rather than migration

These live in dashboards and must be recorded when set, because they are not in the repository: the Supabase Site URL and redirect allowlist, the Google provider client id and secret, auth SMTP, the Stripe webhook endpoint and its secret, Stripe's active currencies and payment methods, Resend's verified sending domain and DNS records, and the scheduler.

---

## 5. Backups and getting out

- Supabase takes automatic backups on paid plans; on the free plan, a scheduled `pg_dump` is the founder's responsibility. **Before any destructive change, take one.**
- The ledger is append-only, so a restore never loses the reason a number is what it is.
- Portability is deliberate: the schema is ordinary PostgreSQL, the storage buckets are S3-compatible, and the only Supabase-specific pieces are the auth schema and the RLS helper functions. Moving to another PostgreSQL host would mean replacing authentication, not rewriting the business.

---

## 6. The test project, afterwards

Once production exists, the test project stays useful for exactly what it is: a place to try migrations and run the access tests before they touch real customers. It should never hold a real customer record. If it ever does, it stops being a test project that day.
