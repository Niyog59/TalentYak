-- M17 · Links between a support case and the records around it.
--
-- Administrators can't read conversations (TY-MSG-04), so a case can't reach
-- its relationship by joining through one. This returns identifiers only —
-- who reported it, the client, the coach, the relationship and purchase —
-- never a message, a name the case doesn't already show, or any content.

create or replace function admin_support_case_links (p_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  select jsonb_build_object(
    'reporter_profile_id', s.reporter_profile_id,
    'owner_id', s.owner_id,
    'customer_id', coalesce(cv.customer_id, ap.customer_id),
    'provider_id', coalesce(cv.provider_id, ap.provider_id),
    'enrollment_id', coalesce(cv.enrollment_id, ap.enrollment_id),
    'purchase_id', coalesce(e.purchase_id, ap.purchase_id)
  ) into v
  from support_cases s
  left join conversations cv on cv.id = s.conversation_id
  left join appointments ap on ap.id = s.appointment_id
  left join enrollments e on e.id = coalesce(cv.enrollment_id, ap.enrollment_id)
  where s.id = p_case;
  return v;
end;
$$;

revoke execute on function admin_support_case_links (uuid) from public, anon;
grant execute on function admin_support_case_links (uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
