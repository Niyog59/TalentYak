-- M12 · Client logging and progress.
--
-- What the client actually did, against what their coach prescribed (M11).
--
--   workout_logs            one workout, planned (a published version and a
--                           session) or unplanned; completed, partial, skipped
--                           or still in progress. Existing table, extended.
--   workout_exercise_logs   one exercise in that workout: the planned one, the
--                           coach's alternative, the client's own substitute,
--                           or an added exercise; skipped or not; what the
--                           load means (weight, bodyweight, assisted; per hand
--                           or combined); notes
--   set_logs                one CONFIRMED set. Existing table, extended with
--                           the load as entered (value and unit), time, extra
--   bodyweight_logs /       one entry per date, stored in kg / cm with the
--   measurements            unit the client entered. Existing tables
--   progress_photos         a dated, optional pose, pointing at an M08 asset
--   food_entries            a dated photo and/or text, optional calorie and
--                           protein numbers the client typed
--   food_diary_days         "I've recorded everything for this day"
--   tracking_preferences    kg/lb, cm/in, gentle reminders on or off
--   tracking_focus          what the current coach finds useful to track
--
-- The rules that shape this file:
--
--   1. Prescribed and actual stay apart. A set row exists only when the
--      client confirmed it; nothing the coach suggested is ever stored as
--      done. The version and session a workout was started against are fixed
--      for that record, and a published version never changes (0046), so a
--      later plan update cannot rewrite what the client followed.
--   2. Every client write goes through a function here. Direct table writes
--      are revoked. The functions check that the record is the caller's own,
--      that the date makes sense in the client's own timezone, and that
--      coaching is live: while a relationship is paused for payment, ended,
--      or either side is suspended, new entries are refused and the device
--      keeps them until they can be saved (founder decision 2026-09-27,
--      superseding TY-ACCESS-06 for tracking). Reading is never gated.
--   3. Saving is safe to repeat. Records carry ids the device chose, so a
--      retried save updates rather than duplicates, and a planned session is
--      recorded at most once per day. A workout and a food entry carry a
--      revision: a save based on an older revision is refused with the
--      current one, so two devices never silently overwrite each other.
--   4. Coaches read, never write. Access reuses coach_may_read_record()
--      (0021) verbatim: the current coach only, earlier history only within
--      the client's sharing choice, photos by the stricter media test.
--      Admin has no reach (invariant 3).
--   5. Removing a mistaken photo stays available at all times through M08's
--      own deletion; nothing here deletes anything automatically.

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

-- May the caller add or change tracking records on this relationship now?
--   live           yes
--   paused         the paid period ran out and a renewal failed
--   ended          the relationship is over
--   suspended      the client's account is suspended
--   unavailable    no open coach assignment, or the coach is suspended
--   not_permitted  not the caller's relationship
create or replace function tracking_write_state (p_enrollment uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when e.id is null then 'not_permitted'
    when coaching_is_live (e.id) then 'live'
    when cu.suspended_at is not null then 'suspended'
    when e.state = 'paused' then 'paused'
    when e.state = 'ended' then 'ended'
    else 'unavailable'
  end
  from (select 1) as one
  left join enrollments e on e.id = p_enrollment and e.customer_id = auth.uid ()
  left join profiles cu on cu.id = e.customer_id;
$$;

-- Today in the client's own timezone. Every tracking date is a calendar day
-- the client lived, never the server's.
create or replace function client_local_today (p_customer uuid)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
begin
  select timezone into v_tz from profiles where id = p_customer;
  begin
    return (now() at time zone coalesce(nullif(v_tz, ''), 'UTC'))::date;
  exception when others then
    return (now() at time zone 'UTC')::date;
  end;
end;
$$;

-- A write the caller may make now, on a sensible date. Raises otherwise.
create or replace function assert_tracking_write (p_enrollment uuid, p_date date)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_state text := tracking_write_state (p_enrollment);
  v_today date;
begin
  if v_state = 'not_permitted' then
    raise exception 'tracking_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if v_state <> 'live' then
    raise exception 'tracking_%', v_state using errcode = 'insufficient_privilege',
      hint = 'New entries wait on the device until coaching is live again.';
  end if;
  if p_date is not null then
    v_today := client_local_today (auth.uid ());
    -- A day of slack forward for a device whose clock is ahead; two years back
    -- for catching up.
    if p_date > v_today + 1 or p_date < v_today - 730 then
      raise exception 'tracking_date_invalid' using errcode = 'check_violation';
    end if;
  end if;
end;
$$;

revoke execute on function tracking_write_state (uuid) from public, anon;
revoke execute on function client_local_today (uuid) from public, anon, authenticated;
revoke execute on function assert_tracking_write (uuid, date) from public, anon, authenticated;
grant execute on function tracking_write_state (uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Workouts
-- ---------------------------------------------------------------------------

alter table workout_logs
  add column if not exists status text not null default 'completed',
  add column if not exists title text,
  add column if not exists revision int not null default 1,
  add column if not exists last_save_id uuid,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists timezone text,
  add column if not exists updated_at timestamptz not null default now();

alter table workout_logs drop constraint if exists workout_logs_status_ok;
alter table workout_logs add constraint workout_logs_status_ok
  check (status in ('in_progress', 'completed', 'partial', 'skipped'));
alter table workout_logs drop constraint if exists workout_logs_title_len;
alter table workout_logs add constraint workout_logs_title_len
  check (title is null or char_length(title) between 1 and 80);
alter table workout_logs drop constraint if exists workout_logs_notes_len;
alter table workout_logs add constraint workout_logs_notes_len
  check (notes is null or char_length(notes) <= 2000) not valid;

-- A planned session is recorded at most once per day. Two devices starting
-- the same session are told about each other instead of creating two.
create unique index if not exists workout_logs_one_per_session_day
  on workout_logs (enrollment_id, session_key, performed_at) where session_key is not null;

create table if not exists workout_exercise_logs (
  -- Chosen by the device, so a retried save updates this row, never adds one.
  id uuid primary key,
  workout_log_id uuid not null references workout_logs (id) on delete cascade,
  position smallint not null check (position between 0 and 60),
  -- The planned exercise this entry fills, by its stable M11 key. Null for an
  -- exercise the client added.
  exercise_key uuid,
  -- The coach's alternative performed instead. Its history is its own.
  alternative_key uuid,
  -- What the client actually did when it is not in the plan: their own
  -- substitute for the planned exercise, or an added exercise. Recorded as
  -- the exercise performed; never compared with the planned one.
  performed_name text check (performed_name is null or char_length(performed_name) between 1 and 80),
  status text not null default 'active' check (status in ('active', 'skipped')),
  -- What a load number means for this exercise, kept with the record so
  -- history and comparisons never mix meanings.
  load_kind text not null default 'weight' check (load_kind in ('weight', 'bodyweight', 'assisted', 'none')),
  load_basis text check (load_basis in ('total', 'per_hand')),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workout_exercise_logs_identity check (exercise_key is not null or performed_name is not null),
  constraint workout_exercise_logs_alternative check (alternative_key is null or (exercise_key is not null and performed_name is null))
);

create index if not exists workout_exercise_logs_workout_idx on workout_exercise_logs (workout_log_id, position);
create index if not exists workout_exercise_logs_exercise_key_idx on workout_exercise_logs (exercise_key) where exercise_key is not null;

alter table workout_exercise_logs enable row level security;
revoke insert, update, delete, truncate on workout_exercise_logs from anon, authenticated;

create policy "customer reads own exercise logs" on workout_exercise_logs
  for select using (exists (
    select 1 from workout_logs wl
    where wl.id = workout_log_id and wl.enrollment_id is not null and enrollment_belongs_to_me (wl.enrollment_id)
  ));
create policy "current coach reads exercise logs" on workout_exercise_logs
  for select using (exists (
    select 1 from workout_logs wl
    where wl.id = workout_log_id and wl.enrollment_id is not null
      and coach_may_read_record (wl.enrollment_id, wl.performed_at::timestamptz, false)
  ));

-- A planned entry must name an exercise (or alternative) the workout's own
-- version really contains.
create or replace function check_exercise_log_reference ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w workout_logs;
begin
  if new.exercise_key is null then
    return new;
  end if;
  select * into w from workout_logs where id = new.workout_log_id;
  if w.plan_version_id is null
     or plan_version_exercise (w.plan_version_id, w.session_key, new.exercise_key, new.alternative_key) is null then
    raise exception 'exercise_log_reference_invalid' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists workout_exercise_logs_reference on workout_exercise_logs;
create trigger workout_exercise_logs_reference before insert or update of exercise_key, alternative_key, workout_log_id on workout_exercise_logs
  for each row execute function check_exercise_log_reference ();

alter table set_logs
  add column if not exists exercise_log_id uuid references workout_exercise_logs (id) on delete cascade,
  -- The load exactly as entered. For 'assisted', the assistance; for
  -- 'bodyweight', any weight added.
  add column if not exists load_value numeric(7, 2),
  add column if not exists load_unit text,
  add column if not exists duration_seconds int,
  -- Beyond the prescribed number of sets.
  add column if not exists extra boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table set_logs drop constraint if exists set_logs_load_ok;
alter table set_logs add constraint set_logs_load_ok check (
  (load_value is null or (load_value >= 0 and load_value <= 1000 and load_unit is not null))
  and (load_unit is null or load_unit in ('kg', 'lb'))
);
alter table set_logs drop constraint if exists set_logs_amount_ok;
alter table set_logs add constraint set_logs_amount_ok check (
  (reps is null or reps between 0 and 1000)
  and (duration_seconds is null or duration_seconds between 1 and 36000)
  and (rpe is null or rpe between 1 and 10)
) not valid;

create index if not exists set_logs_exercise_log_idx on set_logs (exercise_log_id) where exercise_log_id is not null;

-- Save a whole workout as the device holds it. Returns
--   {ok: true, revision}                          saved (or an exact retry)
--   {ok: false, conflict: true, revision}         changed elsewhere since
--   {ok: false, duplicate: true, existing_id, revision}
--                                                 this session already has a
--                                                 record for this day
create or replace function save_workout_log (p_doc jsonb, p_base_revision int, p_save_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exercises jsonb := coalesce(p_doc -> 'exercises', '[]'::jsonb);
  v_sets jsonb := coalesce(p_doc -> 'sets', '[]'::jsonb);
  v_id uuid;
  v_enrollment uuid;
  v_version uuid;
  v_session uuid;
  v_date date;
  v_status text;
  v_title text;
  v_notes text;
  v_existing workout_logs;
  v_found boolean;
  v_other workout_logs;
  v_revision int;
  v_count int;
begin
  if jsonb_typeof(p_doc) is distinct from 'object' or octet_length(p_doc::text) > 200000
     or jsonb_typeof(v_exercises) <> 'array' or jsonb_typeof(v_sets) <> 'array'
     or jsonb_array_length(v_exercises) > 40 or jsonb_array_length(v_sets) > 400
     or exists (select 1 from jsonb_array_elements(v_exercises) x where x ->> 'id' is null)
     or exists (select 1 from jsonb_array_elements(v_sets) x where x ->> 'id' is null or x ->> 'exercise_log_id' is null) then
    raise exception 'workout_log_invalid' using errcode = 'check_violation';
  end if;

  v_id := (p_doc ->> 'id')::uuid;
  v_enrollment := (p_doc ->> 'enrollment_id')::uuid;
  v_version := nullif(p_doc ->> 'plan_version_id', '')::uuid;
  v_session := nullif(p_doc ->> 'session_key', '')::uuid;
  v_date := (p_doc ->> 'performed_on')::date;
  v_status := p_doc ->> 'status';
  v_title := nullif(trim(coalesce(p_doc ->> 'title', '')), '');
  v_notes := nullif(trim(coalesce(p_doc ->> 'notes', '')), '');

  if v_id is null or v_enrollment is null or v_date is null
     or coalesce(v_status, '') not in ('in_progress', 'completed', 'partial', 'skipped')
     or char_length(coalesce(v_title, '')) > 80 or char_length(coalesce(v_notes, '')) > 2000
     or (v_version is null and v_title is null) then
    raise exception 'workout_log_invalid' using errcode = 'check_violation';
  end if;

  select * into v_existing from workout_logs where id = v_id for update;
  v_found := found;
  if v_found and (v_existing.enrollment_id is distinct from v_enrollment or not enrollment_belongs_to_me (v_existing.enrollment_id)) then
    raise exception 'tracking_not_permitted' using errcode = 'insufficient_privilege';
  end if;

  perform assert_tracking_write (v_enrollment, v_date);

  if v_found then
    -- The same save arriving twice (a lost response, a retry) is not a conflict.
    if p_save_id is not null and v_existing.last_save_id = p_save_id then
      return jsonb_build_object('ok', true, 'revision', v_existing.revision, 'replayed', true);
    end if;
    if v_existing.revision <> coalesce(p_base_revision, -1) then
      return jsonb_build_object('ok', false, 'conflict', true, 'revision', v_existing.revision);
    end if;
    -- What the workout was performed against is fixed once it exists.
    if v_existing.plan_version_id is distinct from v_version or v_existing.session_key is distinct from v_session then
      raise exception 'workout_log_invalid' using errcode = 'check_violation';
    end if;
  elsif coalesce(p_base_revision, 0) <> 0 then
    -- The device saved this before, and it has since been deleted elsewhere.
    return jsonb_build_object('ok', false, 'conflict', true, 'revision', 0, 'missing', true);
  end if;

  if v_session is not null then
    select * into v_other from workout_logs
      where enrollment_id = v_enrollment and session_key = v_session and performed_at = v_date and id <> v_id
      limit 1;
    if found then
      return jsonb_build_object('ok', false, 'duplicate', true, 'existing_id', v_other.id, 'revision', v_other.revision);
    end if;
  end if;

  -- Ids must be new or already this workout's: a device can never take over
  -- another record's rows by naming them.
  if exists (
    select 1 from jsonb_array_elements(v_exercises) x
    join workout_exercise_logs el on el.id = (x ->> 'id')::uuid
    where el.workout_log_id <> v_id
  ) or exists (
    select 1 from jsonb_array_elements(v_sets) x
    join set_logs s on s.id = (x ->> 'id')::uuid
    where s.workout_log_id <> v_id
  ) then
    raise exception 'workout_log_invalid' using errcode = 'check_violation';
  end if;

  if not v_found then
    insert into workout_logs (id, enrollment_id, plan_version_id, session_key, performed_at, status, title, notes,
                              revision, last_save_id, started_at, finished_at, timezone)
      values (v_id, v_enrollment, v_version, v_session, v_date, v_status, v_title, v_notes,
              1, p_save_id, now(), case when v_status <> 'in_progress' then now() end,
              (select timezone from profiles where id = auth.uid ()));
    v_revision := 1;
  else
    update workout_logs
      set performed_at = v_date, status = v_status, title = v_title, notes = v_notes,
          revision = revision + 1, last_save_id = p_save_id,
          finished_at = case when v_status = 'in_progress' then null else coalesce(finished_at, now()) end,
          updated_at = now()
      where id = v_id
      returning revision into v_revision;
  end if;

  delete from set_logs where workout_log_id = v_id
    and id not in (select (x ->> 'id')::uuid from jsonb_array_elements(v_sets) x);
  delete from workout_exercise_logs where workout_log_id = v_id
    and id not in (select (x ->> 'id')::uuid from jsonb_array_elements(v_exercises) x);

  insert into workout_exercise_logs (id, workout_log_id, position, exercise_key, alternative_key, performed_name,
                                     status, load_kind, load_basis, notes)
    select x.id, v_id, x.position, x.exercise_key, x.alternative_key, nullif(trim(x.performed_name), ''),
           coalesce(x.status, 'active'), coalesce(x.load_kind, 'weight'), nullif(x.load_basis, ''), nullif(trim(x.notes), '')
    from jsonb_to_recordset(v_exercises) as x (
      id uuid, position int, exercise_key uuid, alternative_key uuid, performed_name text,
      status text, load_kind text, load_basis text, notes text)
  on conflict (id) do update set
    position = excluded.position, exercise_key = excluded.exercise_key, alternative_key = excluded.alternative_key,
    performed_name = excluded.performed_name, status = excluded.status, load_kind = excluded.load_kind,
    load_basis = excluded.load_basis, notes = excluded.notes, updated_at = now();

  -- A set's plan identity is its exercise entry's — unless that entry is the
  -- client's own substitute or an added exercise, which the plan never named.
  insert into set_logs (id, workout_log_id, exercise_log_id, set_index, load_value, load_unit, reps,
                        duration_seconds, rpe, extra, exercise_key, alternative_key)
    select x.id, v_id, x.exercise_log_id, x.set_index, x.load_value, nullif(x.load_unit, ''), x.reps,
           x.duration_seconds, x.rpe, coalesce(x.extra, false),
           case when el.performed_name is null then el.exercise_key end,
           case when el.performed_name is null then el.alternative_key end
    from jsonb_to_recordset(v_sets) as x (
      id uuid, exercise_log_id uuid, set_index int, load_value numeric, load_unit text, reps int,
      duration_seconds int, rpe numeric, extra boolean)
    join workout_exercise_logs el on el.id = x.exercise_log_id and el.workout_log_id = v_id
  on conflict (id) do update set
    exercise_log_id = excluded.exercise_log_id, set_index = excluded.set_index, load_value = excluded.load_value,
    load_unit = excluded.load_unit, reps = excluded.reps, duration_seconds = excluded.duration_seconds,
    rpe = excluded.rpe, extra = excluded.extra, exercise_key = excluded.exercise_key,
    alternative_key = excluded.alternative_key, updated_at = now();
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(v_sets) then
    raise exception 'workout_log_invalid' using errcode = 'check_violation';
  end if;

  return jsonb_build_object('ok', true, 'revision', v_revision);
end;
$$;

-- The client removing a workout they recorded by mistake.
create or replace function delete_workout_log (p_id uuid, p_revision int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v workout_logs;
begin
  select * into v from workout_logs where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'gone', true);
  end if;
  if v.enrollment_id is null or not enrollment_belongs_to_me (v.enrollment_id) then
    raise exception 'tracking_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  perform assert_tracking_write (v.enrollment_id, null);
  if v.revision <> coalesce(p_revision, -1) then
    return jsonb_build_object('ok', false, 'conflict', true, 'revision', v.revision);
  end if;
  delete from workout_logs where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Body weight and measurements
-- ---------------------------------------------------------------------------

alter table bodyweight_logs
  add column if not exists entered_value numeric(6, 2),
  add column if not exists entered_unit text check (entered_unit in ('kg', 'lb')),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table measurements
  add column if not exists entered_unit text check (entered_unit in ('cm', 'in')),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists bodyweight_logs_one_per_day on bodyweight_logs (enrollment_id, logged_on) where enrollment_id is not null;
create unique index if not exists measurements_one_per_day on measurements (enrollment_id, logged_on) where enrollment_id is not null;

-- One date's weight and measurements, as the client entered them. A blank
-- value clears that reading for that date. p_base is what the device last saw
-- for this date ('' for nothing); a different current value is a conflict,
-- returned with what is saved now. p_base null saves regardless — the client
-- chose "keep mine".
create or replace function save_body_entry (
  p_enrollment uuid,
  p_date date,
  p_weight numeric,
  p_weight_unit text,
  p_waist numeric,
  p_hips numeric,
  p_chest numeric,
  p_arm numeric,
  p_length_unit text,
  p_base text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bw bodyweight_logs;
  v_m measurements;
  v_token text;
  v_kg numeric;
  v_factor numeric;
  v_lengths numeric[];
begin
  perform assert_tracking_write (p_enrollment, p_date);

  select * into v_bw from bodyweight_logs where enrollment_id = p_enrollment and logged_on = p_date for update;
  select * into v_m from measurements where enrollment_id = p_enrollment and logged_on = p_date for update;
  v_token := coalesce(v_bw.updated_at::text, '-') || '|' || coalesce(v_m.updated_at::text, '-');

  if p_base is not null and p_base <> v_token and not (p_base = '' and v_token = '-|-') then
    return jsonb_build_object('ok', false, 'conflict', true, 'token', v_token);
  end if;

  if p_weight is null and p_waist is null and p_hips is null and p_chest is null and p_arm is null
     and v_bw.id is null and v_m.id is null then
    raise exception 'body_entry_empty' using errcode = 'check_violation';
  end if;

  if p_weight is null then
    delete from bodyweight_logs where enrollment_id = p_enrollment and logged_on = p_date;
  else
    if p_weight_unit not in ('kg', 'lb') then
      raise exception 'body_entry_invalid' using errcode = 'check_violation';
    end if;
    v_kg := round(case when p_weight_unit = 'lb' then p_weight * 0.45359237 else p_weight end, 2);
    if v_kg < 20 or v_kg > 400 then
      raise exception 'body_entry_invalid' using errcode = 'check_violation';
    end if;
    insert into bodyweight_logs (enrollment_id, logged_on, weight_kg, entered_value, entered_unit)
      values (p_enrollment, p_date, v_kg, round(p_weight, 2), p_weight_unit)
    on conflict (enrollment_id, logged_on) where enrollment_id is not null do update set
      weight_kg = excluded.weight_kg, entered_value = excluded.entered_value,
      entered_unit = excluded.entered_unit, updated_at = now();
  end if;

  if p_waist is null and p_hips is null and p_chest is null and p_arm is null then
    delete from measurements where enrollment_id = p_enrollment and logged_on = p_date;
  else
    if p_length_unit not in ('cm', 'in') then
      raise exception 'body_entry_invalid' using errcode = 'check_violation';
    end if;
    v_factor := case when p_length_unit = 'in' then 2.54 else 1 end;
    v_lengths := array[p_waist * v_factor, p_hips * v_factor, p_chest * v_factor, p_arm * v_factor];
    if exists (select 1 from unnest(v_lengths) l where l is not null and (l < 10 or l > 300)) then
      raise exception 'body_entry_invalid' using errcode = 'check_violation';
    end if;
    insert into measurements (enrollment_id, logged_on, waist_cm, hip_cm, chest_cm, arm_cm, entered_unit)
      values (p_enrollment, p_date, round(v_lengths[1], 2), round(v_lengths[2], 2), round(v_lengths[3], 2),
              round(v_lengths[4], 2), p_length_unit)
    on conflict (enrollment_id, logged_on) where enrollment_id is not null do update set
      waist_cm = excluded.waist_cm, hip_cm = excluded.hip_cm, chest_cm = excluded.chest_cm,
      arm_cm = excluded.arm_cm, entered_unit = excluded.entered_unit, updated_at = now();
  end if;

  select * into v_bw from bodyweight_logs where enrollment_id = p_enrollment and logged_on = p_date;
  select * into v_m from measurements where enrollment_id = p_enrollment and logged_on = p_date;
  return jsonb_build_object('ok', true,
    'token', coalesce(v_bw.updated_at::text, '-') || '|' || coalesce(v_m.updated_at::text, '-'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Progress photos — an M08 asset with a date and a pose
-- ---------------------------------------------------------------------------

alter table progress_photos alter column r2_key drop not null;
alter table progress_photos
  add column if not exists media_id uuid references media_assets (id) on delete set null,
  add column if not exists pose text check (pose in ('front', 'side', 'back', 'other')),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists progress_photos_media_idx on progress_photos (media_id) where media_id is not null;
create index if not exists progress_photos_taken_idx on progress_photos (enrollment_id, taken_on);

create or replace function save_progress_photo (p_enrollment uuid, p_media uuid, p_date date, p_pose text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform assert_tracking_write (p_enrollment, p_date);
  if p_pose is not null and p_pose not in ('front', 'side', 'back', 'other') then
    raise exception 'progress_photo_invalid' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from media_assets m
    where m.id = p_media and m.owner_profile_id = auth.uid () and m.enrollment_id = p_enrollment
      and m.purpose = 'progress_photo' and m.media_kind = 'image' and m.state <> 'deleted'
  ) then
    raise exception 'progress_photo_invalid' using errcode = 'check_violation';
  end if;

  insert into progress_photos (enrollment_id, media_id, taken_on, pose)
    values (p_enrollment, p_media, p_date, p_pose)
  on conflict (media_id) where media_id is not null do update set
    taken_on = excluded.taken_on, pose = excluded.pose, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- Removing a mistaken photo: the record here, alongside M08's own deletion of
-- the file. Allowed whatever the relationship's state — taking something
-- back is never "new coaching activity".
create or replace function remove_progress_photo (p_media uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from progress_photos p
    where p.media_id = p_media and p.enrollment_id is not null and enrollment_belongs_to_me (p.enrollment_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Food diary
-- ---------------------------------------------------------------------------

create table if not exists food_entries (
  id uuid primary key,  -- chosen by the device
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  eaten_on date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack', 'other')),
  description text check (description is null or char_length(description) between 1 and 1000),
  media_id uuid references media_assets (id) on delete set null,
  -- Typed by the client, when they know them. Never estimated from a photo,
  -- never looked up.
  kcal int check (kcal is null or kcal between 0 and 10000),
  protein_g numeric(6, 1) check (protein_g is null or protein_g between 0 and 1000),
  revision int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint food_entries_has_content check (description is not null or media_id is not null or kcal is not null or protein_g is not null)
);

create index if not exists food_entries_day_idx on food_entries (enrollment_id, eaten_on);
create index if not exists food_entries_media_idx on food_entries (media_id) where media_id is not null;

alter table food_entries enable row level security;
revoke insert, update, delete, truncate on food_entries from anon, authenticated;

create policy "customer reads own food entries" on food_entries
  for select using (enrollment_belongs_to_me (enrollment_id));
create policy "current coach reads food entries" on food_entries
  for select using (coach_may_read_record (enrollment_id, eaten_on::timestamptz, false));

-- A day with entries is partial unless the client says it is complete. A day
-- with no entries is unrecorded — never zero.
create table if not exists food_diary_days (
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  day date not null,
  complete boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (enrollment_id, day)
);

alter table food_diary_days enable row level security;
revoke insert, update, delete, truncate on food_diary_days from anon, authenticated;

create policy "customer reads own food days" on food_diary_days
  for select using (enrollment_belongs_to_me (enrollment_id));
create policy "current coach reads food days" on food_diary_days
  for select using (coach_may_read_record (enrollment_id, day::timestamptz, false));

create or replace function save_food_entry (p_entry jsonb, p_base_revision int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := (p_entry ->> 'id')::uuid;
  v_enrollment uuid := (p_entry ->> 'enrollment_id')::uuid;
  v_date date := (p_entry ->> 'eaten_on')::date;
  v_meal text := p_entry ->> 'meal';
  v_text text := nullif(trim(coalesce(p_entry ->> 'description', '')), '');
  v_media uuid := nullif(p_entry ->> 'media_id', '')::uuid;
  v_kcal int := nullif(p_entry ->> 'kcal', '')::int;
  v_protein numeric := nullif(p_entry ->> 'protein_g', '')::numeric;
  v_existing food_entries;
  v_found boolean;
  v_revision int;
begin
  if v_id is null or v_enrollment is null or v_date is null then
    raise exception 'food_entry_invalid' using errcode = 'check_violation';
  end if;

  select * into v_existing from food_entries where id = v_id for update;
  v_found := found;
  if v_found and (v_existing.enrollment_id <> v_enrollment or not enrollment_belongs_to_me (v_existing.enrollment_id)) then
    raise exception 'tracking_not_permitted' using errcode = 'insufficient_privilege';
  end if;

  perform assert_tracking_write (v_enrollment, v_date);

  if v_found and v_existing.revision <> coalesce(p_base_revision, -1) then
    return jsonb_build_object('ok', false, 'conflict', true, 'revision', v_existing.revision);
  elsif not v_found and coalesce(p_base_revision, 0) <> 0 then
    return jsonb_build_object('ok', false, 'conflict', true, 'revision', 0, 'missing', true);
  end if;

  -- A new photo must be the client's own food photo on this relationship.
  if v_media is not null and v_media is distinct from v_existing.media_id and not exists (
    select 1 from media_assets m
    where m.id = v_media and m.owner_profile_id = auth.uid () and m.enrollment_id = v_enrollment
      and m.purpose = 'food_photo' and m.media_kind = 'image' and m.state <> 'deleted'
  ) then
    raise exception 'food_entry_invalid' using errcode = 'check_violation';
  end if;

  if not v_found then
    insert into food_entries (id, enrollment_id, eaten_on, meal, description, media_id, kcal, protein_g)
      values (v_id, v_enrollment, v_date, v_meal, v_text, v_media, v_kcal, v_protein);
    v_revision := 1;
  else
    update food_entries
      set eaten_on = v_date, meal = v_meal, description = v_text, media_id = v_media, kcal = v_kcal,
          protein_g = v_protein, revision = revision + 1, updated_at = now()
      where id = v_id
      returning revision into v_revision;
  end if;
  return jsonb_build_object('ok', true, 'revision', v_revision);
end;
$$;

create or replace function delete_food_entry (p_id uuid, p_revision int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v food_entries;
begin
  select * into v from food_entries where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'gone', true);
  end if;
  if not enrollment_belongs_to_me (v.enrollment_id) then
    raise exception 'tracking_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  perform assert_tracking_write (v.enrollment_id, null);
  if v.revision <> coalesce(p_revision, -1) then
    return jsonb_build_object('ok', false, 'conflict', true, 'revision', v.revision);
  end if;
  delete from food_entries where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function set_food_day (p_enrollment uuid, p_day date, p_complete boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_tracking_write (p_enrollment, p_day);
  insert into food_diary_days (enrollment_id, day, complete)
    values (p_enrollment, p_day, coalesce(p_complete, false))
  on conflict (enrollment_id, day) do update set complete = excluded.complete, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Preferences and the coach's tracking focus
-- ---------------------------------------------------------------------------

create table if not exists tracking_preferences (
  customer_id uuid primary key references profiles (id) on delete cascade,
  weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  length_unit text not null default 'cm' check (length_unit in ('cm', 'in')),
  -- One gentle in-app nudge on a planned workout day with nothing logged.
  log_reminders boolean not null default true,
  updated_at timestamptz not null default now()
);

drop trigger if exists tracking_preferences_touch on tracking_preferences;
create trigger tracking_preferences_touch before update on tracking_preferences
  for each row execute function touch_updated_at ();

alter table tracking_preferences enable row level security;
revoke delete, truncate on tracking_preferences from anon, authenticated;

create policy "client reads own tracking preferences" on tracking_preferences
  for select using (customer_id = auth.uid ());
create policy "client creates own tracking preferences" on tracking_preferences
  for insert with check (customer_id = auth.uid ());
create policy "client updates own tracking preferences" on tracking_preferences
  for update using (customer_id = auth.uid ()) with check (customer_id = auth.uid ());
create policy "current coach reads tracking preferences" on tracking_preferences
  for select using (coaches_customer_now (customer_id));

-- What the current coach finds useful to track. Advice only: every field
-- stays optional for the client, photos and measurements especially.
create table if not exists tracking_focus (
  assignment_id uuid primary key references enrollment_assignments (id) on delete cascade,
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  provider_id uuid not null references providers (id),
  fields text[] not null default '{}'
    check (fields <@ array['workouts', 'bodyweight', 'waist', 'hips', 'chest', 'arm', 'photos', 'food_photos', 'food_notes', 'food_numbers']::text[]),
  note text check (note is null or char_length(note) <= 500),
  updated_at timestamptz not null default now()
);

create index if not exists tracking_focus_enrollment_idx on tracking_focus (enrollment_id);
create index if not exists tracking_focus_provider_idx on tracking_focus (provider_id);

alter table tracking_focus enable row level security;
revoke insert, update, delete, truncate on tracking_focus from anon, authenticated;

create policy "client reads tracking focus" on tracking_focus
  for select using (enrollment_belongs_to_me (enrollment_id));
create policy "current coach reads own tracking focus" on tracking_focus
  for select using (
    coach_may_read_record (enrollment_id, now(), false)
    and exists (
      select 1 from enrollment_assignments a join providers p on p.id = a.provider_id
      where a.id = assignment_id and a.effective_to is null and p.profile_id = auth.uid ()
    )
  );

create or replace function set_tracking_focus (p_enrollment uuid, p_fields text[], p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment enrollment_assignments;
begin
  if not coaches_enrollment_now (p_enrollment) then
    raise exception 'tracking_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  select a.* into v_assignment from enrollment_assignments a
    join providers p on p.id = a.provider_id
    where a.enrollment_id = p_enrollment and a.effective_to is null and p.profile_id = auth.uid ();
  if not found then
    raise exception 'tracking_not_permitted' using errcode = 'insufficient_privilege';
  end if;

  insert into tracking_focus (assignment_id, enrollment_id, provider_id, fields, note)
    values (v_assignment.id, p_enrollment, v_assignment.provider_id,
            array(select distinct f from unnest(coalesce(p_fields, '{}')) f order by f),
            nullif(left(trim(coalesce(p_note, '')), 500), ''))
  on conflict (assignment_id) do update set fields = excluded.fields, note = excluded.note, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The client's existing record tables: read directly, write through the
--    functions above
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['workout_logs', 'bodyweight_logs', 'measurements', 'progress_photos'] loop
    execute format('drop policy if exists "customer manages own records" on %I', t);
    execute format('drop policy if exists "customer reads own records" on %I', t);
    execute format($f$
      create policy "customer reads own records" on %I for select
        using ((enrollment_id is not null and enrollment_belongs_to_me (enrollment_id))
               or (enrollment_id is null and booking_id is not null and booking_belongs_to_me (booking_id)))
    $f$, t);
    execute format('revoke insert, update, delete, truncate on %I from anon, authenticated', t);
  end loop;
end $$;

drop policy if exists "customer manages own set logs" on set_logs;
drop policy if exists "customer reads own set logs" on set_logs;
create policy "customer reads own set logs" on set_logs for select
  using (exists (select 1 from workout_logs wl where wl.id = workout_log_id and (
    (wl.enrollment_id is not null and enrollment_belongs_to_me (wl.enrollment_id))
    or (wl.enrollment_id is null and wl.booking_id is not null and booking_belongs_to_me (wl.booking_id)))));
revoke insert, update, delete, truncate on set_logs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'save_workout_log(jsonb, int, uuid)',
    'delete_workout_log(uuid, int)',
    'save_body_entry(uuid, date, numeric, text, numeric, numeric, numeric, numeric, text, text)',
    'save_progress_photo(uuid, uuid, date, text)',
    'remove_progress_photo(uuid)',
    'save_food_entry(jsonb, int)',
    'delete_food_entry(uuid, int)',
    'set_food_day(uuid, date, boolean)',
    'set_tracking_focus(uuid, text[], text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

notify pgrst, 'reload schema';
