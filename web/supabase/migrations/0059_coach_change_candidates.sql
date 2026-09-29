-- M17 · The replacements the founder may choose for one request: every
-- approved coach, each marked whether they can take this client over right
-- now (same service, selling, accepting, not away, with a free place). The
-- apply function checks the same rule again, under a lock, at confirmation.

create or replace function admin_coach_change_candidates (p_request uuid)
returns table (provider_id uuid, display_name text, eligible boolean, accepting boolean, commitments int, capacity int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r coach_change_requests%rowtype;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  select * into r from coach_change_requests where id = p_request;
  if not found then
    return;
  end if;
  return query
    select p.id, p.display_name, coach_can_take_over (p.id, r.enrollment_id), p.accepting_new_clients,
           provider_commitments (p.id), least(p.max_active_clients, p.capacity_ceiling)
    from providers p
    join enrollments e on e.id = r.enrollment_id
    where p.status = 'approved' and p.suspended_at is null and p.id <> e.provider_id
    order by coach_can_take_over (p.id, r.enrollment_id) desc, p.display_name;
end;
$$;

revoke execute on function admin_coach_change_candidates (uuid) from public, anon;
grant execute on function admin_coach_change_candidates (uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
