-- Booking / order engine. One lifecycle for every vertical:
-- requested -> confirmed -> scheduled -> delivered -> completed
-- with cancelled / refunded exits. Vertical-specific data lives in
-- intake_response and in the vertical's own tables keyed by booking id.

create type booking_status as enum (
  'requested',   -- paid or payment pending; awaiting founder review
  'confirmed',   -- details verified with customer, provider assigned
  'scheduled',   -- date/time fixed
  'delivered',   -- service performed / artifact delivered
  'completed',   -- closed out (recording sent, follow-up done)
  'cancelled',
  'refunded'
);

create table bookings (
  id uuid primary key default gen_random_uuid (),
  service_id text not null references services (id),
  vertical_slug text not null references verticals (slug),
  -- Guests may book without an account during the agency phase.
  customer_id uuid references profiles (id),
  customer_email text not null,
  customer_name text,
  provider_id uuid references providers (id),
  status booking_status not null default 'requested',
  intake_response jsonb not null default '{}',
  intake_schema_version int not null default 1,
  scheduled_at timestamptz,
  video_link text,
  admin_notes text,
  stripe_checkout_session_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bookings_status_idx on bookings (status);
create index bookings_customer_idx on bookings (customer_id);
create index bookings_email_idx on bookings (customer_email);

-- Append-only audit trail of status transitions and admin actions.
create table booking_events (
  id uuid primary key default gen_random_uuid (),
  booking_id uuid not null references bookings (id) on delete cascade,
  from_status booking_status,
  to_status booking_status,
  actor text not null default 'system', -- 'system' | 'admin' | 'customer' | 'stripe'
  note text,
  created_at timestamptz not null default now()
);

create index booking_events_booking_idx on booking_events (booking_id);

alter table bookings enable row level security;
alter table booking_events enable row level security;

create policy "customer reads own bookings" on bookings
  for select using (customer_id = auth.uid ());

create policy "admin manages bookings" on bookings
  for all using (is_admin ());

create policy "provider reads assigned bookings" on bookings
  for select using (
    provider_id in (select id from providers where profile_id = auth.uid ())
  );

create policy "admin manages booking events" on booking_events
  for all using (is_admin ());

create policy "customer reads own booking events" on booking_events
  for select using (
    booking_id in (select id from bookings where customer_id = auth.uid ())
  );

create or replace function touch_updated_at ()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger bookings_touch
  before update on bookings
  for each row execute function touch_updated_at ();
