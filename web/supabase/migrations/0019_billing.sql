-- M06/M07 · Atomic payment effects.
--
-- The webhook in src/lib/payments/webhook.ts wrote each effect with a separate
-- API call — cycle, then ledger, then earning state, then purchase — so a crash
-- between two of them left a half-applied payment. The effects were idempotent,
-- which made a retry converge, but "converges if Stripe retries in time" is
-- weaker than "never half-applied".
--
-- These functions apply every effect of one payment event in ONE transaction.
-- The commission arithmetic stays in TypeScript, where it is unit tested; the
-- application computes the ledger drafts and passes them in, and the database
-- commits them together or not at all.
--
-- Every function is idempotent. Ledger rows dedupe on effect_key, cycles on
-- source_key, refunds and disputes on their Stripe id, notifications on their
-- dedupe key. Running any of them twice with the same input changes nothing
-- the second time. That is what makes a replayed or duplicated event harmless.
--
-- Every function also applies AUTHORITATIVE state rather than inferring from
-- event order. The application fetches the current Stripe object and passes its
-- state; the function sets that state. Two events processed out of order both
-- end in the same place, because both carry the same, current truth.

-- ---------------------------------------------------------------------------
-- 1. Supporting columns and tables
-- ---------------------------------------------------------------------------

create table if not exists billing_customers (
  profile_id uuid primary key references profiles (id) on delete restrict,
  stripe_customer_id text not null,
  livemode boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists billing_customers_stripe_key on billing_customers (stripe_customer_id);

alter table billing_customers enable row level security;
-- Deny-all. The customer's Stripe id is fetched server-side when needed.

alter table billing_cycles
  -- Stable identity for a paid period, known before insert: the invoice id for
  -- a subscription period, the payment intent id for a one-off payment.
  add column if not exists source_key text,
  add column if not exists stripe_payment_intent_id text;

create unique index if not exists billing_cycles_source_key on billing_cycles (source_key)
  where source_key is not null;
create index if not exists billing_cycles_payment_intent_idx on billing_cycles (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

alter table purchases
  add column if not exists requires_review boolean not null default false,
  add column if not exists review_reason text;

create index if not exists purchases_review_idx on purchases (created_at desc) where requires_review;

alter table refunds
  -- Our own id for an admin-initiated refund, sent to Stripe as metadata so the
  -- webhook can match the refund even if we crashed before saving Stripe's id.
  add column if not exists stripe_payment_intent_id text;

-- A purchase maps to at most one enrollment.
create unique index if not exists enrollments_purchase_key on enrollments (purchase_id)
  where purchase_id is not null;

alter table reconciliation_exceptions drop constraint if exists reconciliation_exceptions_kind_check;
alter table reconciliation_exceptions add constraint reconciliation_exceptions_kind_check
  check (kind in (
    'missing_payment',
    'unmatched_ledger_entry',
    'duplicate_effect',
    'stale_pending_event',
    'fee_difference',
    'refund_after_payout',
    'unmatched_transfer',
    'negative_balance',
    'late_payment_after_expiry',  -- paid after the capacity hold lapsed
    'dispute_opened',             -- a chargeback needs a response
    'dispute_after_payout',       -- disputed money was already paid out
    'payment_on_closed_purchase', -- money arrived for an ended or refunded purchase
    'stale_outbox_job',           -- background work stuck or failed
    'coach_change_review'         -- a reassignment left funds to allocate
  ));

-- Earning states that are paused/ended relationships still hold a place.
create or replace function provider_commitments (p_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from enrollments where provider_id = p_id and state in ('active', 'paused'))::int
    + (select count(*) from capacity_reservations
        where provider_id = p_id and state = 'held' and expires_at > now())::int;
$$;

create or replace function raise_exception_row (p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into reconciliation_exceptions (
    kind, severity, provider_id, purchase_id, provider_event_id, currency, amount_minor, detail
  ) values (
    p->>'kind',
    coalesce(p->>'severity', 'warning'),
    nullif(p->>'provider_id', '')::uuid,
    nullif(p->>'purchase_id', '')::uuid,
    nullif(p->>'provider_event_id', '')::uuid,
    nullif(p->>'currency', ''),
    nullif(p->>'amount_minor', '')::bigint,
    p->>'detail'
  ) returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Starting a checkout — hold, attempt and pending purchase together
-- ---------------------------------------------------------------------------

create or replace function create_checkout_records (p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid := (p->>'customer_id')::uuid;
  v_key text := p->>'idempotency_key';
  v_currency text := upper(p->>'currency');
  ver offer_versions%rowtype;
  o offers%rowtype;
  pr providers%rowtype;
  cps current_policy_set%rowtype;
  v_price bigint;
  v_attempt checkout_attempts%rowtype;
  v_reservation uuid;
  v_purchase uuid;
  v_hold int := coalesce((p->>'hold_seconds')::int, 1800);
begin
  if not is_privileged_writer () then
    raise exception 'server_only' using hint = 'Checkouts are created by the server.';
  end if;

  -- Same customer, same idempotency key: return what already exists. A
  -- double-clicked button or a retried request is one checkout, not two.
  select * into v_attempt from checkout_attempts
    where customer_id = v_customer and idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'reused', true,
      'attempt_id', v_attempt.id,
      'purchase_id', (select id from purchases where checkout_attempt_id = v_attempt.id),
      'reservation_id', v_attempt.reservation_id,
      'state', v_attempt.state,
      'stripe_checkout_session_id', v_attempt.stripe_checkout_session_id,
      'currency', v_attempt.currency,
      'amount_minor', v_attempt.amount_minor
    );
  end if;

  select * into ver from offer_versions where id = (p->>'offer_version_id')::uuid;
  if not found or ver.published_at is null or ver.superseded_at is not null then
    raise exception 'offer_unavailable' using hint = 'This plan is no longer available. Refresh to see the current one.';
  end if;

  select * into o from offers where id = ver.offer_id;
  if o.status <> 'published' then
    raise exception 'offer_unavailable' using hint = 'This plan is not open for new sign-ups.';
  end if;

  select * into pr from providers where id = o.provider_id;
  if not provider_is_public (pr.id) then
    raise exception 'coach_unavailable' using hint = 'This coach is not currently taking sign-ups.';
  end if;
  if not pr.accepting_new_clients and ver.service_type = 'recurring_coaching' then
    raise exception 'coach_not_accepting' using hint = 'This coach is not accepting new clients right now.';
  end if;

  if pr.profile_id = v_customer then
    raise exception 'own_offer' using hint = 'You cannot buy your own plan.';
  end if;

  select * into cps from current_policy_set where id;
  if not (ver.billing_structure::text = any (cps.publishable_billing_structures)) then
    raise exception 'billing_structure_not_sellable' using hint = 'This kind of plan cannot be purchased yet.';
  end if;

  select amount_minor into v_price from offer_prices
    where offer_version_id = ver.id and currency = v_currency;
  if v_price is null or v_price <= 0 then
    raise exception 'currency_not_offered' using hint = 'This plan is not sold in that currency.';
  end if;

  -- One ongoing plan per coach at a time.
  if ver.service_type = 'recurring_coaching' and exists (
    select 1 from purchases
    where customer_id = v_customer and provider_id = pr.id
      and service_type = 'recurring_coaching'
      and state in ('active', 'cancelling', 'past_due')
  ) then
    raise exception 'already_subscribed' using hint = 'You already have an ongoing plan with this coach.';
  end if;

  -- Ongoing coaching takes a place in the coach's client list. A one-off
  -- consultation does not.
  if ver.service_type = 'recurring_coaching' then
    v_reservation := reserve_capacity (pr.id, ver.id, v_customer, v_hold);
    if v_reservation is null then
      raise exception 'coach_full' using hint = 'This coach has no free places right now.';
    end if;
  end if;

  insert into checkout_attempts (
    customer_id, offer_version_id, provider_id, reservation_id,
    currency, amount_minor, idempotency_key, state, expires_at
  ) values (
    v_customer, ver.id, pr.id, v_reservation,
    v_currency, v_price, v_key, 'created', now() + make_interval(secs => v_hold)
  ) returning * into v_attempt;

  insert into purchases (
    customer_id, provider_id, offer_version_id, checkout_attempt_id, state,
    service_type, billing_structure, charge_currency, charge_amount_minor, display_currency,
    term_months, billing_interval, billing_interval_count, auto_renews, inclusions_snapshot,
    commission_policy_id, cancellation_policy_id, payment_failure_policy_id,
    recognition_policy_id, billing_terms_policy_id
  ) values (
    v_customer, pr.id, ver.id, v_attempt.id, 'pending_payment',
    ver.service_type, ver.billing_structure, v_currency, v_price, nullif(upper(p->>'display_currency'), ''),
    ver.term_months, ver.billing_interval, ver.billing_interval_count, ver.auto_renews,
    jsonb_build_object(
      'title', ver.title,
      'description', ver.description,
      'calls_included_per_month', ver.calls_included_per_month,
      'call_duration_minutes', ver.call_duration_minutes,
      'check_in_cadence', ver.check_in_cadence,
      'response_time_hours', ver.response_time_hours,
      'programme_included', ver.programme_included,
      'programme_review_cadence', ver.programme_review_cadence,
      'form_review_included', ver.form_review_included,
      'messaging_channel', ver.messaging_channel,
      'intended_client', ver.intended_client,
      'additional_inclusions', to_jsonb(ver.additional_inclusions),
      'offer_version', ver.version
    ),
    ver.commission_policy_id, ver.cancellation_policy_id, ver.payment_failure_policy_id,
    ver.recognition_policy_id, ver.billing_terms_policy_id
  ) returning id into v_purchase;

  return jsonb_build_object(
    'reused', false,
    'attempt_id', v_attempt.id,
    'purchase_id', v_purchase,
    'reservation_id', v_reservation,
    'state', 'created',
    'stripe_checkout_session_id', null,
    'currency', v_currency,
    'amount_minor', v_price,
    'expires_at', v_attempt.expires_at
  );
end;
$$;

create or replace function attach_checkout_session (p_attempt_id uuid, p_session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;
  update checkout_attempts
    set stripe_checkout_session_id = p_session_id, state = 'redirected'
    where id = p_attempt_id and state in ('created', 'redirected');
end;
$$;

-- Abandoned, expired, or failed to start. Releases only this attempt's own
-- hold. Never touches an attempt that has completed.
create or replace function close_checkout_attempt (p_attempt_id uuid, p_state text, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  a checkout_attempts%rowtype;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;
  if p_state not in ('expired', 'abandoned', 'failed') then
    raise exception 'invalid_state';
  end if;

  select * into a from checkout_attempts where id = p_attempt_id for update;
  if not found or a.state in ('completed', 'expired', 'abandoned', 'failed') then
    return false;
  end if;

  update checkout_attempts set state = p_state where id = a.id;

  if a.reservation_id is not null then
    update capacity_reservations
      set state = case when p_state = 'expired' then 'expired' else 'released' end,
          released_at = now()
      where id = a.reservation_id and state = 'held';
  end if;

  update purchases
    set state = 'ended', cancellation_reason = coalesce(p_reason, 'checkout_' || p_state), ends_at = now()
    where checkout_attempt_id = a.id and state = 'pending_payment';

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. A paid period
-- ---------------------------------------------------------------------------

create or replace function record_cycle_payment (p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pu purchases%rowtype;
  v_cycle_id uuid;
  v_source_key text := p->'cycle'->>'source_key';
  v_period_start timestamptz := (p->'cycle'->>'period_start')::timestamptz;
  v_period_end timestamptz := (p->'cycle'->>'period_end')::timestamptz;
  v_entry jsonb;
  v_entry_id uuid;
  v_written int := 0;
  v_enrollment enrollments%rowtype;
  v_attempt checkout_attempts%rowtype;
  v_res capacity_reservations%rowtype;
  v_pr providers%rowtype;
  v_requires_review boolean := false;
  v_attributed uuid;
  v_event uuid := nullif(p->>'source_event_id', '')::uuid;
  v_late boolean := false;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;
  if v_source_key is null then
    raise exception 'cycle_source_key_required';
  end if;

  select * into pu from purchases where id = (p->>'purchase_id')::uuid for update;
  if not found then
    raise exception 'purchase_not_found';
  end if;

  -- The period this money buys. Keyed by source_key, so the same invoice seen
  -- through two different events is one cycle.
  insert into billing_cycles (
    purchase_id, subscription_id, sequence, period_start, period_end, currency, amount_minor,
    state, paid_at, stripe_invoice_id, stripe_payment_intent_id, source_key
  )
  select
    pu.id,
    (select id from subscriptions where purchase_id = pu.id),
    coalesce(max(bc.sequence) + 1, 0),
    v_period_start, v_period_end,
    upper(p->'cycle'->>'currency'),
    (p->'cycle'->>'amount_minor')::bigint,
    'paid', now(),
    nullif(p->'cycle'->>'stripe_invoice_id', ''),
    nullif(p->'cycle'->>'stripe_payment_intent_id', ''),
    v_source_key
  from billing_cycles bc
  where bc.purchase_id = pu.id
  on conflict (source_key) where source_key is not null do nothing
  returning id into v_cycle_id;

  if v_cycle_id is null then
    select id into v_cycle_id from billing_cycles where source_key = v_source_key;
    -- A period that failed and was then recovered becomes paid.
    update billing_cycles
      set state = 'paid', paid_at = coalesce(paid_at, now()),
          stripe_payment_intent_id = coalesce(stripe_payment_intent_id, nullif(p->'cycle'->>'stripe_payment_intent_id', ''))
      where id = v_cycle_id and state in ('scheduled', 'failed');
  end if;

  -- Money for a purchase that is already over. Record it — money is truth —
  -- but make a person look at it rather than silently reopening anything.
  if pu.state in ('ended', 'refunded') then
    perform raise_exception_row (jsonb_build_object(
      'kind', 'payment_on_closed_purchase', 'severity', 'critical',
      'purchase_id', pu.id, 'provider_id', pu.provider_id, 'provider_event_id', v_event,
      'currency', upper(p->'cycle'->>'currency'), 'amount_minor', p->'cycle'->>'amount_minor',
      'detail', format('A payment arrived for a purchase in state %s.', pu.state)));
  end if;

  -- First payment for ongoing coaching opens the relationship.
  select * into v_enrollment from enrollments where purchase_id = pu.id;

  if v_enrollment.id is null and pu.service_type = 'recurring_coaching' and pu.state not in ('ended', 'refunded') then
    select * into v_attempt from checkout_attempts where id = pu.checkout_attempt_id;
    if v_attempt.reservation_id is not null then
      select * into v_res from capacity_reservations where id = v_attempt.reservation_id for update;
    end if;

    -- Same lock reserve_capacity() and set_my_capacity() take.
    select * into v_pr from providers where id = pu.provider_id for update;

    if v_res.id is not null and v_res.state = 'held' and v_res.expires_at > now() then
      update capacity_reservations set state = 'converted', converted_at = now() where id = v_res.id;
    else
      -- The hold lapsed before the money arrived. This is the late-payment
      -- recovery case: never overbook, never let the payment vanish.
      v_late := true;
      if v_res.id is not null and v_res.state = 'held' then
        update capacity_reservations set state = 'expired', released_at = now() where id = v_res.id;
      end if;

      if v_pr.max_active_clients is not null
         and provider_commitments (v_pr.id) >= v_pr.max_active_clients then
        v_requires_review := true;
      end if;
    end if;

    if not v_requires_review then
      insert into enrollments (customer_id, provider_id, purchase_id, state, started_at)
        values (pu.customer_id, pu.provider_id, pu.id, 'active', now())
        returning * into v_enrollment;
      insert into enrollment_assignments (enrollment_id, provider_id, effective_from, reason)
        values (v_enrollment.id, pu.provider_id, now(), 'initial_purchase');
    end if;

    if v_late then
      perform raise_exception_row (jsonb_build_object(
        'kind', 'late_payment_after_expiry',
        'severity', case when v_requires_review then 'critical' else 'info' end,
        'purchase_id', pu.id, 'provider_id', pu.provider_id, 'provider_event_id', v_event,
        'currency', upper(p->'cycle'->>'currency'), 'amount_minor', p->'cycle'->>'amount_minor',
        'detail', case when v_requires_review
          then 'Payment arrived after the capacity hold lapsed, and the coach is now full. The customer has paid and has NO coach. Refund or make room.'
          else 'Payment arrived after the capacity hold lapsed. A place was still free, so the customer was enrolled.' end));
    end if;
  elsif v_enrollment.id is not null and v_enrollment.state = 'paused' then
    -- A recovered payment resumes a relationship paused by a failed renewal.
    update enrollments set state = 'active' where id = v_enrollment.id;
  end if;

  -- Coach earnings go to whoever was assigned when this period STARTED, so a
  -- coach change never moves earned money from one coach to another.
  select a.provider_id into v_attributed
    from enrollments e
    join enrollment_assignments a on a.enrollment_id = e.id
    where e.purchase_id = pu.id
      and a.effective_from <= v_period_start
      and (a.effective_to is null or a.effective_to > v_period_start)
    order by a.effective_from desc
    limit 1;
  v_attributed := coalesce(v_attributed, pu.provider_id);

  for v_entry in select * from jsonb_array_elements(coalesce(p->'entries', '[]'::jsonb)) loop
    v_entry_id := null;  -- must reset: a conflicting insert returns no row

    insert into ledger_entries (
      account, effect, currency, amount_minor, provider_id, customer_id, purchase_id,
      billing_cycle_id, source_event_id, commission_policy_id, effect_key
    ) values (
      (v_entry->>'account')::ledger_account,
      (v_entry->>'effect')::ledger_effect,
      upper(v_entry->>'currency'),
      (v_entry->>'amountMinor')::bigint,
      v_attributed,
      pu.customer_id,
      pu.id,
      v_cycle_id,
      v_event,
      coalesce(v_entry->>'commissionPolicyId', pu.commission_policy_id),
      v_entry->>'effectKey'
    )
    on conflict (effect_key) do nothing
    returning id into v_entry_id;

    if v_entry_id is not null then
      v_written := v_written + 1;
      if v_entry->>'account' = 'coach_payable' then
        insert into earning_states (ledger_entry_id, provider_id, currency, state, eligible_at, hold_reason)
          values (
            v_entry_id, v_attributed, upper(v_entry->>'currency'),
            case when v_requires_review then 'held' else coalesce(v_entry->>'initialState', 'pending') end,
            case when coalesce(v_entry->>'initialState', 'pending') = 'eligible' and not v_requires_review then now() end,
            case when v_requires_review then 'late_payment_review' end
          );
      end if;
    end if;
  end loop;

  update purchases set
    state = case when state in ('pending_payment', 'past_due') then 'active'::purchase_state else state end,
    paid_through_at = greatest(coalesce(paid_through_at, v_period_end), v_period_end),
    started_at = coalesce(started_at, now()),
    requires_review = requires_review or v_requires_review,
    review_reason = case when v_requires_review then 'late_payment_coach_full' else review_reason end
  where id = pu.id;

  update checkout_attempts set state = 'completed', completed_at = coalesce(completed_at, now())
    where id = pu.checkout_attempt_id and state <> 'completed';

  if p ? 'notification' and jsonb_typeof(p->'notification') = 'object' then
    perform enqueue_outbox (
      p->'notification'->>'topic',
      p->'notification'->'payload',
      p->'notification'->>'dedupe_key'
    );
  end if;

  return jsonb_build_object(
    'cycle_id', v_cycle_id,
    'entries_written', v_written,
    'enrollment_id', v_enrollment.id,
    'requires_review', v_requires_review,
    'late', v_late
  );
end;
$$;

-- A renewal that did not collect. Paid-through access is untouched; no new
-- period opens; no history is erased.
create or replace function record_payment_failure (p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pu purchases%rowtype;
  v_cycle uuid;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  select * into pu from purchases where id = (p->>'purchase_id')::uuid for update;
  if not found then
    raise exception 'purchase_not_found';
  end if;

  if p->>'source_key' is not null then
    insert into billing_cycles (
      purchase_id, subscription_id, sequence, period_start, period_end, currency, amount_minor,
      state, stripe_invoice_id, source_key
    )
    select pu.id, (select id from subscriptions where purchase_id = pu.id),
      coalesce(max(bc.sequence) + 1, 0),
      coalesce((p->>'period_start')::timestamptz, now()),
      coalesce((p->>'period_end')::timestamptz, now() + interval '1 month'),
      upper(coalesce(p->>'currency', pu.charge_currency)),
      coalesce((p->>'amount_minor')::bigint, pu.charge_amount_minor),
      'failed', nullif(p->>'stripe_invoice_id', ''), p->>'source_key'
    from billing_cycles bc where bc.purchase_id = pu.id
    on conflict (source_key) where source_key is not null do nothing
    returning id into v_cycle;

    -- Never demote a period that has since been paid.
    if v_cycle is null then
      update billing_cycles set state = 'failed'
        where source_key = p->>'source_key' and state = 'scheduled';
    end if;
  end if;

  update purchases set state = 'past_due' where id = pu.id and state = 'active';

  if p ? 'notification' and jsonb_typeof(p->'notification') = 'object' then
    perform enqueue_outbox (p->'notification'->>'topic', p->'notification'->'payload', p->'notification'->>'dedupe_key');
  end if;

  return jsonb_build_object('purchase_state', (select state from purchases where id = pu.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Subscription state from the authoritative Stripe object
-- ---------------------------------------------------------------------------

create or replace function sync_subscription_state (p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pu purchases%rowtype;
  s subscriptions%rowtype;
  v_status text := p->>'status';
  v_observed timestamptz := (p->>'observed_at')::timestamptz;
  v_state purchase_state;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  select * into pu from purchases where id = (p->>'purchase_id')::uuid for update;
  if not found then
    raise exception 'purchase_not_found';
  end if;

  insert into subscriptions (purchase_id, stripe_subscription_id, stripe_customer_id, state)
    values (pu.id, p->>'stripe_subscription_id', nullif(p->>'stripe_customer_id', ''), 'incomplete')
    on conflict (stripe_subscription_id) do nothing;

  select * into s from subscriptions where stripe_subscription_id = p->>'stripe_subscription_id' for update;

  -- The state passed in was fetched from Stripe at `observed_at`. An OLDER
  -- observation finishing after a newer one must not overwrite it. An EQUAL
  -- one is the same truth and applying it again changes nothing.
  if s.last_event_at is not null and v_observed < s.last_event_at then
    return jsonb_build_object('applied', false, 'reason', 'older_observation');
  end if;

  update subscriptions set
    state = v_status,
    stripe_customer_id = coalesce(nullif(p->>'stripe_customer_id', ''), stripe_customer_id),
    cancel_at_period_end = coalesce((p->>'cancel_at_period_end')::boolean, false),
    current_period_start = nullif(p->>'current_period_start', '')::timestamptz,
    current_period_end = nullif(p->>'current_period_end', '')::timestamptz,
    last_event_at = v_observed
  where id = s.id;

  -- Refunded and disputed are decided by money events, not by the subscription.
  if pu.state in ('refunded', 'disputed') then
    return jsonb_build_object('applied', true, 'purchase_state', pu.state);
  end if;

  v_state := case
    when v_status in ('canceled', 'incomplete_expired') then 'ended'
    when v_status in ('past_due', 'unpaid') then 'past_due'
    when v_status in ('active', 'trialing') and coalesce((p->>'cancel_at_period_end')::boolean, false) then 'cancelling'
    when v_status in ('active', 'trialing') then
      case when pu.state = 'pending_payment' then 'pending_payment' else 'active' end
    when v_status = 'incomplete' then 'pending_payment'
    else pu.state
  end;

  update purchases set
    state = v_state,
    cancelled_at = case
      when v_state in ('cancelling', 'ended') then coalesce(cancelled_at, nullif(p->>'canceled_at', '')::timestamptz, now())
      when v_state = 'active' then null
      else cancelled_at end,
    ends_at = case
      when v_state = 'ended' then coalesce(nullif(p->>'ended_at', '')::timestamptz, now())
      when v_state = 'cancelling' then nullif(p->>'current_period_end', '')::timestamptz
      when v_state = 'active' then null
      else ends_at end
  where id = pu.id;

  -- A failed renewal pauses the relationship at the paid-through date; a
  -- recovered one resumes it. Ending waits for paid-through to pass, in
  -- end_lapsed_enrollments(), because the customer paid for that time.
  if v_state = 'past_due' then
    update enrollments set state = 'paused'
      where purchase_id = pu.id and state = 'active'
        and (pu.paid_through_at is null or pu.paid_through_at <= now());
  end if;

  if p ? 'notification' and jsonb_typeof(p->'notification') = 'object' and v_state <> pu.state then
    perform enqueue_outbox (p->'notification'->>'topic', p->'notification'->'payload', p->'notification'->>'dedupe_key');
  end if;

  return jsonb_build_object('applied', true, 'purchase_state', v_state, 'previous_state', pu.state);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Refunds
-- ---------------------------------------------------------------------------

create or replace function record_refund_effects (p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pu purchases%rowtype;
  r refunds%rowtype;
  v_state text := p->'refund'->>'state';
  v_stripe_id text := p->'refund'->>'stripe_refund_id';
  v_request uuid := nullif(p->'refund'->>'request_id', '')::uuid;
  v_cycle uuid := nullif(p->>'billing_cycle_id', '')::uuid;
  v_prev bigint;
  v_entry jsonb;
  v_entry_id uuid;
  v_written int := 0;
  v_paid_out boolean;
  v_total_paid bigint;
  v_total_refunded bigint;
  v_event uuid := nullif(p->>'source_event_id', '')::uuid;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  select * into pu from purchases where id = (p->>'purchase_id')::uuid for update;
  if not found then
    raise exception 'purchase_not_found';
  end if;

  select * into r from refunds where stripe_refund_id = v_stripe_id for update;
  if not found and v_request is not null then
    select * into r from refunds where id = v_request for update;
  end if;

  -- A refund that already succeeded stays succeeded: a stale 'pending'
  -- observation arriving late must not undo it.
  if r.id is not null and r.state = 'succeeded' and v_state <> 'succeeded' then
    v_state := 'succeeded';
  end if;

  if v_state = 'succeeded' and (r.id is null or r.state <> 'succeeded') then
    -- The reversal was computed from a cumulative total. If another refund on
    -- the same service succeeded in the meantime, that basis is stale and the
    -- rounding would not reconcile. Refuse; the webhook fails and retries with
    -- a fresh basis.
    select coalesce(sum(amount_minor), 0) into v_prev
      from refunds
      where purchase_id = pu.id
        and state = 'succeeded'
        and coalesce(billing_cycle_id::text, '') = coalesce(v_cycle::text, '')
        and id is distinct from r.id;

    if v_prev <> coalesce((p->>'previously_refunded_minor')::bigint, 0) then
      raise exception 'stale_refund_basis'
        using detail = format('expected %s, found %s', p->>'previously_refunded_minor', v_prev);
    end if;
  end if;

  if r.id is null then
    insert into refunds (purchase_id, billing_cycle_id, stripe_refund_id, stripe_payment_intent_id,
                         currency, amount_minor, state, reason, settled_at)
      values (pu.id, v_cycle, v_stripe_id, nullif(p->'refund'->>'stripe_payment_intent_id', ''),
              upper(p->'refund'->>'currency'), (p->'refund'->>'amount_minor')::bigint,
              v_state, nullif(p->'refund'->>'reason', ''),
              case when v_state = 'succeeded' then now() end)
      returning * into r;
  else
    update refunds set
      stripe_refund_id = coalesce(stripe_refund_id, v_stripe_id),
      billing_cycle_id = coalesce(billing_cycle_id, v_cycle),
      state = v_state,
      settled_at = case when v_state = 'succeeded' then coalesce(settled_at, now()) else settled_at end
    where id = r.id
    returning * into r;
  end if;

  -- Only a SUCCEEDED refund reverses anything.
  if v_state = 'succeeded' then
    for v_entry in select * from jsonb_array_elements(coalesce(p->'entries', '[]'::jsonb)) loop
      v_entry_id := null;
      insert into ledger_entries (
        account, effect, currency, amount_minor, provider_id, customer_id, purchase_id,
        billing_cycle_id, source_event_id, commission_policy_id, effect_key, reverses_entry_id
      ) values (
        (v_entry->>'account')::ledger_account, (v_entry->>'effect')::ledger_effect,
        upper(v_entry->>'currency'), (v_entry->>'amountMinor')::bigint,
        -- A reversal belongs to the coach who earned the original.
        coalesce(
          (select provider_id from ledger_entries where effect_key = v_entry->>'reversesEffectKey'),
          pu.provider_id),
        pu.customer_id, pu.id, v_cycle, v_event,
        coalesce(v_entry->>'commissionPolicyId', pu.commission_policy_id),
        v_entry->>'effectKey',
        (select id from ledger_entries where effect_key = v_entry->>'reversesEffectKey')
      )
      on conflict (effect_key) do nothing
      returning id into v_entry_id;

      if v_entry_id is not null then
        v_written := v_written + 1;
        if v_entry->>'account' = 'coach_payable' then
          insert into earning_states (ledger_entry_id, provider_id, currency, state, eligible_at)
            select v_entry_id, provider_id, currency, 'eligible', now()
            from ledger_entries where id = v_entry_id;
        end if;
      end if;
    end loop;

    -- Refunding money the coach has already been paid is not netted off
    -- quietly. It becomes a negative balance, carried forward, and a person
    -- sees it.
    select exists (
      select 1 from ledger_entries le
      join earning_states es on es.ledger_entry_id = le.id
      where le.purchase_id = pu.id
        and (v_cycle is null or le.billing_cycle_id = v_cycle)
        and le.account = 'coach_payable' and le.effect = 'service_earned'
        and es.state in ('batched', 'paid')
    ) into v_paid_out;

    if v_paid_out and v_written > 0 then
      perform raise_exception_row (jsonb_build_object(
        'kind', 'refund_after_payout', 'severity', 'warning',
        'purchase_id', pu.id, 'provider_id', pu.provider_id, 'provider_event_id', v_event,
        'currency', r.currency, 'amount_minor', r.amount_minor,
        'detail', 'Refunded after the coach''s share was already batched or paid. The reversal carries forward as a negative balance; nothing is collected from the coach.'));
    end if;

    select coalesce(sum(amount_minor), 0) into v_total_paid
      from billing_cycles where purchase_id = pu.id and state in ('paid', 'delivered', 'refunded');
    select coalesce(sum(amount_minor), 0) into v_total_refunded
      from refunds where purchase_id = pu.id and state = 'succeeded';

    if v_cycle is not null then
      update billing_cycles set state = 'refunded'
        where id = v_cycle
          and amount_minor <= (select coalesce(sum(amount_minor), 0) from refunds
                               where billing_cycle_id = v_cycle and state = 'succeeded');
    end if;

    if v_total_paid > 0 and v_total_refunded >= v_total_paid then
      update purchases set state = 'refunded' where id = pu.id and state <> 'refunded';
    end if;

    if p ? 'notification' and jsonb_typeof(p->'notification') = 'object' then
      perform enqueue_outbox (p->'notification'->>'topic', p->'notification'->'payload', p->'notification'->>'dedupe_key');
    end if;
  end if;

  return jsonb_build_object('refund_id', r.id, 'state', v_state, 'entries_written', v_written);
end;
$$;

-- An admin asking for a refund. Records the request; Stripe does the refund;
-- the webhook records the outcome. The request row is not the refund.
create or replace function admin_request_refund (
  p_purchase_id uuid,
  p_billing_cycle_id uuid,
  p_amount_minor bigint,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pu purchases%rowtype;
  c billing_cycles%rowtype;
  v_already bigint;
  v_id uuid;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'reason_required' using hint = 'Record why this refund is being made.';
  end if;

  select * into pu from purchases where id = p_purchase_id for update;
  select * into c from billing_cycles where id = p_billing_cycle_id and purchase_id = p_purchase_id;
  if pu.id is null or c.id is null then
    raise exception 'not_found' using hint = 'That payment does not belong to this purchase.';
  end if;
  if c.state not in ('paid', 'delivered') then
    raise exception 'not_refundable' using hint = 'Only a paid period can be refunded.';
  end if;

  select coalesce(sum(amount_minor), 0) into v_already
    from refunds where billing_cycle_id = c.id and state in ('requested', 'pending', 'succeeded');

  if p_amount_minor <= 0 or p_amount_minor + v_already > c.amount_minor then
    raise exception 'refund_exceeds_payment'
      using hint = format('At most %s can still be refunded on this payment.', c.amount_minor - v_already);
  end if;

  insert into refunds (purchase_id, billing_cycle_id, stripe_payment_intent_id, currency, amount_minor,
                       state, reason, requested_by)
    values (pu.id, c.id, c.stripe_payment_intent_id, c.currency, p_amount_minor, 'requested', p_reason, auth.uid ())
    returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Disputes — applied from the authoritative dispute state
-- ---------------------------------------------------------------------------

create or replace function record_dispute_effects (p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pu purchases%rowtype;
  d disputes%rowtype;
  v_state text := p->'dispute'->>'state';
  v_stripe_id text := p->'dispute'->>'stripe_dispute_id';
  v_hold text := 'dispute:' || (p->'dispute'->>'stripe_dispute_id');
  v_entry jsonb;
  v_entry_id uuid;
  v_written int := 0;
  v_new boolean := false;
  v_after_payout boolean;
  v_event uuid := nullif(p->>'source_event_id', '')::uuid;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  select * into pu from purchases where id = (p->>'purchase_id')::uuid for update;
  if not found then
    raise exception 'purchase_not_found';
  end if;

  select * into d from disputes where stripe_dispute_id = v_stripe_id for update;
  if not found then
    v_new := true;
    insert into disputes (purchase_id, stripe_dispute_id, currency, amount_minor, state, reason)
      values (pu.id, v_stripe_id, upper(p->'dispute'->>'currency'), (p->'dispute'->>'amount_minor')::bigint,
              v_state, nullif(p->'dispute'->>'reason', ''))
      returning * into d;
  end if;

  -- A closed dispute never reopens because a stale observation arrived.
  if d.state in ('won', 'lost') and v_state not in ('won', 'lost') then
    v_state := d.state;
  end if;

  update disputes set state = v_state,
    closed_at = case when v_state in ('won', 'lost', 'warning_closed') then coalesce(closed_at, now()) end
  where id = d.id;

  -- The entries passed in describe the FINAL state (open: hold; won: hold +
  -- release; lost: hold + release + reversal). Effect keys make re-applying any
  -- subset harmless, which is what lets out-of-order events converge.
  for v_entry in select * from jsonb_array_elements(coalesce(p->'entries', '[]'::jsonb)) loop
    v_entry_id := null;
    insert into ledger_entries (
      account, effect, currency, amount_minor, provider_id, customer_id, purchase_id,
      source_event_id, commission_policy_id, effect_key
    ) values (
      (v_entry->>'account')::ledger_account, (v_entry->>'effect')::ledger_effect,
      upper(v_entry->>'currency'), (v_entry->>'amountMinor')::bigint,
      pu.provider_id, pu.customer_id, pu.id, v_event,
      coalesce(v_entry->>'commissionPolicyId', pu.commission_policy_id),
      v_entry->>'effectKey'
    )
    on conflict (effect_key) do nothing
    returning id into v_entry_id;

    if v_entry_id is not null then
      v_written := v_written + 1;
      if v_entry->>'account' = 'coach_payable' then
        insert into earning_states (ledger_entry_id, provider_id, currency, state, eligible_at)
          values (v_entry_id, pu.provider_id, upper(v_entry->>'currency'), 'eligible', now());
      end if;
    end if;
  end loop;

  if v_state in ('open', 'under_review', 'needs_response', 'warning_needs_response', 'warning_under_review') then
    -- Freeze the coach's unpaid earnings on this purchase.
    update earning_states es set state = 'held', hold_reason = v_hold
      from ledger_entries le
      where le.id = es.ledger_entry_id
        and le.purchase_id = pu.id
        and le.account = 'coach_payable'
        and le.effect = 'service_earned'
        and es.state in ('pending', 'eligible');

    update purchases set state = 'disputed' where id = pu.id and state not in ('refunded', 'disputed');
  elsif v_state = 'won' or v_state = 'warning_closed' then
    update earning_states es set
        state = case when bc.state = 'delivered' then 'eligible' else 'pending' end,
        hold_reason = null
      from ledger_entries le
      left join billing_cycles bc on bc.id = le.billing_cycle_id
      where le.id = es.ledger_entry_id and es.state = 'held' and es.hold_reason = v_hold;

    update purchases set state = case when paid_through_at > now() then 'active'::purchase_state else 'ended'::purchase_state end
      where id = pu.id and state = 'disputed';
  elsif v_state = 'lost' then
    -- The held earnings net against the reversal entries, so both become
    -- eligible and the batch sees zero.
    update earning_states es set state = 'eligible', hold_reason = null, eligible_at = now()
      from ledger_entries le
      where le.id = es.ledger_entry_id and es.state = 'held' and es.hold_reason = v_hold;

    update purchases set state = 'refunded' where id = pu.id;
  end if;

  if v_new then
    select exists (
      select 1 from ledger_entries le join earning_states es on es.ledger_entry_id = le.id
      where le.purchase_id = pu.id and le.account = 'coach_payable' and es.state in ('batched', 'paid')
    ) into v_after_payout;

    perform raise_exception_row (jsonb_build_object(
      'kind', case when v_after_payout then 'dispute_after_payout' else 'dispute_opened' end,
      'severity', 'critical',
      'purchase_id', pu.id, 'provider_id', pu.provider_id, 'provider_event_id', v_event,
      'currency', d.currency, 'amount_minor', d.amount_minor,
      'detail', format('Dispute %s opened (%s). Evidence is due in Stripe. Unpaid earnings on this purchase are held.', v_stripe_id, coalesce(d.reason, 'no reason given'))));
  end if;

  return jsonb_build_object('dispute_id', d.id, 'state', v_state, 'entries_written', v_written, 'new', v_new);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Time-based sweeps
-- ---------------------------------------------------------------------------

-- Earnings become eligible when the service period has actually been
-- delivered — not when the money arrived. One-off consultations are excluded:
-- they need a completion event from the appointment lifecycle, which does not
-- exist yet, and nothing here fabricates one.
create or replace function recognise_delivered_cycles ()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  with delivered as (
    update billing_cycles bc
      set state = 'delivered', delivered_at = now()
      from purchases pu
      where pu.id = bc.purchase_id
        and bc.state = 'paid'
        and bc.period_end <= now()
        and pu.service_type = 'recurring_coaching'
        and pu.state not in ('disputed', 'refunded')
        and not pu.requires_review
      returning bc.id
  )
  update earning_states es
    set state = 'eligible', eligible_at = now()
    from ledger_entries le
    where le.id = es.ledger_entry_id
      and le.billing_cycle_id in (select id from delivered)
      and le.account = 'coach_payable'
      and es.state = 'pending';

  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function end_lapsed_enrollments ()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  update enrollments e set state = 'ended', ended_at = now()
    from purchases pu
    where pu.id = e.purchase_id
      and e.state in ('active', 'paused')
      and pu.state in ('ended', 'refunded')
      and (pu.paid_through_at is null or pu.paid_through_at <= now());

  get diagnostics n = row_count;

  -- A renewal failed earlier and the time the customer DID pay for has now run
  -- out. With no grace period (payment_failure.v1), service pauses here. The
  -- place is kept — a recovered payment resumes it.
  update enrollments e set state = 'paused'
    from purchases pu
    where pu.id = e.purchase_id
      and e.state = 'active'
      and pu.state = 'past_due'
      and pu.paid_through_at is not null
      and pu.paid_through_at <= now();

  -- The last open assignment closes with the relationship, which is what
  -- revokes the coach's access to the customer's private records.
  update enrollment_assignments a set effective_to = now()
    from enrollments e
    where e.id = a.enrollment_id and e.state = 'ended' and a.effective_to is null;

  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: all server-only except the admin refund request
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'raise_exception_row(jsonb)',
    'create_checkout_records(jsonb)',
    'attach_checkout_session(uuid, text)',
    'close_checkout_attempt(uuid, text, text)',
    'record_cycle_payment(jsonb)',
    'record_payment_failure(jsonb)',
    'sync_subscription_state(jsonb)',
    'record_refund_effects(jsonb)',
    'record_dispute_effects(jsonb)',
    'recognise_delivered_cycles()',
    'end_lapsed_enrollments()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

revoke execute on function admin_request_refund (uuid, uuid, bigint, text) from public, anon;
grant execute on function admin_request_refund (uuid, uuid, bigint, text) to authenticated, service_role;

notify pgrst, 'reload schema';
