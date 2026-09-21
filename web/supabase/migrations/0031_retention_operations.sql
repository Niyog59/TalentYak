-- 0031 — Operating the retention contracts from 0022, with the destructive
-- step still switched off.
--
-- 0022 built the shape: policies, candidates, notices, deletion requests, and a
-- `destructive_execution_enabled` flag defaulting to false. What it did not
-- build is the machinery to run any of it — to work out who WOULD be affected,
-- to put a hold on somebody, to notice that a person is no longer eligible and
-- let them off, or to check one last time before anything is removed.
--
-- This migration adds that machinery. It still deletes nothing.
--
-- THE ORDER MATTERS, AND IT IS DELIBERATE:
--
--   1. DRY RUN. Count and sample who would be caught, creating nothing. Every
--      retention rule in this system is a PROPOSAL, so the only honest thing to
--      do with one is show the founder its blast radius before it is approved.
--   2. SCHEDULE. Only under an APPROVED policy, and only then are notices
--      queued (0022 already refuses notices for real people otherwise).
--   3. NOTICE. Advance warning, with failures recorded rather than assumed
--      delivered — a deletion notice that bounced is not a notice.
--   4. HOLD. A person in a dispute, a legal request, or a support conversation
--      is not deleted on schedule because a clock said so.
--   5. FINAL CHECK. Immediately before deletion, ask again whether this is
--      still eligible. Circumstances change between scheduling and execution:
--      a lapsed customer comes back, and their history must not vanish because
--      a job was queued three months ago.
--   6. EXECUTE — which is switched off, and which this migration does not
--      implement. When a policy is approved and the founder turns the flag on,
--      the executor is written then, against a rule that actually exists.
--
-- WHAT THIS IS NOT. Retention expiry is one of three different things that all
-- end in a file being gone, and conflating them is how somebody's history gets
-- deleted under the wrong rule:
--
--   · RETENTION EXPIRY      — a policy-driven clock. Needs notice, holds and a
--                             final check. Off until a policy is approved.
--   · A DELETION REQUEST    — a person asking. Honoured on its own terms, with
--                             financial records retained by law and anonymised.
--   · TEST OR ORPHAN FILES  — housekeeping. Abandoned uploads (0030's sweep)
--                             and synthetic fixtures. Neither is retention.

-- ---------------------------------------------------------------------------
-- 1. Dry run — what WOULD happen, changing nothing
-- ---------------------------------------------------------------------------

alter table retention_candidates
  add column if not exists cancelled_reason text,
  add column if not exists last_checked_at timestamptz;

alter table retention_notices
  add column if not exists attempts int not null default 0,
  add column if not exists last_error text,
  add column if not exists sent_at timestamptz;

-- Eligibility for the one resource type whose data actually exists today:
-- media. The other two policies in 0022 (programmes, form clips) describe
-- tables that this batch does not own, and inventing an eligibility rule for
-- them would be guessing.
--
-- Returns rows; writes nothing. Safe to run against production at any time.
create or replace function retention_dry_run (p_policy_id text)
returns table (
  resource_id uuid,
  profile_id uuid,
  eligible_at timestamptz,
  deletion_due_at timestamptz,
  already_tracked boolean,
  would_be_new boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pol retention_policies%rowtype;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'Retention figures name real people and need an administrator who has completed two-factor sign-in.';
  end if;

  select * into pol from retention_policies where id = p_policy_id;
  if not found then
    raise exception 'unknown_policy';
  end if;

  if pol.resource_type <> 'progress_media' then
    raise exception 'no_eligibility_rule'
      using hint = 'Only progress_media has an implemented eligibility rule. The others are contracts without data.';
  end if;

  return query
  select
    m.id,
    m.owner_profile_id,
    m.recorded_at + make_interval(days => pol.retain_days) as eligible_at,
    m.recorded_at + make_interval(days => pol.retain_days) as deletion_due_at,
    exists (
      select 1 from retention_candidates c
      where c.policy_id = pol.id and c.resource_id = m.id and c.state not in ('cancelled', 'deleted')
    ) as already_tracked,
    not exists (
      select 1 from retention_candidates c
      where c.policy_id = pol.id and c.resource_id = m.id and c.state not in ('cancelled', 'deleted')
    ) as would_be_new
  from media_assets m
  where m.state = 'ready'
    and m.deleted_at is null
    and m.recorded_at + make_interval(days => pol.retain_days) <= now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Holds
-- ---------------------------------------------------------------------------
--
-- A hold outranks the clock. It is set by a person, with a reason, and nothing
-- expires it automatically — releasing it is also a decision somebody makes.

create or replace function place_retention_hold (p_candidate_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin () then
    raise exception 'admin_mfa_required';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason_required'
      using hint = 'A hold without a reason cannot be reviewed later.';
  end if;

  update retention_candidates
    set state = 'held', hold_reason = left(p_reason, 500)
    where id = p_candidate_id and state in ('scheduled', 'notice_failed');

  if not found then
    return false;
  end if;

  -- Pending notices for a held candidate are cancelled: telling somebody their
  -- data is about to be deleted, when a hold means it is not, is worse than
  -- silence.
  update retention_notices set state = 'cancelled'
    where candidate_id = p_candidate_id and state = 'scheduled';

  update outbox set state = 'cancelled',
        last_error = coalesce(last_error || ' | ', '') || 'Retention hold placed.'
    where id in (select outbox_id from retention_notices where candidate_id = p_candidate_id)
      and state in ('pending', 'blocked');

  return true;
end;
$$;

create or replace function release_retention_hold (p_candidate_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin () then
    raise exception 'admin_mfa_required';
  end if;

  -- Back to 'scheduled' without notices: they were cancelled, and a fresh
  -- notice run must issue new ones so the advance warning is real.
  update retention_candidates
    set state = 'scheduled', hold_reason = null
    where id = p_candidate_id and state = 'held';

  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Eligibility changes and the final check
-- ---------------------------------------------------------------------------

-- Is this candidate STILL eligible? Called before any notice is sent and again
-- immediately before anything is removed.
--
-- Returns the reason it is no longer eligible, or null when it still is. A
-- resource that has already gone is not "eligible for deletion" — it is done.
create or replace function retention_ineligible_reason (p_candidate_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c retention_candidates%rowtype;
  pol retention_policies%rowtype;
  m media_assets%rowtype;
begin
  select * into c from retention_candidates where id = p_candidate_id;
  if not found then
    return 'candidate no longer exists';
  end if;

  if c.state = 'held' then
    return 'a hold is in place: ' || coalesce(c.hold_reason, 'no reason recorded');
  end if;

  select * into pol from retention_policies where id = c.policy_id;
  if pol.status <> 'approved' and not c.is_synthetic then
    return 'the policy is not approved';
  end if;

  if c.resource_type = 'progress_media' then
    select * into m from media_assets where id = c.resource_id;
    if not found then
      return 'the file no longer exists';
    end if;
    if m.deleted_at is not null or m.state = 'deleted' then
      return 'already deleted by its owner';
    end if;
    -- The clock is recomputed from the CURRENT record, not from what was true
    -- when the candidate was created. A photo re-dated, or a policy whose
    -- retention period was lengthened, is no longer due.
    if m.recorded_at + make_interval(days => pol.retain_days) > now() then
      return 'no longer past its retention period';
    end if;
  end if;

  return null;
end;
$$;

-- Lets a candidate off, recording why. Used when the final check says the
-- reason for deleting it has gone away.
create or replace function cancel_retention_candidate (p_candidate_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_privileged_writer () and not is_admin () then
    raise exception 'server_only';
  end if;

  update retention_candidates
    set state = 'cancelled', cancelled_reason = left(p_reason, 500)
    where id = p_candidate_id and state <> 'deleted';

  if not found then
    return false;
  end if;

  update retention_notices set state = 'cancelled'
    where candidate_id = p_candidate_id and state = 'scheduled';

  update outbox set state = 'cancelled',
        last_error = coalesce(last_error || ' | ', '') || 'Retention candidate cancelled.'
    where id in (select outbox_id from retention_notices where candidate_id = p_candidate_id)
      and state in ('pending', 'blocked');

  return true;
end;
$$;

-- Sweeps every scheduled candidate, cancelling the ones that are no longer
-- eligible. This is the step that stops a queue built months ago acting on
-- facts that have since changed.
create or replace function recheck_retention_candidates ()
returns table (candidate_id uuid, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_reason text;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  for r in
    select id from retention_candidates
    where state in ('scheduled', 'notice_failed')
    order by deletion_due_at
    limit 500
  loop
    v_reason := retention_ineligible_reason (r.id);

    update retention_candidates set last_checked_at = now() where id = r.id;

    if v_reason is not null then
      perform cancel_retention_candidate (r.id, v_reason);
      candidate_id := r.id; outcome := 'cancelled: ' || v_reason;
    else
      candidate_id := r.id; outcome := 'still eligible';
    end if;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Notices that failed
-- ---------------------------------------------------------------------------
--
-- A notice is the whole point of advance warning, so one that did not arrive
-- must be visible and must stop the clock rather than being written off. A
-- candidate whose notice failed goes to `notice_failed` and is NOT deleted by
-- any future executor.

create or replace function record_notice_outcome (p_outbox_id uuid, p_delivered boolean, p_error text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate uuid;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  update retention_notices
    set state = case when p_delivered then 'sent' else 'failed' end,
        attempts = attempts + 1,
        sent_at = case when p_delivered then now() else sent_at end,
        last_error = left(p_error, 500)
    where outbox_id = p_outbox_id
    returning candidate_id into v_candidate;

  if v_candidate is null then
    return false;
  end if;

  if not p_delivered then
    -- The person was not warned. Until somebody looks at this, the clock
    -- stops: an unwarned deletion is the failure this whole pipeline exists
    -- to prevent.
    update retention_candidates
      set state = 'notice_failed'
      where id = v_candidate and state = 'scheduled';
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. A person asking for their own data to be deleted
-- ---------------------------------------------------------------------------
--
-- Distinct from retention in every way: it is initiated by the person, it is
-- not on a clock, and it is not gated on a policy being approved. What it is
-- NOT is instant erasure — financial records are retained by law and are
-- anonymised instead, which the response says plainly rather than promising
-- something we cannot do.

create or replace function request_own_deletion (p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid () is null then
    raise exception 'sign_in_required';
  end if;

  -- One open request at a time. Asking twice is the same ask.
  select id into v_id from deletion_requests
    where profile_id = auth.uid () and state in ('received', 'in_review')
    limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into deletion_requests (profile_id, state, outcome_note)
  values (auth.uid (), 'received', left(p_note, 1000))
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The guard on execution
-- ---------------------------------------------------------------------------
--
-- No executor exists yet. This function is what one would have to call first,
-- and it refuses for four independent reasons. It is here so that whoever
-- writes the executor cannot quietly skip the checks: the guard exists before
-- the thing it guards.

create or replace function retention_execution_allowed (p_candidate_id uuid)
returns table (allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c retention_candidates%rowtype;
  pol retention_policies%rowtype;
  v_reason text;
  v_enabled boolean;
begin
  if not is_privileged_writer () and not is_admin () then
    raise exception 'server_only';
  end if;

  select destructive_execution_enabled into v_enabled from retention_settings where id = true;
  if not coalesce(v_enabled, false) then
    allowed := false; reason := 'destructive retention execution is switched off';
    return next; return;
  end if;

  select * into c from retention_candidates where id = p_candidate_id;
  select * into pol from retention_policies where id = c.policy_id;

  if pol.status <> 'approved' then
    allowed := false; reason := 'the policy is not approved'; return next; return;
  end if;

  -- Every notice the policy promised must actually have been sent.
  if exists (
    select 1 from retention_notices n
    where n.candidate_id = p_candidate_id and n.state in ('scheduled', 'failed')
  ) then
    allowed := false; reason := 'advance notice has not been delivered'; return next; return;
  end if;

  v_reason := retention_ineligible_reason (p_candidate_id);
  if v_reason is not null then
    allowed := false; reason := v_reason; return next; return;
  end if;

  allowed := true; reason := null;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'cancel_retention_candidate(uuid, text)',
    'recheck_retention_candidates()',
    'record_notice_outcome(uuid, boolean, text)',
    'retention_ineligible_reason(uuid)',
    'retention_execution_allowed(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  -- Admin-gated, called from the founder console by a signed-in administrator.
  foreach fn in array array[
    'retention_dry_run(text)',
    'place_retention_hold(uuid, text)',
    'release_retention_hold(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

revoke execute on function request_own_deletion (text) from public, anon;
grant execute on function request_own_deletion (text) to authenticated, service_role;

notify pgrst, 'reload schema';
