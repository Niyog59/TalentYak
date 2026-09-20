-- M04 · Onboarding consent, coach invitations, verified guest-booking claims.

-- ---------------------------------------------------------------------------
-- 1. Consent fields are server-written
-- ---------------------------------------------------------------------------
--
-- 0008 froze role and suspension, but a signed-in user could still write
-- terms_version and terms_accepted_at on their own profile — marking the terms
-- "accepted" without the consent record the onboarding action writes. Those
-- columns now follow the same rule as role.

create or replace function guard_profile_privileged_columns ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_privileged_writer () then
    if new.role is distinct from old.role then
      insert into role_changes (profile_id, from_role, to_role, changed_by)
      values (old.id, old.role, new.role, auth.uid ());
    end if;
    return new;
  end if;

  new.role := old.role;
  new.suspended_at := old.suspended_at;
  new.suspended_reason := old.suspended_reason;
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

-- Records onboarding in one transaction: the profile fields and a consent row
-- per document, so "accepted" can never exist without its record.
create or replace function complete_onboarding (p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := (p->>'user_id')::uuid;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;
  if coalesce(p->>'timezone', '') !~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$' then
    raise exception 'invalid_timezone';
  end if;

  update profiles set
    preferred_name = nullif(left(trim(p->>'preferred_name'), 80), ''),
    timezone = p->>'timezone',
    display_currency = nullif(upper(p->>'display_currency'), ''),
    terms_version = p->>'terms_version',
    terms_accepted_at = now(),
    privacy_version = p->>'privacy_version',
    privacy_accepted_at = now()
  where id = v_user;

  insert into consents (profile_id, kind, version, context) values
    (v_user, 'terms', p->>'terms_version', 'onboarding'),
    (v_user, 'privacy', p->>'privacy_version', 'onboarding'),
    (v_user, 'age_18_plus', 'self_declared', 'onboarding');
end;
$$;

revoke execute on function complete_onboarding (jsonb) from public, anon, authenticated;
grant execute on function complete_onboarding (jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Coach invitations
-- ---------------------------------------------------------------------------

create or replace function admin_create_coach_invitation (
  p_email text,
  p_token_hash text,
  p_expires_in_days int default 7
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_email text := lower(trim(p_email));
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_email' using hint = 'Enter a valid email address.';
  end if;
  if p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_token';
  end if;
  if exists (select 1 from profiles pr join providers p on p.profile_id = pr.id where lower(pr.email) = v_email) then
    raise exception 'already_a_coach' using hint = 'That person already has a coach account.';
  end if;

  -- Re-inviting replaces the previous live invitation rather than leaving two
  -- valid links in the world.
  update coach_invitations set revoked_at = now()
    where lower(email) = v_email and accepted_at is null and revoked_at is null;

  insert into coach_invitations (email, token_hash, vertical_slug, invited_by, expires_at)
    values (v_email, p_token_hash, 'fitness', auth.uid (),
            now() + make_interval(days => greatest(1, least(p_expires_in_days, 30))))
    returning id into v_id;

  return v_id;
end;
$$;

create or replace function admin_revoke_coach_invitation (p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  update coach_invitations set revoked_at = now()
    where id = p_invitation_id and accepted_at is null and revoked_at is null;
end;
$$;

-- Accepting an invitation links a login to a new coach record. It does NOT
-- approve anyone: the coach starts in `onboarding`, and approval is a separate
-- admin decision after review.
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

  v_base := regexp_replace(lower(split_part(pr.email, '@', 1)), '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  if v_base = '' then v_base := 'coach'; end if;
  v_slug := v_base;
  while exists (select 1 from providers where slug = v_slug) loop
    n := n + 1;
    v_slug := v_base || '-' || n;
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

revoke execute on function accept_coach_invitation (text, uuid) from public, anon, authenticated;
grant execute on function accept_coach_invitation (text, uuid) to service_role;

revoke execute on function admin_create_coach_invitation (text, text, int) from public, anon;
grant execute on function admin_create_coach_invitation (text, text, int) to authenticated, service_role;
revoke execute on function admin_revoke_coach_invitation (uuid) from public, anon;
grant execute on function admin_revoke_coach_invitation (uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Claiming guest bookings — only with a verified email
-- ---------------------------------------------------------------------------
--
-- Before accounts, customers booked as guests: a booking carried an email and
-- no customer_id. Linking them to an account must not trust an email someone
-- merely TYPED. The application calls this only for a user whose email the
-- auth server has confirmed, and every claim is recorded.

create table if not exists booking_claims (
  id uuid primary key default gen_random_uuid (),
  booking_id uuid not null references bookings (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  matched_email text not null,
  claimed_at timestamptz not null default now(),
  unique (booking_id)
);

alter table booking_claims enable row level security;
create policy "person reads own claims" on booking_claims for select using (profile_id = auth.uid ());
create policy "admin reads claims" on booking_claims for select using (is_admin ());

create or replace function claim_guest_bookings (p_user_id uuid, p_verified_email text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  n int;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  select lower(email) into v_email from profiles where id = p_user_id;
  -- Both must agree: the profile's email and the email the auth server says is
  -- verified. A mismatch means something is wrong, and nothing is claimed.
  if v_email is null or v_email <> lower(trim(p_verified_email)) then
    return 0;
  end if;

  with claimed as (
    update bookings set customer_id = p_user_id
      where customer_id is null and lower(customer_email) = v_email
      returning id
  )
  insert into booking_claims (booking_id, profile_id, matched_email)
    select id, p_user_id, v_email from claimed
    on conflict (booking_id) do nothing;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function claim_guest_bookings (uuid, text) from public, anon, authenticated;
grant execute on function claim_guest_bookings (uuid, text) to service_role;

notify pgrst, 'reload schema';
