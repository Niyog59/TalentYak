-- SECURITY FIX · in_action() could return NULL, silently disabling guards.
--
-- Found 2026-09-16 by workflows.db.test.ts: an approved coach ran
--
--     update offers set status = 'published' where id = ...;
--
-- directly, and it succeeded, although guard_offer_publication() exists to
-- refuse exactly that.
--
-- ROOT CAUSE — three-valued logic.
--
-- 0017 defined in_action() as `current_setting('talentyak.action', true) = p_name`.
-- On a database connection where that setting has never been set, current_setting
-- with missing_ok returns NULL, so in_action() returned NULL, not false. Guards
-- were written as
--
--     if not (is_privileged_writer () or in_action ('offer_publication')) then raise ...
--
-- which evaluates `not (false or null)` = `not null` = NULL, and plpgsql treats an
-- IF condition of NULL as false. The guard did nothing.
--
-- It was INTERMITTENT. PostgREST reuses pooled connections. On a connection where
-- the setting had been set in an earlier transaction, it reverts to an empty
-- string rather than NULL, `'' = 'offer_publication'` is a genuine false, and the
-- guard worked. So most runs passed and some did not — the worst kind of
-- security bug to rely on a test to find, and the reason this suite hammers the
-- same checks through fresh sessions.
--
-- AFFECTED — every guard in 0017 that used in_action() under NOT:
--   guard_provider_publication     coach editing own status, approval, publication, capacity
--   guard_offer_publication        coach publishing an offer directly
--   guard_offer_version_publication coach publishing a version directly
--   guard_profile_photo (0022)     fail-safe direction: restored on NULL, so unaffected
--
-- EXPOSURE: none real. Empty project, no real accounts, nothing deployed.
--
-- FIX: in_action() can no longer return NULL.

create or replace function in_action (p_name text)
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('talentyak.action', true), '') = coalesce(p_name, '');
$$;

comment on function in_action (text) is
  'Never NULL. A NULL here disabled every guard written as IF NOT (... OR in_action(...)). See 0023.';

-- ---------------------------------------------------------------------------
-- FIX · sync_subscription_state raised "CASE types purchase_state and text
-- cannot be matched".
-- ---------------------------------------------------------------------------
--
-- A nested CASE returned bare string literals, which resolve to text, while the
-- outer CASE returned the purchase_state column. Postgres refuses to unify them.
-- Every branch is now cast explicitly.

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

  if pu.state in ('refunded', 'disputed') then
    return jsonb_build_object('applied', true, 'purchase_state', pu.state);
  end if;

  v_state := case
    when v_status in ('canceled', 'incomplete_expired') then 'ended'::purchase_state
    when v_status in ('past_due', 'unpaid') then 'past_due'::purchase_state
    when v_status in ('active', 'trialing') and coalesce((p->>'cancel_at_period_end')::boolean, false)
      then 'cancelling'::purchase_state
    when v_status in ('active', 'trialing') and pu.state = 'pending_payment'
      then 'pending_payment'::purchase_state
    when v_status in ('active', 'trialing') then 'active'::purchase_state
    when v_status = 'incomplete' then 'pending_payment'::purchase_state
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

revoke execute on function sync_subscription_state (jsonb) from public, anon, authenticated;
grant execute on function sync_subscription_state (jsonb) to service_role;

notify pgrst, 'reload schema';
