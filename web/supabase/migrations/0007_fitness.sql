-- Fitness vertical node: programs, logging, and measurements.
-- Launch is gated on the Nov 15 presale decision; the schema ships
-- ready so flipping the catalog status is all it takes.

create table programs (
  id uuid primary key default gen_random_uuid (),
  booking_id uuid not null references bookings (id),
  coach_provider_id uuid references providers (id),
  title text not null,
  goal text, -- 'fat_loss' | 'muscle' | 'general'
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index programs_booking_idx on programs (booking_id);

create table program_days (
  id uuid primary key default gen_random_uuid (),
  program_id uuid not null references programs (id) on delete cascade,
  day_index int not null, -- 1..7 within the week
  title text not null, -- e.g. 'Push day', 'Rest'
  notes text
);

create table exercises (
  id uuid primary key default gen_random_uuid (),
  program_day_id uuid not null references program_days (id) on delete cascade,
  name text not null,
  sets int,
  reps text, -- '8-12', 'AMRAP'
  rest_seconds int,
  tempo text,
  notes text,
  sort int not null default 0
);

create table workout_logs (
  id uuid primary key default gen_random_uuid (),
  booking_id uuid not null references bookings (id),
  program_day_id uuid references program_days (id),
  performed_at date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

create table set_logs (
  id uuid primary key default gen_random_uuid (),
  workout_log_id uuid not null references workout_logs (id) on delete cascade,
  exercise_id uuid references exercises (id),
  set_index int not null,
  weight_kg numeric(6, 2),
  reps int,
  rpe numeric(3, 1)
);

create table bodyweight_logs (
  id uuid primary key default gen_random_uuid (),
  booking_id uuid not null references bookings (id),
  logged_on date not null default current_date,
  weight_kg numeric(6, 2) not null,
  unique (booking_id, logged_on)
);

create table measurements (
  id uuid primary key default gen_random_uuid (),
  booking_id uuid not null references bookings (id),
  logged_on date not null default current_date,
  waist_cm numeric(6, 2),
  hip_cm numeric(6, 2),
  chest_cm numeric(6, 2),
  arm_cm numeric(6, 2),
  thigh_cm numeric(6, 2)
);

create table progress_photos (
  id uuid primary key default gen_random_uuid (),
  booking_id uuid not null references bookings (id),
  r2_key text not null,
  taken_on date not null default current_date,
  created_at timestamptz not null default now()
);

-- RLS: customer owns their logs; the assigned coach can see and program;
-- admin sees all.
alter table programs enable row level security;
alter table program_days enable row level security;
alter table exercises enable row level security;
alter table workout_logs enable row level security;
alter table set_logs enable row level security;
alter table bodyweight_logs enable row level security;
alter table measurements enable row level security;
alter table progress_photos enable row level security;

create or replace function booking_belongs_to_me (b_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from bookings where id = b_id and customer_id = auth.uid ()
  );
$$;

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
    where b.id = b_id and p.profile_id = auth.uid ()
  );
$$;

create policy "programs access" on programs for all using (
  is_admin () or booking_belongs_to_me (booking_id) or booking_coached_by_me (booking_id)
);

create policy "program days access" on program_days for all using (
  exists (
    select 1 from programs pr where pr.id = program_id and (
      is_admin () or booking_belongs_to_me (pr.booking_id) or booking_coached_by_me (pr.booking_id)
    )
  )
);

create policy "exercises access" on exercises for all using (
  exists (
    select 1 from program_days pd
    join programs pr on pr.id = pd.program_id
    where pd.id = program_day_id and (
      is_admin () or booking_belongs_to_me (pr.booking_id) or booking_coached_by_me (pr.booking_id)
    )
  )
);

create policy "workout logs access" on workout_logs for all using (
  is_admin () or booking_belongs_to_me (booking_id) or booking_coached_by_me (booking_id)
);

create policy "set logs access" on set_logs for all using (
  exists (
    select 1 from workout_logs wl where wl.id = workout_log_id and (
      is_admin () or booking_belongs_to_me (wl.booking_id) or booking_coached_by_me (wl.booking_id)
    )
  )
);

create policy "bodyweight access" on bodyweight_logs for all using (
  is_admin () or booking_belongs_to_me (booking_id) or booking_coached_by_me (booking_id)
);

create policy "measurements access" on measurements for all using (
  is_admin () or booking_belongs_to_me (booking_id) or booking_coached_by_me (booking_id)
);

create policy "progress photos access" on progress_photos for all using (
  is_admin () or booking_belongs_to_me (booking_id) or booking_coached_by_me (booking_id)
);
