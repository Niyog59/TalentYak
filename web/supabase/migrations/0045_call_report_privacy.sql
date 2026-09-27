-- 0045 — A report about a session is not disclosed to the other person.
--
-- 0044's appointment_call_info returned the number of open reports about a
-- session to BOTH people on it, so a coach could see that their client had
-- asked TalentYak to review the coach's own record before TalentYak had looked
-- at it. Whether and how the other person hears about a report is TalentYak's
-- call. Now: the reporter sees their own reports, administrators see the count,
-- nobody else sees either.

create or replace function appointment_call_info (p_appointment uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a appointments%rowtype;
  v_opens timestamptz;
  v_closes timestamptz;
begin
  select * into a from appointments where id = p_appointment;
  if not found or not (a.customer_id = auth.uid () or is_active_provider (a.provider_id) or is_admin ()) then
    return null;
  end if;
  select w.opens_at, w.closes_at into v_opens, v_closes from call_window (a) w;
  return jsonb_build_object(
    'opens_at', v_opens,
    'closes_at', v_closes,
    'closing_warning_minutes', (select to_jsonb (closing_warning_minutes) from call_settings where id),
    'open_reports', case when is_admin ()
      then (select count(*) from support_cases where appointment_id = a.id and state <> 'resolved') else 0 end,
    'my_open_reports', (select coalesce(jsonb_agg(session_topic), '[]') from support_cases
                         where appointment_id = a.id and state <> 'resolved' and reporter_profile_id = auth.uid ())
  );
end;
$$;

revoke execute on function appointment_call_info (uuid) from public, anon;
grant execute on function appointment_call_info (uuid) to authenticated;

notify pgrst, 'reload schema';
