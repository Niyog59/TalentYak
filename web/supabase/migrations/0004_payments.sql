-- Payments in (Stripe) and payouts out (Payoneer, manual monthly CSV).

create type payment_status as enum ('pending', 'succeeded', 'failed', 'refunded');
create type payout_status as enum ('pending', 'exported', 'paid');

create table payments (
  id uuid primary key default gen_random_uuid (),
  booking_id uuid not null references bookings (id),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_invoice_id text,
  amount_cents int not null,
  currency text not null default 'usd',
  status payment_status not null default 'pending',
  kind text not null default 'one_time', -- 'one_time' | 'subscription_cycle'
  raw jsonb,
  created_at timestamptz not null default now()
);

create index payments_booking_idx on payments (booking_id);
create unique index payments_intent_idx on payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create table payout_batches (
  id uuid primary key default gen_random_uuid (),
  label text not null, -- e.g. '2026-10 Payoneer batch'
  exported_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

-- One ledger row per succeeded payment: how the money splits.
create table payout_ledger (
  id uuid primary key default gen_random_uuid (),
  payment_id uuid not null references payments (id),
  booking_id uuid not null references bookings (id),
  provider_id uuid references providers (id),
  gross_cents int not null,
  direct_costs_cents int not null default 0,
  provider_share_cents int not null,
  platform_share_cents int not null,
  rule text not null, -- e.g. 'pandit_post_cost_50_50', 'fitness_60_40'
  status payout_status not null default 'pending',
  batch_id uuid references payout_batches (id),
  created_at timestamptz not null default now()
);

create index payout_ledger_provider_idx on payout_ledger (provider_id);
create index payout_ledger_status_idx on payout_ledger (status);

alter table payments enable row level security;
alter table payout_batches enable row level security;
alter table payout_ledger enable row level security;

create policy "admin manages payments" on payments
  for all using (is_admin ());

create policy "customer reads own payments" on payments
  for select using (
    booking_id in (select id from bookings where customer_id = auth.uid ())
  );

create policy "admin manages payout batches" on payout_batches
  for all using (is_admin ());

create policy "admin manages payout ledger" on payout_ledger
  for all using (is_admin ());

create policy "provider reads own ledger" on payout_ledger
  for select using (
    provider_id in (select id from providers where profile_id = auth.uid ())
  );
