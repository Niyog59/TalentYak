-- M17 · The founder's client suspension goes through the profile guard.
--
-- 0008/0024 keep suspension writable only by the server key, silently keeping
-- the old value for anyone else — including a security-definer admin
-- function, which is why 0056's admin_set_account_suspension reported success
-- without suspending anyone (caught by the M17 database suite). Here the
-- guard also accepts the one named action, set inside that function's own
-- transaction, the same pattern coach status uses (in_action, 0017). Nothing
-- else about the guard changes; role, consent and identity stay server-only.

create or replace function guard_profile_privileged_columns ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_suspension boolean := in_action ('account_suspension');
begin
  if is_privileged_writer () then
    if new.role is distinct from old.role then
      insert into role_changes (profile_id, from_role, to_role, changed_by)
      values (old.id, old.role, new.role, auth.uid ());
    end if;
    return new;
  end if;

  new.role := old.role;
  if not v_suspension then
    new.suspended_at := old.suspended_at;
    new.suspended_reason := old.suspended_reason;
  end if;
  new.phone_verified := old.phone_verified;
  new.id := old.id;
  new.email := old.email;
  new.created_at := old.created_at;
  new.terms_version := old.terms_version;
  new.terms_accepted_at := old.terms_accepted_at;
  new.privacy_version := old.privacy_version;
  new.privacy_accepted_at := old.privacy_accepted_at;

  return new;
end;
$$;

create or replace function admin_set_account_suspension (p_profile uuid, p_suspend boolean, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  p profiles%rowtype;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required' using hint = 'Record why — it is kept in the history.';
  end if;
  select * into p from profiles where id = p_profile for update;
  if not found then
    raise exception 'not_found' using hint = 'That account was not found.';
  end if;
  if p.role = 'admin' then
    raise exception 'use_trusted_process' using hint = 'Administrator accounts are changed only through the documented founder-access process.';
  end if;
  if exists (select 1 from providers where profile_id = p_profile and status <> 'retired') then
    raise exception 'use_coach_workflow' using hint = 'This account is a coach. Suspend or reinstate them from their coach page, which also handles their profile, sales and clients.';
  end if;
  if p_suspend = (p.suspended_at is not null) then
    return false;
  end if;

  perform set_config('talentyak.action', 'account_suspension', true);
  update profiles set
    suspended_at = case when p_suspend then now() else null end,
    suspended_reason = case when p_suspend then left(btrim(p_reason), 500) else null end
  where id = p_profile;
  perform set_config('talentyak.action', '', true);

  if (select suspended_at is not null from profiles where id = p_profile) <> p_suspend then
    raise exception 'not_applied' using hint = 'The change could not be applied. Nothing was changed.';
  end if;

  perform write_admin_audit (case when p_suspend then 'account.suspend' else 'account.reinstate' end,
    'account', p_profile::text, p_reason,
    jsonb_build_object('suspended', p.suspended_at is not null),
    jsonb_build_object('suspended', p_suspend));
  return true;
end;
$$;

notify pgrst, 'reload schema';
