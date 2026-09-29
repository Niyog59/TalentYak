# Account email links — confirmation, password reset, sign-in link

**Written 2026-09-29.** Why emailed account links used to "expire" at once, how they work now, and the one-time dashboard changes that switch them over. No secret belongs in this file.

## What was wrong

Supabase's default email link verifies itself the moment anything opens it, then hands the site a one-time code that only **the browser that asked for the email** can use. Reproduced against a local Supabase auth server:

| Situation | Old result |
|---|---|
| Asked and opened in the same browser | Worked |
| Asked on a laptop, opened on a phone, in the Gmail app, or in another browser | "That link has expired…" |
| A mail scanner or link preview opened it first | Link used up; the person then saw "Google sign-in was cancelled" |

## How it works now

1. The email links to **`/auth/confirm`** on the site. The one-time token is after the `#`, which browsers never send to a server, so it stays out of request logs and referrers.
2. Opening the page verifies nothing. The person presses **Continue**; only that button sends the token, once, to the server.
3. The server checks the token with Supabase (`verifyOtp` with the token hash — Supabase's supported method for links that work in any browser). Only if it works does it sign out whoever else was signed in on that browser and sign the link's owner in.
4. Confirmation and sign-in links go on to where the person was heading (for example the package they chose). Reset links always go to *Choose a new password*. A second factor, if set up, is still asked for first.

Tokens stay single-use and time-limited (Supabase decides both). Failures are told apart only where it helps: *already used or too old*, *incomplete link*, *too many attempts*, *couldn't check — nothing was used*. Each offers a new link. Nothing reveals whether an address has an account.

Code: `web/src/lib/auth-links.ts` (rules, unit-tested), `web/src/app/(marketing)/auth/confirm/` (page, button, server action). `/auth/callback` stays for Google sign-in and for emails sent before the switch.

## Switching over — in this order

Each step is safe on its own, so an email never points at a page that doesn't exist.

1. **Merge the pull request** and let Vercel deploy it. Old emails keep working exactly as before.
2. **Check the page is live:** open `https://www.talentyak.com/auth/confirm?type=recovery`. It should say *Reset your password* and *This link is incomplete*.
3. **Supabase → Authentication → URL Configuration.** Confirm (no change expected):
   - Site URL: `https://www.talentyak.com`
   - Redirect URLs include `https://www.talentyak.com/**`
4. **Supabase → Authentication → Emails → Templates.** Replace three templates with the files in `docs/operations/auth-email-templates/` (copy the whole file into the message body):

   | Template | Subject | Body file |
   |---|---|---|
   | Confirm signup | `Confirm your email for TalentYak` | `confirm-signup.html` |
   | Magic Link | `Your TalentYak sign-in link` | `magic-link.html` |
   | Reset Password | `Reset your TalentYak password` | `reset-password.html` |

   Leave *Invite user*, *Change email address* and *Reauthentication* alone — TalentYak doesn't send them.
5. **Resend → Domains → `talentyak.com` → turn Click Tracking off** (and Open Tracking, if on). Supabase's auth email goes through Resend's SMTP; with click tracking on, Resend rewrites every link through its own server, which then sees the sign-in token. Not checked from here — it needs the Resend dashboard.
6. **Test it for real:** on a laptop, ask for a password reset; open the email on your phone; press Continue; set a password; sign in with it on the laptop.

**Undo:** in step 4, press *Reset to default* on each template. Links go back to the old behaviour; the site handles both.

## Settings worth knowing

- Link lifetime: **Supabase → Authentication → Providers → Email → Email OTP Expiration** (default 3600 seconds). One hour is sensible.
- Email sending limits are Supabase's and Resend's; the site also rate-limits requests for links and presses of Continue.
