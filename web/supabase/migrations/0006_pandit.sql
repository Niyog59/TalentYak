-- Pandit vertical node: ceremonies and the tithi database.
-- The tithi DB is the compounding asset: store an ancestor's tithi once,
-- remind the family every year, forever. ~$0 CAC retention.

create table ceremonies (
  id uuid primary key default gen_random_uuid (),
  booking_id uuid not null references bookings (id),
  ceremony_type text not null, -- mirrors service id
  temple text default 'Gokarna',
  pandit_provider_id uuid references providers (id),
  assistant_name text,
  samagri_notes text,
  performed_at timestamptz,
  recording_id uuid references recordings (id),
  correctness_checked boolean not null default false, -- senior pandit gate
  notes text,
  created_at timestamptz not null default now()
);

create index ceremonies_booking_idx on ceremonies (booking_id);

-- One row per remembered ancestor. Tithi identity is stored in
-- Bikram Sambat lunar terms; the Gregorian date for each upcoming year
-- is entered/confirmed BY A HUMAN before any reminder is scheduled
-- (handover rule: no tithi auto-send without human confirmation).
create table shraddha_dates (
  id uuid primary key default gen_random_uuid (),
  customer_email text not null,
  customer_name text,
  customer_id uuid references profiles (id),
  booking_id uuid references bookings (id), -- origin booking, if any
  deceased_name text not null,
  relation text,
  gotra text,
  tradition text, -- e.g. 'khas', 'newar', 'other'
  tithi_month_bs text, -- BS lunar month, e.g. 'Ashwin'
  tithi_paksha text check (tithi_paksha in ('shukla', 'krishna')),
  tithi_name text, -- e.g. 'Dwitiya', 'Purnima'
  next_gregorian_date date, -- entered by admin for the coming year
  date_confirmed_by_human boolean not null default false,
  reminder_opt_in boolean not null default true,
  reminder_scheduled boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create index shraddha_dates_email_idx on shraddha_dates (customer_email);
create index shraddha_dates_next_idx on shraddha_dates (next_gregorian_date);

alter table ceremonies enable row level security;
alter table shraddha_dates enable row level security;

create policy "admin manages ceremonies" on ceremonies
  for all using (is_admin ());

create policy "customer reads own ceremonies" on ceremonies
  for select using (
    booking_id in (select id from bookings where customer_id = auth.uid ())
  );

create policy "admin manages shraddha dates" on shraddha_dates
  for all using (is_admin ());

create policy "customer reads own shraddha dates" on shraddha_dates
  for select using (customer_id = auth.uid ());
