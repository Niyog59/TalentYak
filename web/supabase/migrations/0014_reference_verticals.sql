-- Reference data · The service lines this platform knows about.
--
-- These rows are STRUCTURE, not sample content. `offers.vertical_slug` and
-- `providers.vertical_slug` are foreign keys to this table, so without a
-- `fitness` row no coach can exist and no offer can be created — in any
-- environment, production included. That is why they live in a migration and
-- not in a seed file: a seed is optional, and this is not.
--
-- Found when the access-matrix suite first ran against the real database on
-- 2026-09-16: creating an offer failed on `offers_vertical_slug_fkey`, because
-- the migrations built the table and nothing had ever put a row in it.
--
-- ---------------------------------------------------------------------------
-- What is deliberately NOT here: the `services` rows from `seed.sql`.
--
-- Those are the old platform-defined packages — "Coached" at $99/month,
-- "Premium" at $159, a $49 "Plan" — with copy claiming "certified Nepali
-- coaches" and "messaging". Every part of that has been retired by a founder
-- decision: coaches set their own prices (AAF-PLAN-01), there is no platform
-- package (SUP-01), the fixed prices are superseded (SUP-05), and nothing may
-- be claimed that has not been verified or built (invariant 9). Loading them
-- would put retired prices and unverified claims into a real table.
-- ---------------------------------------------------------------------------
--
-- Visibility. Only fitness is `active`. The others are `hidden`, which keeps
-- them registered — the vertical-as-node architecture is intact, and adding one
-- back is a status change — without advertising a service that has no
-- providers. The code-side launch gate, `PUBLIC_VERTICALS` in
-- `src/verticals/registry.ts`, is the server-enforced control on what can be
-- bought; this column keeps the database from contradicting it.
--
-- Pandit is `hidden`, not deleted. Its data model, its payout rule and its
-- tithi pipeline are all retained (AAF-BRAND-05), and invariant 1 — a human
-- confirms every ritual date — still applies in full to anything it holds.
--
-- Copy is plain and factual. Marketing language belongs in the application,
-- where it can be reviewed against what actually exists.

insert into verticals (slug, name, name_ne, tagline, description, status, sort) values
  ('fitness',
   'Fitness Coaching',
   'तन्दुरुस्ती',
   'Online coaching with independent coaches based in Nepal.',
   'Coaches set their own plans, prices and inclusions. You choose your coach and plan before you pay.',
   'active', 1),
  ('pandit',
   'Ceremonies & Rites',
   'कर्मकाण्ड',
   'Retained, not currently offered.',
   'Ancestral rites vertical. Retained with its records and rules; not publicly available.',
   'hidden', 2),
  ('tutoring',
   'Tutoring',
   'शिक्षण',
   'Not currently offered.',
   'Registered as a future service line. No providers.',
   'hidden', 3),
  ('bookkeeping',
   'Bookkeeping',
   'लेखा',
   'Not currently offered.',
   'Registered as a future service line. No providers.',
   'hidden', 4)
on conflict (slug) do nothing;

-- `on conflict do nothing`, not `do update`: if a vertical already exists, its
-- status was set deliberately — perhaps by an admin turning a service on — and
-- a migration re-asserting "hidden" over that decision would be a silent
-- reversal nobody asked for.
