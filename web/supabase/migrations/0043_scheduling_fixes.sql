-- Batch 4 fixes, found by the scheduling database suite before any screen used them.
--
-- 1. reconciliation_exceptions refused two kinds that functions write:
--    'consultation_slot_expired' (0042) and 'payment_could_not_resume_coaching'
--    (0039). Because the row is written inside record_cycle_payment(), the
--    refusal rolled back the whole payment record — the webhook would have
--    failed on exactly the cases meant to be flagged for a person. The second
--    one predates this batch; it is fixed here because it is the same list.
-- 2. is_iana_zone() read pg_timezone_names, which builds the whole zone list on
--    every call; listing bookable times called it hundreds of times and hit the
--    statement timeout. It now asks Postgres to use the zone and catches the
--    refusal.
-- 3. available_slots() checked each candidate time with several queries. It is
--    now one set-based query with the same rules as slot_problem().
-- 4. A one-off consultation could be offered a second meeting. A proposal for
--    one that already has a live meeting must be a reschedule.

-- 1 -------------------------------------------------------------------------

alter table reconciliation_exceptions drop constraint if exists reconciliation_exceptions_kind_check;
alter table reconciliation_exceptions add constraint reconciliation_exceptions_kind_check check (kind in (
  'missing_payment', 'unmatched_ledger_entry', 'duplicate_effect', 'stale_pending_event', 'fee_difference',
  'refund_after_payout', 'unmatched_transfer', 'negative_balance', 'late_payment_after_expiry', 'dispute_opened',
  'dispute_after_payout', 'payment_on_closed_purchase', 'stale_outbox_job', 'coach_change_review',
  'payment_could_not_resume_coaching', 'consultation_slot_expired'
));

-- 2 -------------------------------------------------------------------------

create or replace function is_iana_zone (p text)
returns boolean
language plpgsql
stable
as $$
begin
  if p is null or p !~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$' then
    return false;
  end if;
  perform now() at time zone p;
  return true;
exception when invalid_parameter_value then
  return false;
end;
$$;

-- 3 -------------------------------------------------------------------------

create or replace function available_slots (p_provider uuid, p_duration int, p_from date default null, p_days int default null)
returns table (starts_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s coach_schedule_settings := coach_schedule (p_provider);
  v_tz text;
  v_first date;
  v_last date;
  v_uid uuid := auth.uid ();
begin
  if v_uid is null then
    raise exception 'sign_in_required';
  end if;
  if not (provider_is_public (p_provider) or exists (
    select 1 from enrollments e join enrollment_assignments a on a.enrollment_id = e.id and a.effective_to is null
    where e.customer_id = v_uid and a.provider_id = p_provider and e.state in ('active', 'paused')
  ) or is_active_provider (p_provider)) then
    raise exception 'not_found';
  end if;
  if p_duration is null or p_duration < 10 or p_duration > 240 then
    raise exception 'invalid_duration';
  end if;
  select timezone into v_tz from providers where id = p_provider;
  if not is_iana_zone (v_tz) then
    return;
  end if;

  v_first := greatest(coalesce(p_from, (now() at time zone v_tz)::date), (now() at time zone v_tz)::date);
  v_last := least(v_first + coalesce(p_days, s.horizon_days), ((now() + make_interval(days => s.horizon_days)) at time zone v_tz)::date);

  return query
  with days as (
    select d::date as d from generate_series(v_first, v_last, interval '1 day') d
  ), wins as (
    select days.d, w.start_time, w.end_time from days
      join availability_windows w on w.provider_id = p_provider and w.weekday = extract(dow from days.d)
    union all
    select days.d, x.start_time, x.end_time from days
      join availability_exceptions x on x.provider_id = p_provider and x.kind = 'extra' and days.d between x.starts_on and x.ends_on
  ), cand as (
    select wins.d, t::time as lt
    from wins, generate_series(wins.d + wins.start_time, wins.d + wins.end_time - make_interval(mins => p_duration), interval '15 minutes') t
  ), inst as (
    select distinct cand.d, cand.lt, li.instant as s
    from cand, lateral local_to_instant (cand.d, cand.lt, v_tz) li
  ), busy as (
    select a.provider_id, a.customer_id, a.blocked_from, a.blocked_to, a.starts_at
    from appointments a
    where a.state in ('held', 'booked')
      and (a.provider_id = p_provider or a.customer_id = v_uid)
      and a.blocked_to > now() and a.blocked_from < now() + make_interval(days => s.horizon_days + 2)
  ), daily as (
    select (b.starts_at at time zone v_tz)::date as d, count(*) as n
    from busy b where b.provider_id = p_provider group by 1
  )
  select inst.s
  from inst
  where inst.s >= now() + make_interval(mins => s.min_notice_minutes)
    and inst.s <= now() + make_interval(days => s.horizon_days)
    -- the local clock reading survived the clock-change resolution
    and (inst.s at time zone v_tz)::time = inst.lt
    and not exists (
      select 1 from availability_exceptions x
      where x.provider_id = p_provider and x.kind = 'unavailable'
        and inst.d between x.starts_on and x.ends_on
        and (x.start_time is null or (inst.lt < x.end_time and inst.lt + make_interval(mins => p_duration) > x.start_time))
    )
    and not exists (
      select 1 from busy b
      where tstzrange(b.blocked_from, b.blocked_to) && tstzrange(
        inst.s - make_interval(mins => s.buffer_before_minutes),
        inst.s + make_interval(mins => p_duration + s.buffer_after_minutes))
    )
    and (s.daily_limit is null or coalesce((select n from daily where daily.d = inst.d), 0) < s.daily_limit)
  order by inst.s;
end;
$$;

revoke execute on function available_slots (uuid, int, date, int) from public, anon;
grant execute on function available_slots (uuid, int, date, int) to authenticated;

-- 4 -------------------------------------------------------------------------

create or replace function consultation_used_once ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'consultation' and new.replaces_appointment_id is null and exists (
    select 1 from appointments a
    where a.purchase_id = new.purchase_id and a.kind = 'consultation'
      and a.state in ('held', 'booked', 'tentative', 'on_hold')
  ) then
    raise exception 'consultation_already_booked'
      using hint = 'This session already has a time. Suggest a new time for it instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists appointment_proposals_consultation_once on appointment_proposals;
create trigger appointment_proposals_consultation_once before insert on appointment_proposals
  for each row execute function consultation_used_once ();

notify pgrst, 'reload schema';
