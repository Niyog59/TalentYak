-- M03/M06/M07 · Event receipts, transactional outbox, immutable ledger,
-- refunds, disputes, payout batches, reconciliation.
--
-- Two ideas run through this file.
--
-- **A financial amount is never edited.** Not by a coach, not by an admin, not
-- by a server function, not by a migration. A correction is a new, opposite
-- entry that references what it corrects. This is enforced by triggers and by
-- revoked grants, because "append-only" written in a comment is not a control —
-- the previous `payout_ledger` said exactly that and still allowed `for all`.
--
-- **Mutable workflow state lives somewhere else.** Whether an earning is held,
-- eligible, batched or paid changes constantly. Putting that column next to the
-- amount is what makes people reach for an UPDATE on a financial row. So the
-- amounts are in `ledger_entries` and the workflow is in `earning_states`.
--
-- `payments` and `payout_ledger` from 0004 are NOT dropped. They hold real
-- history, and the node protection rule applies.

-- ---------------------------------------------------------------------------
-- 1. Durable event receipts
-- ---------------------------------------------------------------------------

-- The old webhook read an event, tried to write, and returned {received:true}
-- whether or not the write succeeded — so a database error looked to Stripe
-- exactly like success and was never retried. The money was simply lost.
--
-- A receipt row is NOT proof the business effects completed. Those are separate
-- columns on purpose.
create table if not exists provider_events (
  id uuid primary key default gen_random_uuid (),
  -- 'stripe' today; the column exists so a second provider does not need a
  -- second table with the same bugs.
  source text not null default 'stripe',
  -- Stripe's own event id. The first line of deduplication.
  external_id text not null,
  event_type text not null,
  -- Which account and mode the event came from. A test-mode event must never be
  -- processed as live, and an event from someone else's account must never be
  -- processed at all.
  account_id text,
  livemode boolean not null default false,
  api_version text,

  -- Only the fields needed to replay and reconcile. A full Stripe payload
  -- carries customer PII, and this table is queried by ordinary operators.
  payload jsonb not null default '{}',

  processing_state text not null default 'received'
    check (processing_state in ('received', 'processing', 'processed', 'failed', 'ignored')),
  attempts int not null default 0,
  last_error text,
  -- Held by one worker at a time so two servers cannot process the same event
  -- concurrently; a crashed worker's lease simply expires.
  lease_owner text,
  lease_expires_at timestamptz,

  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index if not exists provider_events_external_key
  on provider_events (source, external_id);
create index if not exists provider_events_state_idx
  on provider_events (processing_state, received_at);
create index if not exists provider_events_type_idx on provider_events (event_type);
create index if not exists provider_events_lease_idx
  on provider_events (lease_expires_at) where processing_state = 'processing';

alter table provider_events enable row level security;
-- Deny-all but admin. These rows describe payments and are not customer-facing.
create policy "admin reads provider events" on provider_events
  for select using (is_admin ());

-- ---------------------------------------------------------------------------
-- 2. Transactional outbox
-- ---------------------------------------------------------------------------

-- Work that must happen because a database change happened — send a receipt,
-- notify a coach — committed in the SAME transaction as that change. Without
-- this, a crash between "payment recorded" and "email queued" loses the email
-- silently, and nothing afterwards knows it is missing.
create table if not exists outbox (
  id uuid primary key default gen_random_uuid (),
  topic text not null,
  payload jsonb not null default '{}',
  -- Stable key so the same logical task enqueued twice runs once.
  dedupe_key text,

  state text not null default 'pending'
    check (state in ('pending', 'processing', 'done', 'failed', 'cancelled')),
  attempts int not null default 0,
  max_attempts int not null default 8,
  last_error text,

  scheduled_for timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,

  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists outbox_dedupe_key on outbox (topic, dedupe_key)
  where dedupe_key is not null;
create index if not exists outbox_due_idx on outbox (state, scheduled_for)
  where state = 'pending';
create index if not exists outbox_lease_idx on outbox (lease_expires_at)
  where state = 'processing';
-- Final failures must be visible, not buried.
create index if not exists outbox_failed_idx on outbox (created_at desc)
  where state = 'failed';

alter table outbox enable row level security;
create policy "admin reads outbox" on outbox for select using (is_admin ());

-- ---------------------------------------------------------------------------
-- 3. The ledger
-- ---------------------------------------------------------------------------

do $$ begin
  create type ledger_account as enum (
    'coach_payable',      -- what a coach is owed
    'platform_revenue',   -- commission
    'platform_subsidy',   -- a promotion the platform funded
    'processing_expense', -- card and payout fees, borne by the platform
    'customer_refund',    -- money returned to a customer
    'dispute_holdback'    -- amounts frozen while a chargeback is open
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type ledger_effect as enum (
    'service_earned',
    'commission_earned',
    'refund_reversal',
    'dispute_hold',
    'dispute_release',
    'dispute_loss',
    'subsidy',
    'processing_fee',
    'payout',
    'payout_reversal',
    'manual_adjustment'
  );
exception when duplicate_object then null; end $$;

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid (),

  account ledger_account not null,
  effect ledger_effect not null,

  -- Signed integer minor units. Positive increases the account, negative
  -- decreases it. Currencies are never mixed in a sum: every report groups by
  -- this column, and there is no conversion anywhere in this table.
  currency text not null,
  amount_minor bigint not null,

  provider_id uuid references providers (id),
  customer_id uuid references profiles (id),
  purchase_id uuid references purchases (id),
  billing_cycle_id uuid references billing_cycles (id),
  payment_id uuid references payments (id),
  source_event_id uuid references provider_events (id),

  -- The rate this entry was computed under, so a 2026 row is still explicable
  -- after the rate changes.
  commission_policy_id text,

  -- **The idempotency key.** Deduplication by Stripe event id alone is not
  -- enough: several different events can describe one payment, and a retried
  -- delivery of a different event type would otherwise accrue a second time.
  -- This key names the business effect — "commission on cycle X" — so the same
  -- effect can only ever be recorded once, whichever event carries it.
  effect_key text not null,

  -- What this corrects, for a compensating entry.
  reverses_entry_id uuid references ledger_entries (id),

  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint ledger_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint ledger_sane_magnitude check (abs(amount_minor) <= 100000000000)
);

create unique index if not exists ledger_effect_key on ledger_entries (effect_key);
create index if not exists ledger_provider_idx
  on ledger_entries (provider_id, currency, occurred_at desc);
create index if not exists ledger_purchase_idx on ledger_entries (purchase_id);
create index if not exists ledger_cycle_idx on ledger_entries (billing_cycle_id);
create index if not exists ledger_account_idx on ledger_entries (account, currency);
create index if not exists ledger_event_idx on ledger_entries (source_event_id);
create index if not exists ledger_reverses_idx on ledger_entries (reverses_entry_id)
  where reverses_entry_id is not null;

alter table ledger_entries enable row level security;

-- A coach reads their OWN entries and nobody else's. Coaches must never be able
-- to see each other's rates or statements.
create policy "provider reads own ledger" on ledger_entries
  for select using (provider_id is not null and is_active_provider (provider_id));
create policy "admin reads ledger" on ledger_entries
  for select using (is_admin ());

-- Note what is absent: no INSERT, UPDATE, or DELETE policy for anyone at all,
-- including admin. Writes come only from server functions holding the service
-- role, and even they cannot update or delete — see below.

-- Immutability, enforced rather than promised.
create or replace function reject_ledger_mutation ()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'ledger_entries is append-only. % on entry % is refused. Record a compensating entry that references it via reverses_entry_id.',
    tg_op, coalesce(old.id, new.id)
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists ledger_entries_no_update on ledger_entries;
create trigger ledger_entries_no_update
  before update on ledger_entries
  for each row execute function reject_ledger_mutation ();

drop trigger if exists ledger_entries_no_delete on ledger_entries;
create trigger ledger_entries_no_delete
  before delete on ledger_entries
  for each row execute function reject_ledger_mutation ();

-- Belt and braces: even the service role, which bypasses RLS entirely, has no
-- UPDATE or DELETE grant here.
revoke update, delete on ledger_entries from authenticated, anon;
do $$ begin
  execute 'revoke update, delete on ledger_entries from service_role';
exception when undefined_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 4. Earning workflow state — mutable, and deliberately separate
-- ---------------------------------------------------------------------------

create table if not exists earning_states (
  ledger_entry_id uuid primary key references ledger_entries (id) on delete restrict,
  provider_id uuid not null references providers (id),
  currency text not null,

  -- The five words a coach sees, and they mean different things:
  --   pending   service not yet delivered
  --   held      delivered, but frozen (a dispute, a review)
  --   eligible  delivered and free to be paid
  --   batched   claimed into a payout batch
  --   paid      actually transferred, with evidence recorded
  state text not null default 'pending'
    check (state in ('pending', 'held', 'eligible', 'batched', 'paid', 'reversed')),
  hold_reason text,
  eligible_at timestamptz,
  batch_id uuid,
  paid_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint earning_states_currency_format check (currency ~ '^[A-Z]{3}$')
);

create index if not exists earning_states_provider_idx
  on earning_states (provider_id, currency, state);
create index if not exists earning_states_eligible_idx
  on earning_states (provider_id, currency) where state = 'eligible';
create index if not exists earning_states_batch_idx on earning_states (batch_id)
  where batch_id is not null;

alter table earning_states enable row level security;

create policy "provider reads own earning states" on earning_states
  for select using (is_active_provider (provider_id));
create policy "admin manages earning states" on earning_states
  for all using (is_admin ()) with check (is_admin ());

drop trigger if exists earning_states_touch on earning_states;
create trigger earning_states_touch before update on earning_states
  for each row execute function touch_updated_at ();

-- ---------------------------------------------------------------------------
-- 5. Refunds and disputes
-- ---------------------------------------------------------------------------

-- An admin writing "refunded" in a notes field is not a refund. This table
-- tracks what the payment provider actually reports.
create table if not exists refunds (
  id uuid primary key default gen_random_uuid (),
  purchase_id uuid not null references purchases (id),
  billing_cycle_id uuid references billing_cycles (id),
  payment_id uuid references payments (id),
  stripe_refund_id text,

  currency text not null,
  amount_minor bigint not null check (amount_minor > 0),

  -- Requested is not succeeded. A refund can fail.
  state text not null default 'requested'
    check (state in ('requested', 'pending', 'succeeded', 'failed', 'cancelled')),
  reason text,
  requested_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  settled_at timestamptz,

  constraint refunds_currency_format check (currency ~ '^[A-Z]{3}$')
);

create unique index if not exists refunds_stripe_key on refunds (stripe_refund_id)
  where stripe_refund_id is not null;
create index if not exists refunds_purchase_idx on refunds (purchase_id);
create index if not exists refunds_state_idx on refunds (state);

alter table refunds enable row level security;
create policy "customer reads own refunds" on refunds
  for select using (
    exists (select 1 from purchases p where p.id = purchase_id and p.customer_id = auth.uid ())
  );
create policy "admin manages refunds" on refunds
  for all using (is_admin ()) with check (is_admin ());

create table if not exists disputes (
  id uuid primary key default gen_random_uuid (),
  purchase_id uuid references purchases (id),
  payment_id uuid references payments (id),
  stripe_dispute_id text not null,

  currency text not null,
  amount_minor bigint not null check (amount_minor > 0),
  state text not null
    check (state in ('open', 'under_review', 'won', 'lost', 'warning_closed')),
  reason text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,

  constraint disputes_currency_format check (currency ~ '^[A-Z]{3}$')
);

create unique index if not exists disputes_stripe_key on disputes (stripe_dispute_id);
create index if not exists disputes_state_idx on disputes (state);
create index if not exists disputes_purchase_idx on disputes (purchase_id);

alter table disputes enable row level security;
create policy "admin manages disputes" on disputes
  for all using (is_admin ()) with check (is_admin ());

-- ---------------------------------------------------------------------------
-- 6. Payout batches
-- ---------------------------------------------------------------------------

-- 0004's payout_batches is extended rather than replaced: it has rows.
alter table payout_batches
  add column if not exists state text not null default 'prepared',
  add column if not exists currency text,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists prepared_by uuid references profiles (id),
  add column if not exists total_minor bigint,
  add column if not exists submitted_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references profiles (id);

alter table payout_batches
  drop constraint if exists payout_batches_state_values;
alter table payout_batches
  add constraint payout_batches_state_values
  check (state in ('prepared', 'exported', 'submitted', 'paid', 'failed', 'cancelled'));

comment on column payout_batches.state is
  'Exported is NOT paid. A downloaded CSV means a file exists, not that anyone received money.';

create table if not exists payout_batch_items (
  id uuid primary key default gen_random_uuid (),
  batch_id uuid not null references payout_batches (id) on delete restrict,
  provider_id uuid not null references providers (id),
  currency text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  entry_count int not null default 0,

  -- The destination as it stood when the batch was prepared. A later change of
  -- bank details must not silently rewrite what was already sent.
  payout_destination_id uuid references provider_payout_destinations (id),

  state text not null default 'prepared'
    check (state in ('prepared', 'submitted', 'paid', 'failed', 'returned', 'cancelled')),

  -- Evidence. `paid` is refused without these — see the trigger below.
  external_reference text,
  paid_at timestamptz,
  paid_by uuid references profiles (id),
  evidence_note text,
  -- A transfer recorded by hand is labelled as such, and never described as
  -- confirmed by a payment provider that was never involved.
  settlement_method text not null default 'manual'
    check (settlement_method in ('manual', 'api')),

  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payout_batch_items_currency_format check (currency ~ '^[A-Z]{3}$')
);

create unique index if not exists payout_batch_items_batch_provider_key
  on payout_batch_items (batch_id, provider_id, currency);
create index if not exists payout_batch_items_provider_idx
  on payout_batch_items (provider_id, created_at desc);
create index if not exists payout_batch_items_state_idx on payout_batch_items (state);

alter table payout_batch_items enable row level security;

create policy "provider reads own payout items" on payout_batch_items
  for select using (is_active_provider (provider_id));
create policy "admin manages payout items" on payout_batch_items
  for all using (is_admin ()) with check (is_admin ());

drop trigger if exists payout_batch_items_touch on payout_batch_items;
create trigger payout_batch_items_touch before update on payout_batch_items
  for each row execute function touch_updated_at ();

-- Marking something paid without recording what was sent, when, and by whom
-- makes reconciliation impossible later, when it is most needed.
create or replace function require_payout_evidence ()
returns trigger
language plpgsql
as $$
begin
  if new.state = 'paid' and (old.state is distinct from 'paid') then
    if coalesce(trim(new.external_reference), '') = '' then
      raise exception
        'Cannot mark payout item % as paid without an external transfer reference.', new.id
        using errcode = 'restrict_violation';
    end if;
    if new.paid_at is null then
      raise exception 'Cannot mark payout item % as paid without a paid timestamp.', new.id
        using errcode = 'restrict_violation';
    end if;
    if new.paid_by is null then
      raise exception 'Cannot mark payout item % as paid without recording who confirmed it.', new.id
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payout_batch_items_evidence on payout_batch_items;
create trigger payout_batch_items_evidence
  before insert or update on payout_batch_items
  for each row execute function require_payout_evidence ();

-- ---------------------------------------------------------------------------
-- 7. Reconciliation exceptions
-- ---------------------------------------------------------------------------

-- Things that do not add up. Surfacing them is the point: a finance screen that
-- shows only what balances is a finance screen that hides the problems.
create table if not exists reconciliation_exceptions (
  id uuid primary key default gen_random_uuid (),
  kind text not null check (kind in (
    'missing_payment',        -- provider says paid, we have no record
    'unmatched_ledger_entry', -- we have an entry with no provider counterpart
    'duplicate_effect',       -- two entries claiming the same effect
    'stale_pending_event',    -- an event stuck in processing
    'fee_difference',         -- estimated fee differs from actual
    'refund_after_payout',    -- money was refunded after the coach was paid
    'unmatched_transfer',     -- a transfer we cannot tie to a batch item
    'negative_balance'        -- a coach owes more than they have earned
  )),
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  provider_id uuid references providers (id),
  purchase_id uuid references purchases (id),
  ledger_entry_id uuid references ledger_entries (id),
  provider_event_id uuid references provider_events (id),
  payout_batch_item_id uuid references payout_batch_items (id),

  currency text,
  amount_minor bigint,
  detail text not null,

  state text not null default 'open' check (state in ('open', 'investigating', 'resolved', 'accepted')),
  resolved_by uuid references profiles (id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);

create index if not exists reconciliation_open_idx
  on reconciliation_exceptions (severity, created_at desc) where state = 'open';
create index if not exists reconciliation_provider_idx
  on reconciliation_exceptions (provider_id);

alter table reconciliation_exceptions enable row level security;
create policy "admin manages reconciliation" on reconciliation_exceptions
  for all using (is_admin ()) with check (is_admin ());

-- ---------------------------------------------------------------------------
-- 8. Balance view
-- ---------------------------------------------------------------------------

-- Never sums across currencies. A coach paid in two currencies has two
-- balances, and adding them would be inventing an exchange rate.
create or replace view coach_balances as
  select
    es.provider_id,
    es.currency,
    sum(case when es.state = 'pending'  then l.amount_minor else 0 end) as pending_minor,
    sum(case when es.state = 'held'     then l.amount_minor else 0 end) as held_minor,
    sum(case when es.state = 'eligible' then l.amount_minor else 0 end) as eligible_minor,
    sum(case when es.state = 'batched'  then l.amount_minor else 0 end) as batched_minor,
    sum(case when es.state = 'paid'     then l.amount_minor else 0 end) as paid_minor,
    count(*) as entry_count
  from earning_states es
  join ledger_entries l on l.id = es.ledger_entry_id
  where l.account = 'coach_payable'
  group by es.provider_id, es.currency;

comment on view coach_balances is
  'Per provider AND per currency. Amounts in different currencies are never added together.';
