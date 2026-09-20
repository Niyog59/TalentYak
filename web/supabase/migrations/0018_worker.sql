-- M08 slice · The outbox worker's database half, delivery records, rate limits.
--
-- The outbox table exists since 0012 but nothing processed it, which means any
-- task written to it would have sat there forever. The founder's rule: do not
-- acknowledge an external event as safely processed if the work it created can
-- be stranded with no functioning worker. So this migration provides the
-- worker's primitives, all atomic, and the worker itself lives in
-- src/lib/jobs/worker.ts.
--
-- STATES
--
--   pending      due at scheduled_for
--   processing   claimed by a worker holding a lease
--   done         finished; for email, the provider ACCEPTED the message — which
--                is not the same as delivered, and the delivery record says so
--   blocked      cannot run because something outside it is unconfigured, e.g.
--                no verified sending domain. Not a failure, not retried as one,
--                and cancelled once it is no longer worth sending
--   failed       gave up after max_attempts, or hit a permanent error. Visible
--                on the admin screen and retryable by a person
--   cancelled    deliberately not sent
--
-- RECOVERY. A worker that crashes mid-job leaves the job `processing` with a
-- lease that expires. The next claim picks it up again. No job depends on a
-- process staying alive.

alter table outbox drop constraint if exists outbox_state_check;
alter table outbox add constraint outbox_state_check
  check (state in ('pending', 'processing', 'done', 'blocked', 'failed', 'cancelled'));

alter table outbox
  -- After this, the message is no longer worth sending. A password reset link
  -- delivered two days late is worse than none.
  add column if not exists expires_at timestamptz,
  add column if not exists result jsonb,
  add column if not exists retried_by uuid references profiles (id) on delete set null,
  add column if not exists retried_at timestamptz;

create index if not exists outbox_blocked_idx on outbox (scheduled_for) where state = 'blocked';

create or replace function enqueue_outbox (
  p_topic text,
  p_payload jsonb,
  p_dedupe_key text default null,
  p_scheduled_for timestamptz default now(),
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not is_privileged_writer () then
    raise exception 'server_only' using hint = 'Only server functions enqueue work.';
  end if;

  insert into outbox (topic, payload, dedupe_key, scheduled_for, expires_at)
  values (p_topic, coalesce(p_payload, '{}'), p_dedupe_key, coalesce(p_scheduled_for, now()), p_expires_at)
  on conflict (topic, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from outbox where topic = p_topic and dedupe_key = p_dedupe_key;
  end if;

  return v_id;
end;
$$;

-- Claims due jobs atomically. SKIP LOCKED means two workers running at once
-- each get different jobs rather than both getting the same one.
create or replace function claim_outbox_jobs (
  p_worker text,
  p_limit int default 20,
  p_lease_seconds int default 120
)
returns setof outbox
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_privileged_writer () then
    raise exception 'server_only' using hint = 'Only the worker claims jobs.';
  end if;

  -- A job whose lease expired on its last permitted attempt has had every
  -- chance. Fail it visibly rather than reclaiming it forever.
  update outbox
    set state = 'failed',
        last_error = coalesce(last_error || ' | ', '') || 'Worker lease expired on final attempt.',
        lease_owner = null,
        lease_expires_at = null
    where state = 'processing'
      and lease_expires_at < now()
      and attempts >= max_attempts;

  -- Anything past its expiry is no longer worth sending.
  update outbox
    set state = 'cancelled',
        last_error = coalesce(last_error || ' | ', '') || 'Expired before it could be sent.',
        lease_owner = null,
        lease_expires_at = null,
        completed_at = now()
    where state in ('pending', 'blocked')
      and expires_at is not null
      and expires_at < now();

  return query
  with due as (
    select id
    from outbox
    where (state in ('pending', 'blocked') and scheduled_for <= now())
       or (state = 'processing' and lease_expires_at < now())
    order by scheduled_for
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  )
  update outbox o
    set state = 'processing',
        lease_owner = p_worker,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        attempts = o.attempts + 1
  from due
  where o.id = due.id
  returning o.*;
end;
$$;

create or replace function complete_outbox_job (p_id uuid, p_worker text, p_result jsonb default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_privileged_writer () then
    raise exception 'server_only' using hint = 'Only the worker completes jobs.';
  end if;

  -- Only the lease holder may complete. A worker whose lease expired and was
  -- reclaimed by another cannot overwrite that worker's outcome.
  update outbox
    set state = 'done', completed_at = now(), result = p_result,
        lease_owner = null, lease_expires_at = null, last_error = null
    where id = p_id and lease_owner = p_worker and state = 'processing';

  return found;
end;
$$;

create or replace function fail_outbox_job (
  p_id uuid,
  p_worker text,
  p_error text,
  p_retryable boolean default true,
  p_blocked boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  j outbox%rowtype;
  v_state text;
  v_delay interval;
begin
  if not is_privileged_writer () then
    raise exception 'server_only' using hint = 'Only the worker fails jobs.';
  end if;

  select * into j from outbox where id = p_id and lease_owner = p_worker and state = 'processing' for update;
  if not found then
    return 'not_held';
  end if;

  if p_blocked then
    -- Blocked on configuration. Does not consume an attempt: nothing was tried.
    v_state := 'blocked';
    update outbox
      set state = 'blocked', attempts = greatest(0, j.attempts - 1),
          scheduled_for = now() + interval '15 minutes',
          last_error = left(p_error, 2000), lease_owner = null, lease_expires_at = null
      where id = p_id;
    return v_state;
  end if;

  if not p_retryable or j.attempts >= j.max_attempts then
    update outbox
      set state = 'failed', last_error = left(p_error, 2000),
          lease_owner = null, lease_expires_at = null
      where id = p_id;
    return 'failed';
  end if;

  -- Exponential backoff from 30 seconds, capped at six hours, with up to 20%
  -- jitter so a burst of failures does not retry in lockstep.
  v_delay := least(
    interval '6 hours',
    make_interval(secs => 30 * power(2, greatest(0, j.attempts - 1)))
  );
  v_delay := v_delay * (1 + random() * 0.2);

  update outbox
    set state = 'pending', scheduled_for = now() + v_delay, last_error = left(p_error, 2000),
        lease_owner = null, lease_expires_at = null
    where id = p_id;

  return 'pending';
end;
$$;

-- A person retrying a failed job. Gives it three more attempts and records who.
create or replace function admin_retry_outbox_job (p_id uuid)
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

  update outbox
    set state = 'pending', scheduled_for = now(), max_attempts = attempts + 3,
        retried_by = auth.uid (), retried_at = now(), completed_at = null
    where id = p_id and state in ('failed', 'blocked');

  if not found then
    raise exception 'not_retryable' using hint = 'Only failed or blocked jobs can be retried.';
  end if;

  return 'pending';
end;
$$;

-- ---------------------------------------------------------------------------
-- Delivery records
-- ---------------------------------------------------------------------------
--
-- "Queued", "accepted by the provider", "delivered", "bounced" and "failed" are
-- five different facts, and a send log that collapses them into "sent" is
-- lying by omission. This table records what is actually known.

create table if not exists notification_deliveries (
  id uuid primary key default gen_random_uuid (),
  outbox_id uuid not null references outbox (id) on delete cascade,
  channel text not null default 'email' check (channel in ('email')),
  template text not null,
  recipient_profile_id uuid references profiles (id) on delete set null,
  -- Kept so a failed delivery can be investigated. Admin-only.
  recipient_email text not null,
  subject text not null,
  provider text not null default 'resend',
  provider_message_id text,
  state text not null
    check (state in ('accepted', 'delivered', 'bounced', 'complained', 'failed', 'uncertain')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One delivery record per job. A retried job updates its record rather than
-- implying it was sent twice.
create unique index if not exists notification_deliveries_outbox_key on notification_deliveries (outbox_id);
create index if not exists notification_deliveries_state_idx on notification_deliveries (state, created_at desc);
create index if not exists notification_deliveries_recipient_idx on notification_deliveries (recipient_profile_id);

alter table notification_deliveries enable row level security;
create policy "admin reads deliveries" on notification_deliveries for select using (is_admin ());

drop trigger if exists notification_deliveries_touch on notification_deliveries;
create trigger notification_deliveries_touch before update on notification_deliveries
  for each row execute function touch_updated_at ();

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------
--
-- In-memory counters do not work on serverless hosting: every request may land
-- on a different instance with its own empty memory. Counters live here
-- instead, incremented atomically. Bucket keys never contain a raw IP address
-- or email — the application hashes them first.

create table if not exists rate_limit_counters (
  bucket text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, window_start)
);

create index if not exists rate_limit_counters_window_idx on rate_limit_counters (window_start);

alter table rate_limit_counters enable row level security;
-- Deny-all. Server functions only.

create or replace function hit_rate_limit (p_bucket text, p_limit int, p_window_seconds int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_hits int;
begin
  if not is_privileged_writer () then
    raise exception 'server_only' using hint = 'Rate limits are checked by the server.';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into rate_limit_counters (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = rate_limit_counters.hits + 1
  returning hits into v_hits;

  return jsonb_build_object(
    'allowed', v_hits <= p_limit,
    'hits', v_hits,
    'limit', p_limit,
    'retry_after_seconds',
      greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - now())))::int)
  );
end;
$$;

create or replace function prune_rate_limits ()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;
  delete from rate_limit_counters where window_start < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'enqueue_outbox(text, jsonb, text, timestamptz, timestamptz)',
    'claim_outbox_jobs(text, int, int)',
    'complete_outbox_job(uuid, text, jsonb)',
    'fail_outbox_job(uuid, text, text, boolean, boolean)',
    'hit_rate_limit(text, int, int)',
    'prune_rate_limits()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

revoke execute on function admin_retry_outbox_job (uuid) from public, anon;
grant execute on function admin_retry_outbox_job (uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
