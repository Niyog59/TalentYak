-- Approved paid-access rules (founder instruction, 2026-09-22).
--
-- These replace the sandbox defaults they conflict with. In full:
--
--   1. Cancelling a renewal keeps access ACTIVE until the already-paid period
--      ends. Already true: sync_subscription_state() only pauses once
--      paid_through_at has passed, and end_lapsed_enrollments() waits for it.
--      cancellation.v2 is that rule, approved.
--   2. When a renewal fails and the paid period has run out, NEW service
--      pauses — new messages, new bookings, new coaching activity — and the
--      customer is shown the approved wording.
--   3. Progress, plans, logs and message history are preserved and stay
--      readable under the permissions that already apply. A failed payment
--      never deletes anything, here or anywhere: retention's destructive
--      execution remains off and is not connected to billing.
--   4. A successful payment restores the paused access, losing nothing, and
--      NEVER overrides a suspension or a coach reassignment.
--
-- What actually changes in this migration: coach-side coaching activity stops
-- while a relationship is paused (it did not before), the approved wording is
-- stored once and read by the conversation screen, the recovery path refuses
-- to resume a relationship whose assignment is no longer open, and the policy
-- ids move to the approved versions.

-- ---------------------------------------------------------------------------
-- 1. Approved policy versions
-- ---------------------------------------------------------------------------

update current_policy_set
  set cancellation_policy_id = 'cancellation.v2',
      payment_failure_policy_id = 'payment_failure.v2',
      updated_at = now()
  where id;

alter table messaging_settings
  add column if not exists paused_notice text not null
    default 'Your payment didn’t go through. Renew to continue coaching. Your progress is saved.';

update messaging_settings
  set policy_id = 'messaging.v2',
      policy_status = 'confirmed',
      paused_notice = 'Your payment didn’t go through. Renew to continue coaching. Your progress is saved.',
      updated_at = now()
  where id;

-- ---------------------------------------------------------------------------
-- 2. Is coaching live right now?
-- ---------------------------------------------------------------------------
--
-- One test for "new coaching activity may happen on this relationship":
-- the relationship is active (not paused by an unpaid renewal, not ended),
-- an assignment is open, and neither party is suspended.
--
-- Reading is deliberately NOT included: coach_may_read_record() still allows
-- 'paused', because a pause must not take away what has already been recorded.

create or replace function coaching_is_live (e_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from enrollments e
    join enrollment_assignments a on a.enrollment_id = e.id
    join providers p on p.id = a.provider_id
    join profiles coach on coach.id = p.profile_id
    join profiles customer on customer.id = e.customer_id
    where e.id = e_id
      and e.state = 'active'
      and a_open (a.effective_from, a.effective_to)
      and p.suspended_at is null and p.status <> 'suspended'
      and coach.suspended_at is null
      and customer.suspended_at is null
  );
$$;

comment on function coaching_is_live (uuid) is
  'True when new coaching activity may happen: relationship active (a failed renewal past paid-through pauses it), assignment open, neither party suspended. Bookings and any future coaching action must check this. Reading is not gated by it.';

-- The coach WRITE gate, used by every programme policy in 0021. Until now it
-- allowed 'paused', so a coach could keep writing programming for a
-- relationship whose payment had lapsed. Reads are unchanged.
create or replace function coaches_enrollment_now (e_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coaching_is_live (e_id)
     and exists (
       select 1
       from enrollment_assignments a
       join providers p on p.id = a.provider_id
       where a.enrollment_id = e_id
         and a.effective_to is null
         and p.profile_id = auth.uid ()
     );
$$;

comment on function coaches_enrollment_now (uuid) is
  'May the calling coach add new coaching work to this relationship right now? Requires coaching_is_live(): an unpaid, paused relationship is read-only for the coach until payment is recovered (payment_failure.v2).';

revoke execute on function coaching_is_live (uuid) from public, anon;
grant execute on function coaching_is_live (uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The approved wording, shown where a customer meets the pause
-- ---------------------------------------------------------------------------

create or replace function conversation_access (p_id uuid, p_uid uuid)
returns table (role text, can_read boolean, can_send boolean, state text, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  s messaging_settings;
  v_open boolean;
  v_coach_ok boolean;
  v_customer_ok boolean;
  v_live boolean;
begin
  select c.customer_id, e.state as e_state, a.effective_from, a.effective_to,
         p.profile_id as coach_profile, p.status as p_status, p.suspended_at as p_suspended,
         cp.suspended_at as coach_suspended, cu.suspended_at as customer_suspended
    into r
    from conversations c
    join enrollments e on e.id = c.enrollment_id
    join enrollment_assignments a on a.id = c.assignment_id
    join providers p on p.id = c.provider_id
    join profiles cp on cp.id = p.profile_id
    join profiles cu on cu.id = c.customer_id
    where c.id = p_id;

  if not found or p_uid is null then
    return;
  end if;

  select * into s from messaging_settings where id;

  v_open := a_open (r.effective_from, r.effective_to);
  v_coach_ok := r.p_suspended is null and r.p_status <> 'suspended' and r.coach_suspended is null;
  v_customer_ok := r.customer_suspended is null;
  v_live := v_open and r.e_state in ('active', 'paused');

  if p_uid = r.customer_id then
    role := 'customer';
    if not v_customer_ok then
      can_read := false; can_send := false; state := 'suspended';
      reason := 'Your account is paused. Contact support.';
    else
      can_read := v_live or s.client_reads_after_end;
      if r.e_state = 'ended' then
        state := 'ended'; can_send := false;
        reason := 'This coaching has ended. You can still read your messages.';
      elsif not v_open then
        state := 'reassigned'; can_send := false;
        reason := 'You have a different coach now. This conversation is kept for you to read.';
      elsif not v_coach_ok then
        state := 'suspended'; can_send := false;
        reason := 'Your coach is not available at the moment. Contact support if you need help.';
      elsif r.e_state = 'pending' then
        state := 'pending'; can_send := false;
        reason := 'Messaging opens once your coaching starts.';
      elsif r.e_state = 'paused' then
        state := 'paused'; can_send := s.send_while_paused;
        -- Founder-approved wording (payment_failure.v2), stored once.
        reason := case when s.send_while_paused then null else s.paused_notice end;
      else
        state := 'active'; can_send := true; reason := null;
      end if;
    end if;
    return next;
    return;
  end if;

  if p_uid = r.coach_profile then
    role := 'coach';
    if not v_coach_ok then
      can_read := false; can_send := false; state := 'suspended';
      reason := 'Your coaching account is paused. Contact support.';
    elsif not v_live then
      can_read := false; can_send := false;
      state := case when r.e_state = 'ended' then 'ended' else 'reassigned' end;
      reason := 'You are no longer this client''s coach.';
    elsif not v_customer_ok then
      can_read := true; can_send := false; state := 'suspended';
      reason := 'This client''s account is paused.';
    elsif r.e_state = 'paused' then
      can_read := true; can_send := s.send_while_paused; state := 'paused';
      reason := case when s.send_while_paused then null
                     else 'This client''s payment didn''t go through. You can read the history; new coaching resumes when they renew.' end;
    else
      can_read := true; can_send := true; state := 'active'; reason := null;
    end if;
    return next;
    return;
  end if;
end;
$$;

revoke execute on function conversation_access (uuid, uuid) from public, anon, authenticated;
grant execute on function conversation_access (uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Recovery restores what was paused — and nothing else
-- ---------------------------------------------------------------------------
--
-- record_cycle_payment() already resumed a paused relationship. It did not
-- check that the relationship was still the same one: if a coach change had
-- closed the assignment, or an admin had ended it, a late payment would have
-- flipped it back to 'active' with nobody assigned. Resuming now requires an
-- open assignment; otherwise the money is still recorded, the relationship is
-- left as it is, and a person is asked to look.

create or replace function resume_paid_enrollment (p_enrollment uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resumed boolean := false;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  update enrollments e set state = 'active'
    where e.id = p_enrollment
      and e.state = 'paused'
      and exists (
        select 1 from enrollment_assignments a
        where a.enrollment_id = e.id and a.effective_to is null
      );

  get diagnostics v_resumed = row_count;
  -- Suspension is not touched here: it lives on the profile or the provider,
  -- is applied by an administrator, and a payment does not undo it. The access
  -- functions keep refusing while it stands, whatever this row says.
  return v_resumed;
end;
$$;

revoke execute on function resume_paid_enrollment (uuid) from public, anon, authenticated;
grant execute on function resume_paid_enrollment (uuid) to service_role;

comment on function resume_paid_enrollment (uuid) is
  'Restores a relationship paused by a failed renewal, only while its assignment is still open. Never lifts a suspension, never reopens a reassigned or ended relationship (payment_failure.v2).';

-- ---------------------------------------------------------------------------
-- 5. record_cycle_payment: resume through the guarded path
-- ---------------------------------------------------------------------------
--
-- Unchanged from 0019 apart from the paused-relationship branch, which now
-- goes through resume_paid_enrollment() and reports when it cannot resume.

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
    -- A recovered payment restores what the failed renewal paused — and only
    -- that. resume_paid_enrollment() refuses when the assignment is no longer
    -- open (a coach change, or an ended relationship), and never touches a
    -- suspension, which is an administrator's decision, not a payment's.
    if not resume_paid_enrollment (v_enrollment.id) then
      perform raise_exception_row (jsonb_build_object(
        'kind', 'payment_could_not_resume_coaching', 'severity', 'critical',
        'purchase_id', pu.id, 'provider_id', pu.provider_id, 'provider_event_id', v_event,
        'currency', upper(p->'cycle'->>'currency'), 'amount_minor', p->'cycle'->>'amount_minor',
        'detail', 'A payment recovered a paused relationship, but it has no open coach assignment, so it was left paused. The customer has paid; assign a coach or refund.'));
    end if;
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

notify pgrst, 'reload schema';
