-- M13 fix · checkin_hand_over (0051) named a table alias the same as one of
-- its own variables, so Postgres could not tell them apart and every new coach
-- assignment was refused. Same function, alias renamed. Found by the M13
-- database suite before any real coach change ran against it.

create or replace function checkin_hand_over (p_assignment uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a enrollment_assignments;
  c checkins;
  v_coach uuid;
begin
  select * into a from enrollment_assignments where id = p_assignment;
  if not found then
    return;
  end if;
  select profile_id into v_coach from providers where id = a.provider_id;

  for c in
    select * from checkins
    where enrollment_id = a.enrollment_id and responsible_assignment_id <> a.id
      and status in ('open', 'submitted', 'reopened')
    for update
  loop
    if c.status = 'open' then
      -- Not sent: closed. Any draft stays for the client to read.
      update checkins set status = 'cancelled', status_reason = 'coach_changed', updated_at = now() where id = c.id;
      insert into checkin_events (checkin_id, kind, detail) values (c.id, 'cancelled', '{"reason":"coach_changed"}'::jsonb);
    elsif a.history_scope = 'full' or (a.history_scope = 'programme_and_logs' and not c.has_attachments) then
      update checkins set responsible_assignment_id = a.id, responsible_provider_id = a.provider_id,
             needs_resolution = null, updated_at = now()
        where id = c.id;
      insert into checkin_events (checkin_id, kind, detail) values (c.id, 'transferred', '{}'::jsonb);
      perform queue_checkin_notice (c.id, 'transferred', v_coach, 'transferred:' || a.id,
                                    jsonb_build_object('revision', c.review_revision));
    elsif c.needs_resolution is null then
      update checkins set needs_resolution = 'coach_change_scope', updated_at = now() where id = c.id;
      insert into checkin_events (checkin_id, kind, detail) values (c.id, 'flagged', '{"reason":"coach_change_scope"}'::jsonb);
    end if;
  end loop;

  -- A narrower sharing choice made later: a review already handed over that
  -- the coach may no longer see is flagged, never reviewed blind.
  with narrowed as (
    update checkins x set needs_resolution = 'coach_change_scope', updated_at = now()
      where x.responsible_assignment_id = a.id and x.status in ('submitted', 'reopened') and x.needs_resolution is null
        and a.previous_provider_id is not null and x.created_at < a.effective_from
        and not (a.history_scope = 'full' or (a.history_scope = 'programme_and_logs' and not x.has_attachments))
      returning x.id
  )
  insert into checkin_events (checkin_id, kind, detail)
    select id, 'flagged', '{"reason":"coach_change_scope"}'::jsonb from narrowed;

  update checkin_schedules set ended_at = coalesce(ended_at, now()), updated_at = now()
    where enrollment_id = a.enrollment_id and assignment_id <> a.id and ended_at is null;
end;
$$;

revoke execute on function checkin_hand_over (uuid) from public, anon, authenticated;
grant execute on function checkin_hand_over (uuid) to service_role;

notify pgrst, 'reload schema';
