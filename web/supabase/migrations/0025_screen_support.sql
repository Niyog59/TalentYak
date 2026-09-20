-- 0025 — Screen support, and one disclosure fix
--
-- 1. FIX: `coach_balances` was readable by anyone, including signed-out
--    visitors. A Postgres view runs with its OWNER's privileges unless it is
--    declared security_invoker, and the owner here bypasses row-level
--    security — so the view summed every coach's earnings for whoever asked.
--    Found by probing the view with the anonymous key while building the
--    earnings screen. Only synthetic test data existed.
--
-- 2. `provider_commitments()` told any caller how many clients a coach has.
--    Only definer functions use it; nobody needs to call it directly.
--
-- 3. Small read and review functions the coach, customer and admin screens
--    need, each doing its own authorisation.

-- ---------------------------------------------------------------------------
-- 1. Balance view runs as the caller
-- ---------------------------------------------------------------------------

alter view coach_balances set (security_invoker = true);
revoke all on coach_balances from anon, public;
grant select on coach_balances to authenticated, service_role;

-- The directory view is deliberately a definer view: it is the single, reviewed
-- shape in which provider data reaches a visitor, and it filters to public
-- coaches itself. Recorded here so the migration check can hold every other
-- view to security_invoker.
comment on view public_coach_directory is
  'DEFINER VIEW BY DESIGN. The only shape in which provider data reaches an anonymous visitor; filters with provider_is_public(). Adding a column here is a decision about disclosure, not a convenience.';

-- ---------------------------------------------------------------------------
-- 2. Commitments are not public
-- ---------------------------------------------------------------------------

revoke execute on function provider_commitments (uuid) from public, anon, authenticated;
grant execute on function provider_commitments (uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3a. A coach's own capacity picture
-- ---------------------------------------------------------------------------

create or replace function my_capacity_summary ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v providers%rowtype;
begin
  select * into v from providers where profile_id = auth.uid ();
  if not found then
    raise exception 'not_a_provider' using hint = 'This account is not a coach.';
  end if;
  return jsonb_build_object(
    'status', v.status,
    'max_active_clients', v.max_active_clients,
    'capacity_ceiling', v.capacity_ceiling,
    'accepting_new_clients', v.accepting_new_clients,
    'published_at', v.published_at,
    'commitments', provider_commitments (v.id),
    'held_checkouts', (
      select count(*) from capacity_reservations
      where provider_id = v.id and state = 'held' and expires_at > now()
    )
  );
end;
$$;

revoke execute on function my_capacity_summary () from public, anon;
grant execute on function my_capacity_summary () to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3b. A coach's current clients — first name only
-- ---------------------------------------------------------------------------
--
-- A coach needs to know who they are coaching. They do not need the client's
-- email, phone or legal name to do it; contact goes through the product.

create or replace function my_clients ()
returns table (
  enrollment_id uuid,
  purchase_id uuid,
  client_name text,
  offer_title text,
  purchase_state purchase_state,
  assigned_from timestamptz,
  paid_through timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    pu.id,
    coalesce(nullif(trim(pr.preferred_name), ''), split_part(coalesce(pr.full_name, ''), ' ', 1), 'Client'),
    pu.inclusions_snapshot->>'title',
    pu.state,
    a.effective_from,
    pu.paid_through_at
  from enrollment_assignments a
  join enrollments e on e.id = a.enrollment_id
  join purchases pu on pu.id = e.purchase_id
  join profiles pr on pr.id = pu.customer_id
  where a.provider_id = my_provider_id ()
    and a.effective_from <= now()
    and (a.effective_to is null or a.effective_to > now())
    and is_active_provider (a.provider_id)
  order by a.effective_from desc;
$$;

revoke execute on function my_clients () from public, anon;
grant execute on function my_clients () to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3c. Customers can see the coach they bought from, even if hidden later
-- ---------------------------------------------------------------------------

drop policy if exists "customer reads coach of own purchases" on provider_public_profiles;
create policy "customer reads coach of own purchases" on provider_public_profiles
  for select using (
    exists (
      select 1 from purchases pu
      where pu.provider_id = provider_public_profiles.provider_id
        and pu.customer_id = auth.uid ()
    )
  );

-- ---------------------------------------------------------------------------
-- 3d. Profile photo review
-- ---------------------------------------------------------------------------
--
-- The server re-encodes the upload (EXIF stripped), stores it in the private
-- pending bucket and records the pending path with the service role. An admin
-- then approves or rejects it here. On approval the server has already copied
-- the image into the public bucket at `<provider_id>/<file>`; this function
-- only accepts a public path that matches the pending file, so an admin
-- session cannot point a coach's photo at an arbitrary object.

create or replace function admin_review_profile_photo (
  p_provider_id uuid,
  p_approve boolean,
  p_public_path text,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  pp provider_public_profiles%rowtype;
  v_expected text;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;

  select * into pp from provider_public_profiles where provider_id = p_provider_id for update;
  if not found or pp.photo_pending_path is null then
    raise exception 'not_found' using hint = 'There is no photo waiting for review.';
  end if;

  perform set_config('talentyak.action', 'photo_review', true);

  if p_approve then
    v_expected := p_provider_id::text || '/' || regexp_replace(pp.photo_pending_path, '^.*/', '');
    if p_public_path is distinct from v_expected then
      raise exception 'invalid_reference' using hint = 'The approved image does not match the pending upload.';
    end if;
    update provider_public_profiles
      set photo_path = v_expected,
          photo_pending_path = null,
          photo_pending_at = null,
          photo_review_note = null
      where provider_id = p_provider_id;
    return v_expected;
  end if;

  if nullif(trim(p_note), '') is null then
    raise exception 'reason_required' using hint = 'Tell the coach why the photo was not approved.';
  end if;
  update provider_public_profiles
    set photo_pending_path = null,
        photo_pending_at = null,
        photo_review_note = left(trim(p_note), 500)
    where provider_id = p_provider_id;
  return null;
end;
$$;

revoke execute on function admin_review_profile_photo (uuid, boolean, text, text) from public, anon;
grant execute on function admin_review_profile_photo (uuid, boolean, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3e. Resolving a reconciliation exception, with who and why
-- ---------------------------------------------------------------------------

create or replace function admin_resolve_exception (p_id uuid, p_state text, p_note text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if p_state not in ('investigating', 'resolved', 'accepted') then
    raise exception 'invalid_state' using hint = 'Choose investigating, resolved or accepted.';
  end if;
  if p_state in ('resolved', 'accepted') and nullif(trim(p_note), '') is null then
    raise exception 'reason_required' using hint = 'Record what was found and done.';
  end if;

  update reconciliation_exceptions
    set state = p_state,
        resolution_note = coalesce(nullif(left(trim(p_note), 2000), ''), resolution_note),
        resolved_by = case when p_state in ('resolved', 'accepted') then auth.uid () else resolved_by end,
        resolved_at = case when p_state in ('resolved', 'accepted') then now() else resolved_at end
    where id = p_id and state not in ('resolved', 'accepted');

  if not found then
    raise exception 'not_found' using hint = 'That exception does not exist or is already closed.';
  end if;
  return p_state;
end;
$$;

revoke execute on function admin_resolve_exception (uuid, text, text) from public, anon;
grant execute on function admin_resolve_exception (uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
