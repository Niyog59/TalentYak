-- 0026 — Coach public addresses never derive from an email address
--
-- 0024 built a new coach's public page address (/coaches/<slug>) from the part
-- of their email before the @. That publishes a personal email handle on the
-- open web, and for many people it is their full name plus a birth year. The
-- address is now built from the name they gave and a random suffix.
--
-- Also: any provider whose slug still matches its email handle is given a new
-- one. At the time of writing no invitation had been accepted, so this changes
-- nothing on the test project; it exists so a production project built from
-- these migrations can never carry the old form.

create or replace function accept_coach_invitation (p_token_hash text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv coach_invitations%rowtype;
  pr profiles%rowtype;
  v_provider uuid;
  v_base text;
  v_slug text;
  n int := 0;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  select * into inv from coach_invitations where token_hash = p_token_hash for update;
  if not found or inv.revoked_at is not null then
    raise exception 'invitation_invalid' using hint = 'This invitation link is not valid. Ask for a new one.';
  end if;
  if inv.accepted_at is not null then
    if inv.accepted_by = p_user_id then
      return jsonb_build_object('provider_id', (select id from providers where profile_id = p_user_id), 'already', true);
    end if;
    raise exception 'invitation_used' using hint = 'This invitation has already been used.';
  end if;
  if inv.expires_at < now() then
    raise exception 'invitation_expired' using hint = 'This invitation has expired. Ask for a new one.';
  end if;

  select * into pr from profiles where id = p_user_id for update;
  -- The invitation is for an email address. Only the account that owns that
  -- address may accept it — not whoever happens to hold the link.
  if lower(pr.email) <> lower(inv.email) then
    raise exception 'invitation_wrong_account'
      using hint = 'This invitation was sent to a different email address. Sign in with that address to accept it.';
  end if;
  if exists (select 1 from providers where profile_id = p_user_id) then
    raise exception 'already_a_coach' using hint = 'This account is already a coach.';
  end if;

  -- The public address is built from the name the person gave, never from
  -- their email address, plus a short random suffix so it is not guessable
  -- from the name alone and never collides.
  v_base := regexp_replace(lower(coalesce(nullif(pr.preferred_name, ''), nullif(pr.full_name, ''), 'coach')), '[^a-z0-9]+', '-', 'g');
  v_base := left(trim(both '-' from v_base), 40);
  if v_base = '' then v_base := 'coach'; end if;
  loop
    v_slug := v_base || '-' || substr(md5(gen_random_uuid ()::text), 1, 5);
    exit when not exists (select 1 from providers where slug = v_slug);
    n := n + 1;
    if n > 20 then raise exception 'slug_generation_failed'; end if;
  end loop;

  insert into providers (profile_id, display_name, vertical_slug, status, slug, accepting_new_clients, active)
    values (p_user_id, coalesce(nullif(pr.preferred_name, ''), nullif(pr.full_name, ''), 'New coach'),
            inv.vertical_slug, 'onboarding', v_slug, false, true)
    returning id into v_provider;

  insert into provider_public_profiles (provider_id, display_name)
    values (v_provider, coalesce(nullif(pr.preferred_name, ''), nullif(pr.full_name, ''), 'New coach'));

  update profiles set role = 'provider' where id = p_user_id and role = 'customer';

  update coach_invitations set accepted_at = now(), accepted_by = p_user_id, provider_id = v_provider
    where id = inv.id;

  insert into provider_status_events (provider_id, from_status, to_status, action, actor)
    values (v_provider, null, 'onboarding', 'invitation_accepted', p_user_id);

  return jsonb_build_object('provider_id', v_provider, 'already', false);
end;
$$;


update providers p
  set slug = regexp_replace(lower(coalesce(nullif(p.display_name, ''), 'coach')), '[^a-z0-9]+', '-', 'g')
             || '-' || substr(md5(gen_random_uuid ()::text), 1, 5)
  from profiles pr
  where pr.id = p.profile_id
    and p.slug is not null
    and p.slug ~ ('^' || regexp_replace(lower(split_part(pr.email, '@', 1)), '[^a-z0-9]+', '-', 'g') || '(-[0-9]+)?$');

-- Tidy any slug that the update above left with leading or doubled hyphens.
update providers
  set slug = trim(both '-' from regexp_replace(slug, '-+', '-', 'g'))
  where slug ~ '(^-|--|-$)';

notify pgrst, 'reload schema';
