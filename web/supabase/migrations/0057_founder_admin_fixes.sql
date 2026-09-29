-- M17 · Follow-up to 0056.
--
-- Logging paused by the founder is reported only for a relationship that is
-- otherwise live. A payment pause, an ending or a suspension keeps its own,
-- more specific answer, and screens that ask "is this relationship live?"
-- (check-ins, the dashboard) are not misled by the logging switch.

create or replace function tracking_write_state (p_enrollment uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when e.id is null then 'not_permitted'
    when coaching_is_live (e.id) and not feature_allows ('logging', e.customer_id) then 'logging_paused'
    when coaching_is_live (e.id) then 'live'
    when cu.suspended_at is not null then 'suspended'
    when e.state = 'paused' then 'paused'
    when e.state = 'ended' then 'ended'
    else 'unavailable'
  end
  from (select 1) as one
  left join enrollments e on e.id = p_enrollment and e.customer_id = auth.uid ()
  left join profiles cu on cu.id = e.customer_id;
$$;

notify pgrst, 'reload schema';
