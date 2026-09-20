-- M03 · Identity hardening and profile fields.
--
-- Additive only. No existing migration is edited, no table is dropped, no row
-- is deleted.
--
-- The first half of this migration closes a privilege-escalation hole. The
-- policy created in 0001 was:
--
--     create policy "update own profile" on profiles
--       for update using (auth.uid () = id);
--
-- The problem is NOT the missing WITH CHECK — Postgres defaults that to the
-- USING expression, so the row is correctly pinned to its owner. The problem is
-- that `auth.uid() = id` is still true after the row changes. A signed-in
-- customer could run
--
--     update profiles set role = 'admin' where id = auth.uid();
--
-- and the predicate holds before and after, so the policy permits it. They
-- become an administrator. `is_admin()` reads that same column, so the
-- escalation is immediate and total: admin sees contractor tax details, payout
-- destinations, and families' grief data.
--
-- RLS has no way to express "this column is off limits" — a policy is evaluated
-- per row, not per column. So the fix is a trigger that restores the privileged
-- columns unless the writer is genuinely privileged. The policy below is
-- rewritten only to state the WITH CHECK explicitly, which changes no behaviour
-- and stops the next reader assuming the omission was the bug.

-- ---------------------------------------------------------------------------
-- 1. Who is allowed to write privileged columns
-- ---------------------------------------------------------------------------

-- The role carried by the request's JWT. 'service_role' for our own server
-- functions, 'authenticated' for a signed-in person, 'anon' otherwise.
create or replace function jwt_role ()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    ''
  );
$$;

comment on function jwt_role () is
  'Role from the request JWT. Empty string when there is no JWT, e.g. a direct psql session.';

-- True for our server functions and for migrations run directly against the
-- database. Deliberately NOT true for an ordinary signed-in user, however they
-- shape their request.
create or replace function is_privileged_writer ()
returns boolean
language sql
stable
as $$
  select jwt_role () = 'service_role'
      or current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin');
$$;

comment on function is_privileged_writer () is
  'Server-side writer: service role, or a direct superuser session such as a migration.';

-- ---------------------------------------------------------------------------
-- 2. Profile fields needed by account setup (M04)
-- ---------------------------------------------------------------------------

alter table profiles
  add column if not exists preferred_name text,
  -- IANA identifier, e.g. 'America/Chicago' or 'Asia/Kathmandu'. Never a UTC
  -- offset: offsets change twice a year and cannot describe a recurring time.
  add column if not exists timezone text,
  add column if not exists locale text not null default 'en',
  -- What the customer would LIKE to see prices in. This is a display
  -- preference and never the currency they are charged in — the two are kept
  -- apart everywhere, in the data and in the interface.
  add column if not exists display_currency text,
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists privacy_version text,
  add column if not exists privacy_accepted_at timestamptz,
  -- Optional, and never labelled "verified" unless it actually was. No SMS
  -- provider is configured, so today this can only ever be false.
  add column if not exists phone_verified boolean not null default false,
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text;

-- A timezone must look like an IANA identifier. Postgres cannot fully validate
-- one without pg_timezone_names, but it can reject an offset like '+05:45',
-- which is the mistake that actually gets made.
alter table profiles
  drop constraint if exists profiles_timezone_iana;
alter table profiles
  add constraint profiles_timezone_iana
  check (timezone is null or timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$');

alter table profiles
  drop constraint if exists profiles_display_currency_format;
alter table profiles
  add constraint profiles_display_currency_format
  check (display_currency is null or display_currency ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------
-- 3. Freeze the privileged columns
-- ---------------------------------------------------------------------------

create table if not exists role_changes (
  id uuid primary key default gen_random_uuid (),
  profile_id uuid not null references profiles (id) on delete cascade,
  from_role user_role,
  to_role user_role,
  changed_by uuid references profiles (id),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists role_changes_profile_idx on role_changes (profile_id, created_at desc);

alter table role_changes enable row level security;

-- Deny by default: no policy for anyone but admin. A role change is an audit
-- record, and the subject of one has no business editing it.
create policy "admin reads role changes" on role_changes
  for select using (is_admin ());

create or replace function guard_profile_privileged_columns ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_privileged_writer () then
    if new.role is distinct from old.role then
      insert into role_changes (profile_id, from_role, to_role, changed_by)
      values (old.id, old.role, new.role, auth.uid ());
    end if;
    return new;
  end if;

  -- Anyone else keeps the values they had, silently and without error. Raising
  -- here would leak which columns are privileged and turn an ordinary profile
  -- save into a failure for a user who did nothing wrong.
  new.role := old.role;
  new.suspended_at := old.suspended_at;
  new.suspended_reason := old.suspended_reason;
  new.phone_verified := old.phone_verified;
  new.id := old.id;
  new.email := old.email;
  new.created_at := old.created_at;

  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged on profiles;
create trigger profiles_guard_privileged
  before update on profiles
  for each row execute function guard_profile_privileged_columns ();

-- Replace the 0001 policy, which had no WITH CHECK. The trigger above is what
-- actually protects the columns; this stops a user rewriting the row's identity
-- to point at somebody else.
drop policy if exists "update own profile" on profiles;
create policy "update own profile" on profiles
  for update
  using (auth.uid () = id)
  with check (auth.uid () = id);

-- Nobody inserts a profile directly. Rows are created by the handle_new_user()
-- trigger on auth.users, which runs as the definer. With RLS enabled and no
-- INSERT policy, a direct insert is denied — which is the intent.

-- ---------------------------------------------------------------------------
-- 4. Suspension must survive an existing session
-- ---------------------------------------------------------------------------

-- A suspended coach may still hold a valid access token. Revoking the token is
-- not enough on its own, and waiting for it to expire is not a control. Every
-- access rule that grants a provider anything is written in terms of this
-- function, so suspension takes effect on the next query rather than the next
-- login.
create or replace function is_active_user ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid () and suspended_at is null
  );
$$;

comment on function is_active_user () is
  'False for a suspended account even while its session token is still valid.';

-- is_admin() must also respect suspension: an admin under investigation should
-- not keep admin reach because their token has not expired yet.
create or replace function is_admin ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid ()
      and role = 'admin'
      and suspended_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. First-admin bootstrap
-- ---------------------------------------------------------------------------

-- The first administrator cannot be "whoever signs up first", and it cannot be
-- "anyone with an @talentyak.com address" — both hand the account to whoever
-- gets there first. Instead the founder's intended address is recorded here
-- deliberately, and a matching account is promoted exactly once.
create table if not exists admin_bootstrap (
  id boolean primary key default true,
  email text not null,
  claimed_by uuid references profiles (id),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  -- Exactly one row, ever.
  constraint admin_bootstrap_singleton check (id)
);

alter table admin_bootstrap enable row level security;

-- Deny-all: RLS enabled with zero policies. Only server functions reach this
-- table. Per CLAUDE.md this is the correct pattern, not a missing policy.

create or replace function claim_admin_bootstrap (claimant uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  row admin_bootstrap%rowtype;
  claimant_email text;
begin
  if not is_privileged_writer () then
    raise exception 'admin bootstrap may only be claimed by a server function';
  end if;

  select * into row from admin_bootstrap where id limit 1;
  if not found or row.claimed_at is not null then
    return false;
  end if;

  select email into claimant_email from profiles where id = claimant;
  if claimant_email is null or lower(claimant_email) <> lower(row.email) then
    return false;
  end if;

  update profiles set role = 'admin' where id = claimant;
  update admin_bootstrap
    set claimed_by = claimant, claimed_at = now()
    where id;

  return true;
end;
$$;

comment on function claim_admin_bootstrap (uuid) is
  'Promotes the one pre-recorded address to admin, once. Returns false if already claimed or the email does not match.';

-- ---------------------------------------------------------------------------
-- 6. Indexes the existing schema is missing (ARCHITECTURE.md §3.6)
-- ---------------------------------------------------------------------------

-- Scanned by every subscription renewal webhook.
create index if not exists bookings_stripe_subscription_idx
  on bookings (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- Used by the provider RLS subquery on every coach page load.
create index if not exists bookings_provider_idx on bookings (provider_id);
create index if not exists bookings_service_idx on bookings (service_id);
create index if not exists bookings_vertical_idx on bookings (vertical_slug);
create index if not exists providers_profile_idx on providers (profile_id);
create index if not exists providers_vertical_idx on providers (vertical_slug);
create index if not exists services_vertical_idx on services (vertical_slug);
create index if not exists intake_schemas_service_idx on intake_schemas (service_id);
create index if not exists payments_invoice_idx on payments (stripe_invoice_id)
  where stripe_invoice_id is not null;
create index if not exists payments_session_idx on payments (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create index if not exists payout_ledger_payment_idx on payout_ledger (payment_id);
create index if not exists payout_ledger_booking_idx on payout_ledger (booking_id);
create index if not exists payout_ledger_batch_idx on payout_ledger (batch_id);
create index if not exists recordings_booking_idx on recordings (booking_id);
create index if not exists notification_jobs_booking_idx on notification_jobs (booking_id);
create index if not exists ceremonies_provider_idx on ceremonies (pandit_provider_id);
create index if not exists shraddha_dates_customer_idx on shraddha_dates (customer_id);
create index if not exists programs_coach_idx on programs (coach_provider_id);
create index if not exists program_days_program_idx on program_days (program_id);
create index if not exists exercises_day_idx on exercises (program_day_id);
create index if not exists workout_logs_booking_idx on workout_logs (booking_id);
create index if not exists set_logs_log_idx on set_logs (workout_log_id);
create index if not exists bodyweight_logs_booking_idx on bodyweight_logs (booking_id);
create index if not exists measurements_booking_idx on measurements (booking_id);
create index if not exists progress_photos_booking_idx on progress_photos (booking_id);
