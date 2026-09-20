-- M03 · Protected intake, health-record access by current assignment, and a
-- fix to enqueue_outbox.
--
-- ---------------------------------------------------------------------------
-- 1. Fix: enqueue_outbox refused legitimate internal callers
-- ---------------------------------------------------------------------------
--
-- 0018 made enqueue_outbox check is_privileged_writer(). Admin and customer
-- actions defined in 0020 (record a payout, request a coach change) call it
-- from inside their own SECURITY DEFINER bodies. Those requests carry the
-- admin's or customer's JWT, so the check refused them and every such action
-- would have failed.
--
-- The real protection was never that check. It is the EXECUTE grant: anon and
-- authenticated cannot call enqueue_outbox directly, while a definer function
-- owned by postgres can. The in-body check is removed; the grant stays.

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

revoke execute on function enqueue_outbox (text, jsonb, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function enqueue_outbox (text, jsonb, text, timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Protected intake (invariants 2 and 3; R-38)
-- ---------------------------------------------------------------------------
--
-- The pandit intake form wrote the deceased's name, relation, gotra and tithi
-- into bookings.intake_response. Any provider assigned to that booking could
-- read the whole row. Row restrictions do not hide columns, so the data has to
-- move to a table with its own, narrower rules.
--
-- Three sensitivity classes, each with its own readers:
--   grief     deceased, relation, gotra, tithi     customer + admin
--   health    injuries, conditions                 customer + currently assigned coach
--   personal  birth details, free-text notes        customer + admin
--
-- The key list lives in the database so a trigger can enforce it, and mirrors
-- the `sensitivity` flag on intake fields in src/verticals/*/intake.ts. A test
-- asserts they agree.

create table if not exists sensitive_intake_keys (
  vertical_slug text not null references verticals (slug),
  field_key text not null,
  sensitivity text not null check (sensitivity in ('grief', 'health', 'personal')),
  primary key (vertical_slug, field_key)
);

alter table sensitive_intake_keys enable row level security;
create policy "anyone reads the sensitive key list" on sensitive_intake_keys for select using (true);

insert into sensitive_intake_keys (vertical_slug, field_key, sensitivity) values
  ('pandit', 'deceased_name', 'grief'),
  ('pandit', 'relation', 'grief'),
  ('pandit', 'gotra', 'grief'),
  ('pandit', 'tithi_known', 'grief'),
  ('pandit', 'tithi_details', 'grief'),
  ('pandit', 'additional_ancestors', 'grief'),
  ('pandit', 'sankalpa_name', 'grief'),
  ('pandit', 'person_name', 'personal'),
  ('pandit', 'date_of_birth', 'personal'),
  ('pandit', 'time_of_birth', 'personal'),
  ('pandit', 'place_of_birth', 'personal'),
  ('pandit', 'gender', 'personal'),
  ('pandit', 'birth_details', 'personal'),
  ('pandit', 'notes', 'personal'),
  ('fitness', 'injuries', 'health'),
  ('fitness', 'notes', 'health')
on conflict do nothing;

create table if not exists protected_intake (
  id uuid primary key default gen_random_uuid (),
  booking_id uuid references bookings (id) on delete cascade,
  purchase_id uuid references purchases (id) on delete cascade,
  vertical_slug text not null references verticals (slug),
  sensitivity text not null check (sensitivity in ('grief', 'health', 'personal')),
  schema_version int not null default 1,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint protected_intake_one_anchor check ((booking_id is null) <> (purchase_id is null))
);

create unique index if not exists protected_intake_booking_key
  on protected_intake (booking_id, sensitivity) where booking_id is not null;
create unique index if not exists protected_intake_purchase_key
  on protected_intake (purchase_id, sensitivity) where purchase_id is not null;

alter table protected_intake enable row level security;

create or replace function purchase_belongs_to_me (p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from purchases where id = p_id and customer_id = auth.uid ());
$$;

-- Currently coaching this purchase's customer: an open assignment on its
-- enrollment, a live relationship, and nobody suspended.
create or replace function coaches_purchase_now (p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from enrollments e
    join enrollment_assignments a on a.enrollment_id = e.id and a.effective_to is null
    join providers p on p.id = a.provider_id
    join profiles pr on pr.id = p.profile_id
    where e.purchase_id = p_id
      and e.state in ('active', 'paused')
      and p.profile_id = auth.uid ()
      and p.suspended_at is null and p.status <> 'suspended' and pr.suspended_at is null
  );
$$;

-- The legacy booking path now respects suspension too. 0007's version did not:
-- a suspended coach kept reading their clients' bodyweight and photos.
create or replace function booking_coached_by_me (b_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from bookings b
    join providers p on p.id = b.provider_id
    join profiles pr on pr.id = p.profile_id
    where b.id = b_id
      and p.profile_id = auth.uid ()
      and p.suspended_at is null and p.status <> 'suspended' and pr.suspended_at is null
  );
$$;

create policy "customer reads own protected intake" on protected_intake
  for select using (
    (booking_id is not null and booking_belongs_to_me (booking_id))
    or (purchase_id is not null and purchase_belongs_to_me (purchase_id))
  );

-- A coach reads HEALTH intake for a client they currently coach — they need to
-- know about an injury to coach safely. Never grief or personal intake.
create policy "current coach reads health intake" on protected_intake
  for select using (
    sensitivity = 'health' and (
      (booking_id is not null and booking_coached_by_me (booking_id))
      or (purchase_id is not null and coaches_purchase_now (purchase_id))
    )
  );

-- Admins read grief and personal intake: invariant 1 needs a human to confirm
-- every ritual date. Health intake is NOT readable by admin (invariant 3:
-- owning customer and currently-assigned coach only).
create policy "admin reads grief and personal intake" on protected_intake
  for select using (sensitivity in ('grief', 'personal') and is_admin ());

-- No client write policy. Intake is written by the booking and checkout server
-- actions, which split sensitive fields out before anything is stored.

-- Move any sensitive keys already sitting in bookings.intake_response, without
-- losing a byte, and report the counts so the move can be reconciled.
do $$
declare
  v_bookings_before int;
  v_moved int := 0;
  v_after_leaks int;
  b record;
  v_sens text;
  v_payload jsonb;
begin
  select count(*) into v_bookings_before from bookings
    where exists (
      select 1 from sensitive_intake_keys k
      where k.vertical_slug = bookings.vertical_slug and bookings.intake_response ? k.field_key
    );

  for b in select id, vertical_slug, intake_response, intake_schema_version from bookings loop
    for v_sens in select distinct sensitivity from sensitive_intake_keys where vertical_slug = b.vertical_slug loop
      select coalesce(jsonb_object_agg(k.field_key, b.intake_response -> k.field_key), '{}'::jsonb)
        into v_payload
        from sensitive_intake_keys k
        where k.vertical_slug = b.vertical_slug and k.sensitivity = v_sens and b.intake_response ? k.field_key;

      if v_payload <> '{}'::jsonb then
        insert into protected_intake (booking_id, vertical_slug, sensitivity, schema_version, data)
          values (b.id, b.vertical_slug, v_sens, b.intake_schema_version, v_payload)
          on conflict (booking_id, sensitivity) where booking_id is not null
          do update set data = protected_intake.data || excluded.data;
        v_moved := v_moved + 1;
      end if;
    end loop;

    update bookings set intake_response = intake_response - array(
      select field_key from sensitive_intake_keys where vertical_slug = b.vertical_slug
    ) where id = b.id;
  end loop;

  select count(*) into v_after_leaks from bookings
    where exists (
      select 1 from sensitive_intake_keys k
      where k.vertical_slug = bookings.vertical_slug and bookings.intake_response ? k.field_key
    );

  raise notice '[0021] bookings holding sensitive intake before: %, protected records written: %, bookings still holding sensitive keys after: %',
    v_bookings_before, v_moved, v_after_leaks;

  if v_after_leaks <> 0 then
    raise exception '[0021] sensitive intake remains in bookings.intake_response after the move';
  end if;
end $$;

-- From here on, a sensitive key can never be written back into the broad
-- column, whatever code path tries.
create or replace function reject_sensitive_intake_in_bookings ()
returns trigger
language plpgsql
as $$
declare
  v_key text;
begin
  select k.field_key into v_key
    from sensitive_intake_keys k
    where k.vertical_slug = new.vertical_slug and new.intake_response ? k.field_key
    limit 1;

  if v_key is not null then
    raise exception 'sensitive_intake_in_booking'
      using hint = format('Field %s is sensitive and must be stored in protected_intake, not bookings.intake_response.', v_key);
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_reject_sensitive_intake on bookings;
create trigger bookings_reject_sensitive_intake before insert or update of intake_response on bookings
  for each row execute function reject_sensitive_intake_in_bookings ();

-- ---------------------------------------------------------------------------
-- 3. Health records follow the CURRENT assignment (invariant 3)
-- ---------------------------------------------------------------------------
--
-- 0007 tied every health table to bookings.provider_id and granted "for all"
-- to customer, coach AND admin. Three problems:
--
--   · a reassigned coach kept access, because nothing looked at assignments
--   · an admin could read progress photos and measurements, which invariant 3
--     forbids ("owning customer and currently-assigned coach only")
--   · a coach could delete a customer's own bodyweight log
--
-- Records gain an enrollment_id. Access is decided per record, per purpose:
--   customer          reads and writes their own logs
--   current coach     reads logs (and, per history_scope, older ones); writes programmes
--   former coach      nothing
--   admin             nothing — support that genuinely needs a record goes
--                     through an audited server function, not a table grant

alter table programs add column if not exists enrollment_id uuid references enrollments (id);
alter table workout_logs add column if not exists enrollment_id uuid references enrollments (id);
alter table bodyweight_logs add column if not exists enrollment_id uuid references enrollments (id);
alter table measurements add column if not exists enrollment_id uuid references enrollments (id);
alter table progress_photos add column if not exists enrollment_id uuid references enrollments (id);

alter table programs alter column booking_id drop not null;
alter table workout_logs alter column booking_id drop not null;
alter table bodyweight_logs alter column booking_id drop not null;
alter table measurements alter column booking_id drop not null;
alter table progress_photos alter column booking_id drop not null;

create index if not exists programs_enrollment_idx on programs (enrollment_id);
create index if not exists workout_logs_enrollment_idx on workout_logs (enrollment_id);
create index if not exists bodyweight_logs_enrollment_idx on bodyweight_logs (enrollment_id);
create index if not exists measurements_enrollment_idx on measurements (enrollment_id);
create index if not exists progress_photos_enrollment_idx on progress_photos (enrollment_id);

create or replace function enrollment_belongs_to_me (e_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from enrollments where id = e_id and customer_id = auth.uid ());
$$;

-- May the calling coach read a record created at `recorded_at` on this
-- enrollment? Only the CURRENT coach, only while the relationship is live, and
-- for anything recorded before they took over only if the customer's
-- history_scope allows it. Progress photos (p_media) need the 'full' scope.
create or replace function coach_may_read_record (e_id uuid, recorded_at timestamptz, p_media boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from enrollments e
    join enrollment_assignments a on a.enrollment_id = e.id and a.effective_to is null
    join providers p on p.id = a.provider_id
    join profiles pr on pr.id = p.profile_id
    where e.id = e_id
      and e.state in ('active', 'paused')
      and p.profile_id = auth.uid ()
      and p.suspended_at is null and p.status <> 'suspended' and pr.suspended_at is null
      and (
        recorded_at >= a.effective_from
        or a.previous_provider_id is null
        or a.history_scope = 'full'
        or (a.history_scope = 'programme_and_logs' and not p_media)
      )
  );
$$;

create or replace function coaches_enrollment_now (e_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coach_may_read_record (e_id, now(), false);
$$;

-- Programmes
drop policy if exists "programs access" on programs;
create policy "customer reads own programmes" on programs for select using (
  (enrollment_id is not null and enrollment_belongs_to_me (enrollment_id))
  or (enrollment_id is null and booking_id is not null and booking_belongs_to_me (booking_id))
);
create policy "coach reads programmes" on programs for select using (
  (enrollment_id is not null and coach_may_read_record (enrollment_id, created_at, false))
  or (enrollment_id is null and booking_id is not null and booking_coached_by_me (booking_id))
);
create policy "current coach writes programmes" on programs for insert with check (
  (enrollment_id is not null and coaches_enrollment_now (enrollment_id))
  or (enrollment_id is null and booking_id is not null and booking_coached_by_me (booking_id))
);
create policy "current coach updates programmes" on programs for update
  using ((enrollment_id is not null and coaches_enrollment_now (enrollment_id))
         or (enrollment_id is null and booking_id is not null and booking_coached_by_me (booking_id)))
  with check ((enrollment_id is not null and coaches_enrollment_now (enrollment_id))
         or (enrollment_id is null and booking_id is not null and booking_coached_by_me (booking_id)));
-- No DELETE policy: a prescribed programme is history (AAF-DATA-03).

drop policy if exists "program days access" on program_days;
create policy "programme days follow the programme" on program_days for select using (
  exists (select 1 from programs pr where pr.id = program_id)
);
create policy "current coach writes programme days" on program_days for all
  using (exists (select 1 from programs pr where pr.id = program_id and (
    (pr.enrollment_id is not null and coaches_enrollment_now (pr.enrollment_id))
    or (pr.enrollment_id is null and pr.booking_id is not null and booking_coached_by_me (pr.booking_id)))))
  with check (exists (select 1 from programs pr where pr.id = program_id and (
    (pr.enrollment_id is not null and coaches_enrollment_now (pr.enrollment_id))
    or (pr.enrollment_id is null and pr.booking_id is not null and booking_coached_by_me (pr.booking_id)))));

drop policy if exists "exercises access" on exercises;
create policy "exercises follow the programme" on exercises for select using (
  exists (select 1 from program_days pd where pd.id = program_day_id)
);
create policy "current coach writes exercises" on exercises for all
  using (exists (select 1 from program_days pd join programs pr on pr.id = pd.program_id
    where pd.id = program_day_id and (
      (pr.enrollment_id is not null and coaches_enrollment_now (pr.enrollment_id))
      or (pr.enrollment_id is null and pr.booking_id is not null and booking_coached_by_me (pr.booking_id)))))
  with check (exists (select 1 from program_days pd join programs pr on pr.id = pd.program_id
    where pd.id = program_day_id and (
      (pr.enrollment_id is not null and coaches_enrollment_now (pr.enrollment_id))
      or (pr.enrollment_id is null and pr.booking_id is not null and booking_coached_by_me (pr.booking_id)))));

-- Customer-owned logs: a macro keeps the four tables identical.
do $$
declare
  t text;
  v_date text;
  v_media boolean;
begin
  foreach t in array array['workout_logs', 'bodyweight_logs', 'measurements', 'progress_photos'] loop
    v_date := case t
      when 'workout_logs' then 'performed_at::timestamptz'
      when 'progress_photos' then 'taken_on::timestamptz'
      else 'logged_on::timestamptz' end;
    v_media := (t = 'progress_photos');

    execute format('drop policy if exists "workout logs access" on %I', t);
    execute format('drop policy if exists "bodyweight access" on %I', t);
    execute format('drop policy if exists "measurements access" on %I', t);
    execute format('drop policy if exists "progress photos access" on %I', t);

    execute format($f$
      create policy "customer manages own records" on %I for all
        using ((enrollment_id is not null and enrollment_belongs_to_me (enrollment_id))
               or (enrollment_id is null and booking_id is not null and booking_belongs_to_me (booking_id)))
        with check ((enrollment_id is not null and enrollment_belongs_to_me (enrollment_id))
               or (enrollment_id is null and booking_id is not null and booking_belongs_to_me (booking_id)))
    $f$, t);

    execute format($f$
      create policy "current coach reads records" on %I for select using (
        (enrollment_id is not null and coach_may_read_record (enrollment_id, %s, %L))
        or (enrollment_id is null and booking_id is not null and booking_coached_by_me (booking_id))
      )
    $f$, t, v_date, v_media);
  end loop;
end $$;

drop policy if exists "set logs access" on set_logs;
create policy "customer manages own set logs" on set_logs for all
  using (exists (select 1 from workout_logs wl where wl.id = workout_log_id and (
    (wl.enrollment_id is not null and enrollment_belongs_to_me (wl.enrollment_id))
    or (wl.enrollment_id is null and wl.booking_id is not null and booking_belongs_to_me (wl.booking_id)))))
  with check (exists (select 1 from workout_logs wl where wl.id = workout_log_id and (
    (wl.enrollment_id is not null and enrollment_belongs_to_me (wl.enrollment_id))
    or (wl.enrollment_id is null and wl.booking_id is not null and booking_belongs_to_me (wl.booking_id)))));
create policy "current coach reads set logs" on set_logs for select using (
  exists (select 1 from workout_logs wl where wl.id = workout_log_id and (
    (wl.enrollment_id is not null and coach_may_read_record (wl.enrollment_id, wl.performed_at::timestamptz, false))
    or (wl.enrollment_id is null and wl.booking_id is not null and booking_coached_by_me (wl.booking_id))))
);

notify pgrst, 'reload schema';
