-- M03 · Checkout attempts, purchases, subscriptions, enrollments, assignments.
--
-- Five concepts that a single `bookings` row currently conflates:
--
--   checkout_attempt   someone tried to buy. Most attempts never become a sale.
--   purchase           a commercial contract, with its terms frozen at the moment
--                      it was created.
--   subscription       the recurring billing arrangement behind a purchase.
--   billing_cycle      one period of service that one payment buys.
--   enrollment         the coaching relationship itself, which outlives any one
--                      coach and any one billing cycle.
--
-- `bookings` is preserved and keeps its ids: existing rows are real history,
-- and purchases link back to them so nothing is orphaned.
--
-- The distinction that matters most is the last one. A customer's relationship
-- is with TalentYak, not with whoever is currently assigned to them. Their
-- training history must not belong to a coach who leaves.

-- ---------------------------------------------------------------------------
-- 1. Checkout attempts
-- ---------------------------------------------------------------------------

create table if not exists checkout_attempts (
  id uuid primary key default gen_random_uuid (),
  customer_id uuid not null references profiles (id) on delete cascade,
  offer_version_id uuid not null references offer_versions (id),
  provider_id uuid not null references providers (id),
  reservation_id uuid references capacity_reservations (id),

  -- What the SERVER decided this costs. A client-submitted amount is never
  -- trusted, and this column is what the Stripe session is built from.
  currency text not null,
  amount_minor bigint not null check (amount_minor >= 0),

  -- Supplied by the caller and unique per customer, so a double-clicked button
  -- or a retried request joins the existing attempt instead of starting a
  -- second one.
  idempotency_key text not null,

  state text not null default 'created'
    check (state in ('created', 'redirected', 'completed', 'abandoned', 'expired', 'failed')),

  stripe_checkout_session_id text,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint checkout_attempts_currency_format check (currency ~ '^[A-Z]{3}$')
);

create unique index if not exists checkout_attempts_idempotency_key
  on checkout_attempts (customer_id, idempotency_key);
create unique index if not exists checkout_attempts_session_key
  on checkout_attempts (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create index if not exists checkout_attempts_customer_idx
  on checkout_attempts (customer_id, created_at desc);
create index if not exists checkout_attempts_state_idx on checkout_attempts (state);
create index if not exists checkout_attempts_expiry_idx
  on checkout_attempts (expires_at) where state in ('created', 'redirected');

alter table checkout_attempts enable row level security;

create policy "customer reads own attempts" on checkout_attempts
  for select using (customer_id = auth.uid ());
create policy "admin manages attempts" on checkout_attempts
  for all using (is_admin ()) with check (is_admin ());
-- No customer INSERT or UPDATE policy: attempts are created by a server action
-- that has already priced the offer. A customer who could insert one could
-- name their own price.

drop trigger if exists checkout_attempts_touch on checkout_attempts;
create trigger checkout_attempts_touch before update on checkout_attempts
  for each row execute function touch_updated_at ();

-- ---------------------------------------------------------------------------
-- 2. Purchases
-- ---------------------------------------------------------------------------

do $$ begin
  create type purchase_state as enum (
    'pending_payment', -- created, nothing collected yet
    'active',          -- paid and in service
    'past_due',        -- a renewal failed; paid-through access may still run
    'cancelling',      -- will end at the period end
    'ended',           -- ran its course or was cancelled
    'refunded',        -- fully reversed
    'disputed'         -- a chargeback is open
  );
exception when duplicate_object then null; end $$;

create table if not exists purchases (
  id uuid primary key default gen_random_uuid (),
  customer_id uuid not null references profiles (id),
  provider_id uuid not null references providers (id),
  offer_version_id uuid not null references offer_versions (id),
  checkout_attempt_id uuid references checkout_attempts (id),
  -- Historical anchor. Existing bookings stay valid commercial records and are
  -- linked rather than migrated away.
  booking_id uuid references bookings (id),

  state purchase_state not null default 'pending_payment',

  -- ----- The frozen snapshot -------------------------------------------------
  -- Everything below is copied at creation and never recomputed. Republishing
  -- an offer, changing a rate, or renaming a provider must not reach backwards
  -- into a contract somebody already agreed to.
  service_type service_type not null,
  billing_structure billing_structure not null,
  charge_currency text not null,
  charge_amount_minor bigint not null check (charge_amount_minor >= 0),
  -- What the customer asked to SEE prices in, if different. Recorded so we can
  -- explain a later question, never used to compute money.
  display_currency text,
  term_months int check (term_months > 0),
  billing_interval text check (billing_interval in ('month', 'year')),
  billing_interval_count int check (billing_interval_count > 0),
  auto_renews boolean not null default false,
  inclusions_snapshot jsonb not null default '{}',

  commission_policy_id text not null,
  cancellation_policy_id text not null,
  payment_failure_policy_id text not null,
  recognition_policy_id text not null,
  billing_terms_policy_id text not null,
  -- ---------------------------------------------------------------------------

  -- Access runs to here. Set by the webhook, never by a browser redirect.
  paid_through_at timestamptz,
  started_at timestamptz,
  ends_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint purchases_currency_format check (charge_currency ~ '^[A-Z]{3}$'),
  constraint purchases_display_currency_format
    check (display_currency is null or display_currency ~ '^[A-Z]{3}$'),
  constraint purchases_sane_magnitude check (charge_amount_minor <= 100000000000)
);

create index if not exists purchases_customer_idx on purchases (customer_id, created_at desc);
create index if not exists purchases_provider_idx on purchases (provider_id, created_at desc);
create index if not exists purchases_state_idx on purchases (state);
create index if not exists purchases_offer_version_idx on purchases (offer_version_id);
create index if not exists purchases_booking_idx on purchases (booking_id) where booking_id is not null;
create unique index if not exists purchases_attempt_key
  on purchases (checkout_attempt_id) where checkout_attempt_id is not null;

alter table purchases enable row level security;

create policy "customer reads own purchases" on purchases
  for select using (customer_id = auth.uid ());
-- A coach sees that a purchase exists and what it entitles the customer to.
-- They do not see the customer's card, billing address, or invoices — those
-- live on other tables with no coach policy at all.
create policy "provider reads own purchases" on purchases
  for select using (is_active_provider (provider_id));
create policy "admin manages purchases" on purchases
  for all using (is_admin ()) with check (is_admin ());

-- No customer or provider write policy anywhere. `state` and `paid_through_at`
-- are entitlement, and entitlement is granted by the Stripe webhook alone
-- (invariant 5). A row this table permits a customer to update is a row they
-- can grant themselves free coaching on.

drop trigger if exists purchases_touch on purchases;
create trigger purchases_touch before update on purchases
  for each row execute function touch_updated_at ();

-- The snapshot is frozen once the purchase leaves pending_payment. Not even an
-- admin edits it; a correction is a new record plus a compensating entry.
create or replace function freeze_purchase_snapshot ()
returns trigger
language plpgsql
as $$
begin
  if old.state = 'pending_payment' then
    return new;
  end if;

  if new.charge_amount_minor is distinct from old.charge_amount_minor
     or new.charge_currency is distinct from old.charge_currency
     or new.offer_version_id is distinct from old.offer_version_id
     or new.service_type is distinct from old.service_type
     or new.billing_structure is distinct from old.billing_structure
     or new.term_months is distinct from old.term_months
     or new.commission_policy_id is distinct from old.commission_policy_id
     or new.inclusions_snapshot is distinct from old.inclusions_snapshot
     or new.customer_id is distinct from old.customer_id
  then
    raise exception
      'Purchase % is active; its agreed terms are immutable. Record a correction instead.',
      old.id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists purchases_freeze on purchases;
create trigger purchases_freeze before update on purchases
  for each row execute function freeze_purchase_snapshot ();

-- ---------------------------------------------------------------------------
-- 3. Subscriptions and billing cycles
-- ---------------------------------------------------------------------------

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid (),
  purchase_id uuid not null references purchases (id) on delete cascade,
  stripe_subscription_id text not null,
  stripe_customer_id text,
  state text not null default 'incomplete'
    check (state in ('incomplete', 'trialing', 'active', 'past_due', 'paused',
                     'cancelling', 'canceled', 'unpaid', 'incomplete_expired')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  -- The Stripe object version this row reflects, so a late-arriving stale event
  -- cannot overwrite a newer state.
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists subscriptions_stripe_key
  on subscriptions (stripe_subscription_id);
create unique index if not exists subscriptions_purchase_key on subscriptions (purchase_id);
create index if not exists subscriptions_state_idx on subscriptions (state);

alter table subscriptions enable row level security;

create policy "customer reads own subscription" on subscriptions
  for select using (
    exists (select 1 from purchases p where p.id = purchase_id and p.customer_id = auth.uid ())
  );
create policy "admin manages subscriptions" on subscriptions
  for all using (is_admin ()) with check (is_admin ());

drop trigger if exists subscriptions_touch on subscriptions;
create trigger subscriptions_touch before update on subscriptions
  for each row execute function touch_updated_at ();

-- One period of service that one payment buys. This is the unit earnings are
-- recognised against: a payment arriving is not the same as a month of coaching
-- being delivered, and a prepaid term buys several of these at once.
create table if not exists billing_cycles (
  id uuid primary key default gen_random_uuid (),
  purchase_id uuid not null references purchases (id) on delete cascade,
  subscription_id uuid references subscriptions (id),
  sequence int not null check (sequence >= 0),

  period_start timestamptz not null,
  period_end timestamptz not null,

  -- The share of the payment allocated to this period, in the charge currency.
  -- For a prepaid term these are produced by an exact allocation that sums back
  -- to the amount paid.
  currency text not null,
  amount_minor bigint not null check (amount_minor >= 0),

  state text not null default 'scheduled'
    check (state in ('scheduled', 'paid', 'delivered', 'failed', 'refunded', 'cancelled')),
  paid_at timestamptz,
  -- Set when the period has actually been served. Earnings become eligible from
  -- here, not from the payment.
  delivered_at timestamptz,

  stripe_invoice_id text,
  created_at timestamptz not null default now(),

  constraint billing_cycles_period_order check (period_end > period_start),
  constraint billing_cycles_currency_format check (currency ~ '^[A-Z]{3}$')
);

create unique index if not exists billing_cycles_purchase_sequence_key
  on billing_cycles (purchase_id, sequence);
create index if not exists billing_cycles_purchase_idx on billing_cycles (purchase_id);
create index if not exists billing_cycles_state_idx on billing_cycles (state);
create index if not exists billing_cycles_delivered_idx
  on billing_cycles (delivered_at) where delivered_at is not null;
create unique index if not exists billing_cycles_invoice_key
  on billing_cycles (stripe_invoice_id) where stripe_invoice_id is not null;

alter table billing_cycles enable row level security;

create policy "customer reads own cycles" on billing_cycles
  for select using (
    exists (select 1 from purchases p where p.id = purchase_id and p.customer_id = auth.uid ())
  );
create policy "provider reads own cycles" on billing_cycles
  for select using (
    exists (select 1 from purchases p where p.id = purchase_id and is_active_provider (p.provider_id))
  );
create policy "admin manages cycles" on billing_cycles
  for all using (is_admin ()) with check (is_admin ());

-- ---------------------------------------------------------------------------
-- 4. Enrollments — the coaching relationship
-- ---------------------------------------------------------------------------

create table if not exists enrollments (
  id uuid primary key default gen_random_uuid (),
  customer_id uuid not null references profiles (id),
  -- The CURRENTLY assigned coach. History lives in enrollment_assignments, and
  -- this column is a convenience for the common query, not the record of truth.
  provider_id uuid not null references providers (id),
  purchase_id uuid references purchases (id),
  booking_id uuid references bookings (id),

  state text not null default 'active'
    check (state in ('pending', 'active', 'paused', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists enrollments_customer_idx on enrollments (customer_id);
create index if not exists enrollments_provider_idx on enrollments (provider_id);
-- The capacity count reads this constantly.
create index if not exists enrollments_provider_active_idx
  on enrollments (provider_id) where state = 'active';
create index if not exists enrollments_purchase_idx on enrollments (purchase_id);

alter table enrollments enable row level security;

create policy "customer reads own enrollments" on enrollments
  for select using (customer_id = auth.uid ());
create policy "provider reads own enrollments" on enrollments
  for select using (is_active_provider (provider_id));
create policy "admin manages enrollments" on enrollments
  for all using (is_admin ()) with check (is_admin ());

drop trigger if exists enrollments_touch on enrollments;
create trigger enrollments_touch before update on enrollments
  for each row execute function touch_updated_at ();

-- Who coached whom, and between which dates. This is what makes "the coach who
-- was assigned in March" answerable years later, and what stops a reassignment
-- rewriting history.
create table if not exists enrollment_assignments (
  id uuid primary key default gen_random_uuid (),
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  provider_id uuid not null references providers (id),
  previous_provider_id uuid references providers (id),

  effective_from timestamptz not null default now(),
  effective_to timestamptz,

  reason text,
  requested_by uuid references profiles (id),
  actioned_by uuid references profiles (id),

  -- What the incoming coach may see of what came before. A replacement coach
  -- needs the training record to do their job; they do not automatically get
  -- the previous private conversations, and the customer decides that.
  history_scope text not null default 'programme_and_logs'
    check (history_scope in ('none', 'programme_and_logs', 'full')),

  created_at timestamptz not null default now(),
  constraint enrollment_assignments_interval check (
    effective_to is null or effective_to > effective_from
  )
);

create index if not exists enrollment_assignments_enrollment_idx
  on enrollment_assignments (enrollment_id, effective_from desc);
create index if not exists enrollment_assignments_provider_idx
  on enrollment_assignments (provider_id);

-- One open assignment per enrollment. Two coaches cannot both currently own the
-- same client, which is what would let both of them accrue earnings for it.
create unique index if not exists enrollment_assignments_one_open
  on enrollment_assignments (enrollment_id)
  where effective_to is null;

-- Closed intervals must not overlap either. btree_gist lets a plain uuid sit
-- alongside a range in one exclusion constraint.
create extension if not exists btree_gist;

alter table enrollment_assignments
  drop constraint if exists enrollment_assignments_no_overlap;
alter table enrollment_assignments
  add constraint enrollment_assignments_no_overlap
  exclude using gist (
    enrollment_id with =,
    tstzrange(effective_from, coalesce(effective_to, 'infinity'::timestamptz)) with &&
  );

alter table enrollment_assignments enable row level security;

create policy "customer reads own assignments" on enrollment_assignments
  for select using (
    exists (select 1 from enrollments e where e.id = enrollment_id and e.customer_id = auth.uid ())
  );
-- A coach sees only the stretch they were responsible for. A former coach does
-- not get to watch who replaced them.
create policy "provider reads own assignments" on enrollment_assignments
  for select using (is_active_provider (provider_id));
create policy "admin manages assignments" on enrollment_assignments
  for all using (is_admin ()) with check (is_admin ());

-- Is this coach allowed into this customer's private records RIGHT NOW? Used by
-- every health-data policy. Deliberately excludes a past coach: their access
-- ended when their assignment did.
create or replace function coaches_enrollment_now (e_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from enrollment_assignments a
    join providers p on p.id = a.provider_id
    join profiles pr on pr.id = p.profile_id
    where a.enrollment_id = e_id
      and a.effective_to is null
      and p.profile_id = auth.uid ()
      and p.suspended_at is null
      and p.status <> 'suspended'
      and pr.suspended_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Capacity reservation, now that enrollments exist
-- ---------------------------------------------------------------------------

create or replace function reserve_capacity (
  p_provider_id uuid,
  p_offer_version_id uuid,
  p_customer_id uuid,
  p_hold_seconds int default 1800
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int;
  v_accepting boolean;
  v_active int;
  v_held int;
  v_existing uuid;
  v_id uuid;
begin
  if not is_privileged_writer () then
    raise exception 'capacity may only be reserved by a server function';
  end if;

  -- Lock the provider row first. Every concurrent reservation for this coach
  -- serialises here, which is what makes the count below trustworthy. Without
  -- the lock, two checkouts can each read "one place left" and both proceed.
  select max_active_clients, accepting_new_clients
    into v_limit, v_accepting
  from providers
  where id = p_provider_id
  for update;

  if not found then
    raise exception 'provider % does not exist', p_provider_id;
  end if;

  if not v_accepting then
    return null;  -- not an error: the coach is simply closed to new clients
  end if;

  -- Reuse a live hold rather than consuming a second place. A refreshed
  -- checkout page must not cost the customer their own seat.
  select id into v_existing
  from capacity_reservations
  where provider_id = p_provider_id
    and customer_id = p_customer_id
    and state = 'held'
    and expires_at > now();

  if v_existing is not null then
    update capacity_reservations
      set expires_at = now() + make_interval(secs => p_hold_seconds)
      where id = v_existing;
    return v_existing;
  end if;

  -- Expire stale holds before counting, so an abandoned checkout from an hour
  -- ago does not block a real customer now.
  update capacity_reservations
    set state = 'expired', released_at = now()
    where provider_id = p_provider_id and state = 'held' and expires_at <= now();

  if v_limit is not null then
    select count(*) into v_active
    from enrollments
    where provider_id = p_provider_id and state = 'active';

    select count(*) into v_held
    from capacity_reservations
    where provider_id = p_provider_id and state = 'held';

    if v_active + v_held >= v_limit then
      return null;  -- full
    end if;
  end if;

  insert into capacity_reservations
    (provider_id, offer_version_id, customer_id, expires_at)
  values
    (p_provider_id, p_offer_version_id, p_customer_id,
     now() + make_interval(secs => p_hold_seconds))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function reserve_capacity (uuid, uuid, uuid, int) is
  'Takes a capacity hold under a row lock on the provider. Returns null when the coach is closed or full — a null is a business answer, not a failure.';

create or replace function release_capacity (p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_privileged_writer () then
    raise exception 'capacity may only be released by a server function';
  end if;

  -- Releases only this hold, and only if it is still held. An expired or
  -- already-converted reservation is left exactly as it is.
  update capacity_reservations
    set state = 'released', released_at = now()
    where id = p_reservation_id and state = 'held';

  return found;
end;
$$;
