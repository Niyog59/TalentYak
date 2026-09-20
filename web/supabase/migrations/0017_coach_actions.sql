-- M04/M05 · Legitimate coach and admin actions, and MFA-enforced admin reach.
--
-- The access matrix proved that a coach cannot manipulate their own record
-- DIRECTLY — cannot publish themselves, raise their own capacity, or mark their
-- own credential verified by writing to a table. That is correct, but it is
-- only half the rule. The founder's agreed rules are:
--
--   · an unapproved or suspended coach cannot publish purchasable offers
--   · an APPROVED, active coach publishes their own offers, prices and
--     inclusions with no founder approval
--   · a published offer version stays immutable; a change is a new version
--   · a coach manages accepting-new-clients and capacity through a validated
--     action that cannot drop below existing commitments or bypass an
--     explicitly approved restriction
--
-- Blocking direct manipulation is not the same as blocking the legitimate
-- action. This migration adds the legitimate actions, as functions that
-- validate and then perform the change.
--
-- MECHANISM. The column guards from 0009 restore protected columns unless the
-- writer is privileged. Each function below sets a transaction-local setting
-- (`talentyak.action`) before writing, and the guards accept a change carrying
-- that setting. A client cannot set it: PostgREST exposes no way to write an
-- arbitrary setting, and `set_config(..., true)` lasts only for the function's
-- own transaction. So the only path through the guard is through the function
-- and its validation.
--
-- ERRORS. Functions raise with a machine-readable MESSAGE (e.g.
-- `capacity_below_commitments`) and a human HINT. The application maps the
-- message to its own wording; nothing user-facing depends on parsing prose.

-- ---------------------------------------------------------------------------
-- 1. Admin reach requires a second factor
-- ---------------------------------------------------------------------------
--
-- CLAUDE.md: "Admin accounts require a second factor." Until now that was
-- enforced nowhere. It is now enforced in the database itself: an admin whose
-- session has not completed MFA (assurance level aal1) is not an admin as far
-- as any access rule is concerned. Hiding admin screens would not be enough —
-- an aal1 token could still query the tables directly.

create or replace function jwt_aal ()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal',
    ''
  );
$$;

create or replace function is_admin ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select jwt_aal () = 'aal2'
    and exists (
      select 1 from profiles
      where id = auth.uid ()
        and role = 'admin'
        and suspended_at is null
    );
$$;

comment on function is_admin () is
  'True only for an unsuspended admin whose session has completed MFA (aal2). An admin at aal1 has no admin reach anywhere.';

-- Has the admin role but has not yet completed MFA. Used only to route the
-- person to MFA setup; grants nothing.
create or replace function is_admin_pending_mfa ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select jwt_aal () <> 'aal2'
    and exists (
      select 1 from profiles
      where id = auth.uid () and role = 'admin' and suspended_at is null
    );
$$;

-- ---------------------------------------------------------------------------
-- 2. The policy set new offers are published under, held in the database
-- ---------------------------------------------------------------------------
--
-- Mirrors `currentPolicySnapshot()` in src/lib/policy/registry.ts. A database
-- test asserts the two agree, so they cannot drift. Publishing copies these
-- ids onto the version; a coach cannot choose their own.

create table if not exists current_policy_set (
  id boolean primary key default true,
  commission_policy_id text not null,
  cancellation_policy_id text not null,
  payment_failure_policy_id text not null,
  recognition_policy_id text not null,
  billing_terms_policy_id text not null,
  -- Billing structures that may currently be PUBLISHED. Prepaid terms are
  -- excluded: their cancellation and refund rules are undecided (AAF-TERM-05).
  publishable_billing_structures text[] not null,
  updated_at timestamptz not null default now(),
  constraint current_policy_set_singleton check (id)
);

alter table current_policy_set enable row level security;

create policy "anyone reads the current policy set" on current_policy_set
  for select using (true);

insert into current_policy_set (
  id, commission_policy_id, cancellation_policy_id, payment_failure_policy_id,
  recognition_policy_id, billing_terms_policy_id, publishable_billing_structures
) values (
  true, 'commission.coaching.v3', 'cancellation.v1', 'payment_failure.v1',
  'recognition.v1', 'billing_terms.v1',
  array['monthly_recurring', 'monthly_under_commitment', 'single_payment']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Optimistic concurrency on editable records
-- ---------------------------------------------------------------------------
--
-- Two tabs editing the same offer draft must not silently overwrite each
-- other. Writers send the version they loaded; an update that matches zero rows
-- means someone else saved first, and the application says so.

create or replace function bump_row_version ()
returns trigger
language plpgsql
as $$
begin
  new.row_version := old.row_version + 1;
  return new;
end;
$$;

alter table providers add column if not exists row_version int not null default 1;
alter table provider_public_profiles add column if not exists row_version int not null default 1;
alter table offers add column if not exists row_version int not null default 1;
alter table offer_versions add column if not exists row_version int not null default 1;

drop trigger if exists providers_row_version on providers;
create trigger providers_row_version before update on providers
  for each row execute function bump_row_version ();
drop trigger if exists provider_public_profiles_row_version on provider_public_profiles;
create trigger provider_public_profiles_row_version before update on provider_public_profiles
  for each row execute function bump_row_version ();
drop trigger if exists offers_row_version on offers;
create trigger offers_row_version before update on offers
  for each row execute function bump_row_version ();
drop trigger if exists offer_versions_row_version on offer_versions;
create trigger offer_versions_row_version before update on offer_versions
  for each row execute function bump_row_version ();

-- ---------------------------------------------------------------------------
-- 4. Who may sell
-- ---------------------------------------------------------------------------

alter table providers
  -- An explicit restriction set by an admin, e.g. while a coach is new. Null
  -- means no restriction. A coach can never set capacity above it.
  add column if not exists capacity_ceiling int,
  add column if not exists capacity_restriction_reason text;

alter table providers drop constraint if exists providers_capacity_ceiling_sane;
alter table providers add constraint providers_capacity_ceiling_sane
  check (capacity_ceiling is null or capacity_ceiling > 0);

create or replace function provider_can_sell (p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from providers p
    left join profiles pr on pr.id = p.profile_id
    join verticals v on v.slug = p.vertical_slug
    where p.id = p_id
      and p.status = 'approved'
      and p.suspended_at is null
      and p.active
      and v.status = 'active'
      and (pr.id is null or pr.suspended_at is null)
  );
$$;

comment on function provider_can_sell (uuid) is
  'Approved, active, unsuspended, in an active vertical. Required to publish an offer. Independent of whether the profile is public.';

create or replace function in_action (p_name text)
returns boolean
language sql
stable
as $$
  select current_setting('talentyak.action', true) = p_name;
$$;

-- Status changes from provider_status_events are auditable history.
create table if not exists provider_status_events (
  id uuid primary key default gen_random_uuid (),
  provider_id uuid not null references providers (id) on delete cascade,
  from_status provider_status,
  to_status provider_status,
  action text not null,
  reason text,
  actor uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists provider_status_events_provider_idx
  on provider_status_events (provider_id, created_at desc);

alter table provider_status_events enable row level security;

create policy "provider reads own status history" on provider_status_events
  for select using (is_active_provider (provider_id));
create policy "admin reads provider status history" on provider_status_events
  for select using (is_admin ());

-- ---------------------------------------------------------------------------
-- 5. Column guards, now aware of the legitimate actions
-- ---------------------------------------------------------------------------

create or replace function guard_provider_publication ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_privileged_writer () then
    return new;
  end if;

  -- Approval and suspension change only through the admin review action.
  if not in_action ('provider_status') then
    new.status := old.status;
    new.approved_at := old.approved_at;
    new.approved_by := old.approved_by;
    new.suspended_at := old.suspended_at;
    new.active := old.active;
  end if;

  -- Public visibility changes through the coach's own publication action, or
  -- through an admin review action (suspension takes a coach offline).
  if not (in_action ('profile_publication') or in_action ('provider_status')) then
    new.published_at := old.published_at;
  end if;

  -- Capacity changes only through the capacity actions.
  if not (in_action ('capacity') or in_action ('capacity_ceiling') or in_action ('provider_status')) then
    new.max_active_clients := old.max_active_clients;
    new.accepting_new_clients := old.accepting_new_clients;
  end if;

  if not in_action ('capacity_ceiling') then
    new.capacity_ceiling := old.capacity_ceiling;
    new.capacity_restriction_reason := old.capacity_restriction_reason;
  end if;

  -- Never changed by a client, by any path.
  new.profile_id := old.profile_id;
  new.founding := old.founding;
  new.payout_reference := old.payout_reference;
  new.vertical_slug := old.vertical_slug;
  new.id := old.id;

  return new;
end;
$$;

-- The old "provider updates own availability" policy let a coach flip
-- accepting_new_clients directly, with no check that they were approved.
-- Replaced by a policy for the columns a coach may genuinely edit in place.
drop policy if exists "provider updates own availability" on providers;
create policy "provider edits own provider record" on providers
  for update
  using (is_active_provider (id))
  with check (is_active_provider (id));

-- Offers: publication requires an approved seller and goes through the action.
create or replace function guard_offer_publication ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    if not provider_can_sell (new.provider_id) then
      raise exception 'provider_not_approved'
        using hint = 'Only an approved, active coach can publish an offer.';
    end if;
    if not (is_privileged_writer () or in_action ('offer_publication')) then
      raise exception 'publish_through_action'
        using hint = 'Offers are published through the publish action, which validates them.';
    end if;
  end if;

  if tg_op = 'UPDATE' and not is_privileged_writer () then
    new.provider_id := old.provider_id;
    new.vertical_slug := old.vertical_slug;
  end if;

  return new;
end;
$$;

drop trigger if exists offers_guard_publication on offers;
create trigger offers_guard_publication before insert or update on offers
  for each row execute function guard_offer_publication ();

create or replace function guard_offer_version_publication ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid;
begin
  if new.published_at is not null
     and (tg_op = 'INSERT' or old.published_at is null) then

    select provider_id into v_provider from offers where id = new.offer_id;

    if not provider_can_sell (v_provider) then
      raise exception 'provider_not_approved'
        using hint = 'Only an approved, active coach can publish an offer.';
    end if;

    if not (is_privileged_writer () or in_action ('offer_publication')) then
      raise exception 'publish_through_action'
        using hint = 'Offer versions are published through the publish action, which validates them.';
    end if;

    -- On INSERT the prices cannot exist yet, so a version is never born
    -- published by a client; it is published by UPDATE once priced.
    if tg_op = 'UPDATE' and not exists (
      select 1 from offer_prices where offer_version_id = new.id and amount_minor > 0
    ) then
      raise exception 'offer_version_has_no_price'
        using hint = 'Add at least one price before publishing.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists offer_versions_guard_publication on offer_versions;
create trigger offer_versions_guard_publication before insert or update on offer_versions
  for each row execute function guard_offer_version_publication ();

-- ---------------------------------------------------------------------------
-- 6. Coach actions
-- ---------------------------------------------------------------------------

create or replace function my_provider_id ()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from providers where profile_id = auth.uid ();
$$;

-- Active commitments a capacity change must respect: clients currently being
-- coached, plus live holds for customers mid-checkout.
create or replace function provider_commitments (p_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from enrollments where provider_id = p_id and state = 'active')::int
    + (select count(*) from capacity_reservations
        where provider_id = p_id and state = 'held' and expires_at > now())::int;
$$;

create or replace function set_my_capacity (
  p_max_active_clients int,
  p_accepting_new_clients boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v providers%rowtype;
  v_commitments int;
begin
  -- Lock the row. reserve_capacity() takes the same lock, so a checkout cannot
  -- land between counting commitments and writing the new limit.
  select * into v from providers where profile_id = auth.uid () for update;

  if not found then
    raise exception 'not_a_provider' using hint = 'This account is not a coach.';
  end if;
  if not is_active_provider (v.id) then
    raise exception 'provider_inactive' using hint = 'This coach account is suspended or inactive.';
  end if;
  if p_accepting_new_clients and v.status <> 'approved' then
    raise exception 'not_approved'
      using hint = 'You can accept new clients once your profile has been approved.';
  end if;
  if p_max_active_clients is not null and p_max_active_clients < 1 then
    raise exception 'capacity_invalid' using hint = 'Capacity must be at least 1, or left unlimited.';
  end if;
  if v.capacity_ceiling is not null
     and (p_max_active_clients is null or p_max_active_clients > v.capacity_ceiling) then
    raise exception 'capacity_above_restriction'
      using hint = format('Your capacity is currently limited to %s clients.', v.capacity_ceiling),
            detail = v.capacity_ceiling::text;
  end if;

  v_commitments := provider_commitments (v.id);
  if p_max_active_clients is not null and p_max_active_clients < v_commitments then
    raise exception 'capacity_below_commitments'
      using hint = format('You currently have %s clients or pending sign-ups. Capacity cannot be set lower than that.', v_commitments),
            detail = v_commitments::text;
  end if;

  perform set_config('talentyak.action', 'capacity', true);
  update providers
    set max_active_clients = p_max_active_clients,
        accepting_new_clients = p_accepting_new_clients
    where id = v.id;

  return jsonb_build_object(
    'max_active_clients', p_max_active_clients,
    'accepting_new_clients', p_accepting_new_clients,
    'commitments', v_commitments
  );
end;
$$;

create or replace function submit_my_profile_for_review ()
returns provider_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v providers%rowtype;
  pp provider_public_profiles%rowtype;
begin
  select * into v from providers where profile_id = auth.uid () for update;
  if not found then
    raise exception 'not_a_provider' using hint = 'This account is not a coach.';
  end if;
  if not is_active_provider (v.id) then
    raise exception 'provider_inactive' using hint = 'This coach account is suspended or inactive.';
  end if;
  if v.status not in ('onboarding', 'invited') then
    raise exception 'not_submittable'
      using hint = 'Your profile has already been submitted or reviewed.';
  end if;

  select * into pp from provider_public_profiles where provider_id = v.id;
  if not found or coalesce(length(trim(pp.display_name)), 0) = 0 then
    raise exception 'profile_incomplete' using hint = 'Add your display name before submitting.';
  end if;
  if coalesce(length(trim(pp.bio)), 0) < 40 then
    raise exception 'profile_incomplete'
      using hint = 'Write a short biography (at least a couple of sentences) before submitting.';
  end if;
  if cardinality(pp.languages) = 0 then
    raise exception 'profile_incomplete' using hint = 'Add at least one coaching language.';
  end if;
  if v.timezone is null then
    raise exception 'profile_incomplete' using hint = 'Set your timezone before submitting.';
  end if;

  perform set_config('talentyak.action', 'provider_status', true);
  update providers set status = 'submitted' where id = v.id;
  insert into provider_status_events (provider_id, from_status, to_status, action, actor)
    values (v.id, v.status, 'submitted', 'submit_for_review', auth.uid ());

  return 'submitted';
end;
$$;

create or replace function set_my_profile_published (p_published boolean)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v providers%rowtype;
  v_at timestamptz;
begin
  select * into v from providers where profile_id = auth.uid () for update;
  if not found then
    raise exception 'not_a_provider' using hint = 'This account is not a coach.';
  end if;
  if p_published and not provider_can_sell (v.id) then
    raise exception 'not_approved'
      using hint = 'Your profile can be made public once it has been approved.';
  end if;
  if p_published and not exists (
    select 1 from provider_public_profiles where provider_id = v.id
  ) then
    raise exception 'profile_incomplete' using hint = 'Complete your profile first.';
  end if;

  v_at := case when p_published then coalesce(v.published_at, now()) else null end;

  perform set_config('talentyak.action', 'profile_publication', true);
  update providers
    set published_at = v_at,
        -- Hiding the profile also stops new sign-ups, so nobody can reach a
        -- checkout for a coach they cannot see.
        accepting_new_clients = case when p_published then accepting_new_clients else false end
    where id = v.id;

  return v_at;
end;
$$;

-- Publishes a draft version: validates it, stamps the current policy set onto
-- it, supersedes the previous live version, and marks the offer published —
-- all in one transaction. No founder approval is involved.
create or replace function publish_offer_version (p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ver offer_versions%rowtype;
  o offers%rowtype;
  cps current_policy_set%rowtype;
begin
  select * into ver from offer_versions where id = p_version_id for update;
  if not found then
    raise exception 'offer_not_found' using hint = 'That offer version does not exist.';
  end if;

  select * into o from offers where id = ver.offer_id for update;

  if not (is_active_provider (o.provider_id) or is_admin () or is_privileged_writer ()) then
    raise exception 'not_owner' using hint = 'You can only publish your own offers.';
  end if;
  if ver.published_at is not null then
    raise exception 'already_published'
      using hint = 'This version is already published. Create a new version to change it.';
  end if;
  if not provider_can_sell (o.provider_id) then
    raise exception 'provider_not_approved'
      using hint = 'You can publish offers once your coach profile has been approved.';
  end if;
  if o.status = 'archived' then
    raise exception 'offer_archived' using hint = 'This offer is archived. Create a new offer instead.';
  end if;

  select * into cps from current_policy_set where id;
  if not (ver.billing_structure::text = any (cps.publishable_billing_structures)) then
    raise exception 'billing_structure_not_publishable'
      using hint = 'Prepaid packages cannot be published yet: their cancellation and refund rules are still being decided.';
  end if;

  if not exists (select 1 from offer_prices where offer_version_id = ver.id and amount_minor > 0) then
    raise exception 'offer_version_has_no_price' using hint = 'Add at least one price before publishing.';
  end if;

  perform set_config('talentyak.action', 'offer_publication', true);

  update offer_versions
    set superseded_at = now()
    where offer_id = ver.offer_id
      and published_at is not null
      and superseded_at is null;

  update offer_versions
    set published_at = now(),
        published_by = auth.uid (),
        commission_policy_id = cps.commission_policy_id,
        cancellation_policy_id = cps.cancellation_policy_id,
        payment_failure_policy_id = cps.payment_failure_policy_id,
        recognition_policy_id = cps.recognition_policy_id,
        billing_terms_policy_id = cps.billing_terms_policy_id
    where id = ver.id;

  update offers set status = 'published', archived_at = null where id = ver.offer_id;

  return ver.id;
end;
$$;

-- Stops new sales. Customers already on the offer keep everything they bought:
-- their purchase snapshots the version, and nothing here touches purchases.
create or replace function set_offer_sale_state (p_offer_id uuid, p_state offer_status)
returns offer_status
language plpgsql
security definer
set search_path = public
as $$
declare
  o offers%rowtype;
begin
  select * into o from offers where id = p_offer_id for update;
  if not found then
    raise exception 'offer_not_found' using hint = 'That offer does not exist.';
  end if;
  if not (is_active_provider (o.provider_id) or is_admin ()) then
    raise exception 'not_owner' using hint = 'You can only change your own offers.';
  end if;
  if p_state not in ('paused', 'archived', 'published') then
    raise exception 'invalid_state' using hint = 'Offers can be paused, archived, or resumed.';
  end if;
  if p_state = 'published' then
    if o.status <> 'paused' then
      raise exception 'invalid_state' using hint = 'Only a paused offer can be resumed.';
    end if;
    if not exists (
      select 1 from offer_versions where offer_id = o.id and published_at is not null and superseded_at is null
    ) then
      raise exception 'offer_version_has_no_price' using hint = 'Publish a version first.';
    end if;
  end if;

  perform set_config('talentyak.action', 'offer_publication', true);
  update offers
    set status = p_state,
        archived_at = case when p_state = 'archived' then now() else null end
    where id = o.id;

  return p_state;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Admin actions — every one requires aal2 through is_admin()
-- ---------------------------------------------------------------------------

create or replace function admin_set_provider_status (
  p_provider_id uuid,
  p_action text,
  p_reason text default null
)
returns provider_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v providers%rowtype;
  v_to provider_status;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;

  select * into v from providers where id = p_provider_id for update;
  if not found then
    raise exception 'provider_not_found' using hint = 'That coach does not exist.';
  end if;

  v_to := case p_action
    when 'start_review' then 'in_review'
    when 'approve' then 'approved'
    when 'return_to_onboarding' then 'onboarding'
    when 'suspend' then 'suspended'
    when 'reinstate' then 'approved'
    when 'retire' then 'retired'
  end;

  if v_to is null then
    raise exception 'invalid_action' using hint = 'Unknown review action.';
  end if;

  if p_action = 'start_review' and v.status <> 'submitted' then
    raise exception 'invalid_transition' using hint = 'Only a submitted profile can be taken into review.';
  end if;
  if p_action = 'approve' and v.status not in ('submitted', 'in_review') then
    raise exception 'invalid_transition' using hint = 'Only a submitted or in-review profile can be approved.';
  end if;
  if p_action = 'reinstate' and v.status <> 'suspended' then
    raise exception 'invalid_transition' using hint = 'Only a suspended coach can be reinstated.';
  end if;
  if p_action in ('suspend', 'retire', 'return_to_onboarding') and nullif(trim(p_reason), '') is null then
    raise exception 'reason_required' using hint = 'Record a reason for this action.';
  end if;

  perform set_config('talentyak.action', 'provider_status', true);

  update providers set
    status = v_to,
    approved_at = case when p_action = 'approve' then now() else approved_at end,
    approved_by = case when p_action = 'approve' then auth.uid () else approved_by end,
    suspended_at = case
      when p_action = 'suspend' then now()
      when p_action = 'reinstate' then null
      else suspended_at end,
    -- Suspending or retiring takes the coach off the public directory and
    -- closes new sign-ups immediately. Existing clients are handled
    -- deliberately through reassignment, not dropped by a status flag.
    published_at = case when p_action in ('suspend', 'retire', 'return_to_onboarding') then null else published_at end,
    accepting_new_clients = case when p_action in ('suspend', 'retire', 'return_to_onboarding') then false else accepting_new_clients end,
    active = case when p_action = 'retire' then false else active end
  where id = v.id;

  insert into provider_status_events (provider_id, from_status, to_status, action, reason, actor)
    values (v.id, v.status, v_to, p_action, p_reason, auth.uid ());

  return v_to;
end;
$$;

create or replace function admin_set_capacity_ceiling (
  p_provider_id uuid,
  p_ceiling int,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v providers%rowtype;
  v_commitments int;
  v_max int;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if p_ceiling is not null and p_ceiling < 1 then
    raise exception 'capacity_invalid' using hint = 'A restriction must be at least 1.';
  end if;
  if p_ceiling is not null and nullif(trim(p_reason), '') is null then
    raise exception 'reason_required' using hint = 'Record why capacity is being restricted.';
  end if;

  select * into v from providers where id = p_provider_id for update;
  if not found then
    raise exception 'provider_not_found' using hint = 'That coach does not exist.';
  end if;

  v_commitments := provider_commitments (v.id);
  v_max := v.max_active_clients;

  -- A restriction never strands a client who is already committed. If the
  -- coach is above the new ceiling, capacity drops to whichever is higher of
  -- the ceiling and their existing commitments, and new sign-ups close.
  if p_ceiling is not null and (v_max is null or v_max > p_ceiling) then
    v_max := greatest(p_ceiling, v_commitments);
  end if;

  perform set_config('talentyak.action', 'capacity_ceiling', true);
  update providers set
    capacity_ceiling = p_ceiling,
    capacity_restriction_reason = case when p_ceiling is null then null else p_reason end,
    max_active_clients = v_max,
    accepting_new_clients = case when v_commitments >= coalesce(v_max, v_commitments + 1) then false else accepting_new_clients end
  where id = v.id;

  return jsonb_build_object('capacity_ceiling', p_ceiling, 'max_active_clients', v_max, 'commitments', v_commitments);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Payout destinations — step-up authentication, review, masking
-- ---------------------------------------------------------------------------

create table if not exists payout_destination_events (
  id uuid primary key default gen_random_uuid (),
  provider_id uuid not null references providers (id) on delete cascade,
  destination_id uuid references provider_payout_destinations (id) on delete set null,
  action text not null,
  actor uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists payout_destination_events_provider_idx
  on payout_destination_events (provider_id, created_at desc);

alter table payout_destination_events enable row level security;
create policy "provider reads own destination history" on payout_destination_events
  for select using (is_active_provider (provider_id));
create policy "admin reads destination history" on payout_destination_events
  for select using (is_admin ());

create or replace function mask_reference (p_ref text)
returns text
language sql
immutable
as $$
  select case
    when p_ref is null then null
    when length(trim(p_ref)) <= 4 then repeat('•', length(trim(p_ref)))
    else repeat('•', greatest(4, length(trim(p_ref)) - 4)) || right(trim(p_ref), 4)
  end;
$$;

-- A coach changing where their money goes must prove it is really them NOW,
-- not just that they hold a session: aal2 is required. The new destination
-- starts pending review and cannot be used by a payout batch until approved.
create or replace function set_my_payout_destination (
  p_channel text,
  p_account_reference text,
  p_account_holder_name text,
  p_country text,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid;
  v_id uuid;
begin
  v_provider := my_provider_id ();
  if v_provider is null then
    raise exception 'not_a_provider' using hint = 'This account is not a coach.';
  end if;
  if not is_active_provider (v_provider) then
    raise exception 'provider_inactive' using hint = 'This coach account is suspended or inactive.';
  end if;
  if jwt_aal () <> 'aal2' then
    raise exception 'mfa_required'
      using hint = 'Confirm it is you with your authenticator app before changing where you are paid.';
  end if;
  if coalesce(length(trim(p_channel)), 0) not between 2 and 40 then
    raise exception 'invalid_channel' using hint = 'Describe how you want to be paid.';
  end if;
  if coalesce(length(trim(p_account_reference)), 0) not between 4 and 120 then
    raise exception 'invalid_reference' using hint = 'Enter the account reference exactly as your provider shows it.';
  end if;
  if p_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_currency' using hint = 'Choose a currency.';
  end if;

  update provider_payout_destinations
    set superseded_at = now()
    where provider_id = v_provider and superseded_at is null;

  insert into provider_payout_destinations (
    provider_id, channel, account_reference, account_holder_name, country, currency,
    review_state, created_by
  ) values (
    v_provider, trim(p_channel), trim(p_account_reference), nullif(trim(p_account_holder_name), ''),
    nullif(upper(trim(p_country)), ''), p_currency, 'pending_review', auth.uid ()
  ) returning id into v_id;

  insert into payout_destination_events (provider_id, destination_id, action, actor)
    values (v_provider, v_id, 'changed_by_coach', auth.uid ());

  return jsonb_build_object('id', v_id, 'review_state', 'pending_review',
    'masked_reference', mask_reference (p_account_reference));
end;
$$;

create or replace function get_my_payout_destination ()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', d.id,
    'channel', d.channel,
    'masked_reference', mask_reference (d.account_reference),
    'account_holder_name', d.account_holder_name,
    'country', d.country,
    'currency', d.currency,
    'review_state', d.review_state,
    'created_at', d.created_at
  )
  from provider_payout_destinations d
  where d.provider_id = my_provider_id ()
    and d.superseded_at is null
    and is_active_provider (d.provider_id);
$$;

create or replace function admin_review_payout_destination (p_destination_id uuid, p_decision text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d provider_payout_destinations%rowtype;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid_decision' using hint = 'Approve or reject.';
  end if;

  select * into d from provider_payout_destinations where id = p_destination_id for update;
  if not found or d.superseded_at is not null then
    raise exception 'destination_not_current' using hint = 'That destination has been replaced.';
  end if;
  -- The person who entered a destination does not approve it.
  if d.created_by = auth.uid () then
    raise exception 'self_review' using hint = 'A destination must be approved by someone other than the person who entered it.';
  end if;

  update provider_payout_destinations
    set review_state = p_decision, reviewed_by = auth.uid (), reviewed_at = now()
    where id = d.id;

  insert into payout_destination_events (provider_id, destination_id, action, actor)
    values (d.provider_id, d.id, 'review_' || p_decision, auth.uid ());

  return p_decision;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Execution grants
-- ---------------------------------------------------------------------------

-- Coach actions: a signed-in user may call them; each validates who they are.
revoke execute on function set_my_capacity (int, boolean) from public, anon;
grant execute on function set_my_capacity (int, boolean) to authenticated, service_role;

revoke execute on function submit_my_profile_for_review () from public, anon;
grant execute on function submit_my_profile_for_review () to authenticated, service_role;

revoke execute on function set_my_profile_published (boolean) from public, anon;
grant execute on function set_my_profile_published (boolean) to authenticated, service_role;

revoke execute on function publish_offer_version (uuid) from public, anon;
grant execute on function publish_offer_version (uuid) to authenticated, service_role;

revoke execute on function set_offer_sale_state (uuid, offer_status) from public, anon;
grant execute on function set_offer_sale_state (uuid, offer_status) to authenticated, service_role;

revoke execute on function set_my_payout_destination (text, text, text, text, text) from public, anon;
grant execute on function set_my_payout_destination (text, text, text, text, text) to authenticated, service_role;

revoke execute on function get_my_payout_destination () from public, anon;
grant execute on function get_my_payout_destination () to authenticated, service_role;

-- Admin actions: callable by a signed-in user, and each refuses anyone who is
-- not an aal2 admin.
revoke execute on function admin_set_provider_status (uuid, text, text) from public, anon;
grant execute on function admin_set_provider_status (uuid, text, text) to authenticated, service_role;

revoke execute on function admin_set_capacity_ceiling (uuid, int, text) from public, anon;
grant execute on function admin_set_capacity_ceiling (uuid, int, text) to authenticated, service_role;

revoke execute on function admin_review_payout_destination (uuid, text) from public, anon;
grant execute on function admin_review_payout_destination (uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
