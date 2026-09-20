-- M03 · Provider identity, approval, public profile, and private records.
--
-- Additive. `providers` keeps its primary key and every existing row, so any
-- historical booking, ledger entry, or ceremony that points at a provider still
-- resolves.
--
-- The central idea: a provider is FOUR different things with four different
-- audiences, and putting them in one table means a row restriction is the only
-- thing standing between a public profile page and a contractor's bank details.
-- Row restrictions do not hide columns. So:
--
--   providers                     the core record and its lifecycle state
--   provider_public_profiles      only what the provider consented to publish
--   provider_private              vetting notes and internal assessment
--   provider_payout_destinations  where money would be sent
--   provider_credentials          evidence supporting a claimed qualification
--
-- The last three are deny-by-default with no policy for the provider at all
-- where the data is about them rather than theirs.

-- ---------------------------------------------------------------------------
-- 1. Lifecycle
-- ---------------------------------------------------------------------------

-- Accepting an invitation is not being reviewed. Being reviewed is not being
-- approved. Being approved is not being published. Each is a separate state
-- because each is a separate decision, and collapsing them is how an unvetted
-- person ends up on a public page.
do $$ begin
  create type provider_status as enum (
    'invited',    -- invitation issued, not yet accepted
    'onboarding', -- account linked, filling in their profile
    'submitted',  -- they have asked for review
    'in_review',  -- we are checking credentials
    'approved',   -- checked; may publish and take clients
    'paused',     -- approved, but not accepting new clients right now
    'suspended',  -- access revoked pending resolution
    'retired'     -- gone, with history preserved
  );
exception when duplicate_object then null; end $$;

alter table providers
  add column if not exists status provider_status not null default 'onboarding',
  add column if not exists slug text,
  -- Capacity. `services.capacity_limit` has existed since 0002 and has never
  -- been read; coach capacity belongs to the coach, not to a catalog row.
  add column if not exists max_active_clients int,
  add column if not exists accepting_new_clients boolean not null default false,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references profiles (id),
  add column if not exists published_at timestamptz,
  add column if not exists suspended_at timestamptz,
  add column if not exists timezone text;

alter table providers
  drop constraint if exists providers_slug_format;
alter table providers
  add constraint providers_slug_format
  check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

create unique index if not exists providers_slug_key on providers (slug) where slug is not null;

alter table providers
  drop constraint if exists providers_capacity_sane;
alter table providers
  add constraint providers_capacity_sane
  check (max_active_clients is null or max_active_clients > 0);

alter table providers
  drop constraint if exists providers_timezone_iana;
alter table providers
  add constraint providers_timezone_iana
  check (timezone is null or timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$');

-- One login may hold at most one provider record. Without this, two provider
-- rows could point at the same person and the capacity checks would each see
-- half the truth.
create unique index if not exists providers_profile_key
  on providers (profile_id) where profile_id is not null;

comment on column providers.payout_reference is
  'DEPRECATED. Superseded by provider_payout_destinations, which is deny-by-default. Retained under the node protection rule so historical rows stay readable; no new value may be written here.';

comment on column providers.founding is
  'Historical marker only. Superseded by the versioned commission policy; it no longer affects any split.';

-- A provider is only publicly visible when approved AND published. Two
-- conditions, because approving someone is not the same as them being ready
-- for the world to see.
create or replace function provider_is_public (p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from providers
    where id = p_id
      and status = 'approved'
      and published_at is not null
      and suspended_at is null
      and active
  );
$$;

-- Am I this provider, and am I still allowed in? A suspended coach keeps a
-- valid session token; every provider-facing rule goes through here so that
-- suspension bites on the next query rather than the next login.
create or replace function is_active_provider (p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from providers p
    join profiles pr on pr.id = p.profile_id
    where p.id = p_id
      and p.profile_id = auth.uid ()
      and p.suspended_at is null
      and p.status <> 'suspended'
      and pr.suspended_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Public profile — consented fields only
-- ---------------------------------------------------------------------------

create table if not exists provider_public_profiles (
  provider_id uuid primary key references providers (id) on delete cascade,
  display_name text not null,
  headline text,
  bio text,
  approach text,
  -- Free text the provider wrote about themselves. Everything in this table is
  -- hostile input: it is sanitised and length-capped in the server action
  -- before it arrives, and escaped on the way out.
  specialties text[] not null default '{}',
  languages text[] not null default '{}',
  experience_since date,
  -- Path in the PUBLIC bucket, and only ever a re-encoded, EXIF-stripped copy
  -- that an admin approved. The original stays private.
  photo_path text,
  photo_consent_at timestamptz,
  -- A draft the provider is editing, versus what the world currently sees.
  published_revision int not null default 0,
  draft_revision int not null default 1,
  updated_at timestamptz not null default now(),
  constraint provider_public_bio_length check (bio is null or length(bio) <= 4000),
  constraint provider_public_headline_length check (headline is null or length(headline) <= 200),
  constraint provider_public_specialties_count check (cardinality(specialties) <= 12),
  constraint provider_public_languages_count check (cardinality(languages) <= 12)
);

create index if not exists provider_public_profiles_updated_idx
  on provider_public_profiles (updated_at desc);

alter table provider_public_profiles enable row level security;

-- Anonymous visitors see published profiles of approved providers, and nothing
-- else. Note what is absent from this table: no payout reference, no vetting
-- note, no contact address, no document.
create policy "public reads published profiles" on provider_public_profiles
  for select using (provider_is_public (provider_id));

create policy "provider reads own profile" on provider_public_profiles
  for select using (is_active_provider (provider_id));

create policy "provider edits own profile" on provider_public_profiles
  for update
  using (is_active_provider (provider_id))
  with check (is_active_provider (provider_id));

create policy "provider creates own profile" on provider_public_profiles
  for insert with check (is_active_provider (provider_id));

create policy "admin manages public profiles" on provider_public_profiles
  for all using (is_admin ()) with check (is_admin ());

drop trigger if exists provider_public_profiles_touch on provider_public_profiles;
create trigger provider_public_profiles_touch
  before update on provider_public_profiles
  for each row execute function touch_updated_at ();

-- Publication is not something a provider grants themselves. The column lives
-- on `providers`, which they cannot write, and only a server function or an
-- admin sets it.
create or replace function guard_provider_publication ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_privileged_writer () or is_admin () then
    return new;
  end if;

  new.status := old.status;
  new.published_at := old.published_at;
  new.approved_at := old.approved_at;
  new.approved_by := old.approved_by;
  new.suspended_at := old.suspended_at;
  new.profile_id := old.profile_id;
  new.founding := old.founding;
  new.payout_reference := old.payout_reference;
  new.max_active_clients := old.max_active_clients;

  return new;
end;
$$;

drop trigger if exists providers_guard_publication on providers;
create trigger providers_guard_publication
  before update on providers
  for each row execute function guard_provider_publication ();

-- A provider may set exactly one thing about their own core record: whether
-- they are open to new clients. Everything else on `providers` is frozen above.
create policy "provider updates own availability" on providers
  for update
  using (is_active_provider (id))
  with check (is_active_provider (id));

-- ---------------------------------------------------------------------------
-- 3. Private records — deny by default
-- ---------------------------------------------------------------------------

-- Internal assessment. The provider is the SUBJECT of these notes, not their
-- owner, and letting them read notes written about them would quietly turn an
-- honest assessment into a diplomatic one. RLS on, admin only.
create table if not exists provider_private (
  provider_id uuid primary key references providers (id) on delete cascade,
  legal_name text,
  contact_email text,
  contact_phone text,
  country text,
  vetting_notes text,
  risk_notes text,
  internal_rating text,
  updated_at timestamptz not null default now()
);

alter table provider_private enable row level security;

create policy "admin manages provider private" on provider_private
  for all using (is_admin ()) with check (is_admin ());

drop trigger if exists provider_private_touch on provider_private;
create trigger provider_private_touch
  before update on provider_private
  for each row execute function touch_updated_at ();

-- Where money would be sent. Deny-all: not even the provider reads this
-- directly. The application shows them a masked summary through a server
-- function, because an access token in a browser should never be one query
-- away from a full bank reference.
create table if not exists provider_payout_destinations (
  id uuid primary key default gen_random_uuid (),
  provider_id uuid not null references providers (id) on delete cascade,
  -- Deliberately not named for a vendor: no corridor has been verified, and
  -- naming the column 'payoneer_id' would be a claim we cannot support.
  channel text not null,
  -- Store the minimum the approved transfer route actually needs.
  account_reference text not null,
  account_holder_name text,
  country text,
  currency text not null default 'USD',
  -- A changed destination cannot go straight into a payout. It is reviewed,
  -- and the review is a separate act from the change.
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review', 'approved', 'rejected')),
  reviewed_by uuid references profiles (id),
  reviewed_at timestamptz,
  -- Set when superseded. Rows are never updated in place, so the history of
  -- where money was sent stays intact.
  superseded_at timestamptz,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  constraint provider_payout_currency_format check (currency ~ '^[A-Z]{3}$')
);

-- At most one live destination per provider.
create unique index if not exists provider_payout_destinations_current
  on provider_payout_destinations (provider_id)
  where superseded_at is null;

create index if not exists provider_payout_destinations_provider_idx
  on provider_payout_destinations (provider_id, created_at desc);
create index if not exists provider_payout_destinations_review_idx
  on provider_payout_destinations (review_state)
  where superseded_at is null;

alter table provider_payout_destinations enable row level security;

-- RLS enabled, ZERO policies. Deny-all. Server functions only.
-- This is the correct pattern for this data, not a missing policy.

-- Evidence supporting a qualification: certificates, identity documents,
-- registration numbers. Private bucket, admin review, never public.
create table if not exists provider_credentials (
  id uuid primary key default gen_random_uuid (),
  provider_id uuid not null references providers (id) on delete cascade,
  kind text not null,
  -- What the provider says they hold.
  claimed_title text not null,
  issuing_body text,
  claimed_reference text,
  issued_on date,
  expires_on date,
  -- Path in the PRIVATE evidence bucket. Never served without a short-lived,
  -- requester-scoped signed URL.
  evidence_path text,
  -- What we actually confirmed, which is often less than what was claimed.
  -- Invariant 9: we state only the precision we verified.
  verification_state text not null default 'unverified'
    check (verification_state in ('unverified', 'in_review', 'verified', 'rejected', 'expired')),
  verified_detail text,
  verified_by uuid references profiles (id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists provider_credentials_provider_idx
  on provider_credentials (provider_id);
create index if not exists provider_credentials_state_idx
  on provider_credentials (verification_state);

alter table provider_credentials enable row level security;

-- The provider may see and add their own claims, and see the outcome. They may
-- not write the outcome — a coach marking their own certificate "verified" is
-- the whole failure mode this table exists to prevent.
create policy "provider reads own credentials" on provider_credentials
  for select using (is_active_provider (provider_id));

create policy "provider adds own credentials" on provider_credentials
  for insert with check (is_active_provider (provider_id));

create policy "admin manages credentials" on provider_credentials
  for all using (is_admin ()) with check (is_admin ());

create or replace function guard_credential_verification ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_privileged_writer () or is_admin () then
    return new;
  end if;
  new.verification_state := old.verification_state;
  new.verified_detail := old.verified_detail;
  new.verified_by := old.verified_by;
  new.verified_at := old.verified_at;
  new.provider_id := old.provider_id;
  return new;
end;
$$;

drop trigger if exists provider_credentials_guard on provider_credentials;
create trigger provider_credentials_guard
  before update on provider_credentials
  for each row execute function guard_credential_verification ();

-- ---------------------------------------------------------------------------
-- 4. Coach invitations
-- ---------------------------------------------------------------------------

-- Admin-issued, expiring, single-use. This replaces linking a coach to a login
-- by hand-written SQL, which is how `providers.profile_id` came to be a column
-- that was read but never written (a coach could not sign in at all).
--
-- Only a hash of the token is stored. A leaked database backup should not
-- contain usable invitations.
create table if not exists coach_invitations (
  id uuid primary key default gen_random_uuid (),
  email text not null,
  token_hash text not null unique,
  provider_id uuid references providers (id) on delete set null,
  vertical_slug text not null references verticals (slug),
  invited_by uuid references profiles (id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references profiles (id),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists coach_invitations_email_idx on coach_invitations (lower(email));
create index if not exists coach_invitations_expiry_idx on coach_invitations (expires_at)
  where accepted_at is null and revoked_at is null;

-- One live invitation per address. Re-inviting revokes the previous one rather
-- than leaving two valid tokens in the world.
create unique index if not exists coach_invitations_live_email
  on coach_invitations (lower(email))
  where accepted_at is null and revoked_at is null;

alter table coach_invitations enable row level security;

-- Deny-all for everyone but admin. The invitee never queries this table: they
-- present their token to a server action, which looks it up with the service
-- role. An invitee who could read the table could read everyone else's
-- invitations.
create policy "admin manages invitations" on coach_invitations
  for all using (is_admin ()) with check (is_admin ());

-- ---------------------------------------------------------------------------
-- 5. A safe public view
-- ---------------------------------------------------------------------------

-- What the coach directory renders. A view rather than a table so there is
-- exactly one definition of "publicly visible", and columns that must never be
-- public simply are not selectable.
create or replace view public_coach_directory as
  select
    p.id as provider_id,
    p.slug,
    p.vertical_slug,
    p.accepting_new_clients,
    p.timezone,
    pp.display_name,
    pp.headline,
    pp.bio,
    pp.approach,
    pp.specialties,
    pp.languages,
    pp.experience_since,
    pp.photo_path
  from providers p
  join provider_public_profiles pp on pp.provider_id = p.id
  where provider_is_public (p.id);

comment on view public_coach_directory is
  'The only shape in which provider data reaches an anonymous visitor. Adding a column here is a decision about disclosure, not a convenience.';
