-- M17 · Test activity in the founder's overview, tightened.
--
-- The walkthrough found ledger rows from earlier automated runs counted as
-- real: their fixture coaches' accounts had been deleted, so "is this a test
-- account?" had nothing to look at and said no. Real now has to be shown,
-- not assumed: a ledger row counts when its purchase is live, or — for a row
-- with no purchase (a manual adjustment) — when it belongs to a coach whose
-- account still exists and isn't a test account. The same rule applies to
-- what coaches are owed and to recorded payouts.

create or replace function provider_is_real (p_provider uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from providers pr join profiles p on p.id = pr.profile_id
    where pr.id = p_provider and not is_test_profile (p.id));
$$;

revoke execute on function provider_is_real (uuid) from public, anon, authenticated;

create or replace function admin_overview_metrics (p_from timestamptz, p_to timestamptz, p_tz text, p_include_test boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text := coalesce(nullif(p_tz, ''), 'UTC');
  v jsonb;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'invalid_range' using hint = 'Choose a range of up to 400 days.';
  end if;
  perform now() at time zone v_tz; -- rejects an unknown zone

  with
  live_purchases as (
    select pu.id, pu.customer_id, pu.state, pu.cancelled_at, pu.paid_through_at,
           (p_include_test or purchase_is_live (pu.id)) as counted
    from purchases pu
  ),
  cycles as (
    select bc.currency, bc.amount_minor, bc.paid_at
    from billing_cycles bc join live_purchases lp on lp.id = bc.purchase_id
    where lp.counted and bc.paid_at >= p_from and bc.paid_at < p_to
  ),
  refunds_in as (
    select r.currency, r.amount_minor from refunds r join live_purchases lp on lp.id = r.purchase_id
    where lp.counted and r.state = 'succeeded' and r.settled_at >= p_from and r.settled_at < p_to
  ),
  ledger_in as (
    select le.account, le.effect, le.currency, le.amount_minor
    from ledger_entries le left join live_purchases lp on lp.id = le.purchase_id
    where le.occurred_at >= p_from and le.occurred_at < p_to
      and (p_include_test
           or (lp.id is not null and lp.counted)
           or (lp.id is null and le.provider_id is not null and provider_is_real (le.provider_id)))
  ),
  owed as (
    select es.currency, es.state, sum(le.amount_minor) as amount
    from earning_states es join ledger_entries le on le.id = es.ledger_entry_id
    left join live_purchases lp on lp.id = le.purchase_id
    join providers pr on pr.id = es.provider_id
    where es.state in ('pending', 'held', 'eligible', 'batched')
      and (p_include_test or (lp.id is not null and lp.counted) or (lp.id is null and provider_is_real (pr.id)))
    group by es.currency, es.state
  ),
  payouts_in as (
    select i.currency, i.amount_minor from payout_batch_items i join providers pr on pr.id = i.provider_id
    where i.state = 'paid' and i.paid_at >= p_from and i.paid_at < p_to
      and (p_include_test or provider_is_real (pr.id))
  ),
  days as (
    select d::date as day
    from generate_series((p_from at time zone v_tz)::date, ((p_to - interval '1 second') at time zone v_tz)::date, interval '1 day') d
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', v_tz, 'include_test', p_include_test),
    'accounts_new', (select count(*) from profiles p where p.created_at >= p_from and p.created_at < p_to
                       and (p_include_test or not is_test_profile (p.id))),
    'sign_ins_distinct', (select count(distinct s.profile_id) from sign_in_events s
                            where s.signed_in_at >= p_from and s.signed_in_at < p_to
                              and (p_include_test or not is_test_profile (s.profile_id))),
    'sign_ins_counted_since', (select min(signed_in_at) from sign_in_events),
    'active_paying_clients_now', (select count(distinct lp.customer_id) from live_purchases lp
                                    where lp.counted and lp.state in ('active', 'cancelling', 'past_due')
                                      and lp.paid_through_at > now()),
    'cancellation_requests', (select count(*) from live_purchases lp
                                where lp.counted and lp.cancelled_at >= p_from and lp.cancelled_at < p_to),
    'coaching_ended', (select count(*) from enrollments en left join live_purchases lp on lp.id = en.purchase_id
                         where en.ended_at >= p_from and en.ended_at < p_to and (lp.id is null or lp.counted)
                           and (p_include_test or not is_test_profile (en.customer_id))),
    'failed_renewals', (select count(*) from provider_events pe
                          where pe.event_type = 'invoice.payment_failed'
                            and coalesce(pe.occurred_at, pe.received_at) >= p_from and coalesce(pe.occurred_at, pe.received_at) < p_to
                            and (p_include_test or pe.livemode)),
    'past_due_now', (select count(*) from live_purchases lp where lp.counted and lp.state = 'past_due'),
    'collected', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount, 'payments', n) order by currency)
                  from (select currency, sum(amount_minor) as amount, count(*) as n from cycles group by currency) x), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount, 'refunds', n) order by currency)
                  from (select currency, sum(amount_minor) as amount, count(*) as n from refunds_in group by currency) x), '[]'::jsonb),
    'commission', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount) order by currency)
                  from (select currency, sum(amount_minor) as amount from ledger_in where account = 'platform_revenue' group by currency) x), '[]'::jsonb),
    'coach_earnings', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount) order by currency)
                  from (select currency, sum(amount_minor) as amount from ledger_in where account = 'coach_payable' and effect <> 'payout' group by currency) x), '[]'::jsonb),
    'platform_subsidies', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount) order by currency)
                  from (select currency, sum(amount_minor) as amount from ledger_in where account = 'platform_subsidy' group by currency) x), '[]'::jsonb),
    'fees', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount) order by currency)
                  from (select currency, sum(amount_minor) as amount from ledger_in where account = 'processing_expense' group by currency) x), '[]'::jsonb),
    'fees_ever_recorded', exists (select 1 from ledger_entries where account = 'processing_expense'),
    'coach_owed_now', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'state', state, 'amount_minor', amount) order by currency, state)
                  from owed), '[]'::jsonb),
    'payouts_recorded', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount, 'items', n) order by currency)
                  from (select currency, sum(amount_minor) as amount, count(*) as n from payouts_in group by currency) x), '[]'::jsonb),
    'excluded_test_purchases', (select count(*) from live_purchases lp where not lp.counted),
    'series', (select coalesce(jsonb_agg(jsonb_build_object(
                  'day', d.day,
                  'accounts', (select count(*) from profiles p where (p.created_at at time zone v_tz)::date = d.day
                                 and p.created_at >= p_from and p.created_at < p_to and (p_include_test or not is_test_profile (p.id))),
                  'sign_ins', (select count(distinct s.profile_id) from sign_in_events s where (s.signed_in_at at time zone v_tz)::date = d.day
                                 and s.signed_in_at >= p_from and s.signed_in_at < p_to and (p_include_test or not is_test_profile (s.profile_id))),
                  'collected', coalesce((select jsonb_object_agg(currency, amount) from (
                                 select c.currency, sum(c.amount_minor) as amount from cycles c
                                 where (c.paid_at at time zone v_tz)::date = d.day group by c.currency) y), '{}'::jsonb)
                ) order by d.day), '[]'::jsonb) from days d)
  ) into v;
  return v;
end;
$$;

notify pgrst, 'reload schema';
