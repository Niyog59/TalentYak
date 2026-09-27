-- 0044 — Private calls (M10)
--
-- A confirmed session gets its own private call room at the call provider
-- (Daily), created the first time one of its two people asks to join. Every
-- join is authorised here, at the moment of asking: signed in, one of the two
-- people on the session, the session still confirmed and eligible, and inside
-- the room's window. A copied room address is worth nothing without a pass,
-- and a pass is issued per person, per request, for a couple of minutes.
--
-- What this migration does NOT do, deliberately:
--   · Joining is never evidence that coaching was delivered. Attendance is
--     kept apart from outcomes, and neither moves money.
--   · No automatic no-show. A dropped connection is a connection, not a verdict.
--   · No recordings, transcripts or summaries. The rooms are created with
--     recording and screen sharing off.
--
-- Revocation, stated honestly: the database refuses new passes the instant a
-- session is cancelled, a person suspended or a coach changed. For anyone
-- already in the room, a job ejects them and deletes the room at the provider
-- — the only way to invalidate a pass the provider has signed. That job runs
-- straight after the request that caused it, with the five-minute worker as a
-- backstop, so it is prompt but not instantaneous.

-- ---------------------------------------------------------------------------
-- 1. Settings — mirrors `calls.v1` in src/lib/policy (a test asserts they agree)
-- ---------------------------------------------------------------------------

create table if not exists call_settings (
  id boolean primary key default true,
  policy_id text not null default 'calls.v1',
  policy_status text not null default 'sandbox_default'
    check (policy_status in ('sandbox_default', 'confirmed')),
  -- The room opens this long before the start.
  join_opens_minutes_before int not null default 10 check (join_opens_minutes_before between 0 and 60),
  -- And stays open this long after the booked end, so a session that runs a
  -- little over is never cut off at the booked minute. Never below five.
  grace_after_end_minutes int not null default 30 check (grace_after_end_minutes between 5 and 120),
  -- Warnings shown in the call before the room closes.
  closing_warning_minutes int[] not null default '{10,2}',
  -- How long a join pass may be used for. It only has to last until the
  -- person is in; leaving and coming back asks for a new one.
  join_pass_seconds int not null default 120 check (join_pass_seconds between 30 and 600),
  -- Passes per person per session per ten minutes (refreshes, rejoins).
  join_requests_per_10_minutes int not null default 20 check (join_requests_per_10_minutes between 5 and 100),
  -- How long after a room closes the provider's attendance record is fetched.
  attendance_check_delay_minutes int not null default 3 check (attendance_check_delay_minutes between 1 and 60),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id) on delete set null,
  constraint call_settings_singleton check (id),
  constraint call_settings_warnings check (
    array_length(closing_warning_minutes, 1) between 1 and 4
    and closing_warning_minutes <@ array[1, 2, 3, 5, 10, 15, 20, 30]
  )
);

insert into call_settings (id) values (true) on conflict (id) do nothing;

create index if not exists call_settings_updated_by_idx on call_settings (updated_by);

alter table call_settings enable row level security;
revoke insert, delete, truncate on call_settings from anon, authenticated;
drop policy if exists "signed in reads call settings" on call_settings;
create policy "signed in reads call settings" on call_settings
  for select to authenticated using (true);
drop policy if exists "admin updates call settings" on call_settings;
create policy "admin updates call settings" on call_settings
  for update using (is_admin ()) with check (is_admin ());

-- ---------------------------------------------------------------------------
-- 2. What a session is for — optional, short, either person may set it
-- ---------------------------------------------------------------------------

alter table appointments add column if not exists purpose text;
alter table appointments drop constraint if exists appointments_purpose_len;
alter table appointments add constraint appointments_purpose_len
  check (purpose is null or char_length(purpose) between 1 and 140);

-- ---------------------------------------------------------------------------
-- 3. Rooms, passes, attendance, provider events
-- ---------------------------------------------------------------------------

-- One open room per session at a time. A room that was closed (cancelled,
-- suspended, window over) is never reopened: if a session on hold comes back,
-- it gets a fresh room with a fresh name.
create table if not exists call_rooms (
  id uuid primary key default gen_random_uuid (),
  appointment_id uuid not null references appointments (id) on delete cascade,
  provider text not null default 'daily' check (provider = 'daily'),
  -- Random and unguessable. Never the session id.
  room_name text not null unique check (room_name ~ '^ty-[0-9a-f]{32}$'),
  provider_url text check (provider_url is null or provider_url ~ '^https://[a-z0-9-]+\.daily\.co/ty-[0-9a-f]{32}$'),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  -- pending: reserved here, not yet created at the provider
  -- ready: exists at the provider
  -- closing: must be emptied and deleted at the provider (job queued)
  -- closed: deleted at the provider, or never created there
  state text not null default 'pending' check (state in ('pending', 'ready', 'closing', 'closed')),
  close_reason text check (close_reason is null or char_length(close_reason) <= 60),
  provider_created_at timestamptz,
  close_requested_at timestamptz,
  closed_at timestamptz,
  attendance_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint call_rooms_window check (closes_at > opens_at)
);

create unique index if not exists call_rooms_one_open on call_rooms (appointment_id) where state in ('pending', 'ready');
create index if not exists call_rooms_appointment_idx on call_rooms (appointment_id, created_at desc);
create index if not exists call_rooms_due_idx on call_rooms (state, closes_at);

drop trigger if exists call_rooms_touch on call_rooms;
create trigger call_rooms_touch before update on call_rooms
  for each row execute function touch_updated_at ();

-- Every pass issued: who, for which room, when, and until when. No IP address,
-- no device, no browser — nothing beyond what explains an access.
create table if not exists call_join_passes (
  id uuid primary key default gen_random_uuid (),
  room_id uuid not null references call_rooms (id) on delete cascade,
  appointment_id uuid not null references appointments (id) on delete cascade,
  profile_id uuid references profiles (id) on delete set null,
  role text not null check (role in ('customer', 'coach')),
  audio_only boolean not null default false,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint call_join_passes_expiry check (expires_at > issued_at)
);

create index if not exists call_join_passes_room_idx on call_join_passes (room_id);
create index if not exists call_join_passes_appointment_idx on call_join_passes (appointment_id, profile_id, issued_at desc);
create index if not exists call_join_passes_profile_idx on call_join_passes (profile_id);

-- Who was in the room and for how long, as the PROVIDER recorded it. Not a
-- record that coaching happened; not read by anything that moves money.
create table if not exists call_attendance (
  id uuid primary key default gen_random_uuid (),
  room_id uuid not null references call_rooms (id) on delete cascade,
  appointment_id uuid not null references appointments (id) on delete cascade,
  provider_meeting_id text check (provider_meeting_id is null or char_length(provider_meeting_id) <= 100),
  -- One row per provider participant session: the dedupe key across the
  -- attendance fetch and the provider's webhook.
  provider_participant_id text not null unique check (char_length(provider_participant_id) between 1 and 100),
  profile_id uuid references profiles (id) on delete set null,
  role text not null check (role in ('customer', 'coach')),
  joined_at timestamptz not null,
  duration_seconds int not null check (duration_seconds between 0 and 86400),
  source text not null check (source in ('provider_api', 'provider_webhook')),
  recorded_at timestamptz not null default now()
);

create index if not exists call_attendance_appointment_idx on call_attendance (appointment_id, joined_at);
create index if not exists call_attendance_room_idx on call_attendance (room_id);
create index if not exists call_attendance_profile_idx on call_attendance (profile_id);

-- Provider webhook deliveries already handled, so a replay changes nothing.
-- The event type and room only; the payload itself is not kept.
create table if not exists call_provider_events (
  event_id text primary key check (char_length(event_id) between 1 and 200),
  event_type text not null check (char_length(event_type) <= 60),
  room_id uuid references call_rooms (id) on delete set null,
  received_at timestamptz not null default now()
);

create index if not exists call_provider_events_room_idx on call_provider_events (room_id);
create index if not exists call_provider_events_received_idx on call_provider_events (received_at);

alter table call_rooms enable row level security;
alter table call_join_passes enable row level security;
alter table call_attendance enable row level security;
alter table call_provider_events enable row level security;
revoke insert, update, delete, truncate on call_rooms from anon, authenticated;
revoke insert, update, delete, truncate on call_join_passes from anon, authenticated;
revoke insert, update, delete, truncate on call_attendance from anon, authenticated;
revoke insert, update, delete, truncate on call_provider_events from anon, authenticated;

-- Rooms and passes are server-side records; only administrators read them.
drop policy if exists "admin reads call rooms" on call_rooms;
create policy "admin reads call rooms" on call_rooms for select using (is_admin ());
drop policy if exists "admin reads call passes" on call_join_passes;
create policy "admin reads call passes" on call_join_passes for select using (is_admin ());
drop policy if exists "admin reads call provider events" on call_provider_events;
create policy "admin reads call provider events" on call_provider_events for select using (is_admin ());
-- The two people on a session see its attendance, as context for recording
-- or questioning an outcome.
drop policy if exists "parties read call attendance" on call_attendance;
create policy "parties read call attendance" on call_attendance
  for select using (appointment_party (appointment_id) or is_admin ());

drop trigger if exists call_join_passes_append_only on call_join_passes;
create trigger call_join_passes_append_only before update or delete on call_join_passes
  for each row execute function prevent_history_change ();
drop trigger if exists call_attendance_append_only on call_attendance;
create trigger call_attendance_append_only before update or delete on call_attendance
  for each row execute function prevent_history_change ();

-- ---------------------------------------------------------------------------
-- 4. Closing rooms — on request, on window end, and on every loss of access
-- ---------------------------------------------------------------------------

create or replace function request_call_close (p_room uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update call_rooms set state = 'closing', close_reason = left(p_reason, 60), close_requested_at = now()
    where id = p_room and state in ('pending', 'ready');
  if not found then return false; end if;
  perform enqueue_outbox ('call.close_room', jsonb_build_object('room_id', p_room, 'reason', left(p_reason, 60)), 'call_close:' || p_room);
  return true;
end;
$$;

revoke execute on function request_call_close (uuid, text) from public, anon, authenticated;
grant execute on function request_call_close (uuid, text) to service_role;

create or replace function close_calls_for_appointments (p_ids uuid[], p_reason text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  x record;
  n int := 0;
begin
  for x in select id from call_rooms where appointment_id = any (p_ids) and state in ('pending', 'ready') loop
    if request_call_close (x.id, p_reason) then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

revoke execute on function close_calls_for_appointments (uuid[], text) from public, anon, authenticated;

-- A session that stops being confirmed — cancelled, moved, on hold — closes its room.
create or replace function calls_close_on_appointment_change ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.state = 'booked' and new.state <> 'booked' then
    perform close_calls_for_appointments (array[new.id], 'session_' || new.state);
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_close_calls on appointments;
create trigger appointments_close_calls after update of state on appointments
  for each row execute function calls_close_on_appointment_change ();

-- A coach suspended: every room they are in closes, including one in progress.
create or replace function calls_close_on_provider_suspension ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.suspended_at is not null and old.suspended_at is null)
     or (new.status = 'suspended' and old.status is distinct from 'suspended') then
    perform close_calls_for_appointments (
      array(select a.id from appointments a join call_rooms r on r.appointment_id = a.id
            where a.provider_id = new.id and r.state in ('pending', 'ready')),
      'coach_suspended');
  end if;
  return new;
end;
$$;

drop trigger if exists providers_close_calls on providers;
create trigger providers_close_calls after update of status, suspended_at on providers
  for each row execute function calls_close_on_provider_suspension ();

-- An account suspended, whichever side of the session it is on.
create or replace function calls_close_on_profile_suspension ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.suspended_at is not null and old.suspended_at is null then
    perform close_calls_for_appointments (
      array(select a.id from appointments a join call_rooms r on r.appointment_id = a.id
            where r.state in ('pending', 'ready')
              and (a.customer_id = new.id or a.provider_id in (select p.id from providers p where p.profile_id = new.id))),
      'account_suspended');
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_close_calls on profiles;
create trigger profiles_close_calls after update of suspended_at on profiles
  for each row execute function calls_close_on_profile_suspension ();

-- A coach change: the previous coach's rooms with this client close, even
-- for a session already under way.
create or replace function calls_close_on_reassignment ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.effective_to is not null and old.effective_to is null then
    perform close_calls_for_appointments (
      array(select a.id from appointments a join call_rooms r on r.appointment_id = a.id
            where a.enrollment_id = new.enrollment_id and a.provider_id = new.provider_id and r.state in ('pending', 'ready')),
      'coach_changed');
  end if;
  return new;
end;
$$;

drop trigger if exists enrollment_assignments_close_calls on enrollment_assignments;
create trigger enrollment_assignments_close_calls after update of effective_to on enrollment_assignments
  for each row execute function calls_close_on_reassignment ();

-- The relationship ended (refund, plan over): its rooms close.
create or replace function calls_close_on_enrollment_end ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.state = 'ended' and old.state is distinct from 'ended' then
    perform close_calls_for_appointments (
      array(select a.id from appointments a join call_rooms r on r.appointment_id = a.id
            where a.enrollment_id = new.id and r.state in ('pending', 'ready')),
      'relationship_ended');
  end if;
  return new;
end;
$$;

drop trigger if exists enrollments_close_calls on enrollments;
create trigger enrollments_close_calls after update of state on enrollments
  for each row execute function calls_close_on_enrollment_end ();

-- A one-off session refunded.
create or replace function calls_close_on_purchase_refund ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.state::text = 'refunded' and old.state::text is distinct from 'refunded' then
    perform close_calls_for_appointments (
      array(select a.id from appointments a join call_rooms r on r.appointment_id = a.id
            where a.purchase_id = new.id and a.kind = 'consultation' and r.state in ('pending', 'ready')),
      'refunded');
  end if;
  return new;
end;
$$;

drop trigger if exists purchases_close_calls on purchases;
create trigger purchases_close_calls after update of state on purchases
  for each row execute function calls_close_on_purchase_refund ();

-- ---------------------------------------------------------------------------
-- 5. Asking to join
-- ---------------------------------------------------------------------------

-- The window a session's room is open for: the room's own, once it has one,
-- otherwise the current settings applied to the session's times.
create or replace function call_window (a appointments)
returns table (opens_at timestamptz, closes_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(r.opens_at, a.starts_at - make_interval(mins => g.join_opens_minutes_before)),
         coalesce(r.closes_at, a.ends_at + make_interval(mins => g.grace_after_end_minutes))
  from call_settings g
  left join lateral (
    select opens_at, closes_at from call_rooms
    where appointment_id = a.id and state in ('pending', 'ready') limit 1
  ) r on true
  where g.id;
$$;

revoke execute on function call_window (appointments) from public, anon, authenticated;

/*
 * The only way to obtain a pass. Runs as the person asking. Refusals that the
 * person can act on (too early, closed, not confirmed, paused) come back as
 * `ok: false` with a reason; anything that would reveal a session to someone
 * who is not on it is `not_found`, exactly like a session that doesn't exist.
 *
 * What the caller may choose: audio only, or not. Nothing else — room, name,
 * identity, privileges and expiry are all decided here and by the server.
 */
create or replace function call_join_request (p_appointment uuid, p_audio_only boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  a appointments%rowtype;
  g call_settings;
  r call_rooms%rowtype;
  v_role text;
  v_elig text;
  v_opens timestamptz;
  v_closes timestamptz;
  v_pass uuid;
  v_expires timestamptz;
  v_name text;
  v_times jsonb;
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;

  -- FOR SHARE: a cancellation committing at the same moment either happens
  -- first (and this sees it) or waits for this to finish (and its trigger then
  -- closes the room reserved here). Never a room nobody closes.
  select * into a from appointments where id = p_appointment for share;
  if not found then raise exception 'not_found'; end if;
  if a.customer_id = v_uid then
    v_role := 'customer';
  elsif is_active_provider (a.provider_id) then
    v_role := 'coach';
  else
    raise exception 'not_found';
  end if;

  select * into g from call_settings where id;
  select w.opens_at, w.closes_at into v_opens, v_closes from call_window (a) w;
  v_times := jsonb_build_object('starts_at', a.starts_at, 'ends_at', a.ends_at, 'opens_at', v_opens, 'closes_at', v_closes, 'role', v_role);

  if a.state <> 'booked' then
    return v_times || jsonb_build_object('ok', false, 'reason', 'not_booked', 'state', a.state);
  end if;
  v_elig := meeting_eligibility (a.kind, a.enrollment_id, a.purchase_id, a.starts_at);
  if v_elig <> 'ok' then
    return v_times || jsonb_build_object('ok', false, 'reason', v_elig);
  end if;
  if a.kind = 'coaching' and not exists (
    select 1 from enrollment_assignments ea
    where ea.enrollment_id = a.enrollment_id and ea.provider_id = a.provider_id and ea.effective_to is null
  ) then
    return v_times || jsonb_build_object('ok', false, 'reason', 'coach_changed');
  end if;
  if now() < v_opens then
    return v_times || jsonb_build_object('ok', false, 'reason', 'too_early');
  end if;
  if now() >= v_closes then
    return v_times || jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  if (select count(*) from call_join_passes
      where appointment_id = a.id and profile_id = v_uid and issued_at > now() - interval '10 minutes')
     >= g.join_requests_per_10_minutes then
    raise exception 'rate_limited';
  end if;

  -- The session's open room, or a new one. Repeated and simultaneous requests
  -- all land on the same row.
  select * into r from call_rooms where appointment_id = a.id and state in ('pending', 'ready');
  if not found then
    insert into call_rooms (appointment_id, room_name, opens_at, closes_at)
    values (a.id, 'ty-' || replace(gen_random_uuid ()::text, '-', ''), v_opens, v_closes)
    on conflict (appointment_id) where state in ('pending', 'ready') do nothing
    returning * into r;
    if r.id is null then
      select * into r from call_rooms where appointment_id = a.id and state in ('pending', 'ready');
    end if;
  end if;

  v_expires := least (now() + make_interval(secs => g.join_pass_seconds), r.closes_at);
  insert into call_join_passes (room_id, appointment_id, profile_id, role, audio_only, expires_at)
  values (r.id, a.id, v_uid, v_role, coalesce(p_audio_only, false), v_expires)
  returning id into v_pass;

  -- The name the OTHER person sees. A coach appears under their public name,
  -- a client under their first name — the same as everywhere else.
  if v_role = 'coach' then
    select coalesce(nullif(pp.display_name, ''), p.display_name) into v_name
    from providers p left join provider_public_profiles pp on pp.provider_id = p.id where p.id = a.provider_id;
  else
    select coalesce(nullif(preferred_name, ''), nullif(split_part(coalesce(full_name, ''), ' ', 1), ''), 'Client') into v_name
    from profiles where id = v_uid;
  end if;

  return jsonb_build_object(
    'ok', true,
    'role', v_role,
    'room_id', r.id,
    'room_name', r.room_name,
    'room_state', r.state,
    'room_url', r.provider_url,
    'opens_at', r.opens_at,
    'closes_at', r.closes_at,
    'starts_at', a.starts_at,
    'ends_at', a.ends_at,
    'pass_id', v_pass,
    'pass_expires_at', v_expires,
    'user_id', v_uid,
    'user_name', left(coalesce(v_name, 'Participant'), 60),
    'audio_only', coalesce(p_audio_only, false)
  );
end;
$$;

revoke execute on function call_join_request (uuid, boolean) from public, anon;
grant execute on function call_join_request (uuid, boolean) to authenticated;

-- The server created the room at the provider. False if the room was closed
-- in the meantime — the caller must then delete what it just created.
create or replace function mark_call_room_ready (p_room uuid, p_url text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_privileged_writer () then raise exception 'server_only'; end if;
  update call_rooms set state = 'ready', provider_url = p_url, provider_created_at = coalesce(provider_created_at, now())
    where id = p_room and state in ('pending', 'ready');
  return found;
end;
$$;

revoke execute on function mark_call_room_ready (uuid, text) from public, anon, authenticated;
grant execute on function mark_call_room_ready (uuid, text) to service_role;

create or replace function mark_call_room_closed (p_room uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_privileged_writer () then raise exception 'server_only'; end if;
  update call_rooms set state = 'closed', closed_at = now(), close_reason = coalesce(close_reason, left(p_reason, 60))
    where id = p_room and state <> 'closed';
  return found;
end;
$$;

revoke execute on function mark_call_room_closed (uuid, text) from public, anon, authenticated;
grant execute on function mark_call_room_closed (uuid, text) to service_role;

-- Rooms whose window is over. Called by the scheduled sweep.
create or replace function close_due_call_rooms ()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  x record;
  n int := 0;
begin
  if not is_privileged_writer () then raise exception 'server_only'; end if;
  for x in select id from call_rooms where state in ('pending', 'ready') and closes_at <= now() for update skip locked loop
    if request_call_close (x.id, 'window_ended') then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

revoke execute on function close_due_call_rooms () from public, anon, authenticated;
grant execute on function close_due_call_rooms () to service_role;

-- Attendance as the provider recorded it. Rows for anyone other than the two
-- people on the session are ignored (there should never be any: the room is
-- private and passes are only issued to them). Repeats change nothing.
create or replace function record_call_attendance (p_room uuid, p_rows jsonb, p_source text, p_complete boolean default false)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r call_rooms%rowtype;
  a appointments%rowtype;
  v_coach uuid;
  x jsonb;
  v_uid uuid;
  v_role text;
  n int := 0;
begin
  if not is_privileged_writer () then raise exception 'server_only'; end if;
  select * into r from call_rooms where id = p_room;
  if not found then raise exception 'not_found'; end if;
  select * into a from appointments where id = r.appointment_id;
  select profile_id into v_coach from providers where id = a.provider_id;

  for x in select * from jsonb_array_elements (coalesce(p_rows, '[]')) loop
    v_uid := case when (x->>'user_id') ~ '^[0-9a-f-]{36}$' then (x->>'user_id')::uuid end;
    v_role := case when v_uid = a.customer_id then 'customer' when v_uid = v_coach then 'coach' end;
    continue when v_role is null or coalesce(x->>'participant_id', '') = ''
      or coalesce(x->>'joined_at', '') !~ '^[0-9]+(\.[0-9]+)?$'
      or coalesce(x->>'duration', '') !~ '^[0-9]+(\.[0-9]+)?$';
    insert into call_attendance (room_id, appointment_id, provider_meeting_id, provider_participant_id, profile_id, role, joined_at, duration_seconds, source)
    values (r.id, a.id, left(x->>'meeting_id', 100), left(x->>'participant_id', 100), v_uid, v_role,
            to_timestamp ((x->>'joined_at')::double precision),
            greatest(0, least(86400, round((x->>'duration')::numeric)::int)), p_source)
    on conflict (provider_participant_id) do nothing;
    if found then n := n + 1; end if;
  end loop;

  if p_complete then
    update call_rooms set attendance_checked_at = now() where id = r.id;
  end if;
  return n;
end;
$$;

revoke execute on function record_call_attendance (uuid, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function record_call_attendance (uuid, jsonb, text, boolean) to service_role;

-- A webhook delivery: true the first time an event id is seen, false on a replay.
create or replace function claim_call_provider_event (p_event_id text, p_type text, p_room_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room uuid;
begin
  if not is_privileged_writer () then raise exception 'server_only'; end if;
  select id into v_room from call_rooms where room_name = p_room_name;
  insert into call_provider_events (event_id, event_type, room_id) values (left(p_event_id, 200), left(p_type, 60), v_room)
  on conflict (event_id) do nothing;
  return jsonb_build_object('new', found, 'room_id', v_room);
end;
$$;

revoke execute on function claim_call_provider_event (text, text, text) from public, anon, authenticated;
grant execute on function claim_call_provider_event (text, text, text) to service_role;

-- For the session page: the room's window and whether TalentYak is looking
-- into a report about this session. Parties only.
create or replace function appointment_call_info (p_appointment uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a appointments%rowtype;
  v_opens timestamptz;
  v_closes timestamptz;
begin
  select * into a from appointments where id = p_appointment;
  if not found or not (a.customer_id = auth.uid () or is_active_provider (a.provider_id) or is_admin ()) then
    return null;
  end if;
  select w.opens_at, w.closes_at into v_opens, v_closes from call_window (a) w;
  return jsonb_build_object(
    'opens_at', v_opens,
    'closes_at', v_closes,
    'closing_warning_minutes', (select to_jsonb (closing_warning_minutes) from call_settings where id),
    'open_reports', (select count(*) from support_cases where appointment_id = a.id and state <> 'resolved'),
    'my_open_reports', (select coalesce(jsonb_agg(session_topic), '[]') from support_cases
                         where appointment_id = a.id and state <> 'resolved' and reporter_profile_id = auth.uid ())
  );
end;
$$;

revoke execute on function appointment_call_info (uuid) from public, anon;
grant execute on function appointment_call_info (uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Session purpose
-- ---------------------------------------------------------------------------

create or replace function set_appointment_purpose (p_appointment uuid, p_purpose text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  a appointments%rowtype;
  v_role text;
  v_purpose text := nullif(btrim(coalesce(p_purpose, '')), '');
begin
  select * into a from appointments where id = p_appointment for update;
  if not found then raise exception 'not_found'; end if;
  v_role := case when a.customer_id = auth.uid () then 'customer' when is_active_provider (a.provider_id) then 'coach' end;
  if v_role is null then raise exception 'not_found'; end if;
  if exists (select 1 from profiles where id = auth.uid () and suspended_at is not null) then raise exception 'suspended'; end if;
  if a.state not in ('booked', 'tentative', 'on_hold') or a.ends_at <= now() then raise exception 'not_reschedulable'; end if;
  if v_purpose is not null and char_length(v_purpose) > 140 then raise exception 'purpose_too_long'; end if;
  if a.purpose is not distinct from v_purpose then return false; end if;
  update appointments set purpose = v_purpose where id = a.id;
  perform log_appointment_event (a.id, a.state, a.state, v_role, case when v_purpose is null then 'purpose_cleared' else 'purpose_set' end);
  return true;
end;
$$;

revoke execute on function set_appointment_purpose (uuid, text) from public, anon;
grant execute on function set_appointment_purpose (uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Outcomes: corrections are new rows that point at what they correct
-- ---------------------------------------------------------------------------

alter table appointment_outcomes add column if not exists corrects uuid references appointment_outcomes (id);
create index if not exists appointment_outcomes_corrects_idx on appointment_outcomes (corrects) where corrects is not null;

create or replace function record_appointment_outcome (p_appointment uuid, p_outcome text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a appointments%rowtype;
  v_role text;
  v_id uuid;
  v_prev uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into a from appointments where id = p_appointment for update;
  if not found then raise exception 'not_found'; end if;
  v_role := case when is_active_provider (a.provider_id) then 'coach' when is_admin () then 'admin' end;
  if v_role is null then raise exception 'not_found'; end if;
  if a.state <> 'booked' or a.starts_at > now() then
    raise exception 'not_yet' using hint = 'An outcome can be recorded once a confirmed meeting has started.';
  end if;

  -- An earlier record is never changed. A new one says what it corrects and why.
  select id into v_prev from appointment_outcomes where appointment_id = a.id order by recorded_at desc, id desc limit 1;
  if v_prev is not null and v_note is null then
    raise exception 'correction_reason_required';
  end if;

  insert into appointment_outcomes (appointment_id, outcome, note, recorded_by, recorded_role, corrects)
    values (a.id, p_outcome, v_note, auth.uid (), v_role, v_prev) returning id into v_id;
  perform log_appointment_event (a.id, a.state, a.state, v_role,
    case when v_prev is null then 'outcome_recorded' else 'outcome_corrected' end,
    jsonb_build_object('outcome', p_outcome) || case when v_prev is null then '{}'::jsonb else jsonb_build_object('corrects', v_prev) end);

  -- The client is told what was recorded (and can say if it is wrong). If
  -- TalentYak recorded it, the coach is told too. No other consequence.
  perform enqueue_outbox ('email.session_outcome_recorded',
    jsonb_build_object('appointment_id', a.id, 'outcome_id', v_id, 'recipient', 'customer'),
    'session_outcome:' || v_id || ':customer', now(), now() + interval '14 days');
  if v_role = 'admin' then
    perform enqueue_outbox ('email.session_outcome_recorded',
      jsonb_build_object('appointment_id', a.id, 'outcome_id', v_id, 'recipient', 'coach'),
      'session_outcome:' || v_id || ':coach', now(), now() + interval '14 days');
  end if;
  return v_id;
end;
$$;

revoke execute on function record_appointment_outcome (uuid, text, text) from public, anon;
grant execute on function record_appointment_outcome (uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Reports about a session, through the existing support cases
-- ---------------------------------------------------------------------------

alter table support_cases drop constraint if exists support_cases_category_check;
alter table support_cases add constraint support_cases_category_check
  check (category in ('conduct', 'safety', 'billing', 'technical', 'coach_change', 'other', 'session'));
alter table support_cases
  add column if not exists appointment_id uuid references appointments (id) on delete set null,
  add column if not exists session_topic text;
alter table support_cases drop constraint if exists support_cases_session_topic;
alter table support_cases add constraint support_cases_session_topic check (
  (session_topic is null or session_topic in ('outcome_incorrect', 'call_problem'))
  and (category <> 'session' or session_topic is not null)
);
create index if not exists support_cases_appointment_idx on support_cases (appointment_id) where appointment_id is not null;

/*
 * Either person reporting a call problem, or the client saying a recorded
 * outcome is wrong. Recorded in the session's history too, so the record shows
 * that it was questioned. Clicking twice returns the case already open.
 */
create or replace function open_session_case (p_appointment uuid, p_topic text, p_description text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  a appointments%rowtype;
  v_role text;
  v_id uuid;
  v_limit int;
  v_text text := btrim(coalesce(p_description, ''));
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;
  if p_topic not in ('outcome_incorrect', 'call_problem') then raise exception 'invalid_topic'; end if;
  if exists (select 1 from profiles where id = v_uid and suspended_at is not null) then raise exception 'suspended'; end if;

  select * into a from appointments where id = p_appointment;
  if not found then raise exception 'not_found'; end if;
  v_role := case when a.customer_id = v_uid then 'customer' when is_active_provider (a.provider_id) then 'coach' end;
  if v_role is null then raise exception 'not_found'; end if;

  if p_topic = 'outcome_incorrect' then
    if v_role <> 'customer' then raise exception 'not_found'; end if;
    if not exists (select 1 from appointment_outcomes where appointment_id = a.id) then raise exception 'no_outcome'; end if;
  else
    if a.state <> 'booked' or now() < a.starts_at - interval '1 hour' then raise exception 'not_yet'; end if;
  end if;

  select id into v_id from support_cases
    where appointment_id = a.id and reporter_profile_id = v_uid and session_topic = p_topic and state <> 'resolved';
  if v_id is not null then return v_id; end if;

  if char_length(v_text) < 10 or char_length(v_text) > 2000 then raise exception 'description_length'; end if;
  select support_cases_per_day into v_limit from messaging_settings where id;
  if (select count(*) from support_cases where reporter_profile_id = v_uid and created_at > now() - interval '1 day') >= v_limit then
    raise exception 'rate_limited';
  end if;

  insert into support_cases (reporter_profile_id, reporter_role, category, description, appointment_id, session_topic)
  values (v_uid, v_role, 'session', v_text, a.id, p_topic)
  returning id into v_id;

  perform log_appointment_event (a.id, a.state, a.state, v_role,
    case when p_topic = 'outcome_incorrect' then 'outcome_questioned' else 'call_problem_reported' end,
    jsonb_build_object('case_id', v_id));

  perform enqueue_outbox (
    'email.support_case_opened',
    jsonb_build_object('case_id', v_id, 'reporter_role', v_role, 'category', 'session'),
    'support_case:' || v_id
  );
  return v_id;
end;
$$;

revoke execute on function open_session_case (uuid, text, text) from public, anon;
grant execute on function open_session_case (uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
