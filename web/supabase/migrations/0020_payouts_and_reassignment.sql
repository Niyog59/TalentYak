-- M07 · Payout batches, payout recording, adjustments, coach replacement.
--
-- THREE RULES CARRIED THROUGH EVERY FUNCTION
--
-- 1. Exported is not paid. Preparing a batch claims earnings; exporting records
--    that a file was produced; only recording a transfer — with a reference, a
--    date and the operator's identity — marks anything paid.
-- 2. Nothing moves real money. No function here calls a payment provider. A
--    transfer is made by a person outside the system and recorded afterwards,
--    labelled manual. No payout corridor has been verified.
-- 3. Earned money never changes coach. A replacement redirects FUTURE periods
--    and holds anything ambiguous for a person to allocate.
--
-- The batching rules mirror prepareBatch() in src/lib/payouts/batching.ts. A
-- database test runs both on the same fixture and asserts they agree.

-- ---------------------------------------------------------------------------
-- 0. Capacity counting, made consistent
-- ---------------------------------------------------------------------------
--
-- 0011's reserve_capacity() counted only `active` enrollments, while
-- provider_commitments() (0019) also counts `paused` ones — a client whose
-- renewal failed still holds their place. One definition now.

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
  v_existing uuid;
  v_id uuid;
begin
  if not is_privileged_writer () then
    raise exception 'capacity may only be reserved by a server function';
  end if;

  select max_active_clients, accepting_new_clients
    into v_limit, v_accepting
  from providers
  where id = p_provider_id
  for update;

  if not found then
    raise exception 'provider % does not exist', p_provider_id;
  end if;

  if not v_accepting then
    return null;
  end if;

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

  update capacity_reservations
    set state = 'expired', released_at = now()
    where provider_id = p_provider_id and state = 'held' and expires_at <= now();

  if v_limit is not null and provider_commitments (p_provider_id) >= v_limit then
    return null;
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

revoke execute on function reserve_capacity (uuid, uuid, uuid, int) from public, anon, authenticated;
grant execute on function reserve_capacity (uuid, uuid, uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- 1. Batch audit trail
-- ---------------------------------------------------------------------------

create table if not exists payout_batch_events (
  id uuid primary key default gen_random_uuid (),
  batch_id uuid not null references payout_batches (id) on delete restrict,
  item_id uuid references payout_batch_items (id) on delete restrict,
  action text not null,
  note text,
  actor uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists payout_batch_events_batch_idx on payout_batch_events (batch_id, created_at);

alter table payout_batch_events enable row level security;
create policy "admin reads payout batch events" on payout_batch_events for select using (is_admin ());

-- Items record the rules they were held under, for the preview screen.
alter table payout_batch_items drop constraint if exists payout_batch_items_state_check;
alter table payout_batch_items add constraint payout_batch_items_state_check
  check (state in ('prepared', 'submitted', 'paid', 'failed', 'returned', 'cancelled'));

-- ---------------------------------------------------------------------------
-- 2. Preparing a batch
-- ---------------------------------------------------------------------------

create or replace function admin_prepare_payout_batch (
  p_currency text,
  p_eligible_through date,
  p_minimum_minor bigint default 0,
  p_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency text := upper(p_currency);
  v_batch uuid;
  g record;
  v_dest provider_payout_destinations%rowtype;
  v_reason text;
  v_items jsonb := '[]'::jsonb;
  v_held jsonb := '[]'::jsonb;
  v_total bigint := 0;
  v_item uuid;
  v_name text;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_currency' using hint = 'Choose a currency.';
  end if;

  -- Two operators pressing "prepare" at the same moment serialise here. The
  -- second one then finds the earnings already claimed and gets nothing.
  perform pg_advisory_xact_lock (hashtext('payout_batch:' || v_currency));

  -- Claim the rows before reading totals, so nothing can change underneath.
  perform 1 from earning_states
    where state = 'eligible' and currency = v_currency and batch_id is null
      and eligible_at::date <= p_eligible_through
    for update;

  for g in
    select es.provider_id, sum(le.amount_minor)::bigint as net, count(*)::int as entries
    from earning_states es
    join ledger_entries le on le.id = es.ledger_entry_id
    where es.state = 'eligible' and es.currency = v_currency and es.batch_id is null
      and es.eligible_at::date <= p_eligible_through
    group by es.provider_id
    order by es.provider_id
  loop
    select coalesce(pp.display_name, p.display_name) into v_name
      from providers p left join provider_public_profiles pp on pp.provider_id = p.id
      where p.id = g.provider_id;

    select * into v_dest from provider_payout_destinations
      where provider_id = g.provider_id and superseded_at is null;

    -- Same order as prepareBatch(): a negative balance is reported as such,
    -- never collapsed into "below minimum".
    v_reason := case
      when g.net < 0 then 'negative_balance'
      when g.net = 0 then 'nets_to_zero'
      when v_dest.id is null then 'no_payout_destination'
      when v_dest.review_state <> 'approved' then 'destination_not_approved'
      when g.net < p_minimum_minor then 'below_minimum'
      else null
    end;

    if v_reason = 'nets_to_zero' then
      continue;
    end if;

    if v_reason is not null then
      v_held := v_held || jsonb_build_object(
        'provider_id', g.provider_id, 'display_name', v_name, 'currency', v_currency,
        'amount_minor', g.net, 'entry_count', g.entries, 'reason', v_reason);
      continue;
    end if;

    if v_batch is null then
      insert into payout_batches (label, state, currency, period_end, prepared_by)
        values (coalesce(p_label, format('%s payouts through %s', v_currency, p_eligible_through)),
                'prepared', v_currency, p_eligible_through, auth.uid ())
        returning id into v_batch;
    end if;

    insert into payout_batch_items (batch_id, provider_id, currency, amount_minor, entry_count,
                                    payout_destination_id, state, settlement_method)
      values (v_batch, g.provider_id, v_currency, g.net, g.entries, v_dest.id, 'prepared', 'manual')
      returning id into v_item;

    update earning_states es set state = 'batched', batch_id = v_batch
      where es.provider_id = g.provider_id and es.currency = v_currency
        and es.state = 'eligible' and es.batch_id is null
        and es.eligible_at::date <= p_eligible_through;

    v_total := v_total + g.net;
    v_items := v_items || jsonb_build_object(
      'item_id', v_item, 'provider_id', g.provider_id, 'display_name', v_name,
      'currency', v_currency, 'amount_minor', g.net, 'entry_count', g.entries,
      'masked_reference', mask_reference (v_dest.account_reference));
  end loop;

  if v_batch is not null then
    update payout_batches set total_minor = v_total where id = v_batch;
    insert into payout_batch_events (batch_id, action, actor, note)
      values (v_batch, 'prepared', auth.uid (), format('%s item(s), %s %s', jsonb_array_length(v_items), v_total, v_currency));
  end if;

  return jsonb_build_object('batch_id', v_batch, 'currency', v_currency, 'total_minor', v_total,
                            'items', v_items, 'held', v_held);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Export, submission, reveal
-- ---------------------------------------------------------------------------

create or replace function admin_export_payout_batch (p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b payout_batches%rowtype;
  v_rows jsonb;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;

  select * into b from payout_batches where id = p_batch_id for update;
  if not found then
    raise exception 'batch_not_found' using hint = 'That batch does not exist.';
  end if;
  if b.state not in ('prepared', 'exported', 'submitted') then
    raise exception 'batch_closed' using hint = 'This batch is already closed.';
  end if;

  -- The file carries MASKED references. A payout file gets saved, attached and
  -- forwarded; a full bank reference does not belong in one. The operator
  -- reveals each reference on screen, one at a time, and each reveal is logged.
  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', i.id,
      'provider_id', i.provider_id,
      'display_name', coalesce(pp.display_name, p.display_name),
      'masked_reference', mask_reference (d.account_reference),
      'channel', d.channel,
      'amount_minor', i.amount_minor,
      'currency', i.currency,
      'entry_count', i.entry_count,
      'state', i.state
    ) order by coalesce(pp.display_name, p.display_name)), '[]'::jsonb)
  into v_rows
  from payout_batch_items i
  join providers p on p.id = i.provider_id
  left join provider_public_profiles pp on pp.provider_id = p.id
  left join provider_payout_destinations d on d.id = i.payout_destination_id
  where i.batch_id = b.id;

  update payout_batches
    set state = case when state = 'prepared' then 'exported' else state end,
        exported_at = coalesce(exported_at, now())
    where id = b.id;

  insert into payout_batch_events (batch_id, action, actor) values (b.id, 'exported', auth.uid ());

  return jsonb_build_object('batch_id', b.id, 'label', b.label, 'currency', b.currency, 'rows', v_rows);
end;
$$;

create or replace function admin_reveal_payout_reference (p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i payout_batch_items%rowtype;
  d provider_payout_destinations%rowtype;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;

  select * into i from payout_batch_items where id = p_item_id;
  if not found then
    raise exception 'item_not_found';
  end if;
  select * into d from provider_payout_destinations where id = i.payout_destination_id;

  insert into payout_batch_events (batch_id, item_id, action, actor)
    values (i.batch_id, i.id, 'reference_revealed', auth.uid ());

  return jsonb_build_object('channel', d.channel, 'account_reference', d.account_reference,
                            'account_holder_name', d.account_holder_name, 'country', d.country,
                            'destination_currency', d.currency);
end;
$$;

create or replace function admin_mark_batch_submitted (p_batch_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;

  update payout_batches set state = 'submitted', submitted_at = now()
    where id = p_batch_id and state in ('prepared', 'exported');
  if not found then
    raise exception 'invalid_transition' using hint = 'Only a prepared or exported batch can be marked submitted.';
  end if;

  update payout_batch_items set state = 'submitted' where batch_id = p_batch_id and state = 'prepared';
  insert into payout_batch_events (batch_id, action, note, actor) values (p_batch_id, 'submitted', p_note, auth.uid ());
  return 'submitted';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Recording what actually happened
-- ---------------------------------------------------------------------------

create or replace function refresh_batch_state (p_batch_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open int;
  v_paid int;
  v_state text;
begin
  select count(*) filter (where state in ('prepared', 'submitted')),
         count(*) filter (where state = 'paid')
    into v_open, v_paid
  from payout_batch_items where batch_id = p_batch_id;

  if v_open = 0 then
    v_state := case when v_paid > 0 then 'paid' else 'failed' end;
    update payout_batches
      set state = v_state, confirmed_at = coalesce(confirmed_at, now()), confirmed_by = coalesce(confirmed_by, auth.uid ())
      where id = p_batch_id and state not in ('paid', 'failed', 'cancelled');
  end if;

  return coalesce(v_state, (select state from payout_batches where id = p_batch_id));
end;
$$;

create or replace function admin_record_payout_paid (
  p_item_id uuid,
  p_external_reference text,
  p_paid_at timestamptz,
  p_evidence_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i payout_batch_items%rowtype;
  v_entry uuid;
  v_states int;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if coalesce(length(trim(p_external_reference)), 0) < 3 then
    raise exception 'reference_required' using hint = 'Enter the transfer reference from your payment provider.';
  end if;
  if p_paid_at is null or p_paid_at > now() + interval '1 day' then
    raise exception 'paid_at_invalid' using hint = 'Enter the date the transfer was made.';
  end if;
  if coalesce(length(trim(p_evidence_note)), 0) < 3 then
    raise exception 'evidence_required' using hint = 'Note where the confirmation can be found (e.g. the statement line).';
  end if;

  select * into i from payout_batch_items where id = p_item_id for update;
  if not found then
    raise exception 'item_not_found' using hint = 'That payout line does not exist.';
  end if;
  if i.state = 'paid' then
    -- Recording the same transfer twice is a no-op, never a second payout.
    return jsonb_build_object('item_id', i.id, 'state', 'paid', 'already', true);
  end if;
  if i.state not in ('prepared', 'submitted') then
    raise exception 'invalid_transition' using hint = format('A %s line cannot be marked paid.', i.state);
  end if;

  update payout_batch_items set
    state = 'paid', external_reference = trim(p_external_reference), paid_at = p_paid_at,
    paid_by = auth.uid (), evidence_note = trim(p_evidence_note), settlement_method = 'manual'
  where id = i.id;

  insert into ledger_entries (account, effect, currency, amount_minor, provider_id, effect_key, occurred_at)
    values ('coach_payable', 'payout', i.currency, -i.amount_minor, i.provider_id,
            'payout:' || i.id || ':paid', p_paid_at)
    on conflict (effect_key) do nothing
    returning id into v_entry;

  update earning_states set state = 'paid', paid_at = p_paid_at
    where batch_id = i.batch_id and provider_id = i.provider_id and currency = i.currency and state = 'batched';
  get diagnostics v_states = row_count;

  insert into payout_batch_events (batch_id, item_id, action, note, actor)
    values (i.batch_id, i.id, 'paid', format('ref %s; %s', trim(p_external_reference), trim(p_evidence_note)), auth.uid ());

  perform refresh_batch_state (i.batch_id);

  perform enqueue_outbox ('email.payout_paid',
    jsonb_build_object('provider_id', i.provider_id, 'amount_minor', i.amount_minor, 'currency', i.currency,
                       'paid_at', p_paid_at),
    'payout_paid:' || i.id);

  return jsonb_build_object('item_id', i.id, 'state', 'paid', 'ledger_entry_id', v_entry, 'earnings_marked_paid', v_states);
end;
$$;

-- A transfer that did not arrive. Before it was paid: the earnings simply go
-- back to eligible. After it was recorded paid and then came back: a reversal
-- entry restores what the coach is owed. History is never deleted.
create or replace function admin_record_payout_failed (
  p_item_id uuid,
  p_reason text,
  p_returned_after_payment boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  i payout_batch_items%rowtype;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'reason_required' using hint = 'Record what happened to this transfer.';
  end if;

  select * into i from payout_batch_items where id = p_item_id for update;
  if not found then
    raise exception 'item_not_found';
  end if;

  if p_returned_after_payment then
    if i.state <> 'paid' then
      raise exception 'invalid_transition' using hint = 'Only a line recorded as paid can be returned.';
    end if;

    insert into ledger_entries (account, effect, currency, amount_minor, provider_id, effect_key, reverses_entry_id)
      values ('coach_payable', 'payout_reversal', i.currency, i.amount_minor, i.provider_id,
              'payout:' || i.id || ':returned',
              (select id from ledger_entries where effect_key = 'payout:' || i.id || ':paid'))
      on conflict (effect_key) do nothing;

    update payout_batch_items set state = 'returned', failure_reason = p_reason where id = i.id;
  else
    if i.state not in ('prepared', 'submitted') then
      raise exception 'invalid_transition' using hint = format('A %s line cannot be marked failed.', i.state);
    end if;
    update payout_batch_items set state = 'failed', failure_reason = p_reason where id = i.id;
  end if;

  -- Either way, the coach is owed that money again and it can go in a later batch.
  update earning_states set state = 'eligible', batch_id = null, paid_at = null
    where batch_id = i.batch_id and provider_id = i.provider_id and currency = i.currency
      and state in ('batched', 'paid');

  insert into payout_batch_events (batch_id, item_id, action, note, actor)
    values (i.batch_id, i.id, case when p_returned_after_payment then 'returned' else 'failed' end, p_reason, auth.uid ());

  perform refresh_batch_state (i.batch_id);

  return jsonb_build_object('item_id', i.id, 'state', case when p_returned_after_payment then 'returned' else 'failed' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Adjustments and held funds
-- ---------------------------------------------------------------------------

create or replace function admin_record_adjustment (
  p_provider_id uuid,
  p_currency text,
  p_amount_minor bigint,
  p_reason text,
  p_purchase_id uuid default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if p_amount_minor = 0 then
    raise exception 'amount_required' using hint = 'An adjustment must change the balance.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'reason_required' using hint = 'Record why this adjustment is being made.';
  end if;

  insert into ledger_entries (account, effect, currency, amount_minor, provider_id, purchase_id, effect_key)
    values ('coach_payable', 'manual_adjustment', upper(p_currency), p_amount_minor, p_provider_id, p_purchase_id,
            'adjustment:' || coalesce(p_idempotency_key, gen_random_uuid ()::text))
    on conflict (effect_key) do nothing
    returning id into v_id;

  if v_id is not null then
    insert into earning_states (ledger_entry_id, provider_id, currency, state, eligible_at, hold_reason)
      values (v_id, p_provider_id, upper(p_currency), 'eligible', now(), null);

    perform raise_exception_row (jsonb_build_object(
      'kind', 'unmatched_ledger_entry', 'severity', 'info', 'provider_id', p_provider_id,
      'purchase_id', p_purchase_id, 'currency', upper(p_currency), 'amount_minor', p_amount_minor,
      'detail', 'Manual adjustment recorded: ' || p_reason));
  end if;

  return v_id;
end;
$$;

create or replace function admin_release_held_earning (p_ledger_entry_id uuid, p_note text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if nullif(trim(p_note), '') is null then
    raise exception 'reason_required' using hint = 'Record why this hold is being released.';
  end if;

  -- Disputes release themselves from Stripe's outcome; a person may not.
  update earning_states es set
      state = case when bc.state = 'delivered' or le.billing_cycle_id is null then 'eligible' else 'pending' end,
      eligible_at = case when bc.state = 'delivered' or le.billing_cycle_id is null then now() else null end,
      hold_reason = null
    from ledger_entries le
    left join billing_cycles bc on bc.id = le.billing_cycle_id
    where le.id = es.ledger_entry_id
      and es.ledger_entry_id = p_ledger_entry_id
      and es.state = 'held'
      and coalesce(es.hold_reason, '') not like 'dispute:%'
    returning es.state into v_state;

  if v_state is null then
    raise exception 'not_releasable' using hint = 'Only a held earning that is not under dispute can be released here.';
  end if;

  return v_state;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Customer-requested coach replacement
-- ---------------------------------------------------------------------------

create table if not exists coach_change_requests (
  id uuid primary key default gen_random_uuid (),
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  customer_id uuid not null references profiles (id) on delete cascade,
  current_provider_id uuid not null references providers (id),
  reason text not null,
  preferred_provider_id uuid references providers (id),
  state text not null default 'requested'
    check (state in ('requested', 'applied', 'declined', 'withdrawn')),
  new_provider_id uuid references providers (id),
  effective_at timestamptz,
  history_scope text check (history_scope in ('none', 'programme_and_logs', 'full')),
  decision_note text,
  decided_by uuid references profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint coach_change_reason_length check (length(reason) between 3 and 2000)
);

create index if not exists coach_change_requests_enrollment_idx on coach_change_requests (enrollment_id);
create index if not exists coach_change_requests_open_idx on coach_change_requests (created_at) where state = 'requested';
create unique index if not exists coach_change_requests_one_open
  on coach_change_requests (enrollment_id) where state = 'requested';

alter table coach_change_requests enable row level security;
create policy "customer reads own coach change requests" on coach_change_requests
  for select using (customer_id = auth.uid ());
create policy "admin reads coach change requests" on coach_change_requests
  for select using (is_admin ());

create or replace function request_coach_change (
  p_enrollment_id uuid,
  p_reason text,
  p_preferred_provider_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  e enrollments%rowtype;
  v_id uuid;
begin
  select * into e from enrollments where id = p_enrollment_id;
  if not found or e.customer_id <> auth.uid () then
    raise exception 'not_found' using hint = 'That coaching relationship was not found.';
  end if;
  if e.state not in ('active', 'paused') then
    raise exception 'relationship_ended' using hint = 'This coaching has ended.';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'reason_required' using hint = 'Tell us a little about why you''d like a change.';
  end if;

  insert into coach_change_requests (enrollment_id, customer_id, current_provider_id, reason, preferred_provider_id)
    values (e.id, e.customer_id, e.provider_id, left(trim(p_reason), 2000), p_preferred_provider_id)
    returning id into v_id;

  perform enqueue_outbox ('email.coach_change_requested',
    jsonb_build_object('request_id', v_id, 'customer_id', e.customer_id), 'coach_change_requested:' || v_id);

  return v_id;
exception
  when unique_violation then
    raise exception 'request_already_open' using hint = 'You already have a coach change request open.';
end;
$$;

create or replace function admin_apply_coach_change (
  p_request_id uuid,
  p_new_provider_id uuid,
  p_effective_at timestamptz,
  p_history_scope text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r coach_change_requests%rowtype;
  e enrollments%rowtype;
  np providers%rowtype;
  v_effective timestamptz := coalesce(p_effective_at, now());
  v_held int;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if p_history_scope not in ('none', 'programme_and_logs', 'full') then
    raise exception 'invalid_history_scope' using hint = 'Choose what the new coach may see.';
  end if;
  if v_effective < now() - interval '1 minute' then
    raise exception 'effective_in_past' using hint = 'A change cannot take effect in the past — that would rewrite who coached whom.';
  end if;

  select * into r from coach_change_requests where id = p_request_id for update;
  if not found or r.state <> 'requested' then
    raise exception 'request_not_open' using hint = 'This request has already been decided.';
  end if;

  select * into e from enrollments where id = r.enrollment_id for update;
  if e.provider_id = p_new_provider_id then
    raise exception 'same_coach' using hint = 'Choose a different coach.';
  end if;

  select * into np from providers where id = p_new_provider_id for update;
  if not provider_can_sell (np.id) then
    raise exception 'coach_unavailable' using hint = 'That coach is not approved and active.';
  end if;
  if np.max_active_clients is not null and provider_commitments (np.id) >= np.max_active_clients then
    raise exception 'coach_full' using hint = 'That coach has no free places.';
  end if;

  update enrollment_assignments set effective_to = v_effective
    where enrollment_id = e.id and effective_to is null;

  insert into enrollment_assignments (enrollment_id, provider_id, previous_provider_id, effective_from,
                                      reason, requested_by, actioned_by, history_scope)
    values (e.id, np.id, e.provider_id, v_effective, left(r.reason, 500), r.customer_id, auth.uid (), p_history_scope);

  update enrollments set provider_id = np.id where id = e.id;

  -- Earnings for a period the original coach had not finished delivering are
  -- ambiguous: part of it was theirs. Hold them, and raise an exception so a
  -- person allocates them. Periods already delivered are untouched.
  update earning_states es set state = 'held', hold_reason = 'coach_change:' || r.id
    from ledger_entries le
    join billing_cycles bc on bc.id = le.billing_cycle_id
    where le.id = es.ledger_entry_id
      and le.purchase_id = e.purchase_id
      and le.account = 'coach_payable'
      and le.effect = 'service_earned'
      and es.state = 'pending'
      and bc.period_end > v_effective;
  get diagnostics v_held = row_count;

  if v_held > 0 then
    perform raise_exception_row (jsonb_build_object(
      'kind', 'coach_change_review', 'severity', 'warning',
      'purchase_id', e.purchase_id, 'provider_id', r.current_provider_id,
      'detail', format('Coach changed part-way through a paid period. %s earning(s) held for allocation between the previous and new coach.', v_held)));
  end if;

  update coach_change_requests set
    state = 'applied', new_provider_id = np.id, effective_at = v_effective, history_scope = p_history_scope,
    decision_note = p_note, decided_by = auth.uid (), decided_at = now()
  where id = r.id;

  perform enqueue_outbox ('email.coach_changed',
    jsonb_build_object('request_id', r.id, 'customer_id', r.customer_id,
                       'previous_provider_id', r.current_provider_id, 'new_provider_id', np.id,
                       'effective_at', v_effective),
    'coach_changed:' || r.id);

  return jsonb_build_object('request_id', r.id, 'held_earnings', v_held, 'effective_at', v_effective);
end;
$$;

create or replace function admin_decline_coach_change (p_request_id uuid, p_note text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if nullif(trim(p_note), '') is null then
    raise exception 'reason_required' using hint = 'Tell the customer why.';
  end if;
  update coach_change_requests set state = 'declined', decision_note = p_note, decided_by = auth.uid (), decided_at = now()
    where id = p_request_id and state = 'requested';
  if not found then
    raise exception 'request_not_open' using hint = 'This request has already been decided.';
  end if;
  return 'declined';
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'admin_prepare_payout_batch(text, date, bigint, text)',
    'admin_export_payout_batch(uuid)',
    'admin_reveal_payout_reference(uuid)',
    'admin_mark_batch_submitted(uuid, text)',
    'admin_record_payout_paid(uuid, text, timestamptz, text)',
    'admin_record_payout_failed(uuid, text, boolean)',
    'admin_record_adjustment(uuid, text, bigint, text, uuid, text)',
    'admin_release_held_earning(uuid, text)',
    'admin_apply_coach_change(uuid, uuid, timestamptz, text, text)',
    'admin_decline_coach_change(uuid, text)',
    'request_coach_change(uuid, text, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;

  execute 'revoke execute on function refresh_batch_state(uuid) from public, anon, authenticated';
  execute 'grant execute on function refresh_batch_state(uuid) to service_role';
end $$;

notify pgrst, 'reload schema';
