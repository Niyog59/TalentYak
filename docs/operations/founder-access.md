# Founder access — signing in, two-step verification and recovery

**Written 2026-09-28 (M17).** No password, code, secret or recovery value belongs in this file, in a commit, in a chat or in a report. If one ever lands somewhere it shouldn't, change it — don't argue that it's probably fine.

## Where you sign in

1. Go to **`/admin`** on the site (for example `https://www.talentyak.com/admin`).
2. If you aren't signed in you're sent to the normal sign-in page. Sign in with the founder account's email and password.
3. You're then asked for a **6-digit code from your authenticator app**. Without it the panel doesn't open, and the database refuses every administrator action even if a page were reached some other way.

The founder panel is only for accounts with the administrator role **and** a completed two-step sign-in in the current session. It is checked on every page, every action and every database function, not only in the navigation.

## How an account becomes the founder account (never self-service)

- Public sign-up always creates an ordinary client account. Nothing on the website can make an account an administrator.
- The first administrator address was recorded deliberately in a database migration (`0013_admin_bootstrap.sql`). The first time an account with exactly that address, with a **confirmed email**, signs in, it's promoted once. After that the record is marked used and can never promote anyone again.
- **Adding another administrator** is done by the project owner in the Supabase dashboard (SQL editor), by changing that person's role. The change is written to the role history automatically. Only do this for someone you trust with contractor payout details and grief data; they must set up two-step verification before the panel opens for them.
- **Removing an administrator**: set their role back to `customer` the same way. Suspending an administrator is deliberately not possible from the panel, so the founder can't be locked out by a mis-click.

## Setting and changing your credentials

- **Change your password** while signed in: *Sign-in security* (`/account/security`) → *Password*. You'll need your current password, and your two-step code first.
- **Forgot it**: *Forgot password* on the sign-in page sends a one-time link to the founder email.
- **Two-step verification**: *Sign-in security* → add an authenticator app (Google Authenticator, 1Password, Authy or similar).
- **Sign out everywhere**: *Sign-in security* → *Sign out on all devices*. Use it after changing your password if you think it was exposed.

## Recovery codes — and what replaces them

The sign-in provider (Supabase) does not issue printable recovery codes. Its equivalent is **more than one authenticator device**:

1. Add a second authenticator now: a password manager that stores codes, or a second phone or tablet kept somewhere safe.
2. The panel won't let the founder remove their **last** device, so you can't accidentally lock yourself out.

## If every authenticator device is lost

1. The project owner signs in to the **Supabase dashboard** (that account must itself have two-step verification switched on — check it).
2. Authentication → Users → find the founder account → remove its authenticator factors.
3. Sign in to TalentYak with the password, go straight to *Sign-in security*, and add **two** authenticator devices.
4. Note in the decision register or the operations log that a recovery happened and when. Never record the codes themselves.

If the founder email account itself is lost, recover that first with the email provider. The Supabase dashboard can change an account's email if necessary.

## Test and production

The panel shows three labels at the top of every page: **Site** (production, preview or local), **Database** (test or production) and **Payments** (Stripe test or live). Today the production website uses the **shared test database**, and the Database label is shown as a warning. A separate production database is a launch blocker.

When a production database is created, mark it once in its SQL editor:

```sql
update platform_environment set kind = 'production', note = 'Production', updated_at = now();
```

Feature switches live in each database, so test and production settings stay separate automatically.
