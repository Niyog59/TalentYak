-- M03 · Coach-owned offers, immutable published versions, prices, capacity.
--
-- This inverts the ownership model of `services`, which is a platform-global
-- catalog with no provider foreign key. `services` is NOT dropped — the pandit
-- vertical still uses it and historical bookings still point at it. Offers are
-- a parallel concept with a different owner, not a replacement for it.
--
-- The rule that shapes this file: **a published version is immutable.** Editing
-- a price must never change what an existing customer agreed to pay. So an
-- offer is a container, a version is a frozen contract, and publishing a new
-- price creates a new version rather than updating a row.

do $$ begin
  create type service_type as enum ('recurring_coaching', 'one_off_consultation');
exception when duplicate_object then null; end $$;

comment on type service_type is
  'Classification is by SERVICE, not by how many times it is billed. A six-month package paid once is recurring_coaching.';

do $$ begin
  create type billing_structure as enum (
    'monthly_recurring',        -- billed every month, cancellable at period end
    'monthly_under_commitment', -- billed monthly for a stated number of months
    'prepaid_term',             -- whole term paid once, allocated across periods
    'single_payment'            -- one-off
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type offer_status as enum ('draft', 'published', 'paused', 'archived');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. Offers
-- ---------------------------------------------------------------------------

create table if not exists offers (
  id uuid primary key default gen_random_uuid (),
  provider_id uuid not null references providers (id) on delete cascade,
  vertical_slug text not null references verticals (slug),
  slug text not null,
  status offer_status not null default 'draft',
  -- Selling and serving are different things. Archiving an offer stops new
  -- sales; it does not abandon the customers already on it, whose obligations
  -- stay visible.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offers_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create unique index if not exists offers_provider_slug_key on offers (provider_id, slug);
create index if not exists offers_provider_idx on offers (provider_id);
create index if not exists offers_status_idx on offers (status);
create index if not exists offers_vertical_idx on offers (vertical_slug);

drop trigger if exists offers_touch on offers;
create trigger offers_touch before update on offers
  for each row execute function touch_updated_at ();

-- ---------------------------------------------------------------------------
-- 2. Offer versions — immutable once published
-- ---------------------------------------------------------------------------

create table if not exists offer_versions (
  id uuid primary key default gen_random_uuid (),
  offer_id uuid not null references offers (id) on delete cascade,
  version int not null,

  title text not null,
  description text not null default '',
  service_type service_type not null,
  billing_structure billing_structure not null,

  -- Billing shape. A six-month prepaid term and six monthly charges under a
  -- commitment are different products and are modelled as different rows.
  billing_interval text check (billing_interval in ('month', 'year')),
  billing_interval_count int check (billing_interval_count > 0),
  term_months int check (term_months > 0),
  -- No auto-renewal unless its terms were shown and accepted.
  auto_renews boolean not null default false,

  -- The comparable inclusions. These are columns rather than free JSON so a
  -- customer can line two coaches up side by side and "Not included" is never
  -- blank. Coach autonomy over WHAT they offer does not require the customer
  -- to guess what they are buying.
  calls_included_per_month int check (calls_included_per_month >= 0),
  call_duration_minutes int check (call_duration_minutes > 0),
  check_in_cadence text,
  response_time_hours int check (response_time_hours > 0),
  programme_included boolean not null default false,
  programme_review_cadence text,
  form_review_included boolean not null default false,
  messaging_channel text,
  intended_client text,
  -- Anything the coach wants to add in their own words. Hostile input:
  -- sanitised and capped before it arrives here.
  additional_inclusions text[] not null default '{}',

  -- The policy versions this offer was published under. A purchase copies
  -- these forward, so an old contract is always computed at its own terms.
  commission_policy_id text not null,
  cancellation_policy_id text not null,
  payment_failure_policy_id text not null,
  recognition_policy_id text not null,
  billing_terms_policy_id text not null,

  published_at timestamptz,
  published_by uuid references profiles (id),
  superseded_at timestamptz,
  created_at timestamptz not null default now(),

  constraint offer_versions_title_length check (length(title) between 1 and 200),
  constraint offer_versions_description_length check (length(description) <= 8000),
  constraint offer_versions_inclusions_count check (cardinality(additional_inclusions) <= 20),

  -- A recurring offer must say how often it bills; a one-off must not pretend to.
  constraint offer_versions_recurring_has_interval check (
    (service_type = 'one_off_consultation' and billing_structure = 'single_payment')
    or (service_type = 'recurring_coaching' and billing_structure <> 'single_payment'
        and billing_interval is not null and billing_interval_count is not null)
  ),
  -- A committed or prepaid term must state its length.
  constraint offer_versions_term_stated check (
    billing_structure not in ('monthly_under_commitment', 'prepaid_term')
    or term_months is not null
  ),
  -- A call allowance without a duration is not a promise anyone can check.
  constraint offer_versions_call_duration check (
    coalesce(calls_included_per_month, 0) = 0 or call_duration_minutes is not null
  )
);

create unique index if not exists offer_versions_offer_version_key
  on offer_versions (offer_id, version);
create index if not exists offer_versions_offer_idx on offer_versions (offer_id);
create index if not exists offer_versions_published_idx
  on offer_versions (offer_id, published_at desc) where published_at is not null;

-- Exactly one live published version per offer.
create unique index if not exists offer_versions_live
  on offer_versions (offer_id)
  where published_at is not null and superseded_at is null;

-- The immutability rule, enforced by the database rather than by convention.
-- A published version may only ever be superseded; its terms cannot be edited,
-- not by a coach, not by an admin, not by a server function. There is no
-- legitimate reason to rewrite what somebody already agreed to buy.
create or replace function freeze_published_offer_version ()
returns trigger
language plpgsql
as $$
begin
  if old.published_at is null then
    return new;  -- still a draft; edit freely
  end if;

  if new.published_at is distinct from old.published_at
     or new.version is distinct from old.version
     or new.offer_id is distinct from old.offer_id
     or new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.service_type is distinct from old.service_type
     or new.billing_structure is distinct from old.billing_structure
     or new.billing_interval is distinct from old.billing_interval
     or new.billing_interval_count is distinct from old.billing_interval_count
     or new.term_months is distinct from old.term_months
     or new.auto_renews is distinct from old.auto_renews
     or new.calls_included_per_month is distinct from old.calls_included_per_month
     or new.call_duration_minutes is distinct from old.call_duration_minutes
     or new.check_in_cadence is distinct from old.check_in_cadence
     or new.response_time_hours is distinct from old.response_time_hours
     or new.programme_included is distinct from old.programme_included
     or new.form_review_included is distinct from old.form_review_included
     or new.additional_inclusions is distinct from old.additional_inclusions
     or new.commission_policy_id is distinct from old.commission_policy_id
     or new.cancellation_policy_id is distinct from old.cancellation_policy_id
     or new.payment_failure_policy_id is distinct from old.payment_failure_policy_id
     or new.recognition_policy_id is distinct from old.recognition_policy_id
     or new.billing_terms_policy_id is distinct from old.billing_terms_policy_id
  then
    raise exception
      'Offer version % is published and its terms are immutable. Publish a new version instead.',
      old.id
      using errcode = 'restrict_violation';
  end if;

  return new;  -- only superseded_at may move
end;
$$;

drop trigger if exists offer_versions_freeze on offer_versions;
create trigger offer_versions_freeze
  before update on offer_versions
  for each row execute function freeze_published_offer_version ();

create or replace function prevent_published_offer_version_delete ()
returns trigger
language plpgsql
as $$
begin
  if old.published_at is not null then
    raise exception
      'Offer version % is published and cannot be deleted. Supersede it instead.', old.id
      using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists offer_versions_no_delete on offer_versions;
create trigger offer_versions_no_delete
  before delete on offer_versions
  for each row execute function prevent_published_offer_version_delete ();

-- ---------------------------------------------------------------------------
-- 3. Prices
-- ---------------------------------------------------------------------------

-- A price per currency the coach actually chose to sell in. There is no
-- conversion here on purpose: a converted estimate is a display aid, and it
-- must never silently become the amount charged.
create table if not exists offer_prices (
  id uuid primary key default gen_random_uuid (),
  offer_version_id uuid not null references offer_versions (id) on delete cascade,
  currency text not null,
  -- Integer minor units. How many minor units make a major unit depends on the
  -- currency, so nothing may divide this by 100.
  amount_minor bigint not null check (amount_minor >= 0),
  -- Set once the matching Stripe Price object exists. Derived from this row,
  -- never the other way round.
  stripe_price_id text,
  created_at timestamptz not null default now(),
  constraint offer_prices_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint offer_prices_sane_magnitude check (amount_minor <= 100000000000)
);

create unique index if not exists offer_prices_version_currency_key
  on offer_prices (offer_version_id, currency);
create index if not exists offer_prices_version_idx on offer_prices (offer_version_id);
create unique index if not exists offer_prices_stripe_key
  on offer_prices (stripe_price_id) where stripe_price_id is not null;

-- A price on a published version is as frozen as the version itself.
create or replace function freeze_published_offer_price ()
returns trigger
language plpgsql
as $$
declare
  is_published boolean;
begin
  select published_at is not null into is_published
  from offer_versions where id = coalesce(new.offer_version_id, old.offer_version_id);

  if not coalesce(is_published, false) then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Prices on a published offer version cannot be deleted.'
      using errcode = 'restrict_violation';
  end if;

  -- The Stripe price id may be filled in after publication; the money may not.
  if new.amount_minor is distinct from old.amount_minor
     or new.currency is distinct from old.currency then
    raise exception
      'Offer version % is published; its price cannot change. Publish a new version instead.',
      old.offer_version_id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists offer_prices_freeze on offer_prices;
create trigger offer_prices_freeze
  before update or delete on offer_prices
  for each row execute function freeze_published_offer_price ();

-- ---------------------------------------------------------------------------
-- 4. Row-level security
-- ---------------------------------------------------------------------------

alter table offers enable row level security;
alter table offer_versions enable row level security;
alter table offer_prices enable row level security;

-- Anonymous visitors see published versions of published offers belonging to
-- publicly visible providers. Three conditions, all required.
create or replace function offer_is_public (o_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from offers o
    where o.id = o_id
      and o.status = 'published'
      and o.archived_at is null
      and provider_is_public (o.provider_id)
  );
$$;

create or replace function owns_offer (o_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from offers o
    where o.id = o_id and is_active_provider (o.provider_id)
  );
$$;

create policy "public reads published offers" on offers
  for select using (offer_is_public (id));
create policy "provider reads own offers" on offers
  for select using (is_active_provider (provider_id));
create policy "provider writes own offers" on offers
  for all
  using (is_active_provider (provider_id))
  with check (is_active_provider (provider_id));
create policy "admin manages offers" on offers
  for all using (is_admin ()) with check (is_admin ());

create policy "public reads live offer versions" on offer_versions
  for select using (
    published_at is not null and superseded_at is null and offer_is_public (offer_id)
  );
create policy "provider reads own offer versions" on offer_versions
  for select using (owns_offer (offer_id));
create policy "provider writes own offer versions" on offer_versions
  for all using (owns_offer (offer_id)) with check (owns_offer (offer_id));
create policy "admin manages offer versions" on offer_versions
  for all using (is_admin ()) with check (is_admin ());

create policy "public reads live offer prices" on offer_prices
  for select using (
    exists (
      select 1 from offer_versions v
      where v.id = offer_version_id
        and v.published_at is not null
        and v.superseded_at is null
        and offer_is_public (v.offer_id)
    )
  );
create policy "provider reads own offer prices" on offer_prices
  for select using (
    exists (select 1 from offer_versions v where v.id = offer_version_id and owns_offer (v.offer_id))
  );
create policy "provider writes own offer prices" on offer_prices
  for all
  using (exists (select 1 from offer_versions v where v.id = offer_version_id and owns_offer (v.offer_id)))
  with check (exists (select 1 from offer_versions v where v.id = offer_version_id and owns_offer (v.offer_id)));
create policy "admin manages offer prices" on offer_prices
  for all using (is_admin ()) with check (is_admin ());

-- ---------------------------------------------------------------------------
-- 5. Capacity reservations
-- ---------------------------------------------------------------------------

-- A coach has a maximum number of active clients. Two people reaching checkout
-- at the same moment must not both succeed against the last free place, and
-- the loser must find out BEFORE their card is charged rather than after.
--
-- A reservation is a short-lived hold taken before payment and converted on
-- success. It expires by itself, so an abandoned checkout does not hold a place
-- forever, and it releases only its own hold.
create table if not exists capacity_reservations (
  id uuid primary key default gen_random_uuid (),
  provider_id uuid not null references providers (id) on delete cascade,
  offer_version_id uuid not null references offer_versions (id),
  -- Who the hold is for. Anonymous checkout is not permitted for a paid
  -- purchase, so this is always a real account.
  customer_id uuid not null references profiles (id) on delete cascade,
  state text not null default 'held'
    check (state in ('held', 'converted', 'released', 'expired')),
  expires_at timestamptz not null,
  converted_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists capacity_reservations_provider_idx
  on capacity_reservations (provider_id) where state = 'held';
create index if not exists capacity_reservations_expiry_idx
  on capacity_reservations (expires_at) where state = 'held';
create index if not exists capacity_reservations_customer_idx
  on capacity_reservations (customer_id, created_at desc);

-- One live hold per customer per coach. Refreshing the checkout page must not
-- consume a second place.
create unique index if not exists capacity_reservations_one_live
  on capacity_reservations (provider_id, customer_id)
  where state = 'held';

alter table capacity_reservations enable row level security;

create policy "customer reads own reservations" on capacity_reservations
  for select using (customer_id = auth.uid ());
create policy "provider reads own reservations" on capacity_reservations
  for select using (is_active_provider (provider_id));
create policy "admin manages reservations" on capacity_reservations
  for all using (is_admin ()) with check (is_admin ());

-- Writes go through a server function, never through a policy: the count and
-- the insert must happen under one lock or the check is decorative. That
-- function is `reserve_capacity()`, defined in 0011 because it has to count
-- active enrollments, which are created there.
