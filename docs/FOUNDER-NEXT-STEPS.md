# What only you can do

**Updated 2026-09-18.** Everything on this list needs your identity, your login, your money, or a decision that is yours to make. Everything that did not is already done and checked.

Ordered so each step unblocks the next. **Items 1 to 4 are what stand between today and letting a real person use this.** Items 8 to 11 are the ones that stand between that and taking real money.

Throughout: **never paste a secret into a chat.** Put it where it belongs and tell me it is there.

---

## 1. Make email work

**Why:** right now the system cannot send a single message. Sign-up confirmations, receipts, "you have a new client", payout notices — all of them are queued and recorded as **blocked**, on purpose, because sending is not configured. It says so on the founder console rather than pretending they were sent.

**What to do**

1. Go to [resend.com](https://resend.com) → **Domains** → `talentyak.com`.
2. Resend shows you a set of DNS records. Add each one in **Cloudflare → your domain → DNS → Records**, exactly as shown. Resend's records are usually a `TXT` for signing, a `TXT` for policy and an `MX` for the sending subdomain — copy what Resend shows, do not invent any.
3. Wait for Resend to show **Verified** (usually minutes, up to a few hours).
4. Tell me it is verified and which address you want mail to come from — for example `notifications@talentyak.com`. I will put it in the environment. It is a **sending** address; nobody can read replies to it until item 2.

**Success looks like:** the domain shows Verified in Resend, and after I set the address, the founder console's "failed or blocked" list stops filling up with blocked email.

---

## 2. Create a mailbox a person actually reads

**Why:** emails currently say nothing about how to reach you, because promising a reply to an address nobody reads is worse than staying quiet.

**What to do:** in Google Workspace, create `support@talentyak.com` (or whatever you prefer) as a real mailbox or a group that lands in your inbox. Tell me the address.

**Success looks like:** customer emails carry a reply address, and a reply reaches you.

---

## 3. Turn on Google sign-in

**Why:** the "Continue with Google" button exists and works in code, but the provider is switched off in Supabase, so it cannot succeed.

**What to do**

1. **Google Cloud Console** → your project → **APIs & Services → Credentials** → create an **OAuth client ID** of type **Web application**.
2. Under *Authorised redirect URIs*, add exactly:
   `https://lbqgucirksrafxscgkzg.supabase.co/auth/v1/callback`
3. Copy the **client ID** and **client secret**.
4. **Supabase dashboard** → your project → **Authentication → Providers → Google** → enable it and paste both values there. They belong in Supabase, not in this app's settings.

**Success looks like:** you tell me it is on; I sign in with Google on a test account and land on the account page.

**Note:** the only permissions requested are your name, email address and profile picture. No Calendar access — TalentYak builds its own scheduling later.

---

## 4. Add the site addresses to Supabase

**Why:** confirmation and password-reset links currently come back to `localhost`. For anyone who is not sitting at this laptop, that link is broken.

**What to do:** **Supabase → Authentication → URL Configuration**. Set **Site URL** to `https://talentyak.com`, and add these to **Redirect URLs**:

```
https://talentyak.com/auth/callback
https://talentyak.com/**
http://localhost:3001/auth/callback
```

**Success looks like:** a confirmation email opened on a phone lands on the real site.

---

## 5. Revoke the database token

**Why:** I asked you to create a Supabase personal access token so schema changes could be applied. It is powerful, the running app never uses it, and schema work for this batch is finished.

**What to do:** Supabase → account → **Access Tokens** → revoke the one you created for this work. If more schema changes are needed later, you can issue another in a minute.

**Success looks like:** the token no longer exists. Nothing in the app stops working.

---

## 6. Deploy, then connect Stripe's webhook

**Why:** Stripe confirms payments by calling a public web address. There isn't one yet, so locally I proved this by replaying **real Stripe test events** into the app. The deployed endpoint still needs registering, and it has its **own** signing secret.

**What to do**

1. Connect the repository to **Vercel** and deploy. Set every variable listed in `docs/operations/configuration.md` in Vercel's environment settings.
   **Watch out:** Vercel's fork protection silently blocks deployments whose commit author is not a team member. Your commits currently use a personal email — see item 11.
2. **Stripe → Developers → Webhooks → Add endpoint**: `https://talentyak.com/api/webhooks/stripe`. Subscribe to checkout, invoice, subscription, charge, refund and dispute events.
3. Copy that endpoint's **signing secret** into Vercel as `STRIPE_WEBHOOK_SECRET`.
4. In Vercel, confirm the scheduled job is running (it posts to `/api/jobs/process` with the `CRON_SECRET`).

**Success looks like:** Stripe's dashboard shows the endpoint returning 200, and a test purchase on the deployed site appears in the founder console without anyone touching the database.

---

## 7. Make one test purchase yourself

**Why:** finishing a payment on Stripe's page means typing card details, which I do not do. Everything after the card — the webhook, the ledger, the coach's earnings — is already proven with real Stripe test events. This closes the one remaining gap.

**What to do:** on the deployed site (or locally), sign up as a test customer, choose a coach's plan, and on Stripe's page use the test card `4242 4242 4242 4242`, any future expiry, any three-digit code. This is Stripe's public test card; it is not a real card and no money moves.

**Success looks like:** the return page says you're in, the plan shows on your account, the coach sees the client, and the founder console shows the payment split 80/20.

---

## 8. Approve the money rules — or leave them switched off

**Why:** I built and tested all of these as working defaults, and **every one is switched off** until you approve it, because a rule this codebase invented must not reach a customer by accident. Nothing can be sold for real money until they are settled.

**a. Who pays transfer and currency-conversion fees when a coach in Nepal is paid?** Today the platform absorbs them out of its 20%, so the coach's 80% means exactly what it says.

**b. What happens when someone cancels a prepaid multi-month package?** Today prepaid packages **cannot be sold at all**. Monthly billing is unaffected.

**c. What happens when a renewal payment fails?** Today no new coaching period is granted after the paid-through date. The alternative is a grace period, which is kinder but gives away a coach's time on a promise.

**d. Which countries can you sell in, and how will coaches in Nepal actually be paid?** Today **no country is activated and no payout route is approved**. Your Stripe account being American does not make either true.

**Success looks like:** you answer each, I record it in the decision register, and the switch flips from "sandbox" to "approved".

---

## 9. Find out how you will really pay coaches in Nepal

**Why:** this is the one I could not design around, because I found no evidence any particular route works for US-business-to-Nepal-coach commercial payouts. The system therefore never moves money itself: it prepares a batch, you make the transfers, and you record each one with its reference. That works, but you need a route.

**What to do:** ask two or three services directly what they support for paying contractors in Nepal from a US business — including fees, limits and documentation. Then tell me which one you chose.

**Success looks like:** a named route, its fees, and who absorbs them (item 8a).

---

## 10. Get the terms of service and privacy notice finished

**Why:** the ones in the product are clearly labelled drafts, and the live gate refuses real payments while they are. Customers are agreeing to something at checkout; it should be real.

**What to do:** have final documents prepared — they need to cover subscriptions and cancellation, refunds, that coaching is delivered by independent coaches, health disclaimers, and what happens to personal and health data. Send them to me and I will put them in the product with a version and a date.

**Success looks like:** the drafts label disappears and that lock opens.

---

## 11. Business accounts, when you are ready

- **A business GitHub account.** The repository is under your personal account with your personal commit email. This matters the moment Vercel is connected — see item 6.
- **Set up your own second factor** on the admin account: it guards coach payout details and customer records, and the founder console refuses to open without it.
- **Stripe business and bank verification**, in Stripe's own dashboard. Never send identity or bank documents through chat.

---

## What I have not done, and why

- **Nothing is committed or pushed.** Your rules say stop before committing; the work is sitting in the project folder, ready for you to review.
- **Nothing is deployed.**
- **No real money has moved**, and no real card was ever entered anywhere.
- **No email reached anybody.** Test accounts use a reserved address that cannot receive mail.
- **I have not edited `docs/HANDOVER.md`** — it is yours.
- **No account, subscription or paid service was created.**
