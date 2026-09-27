-- Batch 4 · M09 — Flexible scheduling.
--
-- Both people in a coaching relationship propose, agree and change meetings,
-- from the calendar or the conversation, without double bookings and without
-- forcing a call quota on flexible coaching. The rules that shape this file:
--
--   1. A proposal is not an appointment. It holds no time, expires, and becomes
--      one confirmed appointment only when the other person accepts — at which
--      moment eligibility and availability are checked again, under locks.
--   2. Double booking is impossible, not merely checked for: two exclusion
--      constraints (coach, client) over each appointment's full interval PLUS
--      the coach's buffers. Simultaneous acceptances produce one winner; the
--      other proposal is marked `conflicted` with a way forward.
--   3. Lifecycle, history, attendance outcome, payment and eligibility are
--      separate records. Recording "did not attend" moves no money and assumes
--      nothing about delivery.
--   4. Rescheduling keeps the original until a replacement is accepted.
--   5. Repeating series are anchored to an explicit reference time zone. A
--      local time that does not exist on a clock-change day is moved forward
--      and labelled; one that happens twice uses the FIRST occurrence and is
--      labelled. Travelling or changing one's display zone changes nothing.
--   6. Meetings after the paid period are `tentative` (they hold no time) and
--      confirm when the renewal is paid, if the time is still free. A paused,
--      suspended or ended relationship puts future meetings on hold or cancels
--      them, with a notice — never silently.
--   7. Every timing here is a configurable development default
--      (`scheduling.v1`, sandbox_default), not an approved rule.
--
-- Calls themselves (joining, recording) are Batch 5. Nothing here pretends a
-- call can be joined.

-- ---------------------------------------------------------------------------
-- 0. Small immutable helpers
-- ---------------------------------------------------------------------------

create or replace function ints_between (p int[], lo int, hi int)
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(x between lo and hi), true) from unnest(p) x;
$$;

-- An IANA identifier, never a bare offset like "+05:45".
create or replace function is_iana_zone (p text)
returns boolean
language sql
stable
as $$
  select p is not null
     and p ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$'
     and exists (select 1 from pg_timezone_names where name = p);
$$;

-- ---------------------------------------------------------------------------
-- 1. Platform scheduling settings (sandbox defaults)
-- ---------------------------------------------------------------------------

create table if not exists scheduling_settings (
  id boolean primary key default true,
  policy_id text not null default 'scheduling.v1',
  policy_status text not null default 'sandbox_default'
    check (policy_status in ('sandbox_default', 'confirmed')),
  -- An unanswered proposal lapses after this, or at its start time if sooner.
  proposal_ttl_hours int not null default 48 check (proposal_ttl_hours between 1 and 336),
  reminder_offsets_minutes int[] not null default '{1440,60}',
  default_min_notice_minutes int not null default 720 check (default_min_notice_minutes between 0 and 10080),
  default_horizon_days int not null default 28 check (default_horizon_days between 1 and 180),
  default_buffer_minutes int not null default 10 check (default_buffer_minutes between 0 and 120),
  -- How long a one-off consultation slot is held during checkout.
  slot_hold_minutes int not null default 35 check (slot_hold_minutes between 31 and 120),
  -- Meetings after the paid period: tentative (false) or confirmed (true).
  confirm_beyond_paid_through boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id) on delete set null,
  constraint scheduling_settings_singleton check (id),
  constraint scheduling_settings_reminders check (
    cardinality(reminder_offsets_minutes) <= 4 and ints_between(reminder_offsets_minutes, 5, 10080)
  )
);

insert into scheduling_settings (id) values (true) on conflict (id) do nothing;

create index if not exists scheduling_settings_updated_by_idx on scheduling_settings (updated_by);

alter table scheduling_settings enable row level security;
revoke insert, delete, truncate on scheduling_settings from anon, authenticated;
create policy "signed in reads scheduling settings" on scheduling_settings
  for select to authenticated using (true);
create policy "admin updates scheduling settings" on scheduling_settings
  for update using (is_admin ()) with check (is_admin ());

-- ---------------------------------------------------------------------------
-- 2. Coach availability
-- ---------------------------------------------------------------------------

create table if not exists coach_schedule_settings (
  provider_id uuid primary key references providers (id) on delete cascade,
  durations_minutes int[] not null default '{30,45,60}',
  buffer_before_minutes int not null default 0 check (buffer_before_minutes between 0 and 120),
  buffer_after_minutes int not null default 10 check (buffer_after_minutes between 0 and 120),
  min_notice_minutes int not null default 720 check (min_notice_minutes between 0 and 10080),
  horizon_days int not null default 28 check (horizon_days between 1 and 180),
  daily_limit int check (daily_limit between 1 and 24),
  -- The adjustable starting workflow: client requests wait for the coach.
  auto_confirm_client_requests boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint coach_schedule_durations check (
    cardinality(durations_minutes) between 1 and 8 and ints_between(durations_minutes, 10, 240)
  )
);

drop trigger if exists coach_schedule_settings_touch on coach_schedule_settings;
create trigger coach_schedule_settings_touch before update on coach_schedule_settings
  for each row execute function touch_updated_at ();

-- Weekly hours in the coach's own zone (providers.timezone). Several windows a
-- day are allowed. weekday follows extract(dow): 0 = Sunday.
create table if not exists availability_windows (
  id uuid primary key default gen_random_uuid (),
  provider_id uuid not null references providers (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint availability_windows_order check (end_time > start_time)
);

create index if not exists availability_windows_provider_idx on availability_windows (provider_id, weekday);

-- Date exceptions, time off (a date range) and extra availability. Local dates
-- and times in the coach's zone. An 'unavailable' row with no times is a whole
-- day (or days) off.
create table if not exists availability_exceptions (
  id uuid primary key default gen_random_uuid (),
  provider_id uuid not null references providers (id) on delete cascade,
  kind text not null check (kind in ('unavailable', 'extra')),
  starts_on date not null,
  ends_on date not null,
  start_time time,
  end_time time,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  constraint availability_exceptions_range check (ends_on >= starts_on and ends_on - starts_on <= 366),
  constraint availability_exceptions_times check (
    (start_time is null and end_time is null and kind = 'unavailable')
    or (start_time is not null and end_time is not null and end_time > start_time)
  )
);

create index if not exists availability_exceptions_provider_idx on availability_exceptions (provider_id, starts_on);

alter table coach_schedule_settings enable row level security;
alter table availability_windows enable row level security;
alter table availability_exceptions enable row level security;

-- A coach's availability is their own configuration: they edit it directly.
-- Editing never touches an appointment (see my_schedule_conflicts()).
create policy "coach manages own schedule settings" on coach_schedule_settings
  for all using (is_active_provider (provider_id)) with check (is_active_provider (provider_id));
create policy "admin reads schedule settings" on coach_schedule_settings for select using (is_admin ());
create policy "coach manages own windows" on availability_windows
  for all using (is_active_provider (provider_id)) with check (is_active_provider (provider_id));
create policy "admin reads windows" on availability_windows for select using (is_admin ());
create policy "coach manages own exceptions" on availability_exceptions
  for all using (is_active_provider (provider_id)) with check (is_active_provider (provider_id));
create policy "admin reads exceptions" on availability_exceptions for select using (is_admin ());

-- ---------------------------------------------------------------------------
-- 3. Series, appointments, events, outcomes
-- ---------------------------------------------------------------------------

create table if not exists appointment_series (
  id uuid primary key default gen_random_uuid (),
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  provider_id uuid not null references providers (id),
  customer_id uuid not null references profiles (id),
  -- The zone the series is defined in. Never changed by travel or by either
  -- person's display preference.
  reference_timezone text not null check (is_iana_zone (reference_timezone)),
  weekday smallint not null check (weekday between 0 and 6),
  local_start time not null,
  duration_minutes int not null check (duration_minutes between 10 and 240),
  interval_weeks int not null default 1 check (interval_weeks between 1 and 4),
  starts_on date not null,
  ends_on date,
  state text not null default 'active' check (state in ('active', 'ended')),
  previous_series_id uuid references appointment_series (id),
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint appointment_series_range check (ends_on is null or ends_on >= starts_on)
);

create index if not exists appointment_series_enrollment_idx on appointment_series (enrollment_id);
create index if not exists appointment_series_provider_idx on appointment_series (provider_id);
create index if not exists appointment_series_customer_idx on appointment_series (customer_id);
create index if not exists appointment_series_active_idx on appointment_series (state) where state = 'active';
create index if not exists appointment_series_previous_idx on appointment_series (previous_series_id) where previous_series_id is not null;
create index if not exists appointment_series_created_by_idx on appointment_series (created_by);

-- The appointments table from 0022 has never held a row. It is reshaped here:
-- the lifecycle becomes an explicit text state (the old enum mixed lifecycle
-- with attendance outcomes, which now live in their own table).
alter table appointments drop constraint if exists appointments_no_double_booking;
alter table appointments alter column state drop default;
alter table appointments alter column state type text using state::text;
drop type if exists appointment_state;
alter table appointments alter column state set default 'booked';
alter table appointments drop constraint if exists appointments_state_check;
alter table appointments add constraint appointments_state_check
  check (state in ('held', 'booked', 'tentative', 'on_hold', 'cancelled', 'replaced', 'expired'));

alter table appointments alter column purchase_id drop not null;
alter table appointments
  add column if not exists kind text not null default 'coaching',
  add column if not exists series_id uuid references appointment_series (id),
  add column if not exists checkout_attempt_id uuid references checkout_attempts (id),
  -- The interval the coach's calendar is occupied for: the meeting plus the
  -- coach's buffers, fixed when it was booked. Both constraints use it.
  add column if not exists blocked_from timestamptz,
  add column if not exists blocked_to timestamptz,
  add column if not exists replaced_by uuid references appointments (id),
  add column if not exists state_reason text,
  -- Why a series occurrence is not at the usual local time (clock change).
  add column if not exists time_note text,
  -- Bumped whenever the time changes; reminders carry it.
  add column if not exists revision int not null default 1,
  add column if not exists created_by uuid references profiles (id) on delete set null,
  add column if not exists confirmed_at timestamptz;

alter table appointments drop constraint if exists appointments_kind_check;
alter table appointments add constraint appointments_kind_check check (kind in ('coaching', 'consultation'));
alter table appointments drop constraint if exists appointments_relationship;
alter table appointments add constraint appointments_relationship check (
  (kind = 'coaching' and enrollment_id is not null) or (kind = 'consultation' and purchase_id is not null)
);
alter table appointments alter column blocked_from set not null;
alter table appointments alter column blocked_to set not null;
alter table appointments drop constraint if exists appointments_blocked_covers;
alter table appointments add constraint appointments_blocked_covers
  check (blocked_from <= starts_at and blocked_to >= ends_at);
alter table appointments drop constraint if exists appointments_state_reason_len;
alter table appointments add constraint appointments_state_reason_len
  check (state_reason is null or char_length(state_reason) <= 200);

-- One winner. Held and booked appointments occupy time for the coach AND the
-- client, over the whole interval plus buffers — not merely equal starts.
alter table appointments drop constraint if exists appointments_coach_no_overlap;
alter table appointments add constraint appointments_coach_no_overlap
  exclude using gist (provider_id with =, tstzrange(blocked_from, blocked_to) with &&)
  where (state in ('held', 'booked'));
alter table appointments drop constraint if exists appointments_client_no_overlap;
alter table appointments add constraint appointments_client_no_overlap
  exclude using gist (customer_id with =, tstzrange(blocked_from, blocked_to) with &&)
  where (state in ('held', 'booked'));

-- A one-off consultation is consumed once.
create unique index if not exists appointments_one_consultation
  on appointments (purchase_id) where kind = 'consultation' and state in ('held', 'booked', 'tentative', 'on_hold');

create index if not exists appointments_state_idx on appointments (state, starts_at);
create index if not exists appointments_enrollment_idx on appointments (enrollment_id, starts_at);
create index if not exists appointments_series_idx on appointments (series_id) where series_id is not null;
create index if not exists appointments_entitlement_idx on appointments (entitlement_id) where entitlement_id is not null;
create index if not exists appointments_attempt_idx on appointments (checkout_attempt_id) where checkout_attempt_id is not null;
create index if not exists appointments_replaced_by_idx on appointments (replaced_by) where replaced_by is not null;
create index if not exists appointments_created_by_idx on appointments (created_by);

revoke insert, update, delete, truncate on appointments from anon, authenticated;
drop policy if exists "admin reads appointments" on appointments;
create policy "admin reads appointments" on appointments for select using (is_admin ());

-- History: every state change, with who and why. Append-only.
create table if not exists appointment_events (
  id uuid primary key default gen_random_uuid (),
  appointment_id uuid not null references appointments (id) on delete cascade,
  from_state text,
  to_state text not null,
  actor_profile_id uuid references profiles (id) on delete set null,
  actor_role text not null check (actor_role in ('customer', 'coach', 'admin', 'system')),
  reason text check (reason is null or char_length(reason) <= 200),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists appointment_events_appointment_idx on appointment_events (appointment_id, created_at);
create index if not exists appointment_events_actor_idx on appointment_events (actor_profile_id);

-- Attendance, recorded by a person. Separate from the lifecycle, from payment
-- and from eligibility, and with no consequence attached to any value.
create table if not exists appointment_outcomes (
  id uuid primary key default gen_random_uuid (),
  appointment_id uuid not null references appointments (id) on delete cascade,
  outcome text not null check (outcome in ('attended', 'client_did_not_attend', 'coach_did_not_attend', 'technical_failure', 'other')),
  note text check (note is null or char_length(note) <= 500),
  recorded_by uuid references profiles (id) on delete set null,
  recorded_role text not null check (recorded_role in ('coach', 'admin')),
  recorded_at timestamptz not null default now()
);

create index if not exists appointment_outcomes_appointment_idx on appointment_outcomes (appointment_id, recorded_at desc);
create index if not exists appointment_outcomes_recorded_by_idx on appointment_outcomes (recorded_by);

create or replace function prevent_history_change ()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'history_immutable' using errcode = 'restrict_violation';
  end if;
  -- Deletion only when the appointment itself goes.
  if exists (select 1 from appointments where id = old.appointment_id) then
    raise exception 'history_immutable' using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists appointment_events_append_only on appointment_events;
create trigger appointment_events_append_only before update or delete on appointment_events
  for each row execute function prevent_history_change ();
drop trigger if exists appointment_outcomes_append_only on appointment_outcomes;
create trigger appointment_outcomes_append_only before update or delete on appointment_outcomes
  for each row execute function prevent_history_change ();

-- Only the two people on it (and a coach only while they are active), and admins.
create or replace function appointment_party (a_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from appointments a
    where a.id = a_id
      and (a.customer_id = auth.uid () or is_active_provider (a.provider_id))
  );
$$;

revoke execute on function appointment_party (uuid) from public;
grant execute on function appointment_party (uuid) to anon, authenticated, service_role;

alter table appointment_series enable row level security;
alter table appointment_events enable row level security;
alter table appointment_outcomes enable row level security;
revoke insert, update, delete, truncate on appointment_series, appointment_events, appointment_outcomes from anon, authenticated;

create policy "parties read series" on appointment_series
  for select using (customer_id = auth.uid () or is_active_provider (provider_id));
create policy "admin reads series" on appointment_series for select using (is_admin ());
create policy "parties read appointment events" on appointment_events
  for select using (appointment_party (appointment_id));
create policy "admin reads appointment events" on appointment_events for select using (is_admin ());
create policy "parties read outcomes" on appointment_outcomes
  for select using (appointment_party (appointment_id));
create policy "admin reads outcomes" on appointment_outcomes for select using (is_admin ());

-- ---------------------------------------------------------------------------
-- 4. Proposals
-- ---------------------------------------------------------------------------

create table if not exists appointment_proposals (
  id uuid primary key default gen_random_uuid (),
  kind text not null check (kind in ('coaching', 'consultation')),
  enrollment_id uuid references enrollments (id) on delete cascade,
  purchase_id uuid references purchases (id),
  provider_id uuid not null references providers (id),
  customer_id uuid not null references profiles (id),
  proposed_by uuid references profiles (id) on delete set null,
  proposer_role text not null check (proposer_role in ('customer', 'coach')),
  starts_at timestamptz not null,
  duration_minutes int not null check (duration_minutes between 10 and 240),
  -- Weekly: the series is defined in this zone at this local time.
  recurrence text not null default 'none' check (recurrence in ('none', 'weekly')),
  interval_weeks int not null default 1 check (interval_weeks between 1 and 4),
  repeat_until date,
  reference_timezone text check (reference_timezone is null or is_iana_zone (reference_timezone)),
  -- Rescheduling: the appointment this would replace, and for a series
  -- occurrence, whether it applies to this one or to it and all later ones.
  replaces_appointment_id uuid references appointments (id),
  series_scope text check (series_scope in ('this', 'future')),
  counter_of uuid references appointment_proposals (id),
  state text not null default 'pending'
    check (state in ('pending', 'accepted', 'declined', 'countered', 'withdrawn', 'expired', 'conflicted')),
  state_reason text check (state_reason is null or char_length(state_reason) <= 200),
  expires_at timestamptz not null,
  responded_by uuid references profiles (id) on delete set null,
  responded_at timestamptz,
  resulting_appointment_id uuid references appointments (id),
  request_key text not null check (char_length(request_key) between 8 and 64),
  created_at timestamptz not null default now(),
  constraint appointment_proposals_relationship check (
    (kind = 'coaching' and enrollment_id is not null) or (kind = 'consultation' and purchase_id is not null)
  ),
  constraint appointment_proposals_weekly check (recurrence = 'none' or reference_timezone is not null)
);

create unique index if not exists appointment_proposals_request_key on appointment_proposals (proposed_by, request_key);
create index if not exists appointment_proposals_enrollment_idx on appointment_proposals (enrollment_id, created_at desc);
create index if not exists appointment_proposals_purchase_idx on appointment_proposals (purchase_id) where purchase_id is not null;
create index if not exists appointment_proposals_provider_idx on appointment_proposals (provider_id, state);
create index if not exists appointment_proposals_customer_idx on appointment_proposals (customer_id, state);
create index if not exists appointment_proposals_pending_idx on appointment_proposals (expires_at) where state = 'pending';
create index if not exists appointment_proposals_replaces_idx on appointment_proposals (replaces_appointment_id) where replaces_appointment_id is not null;
create index if not exists appointment_proposals_counter_idx on appointment_proposals (counter_of) where counter_of is not null;
create index if not exists appointment_proposals_result_idx on appointment_proposals (resulting_appointment_id) where resulting_appointment_id is not null;
create index if not exists appointment_proposals_proposed_by_idx on appointment_proposals (proposed_by);
create index if not exists appointment_proposals_responded_by_idx on appointment_proposals (responded_by);

alter table appointment_proposals enable row level security;
revoke insert, update, delete, truncate on appointment_proposals from anon, authenticated;
create policy "parties read proposals" on appointment_proposals
  for select using (customer_id = auth.uid () or is_active_provider (provider_id));
create policy "admin reads proposals" on appointment_proposals for select using (is_admin ());

-- ---------------------------------------------------------------------------
-- 5. Conversation cards
-- ---------------------------------------------------------------------------

alter table messages
  add column if not exists appointment_proposal_id uuid references appointment_proposals (id) on delete set null,
  add column if not exists appointment_id uuid references appointments (id) on delete set null;
create index if not exists messages_appointment_proposal_idx on messages (appointment_proposal_id) where appointment_proposal_id is not null;
create index if not exists messages_appointment_idx on messages (appointment_id) where appointment_id is not null;

alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('text', 'attachment', 'system', 'expectations_link', 'appointment_proposal', 'appointment_link'));
alter table messages drop constraint if exists messages_appointment_card_target;
alter table messages add constraint messages_appointment_card_target check (
  (kind = 'appointment_proposal') = (appointment_proposal_id is not null)
  and (kind = 'appointment_link') = (appointment_id is not null)
);

-- Posts a structured card into the conversation that is open now for this
-- relationship. Internal: EXECUTE revoked from every API role.
create or replace function post_schedule_card (p_enrollment uuid, p_kind text, p_proposal uuid, p_appointment uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv conversations;
  v_seq bigint;
begin
  if p_enrollment is null then
    return;  -- a one-off consultation has no conversation
  end if;
  select c.* into v_conv from conversations c
    join enrollment_assignments a on a.id = c.assignment_id
    where c.enrollment_id = p_enrollment and a.effective_to is null
    for update of c;
  if not found then
    return;
  end if;
  update conversations set last_seq = last_seq + 1, last_message_at = now()
    where id = v_conv.id returning last_seq into v_seq;
  insert into messages (conversation_id, seq, sender_profile_id, sender_role, kind, body,
                        client_message_id, appointment_proposal_id, appointment_id)
    values (v_conv.id, v_seq, null, 'system', p_kind, left(p_body, 200), gen_random_uuid (),
            case when p_kind = 'appointment_proposal' then p_proposal end,
            case when p_kind = 'appointment_link' then p_appointment end);
  insert into conversation_signals (conversation_id, kind) values (v_conv.id, 'message');
end;
$$;

revoke execute on function post_schedule_card (uuid, text, uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Time
-- ---------------------------------------------------------------------------
--
-- A local date and time in a zone, as an instant — deliberately. Postgres on
-- its own moves a non-existent time forward and silently picks the LATER of
-- two repeated times. We keep the forward move (a 02:30 that does not exist
-- becomes 03:30) and choose the EARLIER repeated time, and in both cases say so.

create or replace function local_to_instant (p_date date, p_time time, p_tz text)
returns table (instant timestamptz, adjustment text)
language plpgsql
stable
as $$
declare
  v_local timestamp := p_date + p_time;
  v timestamptz := v_local at time zone p_tz;
  v_step interval;
begin
  if (v at time zone p_tz) <> v_local then
    instant := v;
    adjustment := format('%s does not exist on %s in %s (clock change); moved to %s',
      to_char(p_time, 'HH24:MI'), p_date, p_tz, to_char(v at time zone p_tz, 'HH24:MI'));
    return next;
    return;
  end if;
  -- Repeated local time: an earlier instant with the same wall-clock reading.
  foreach v_step in array array[interval '30 minutes', interval '1 hour', interval '2 hours'] loop
    if ((v - v_step) at time zone p_tz) = v_local then
      instant := v - v_step;
      adjustment := format('%s happens twice on %s in %s (clock change); the first one is used',
        to_char(p_time, 'HH24:MI'), p_date, p_tz);
      return next;
      return;
    end if;
  end loop;
  instant := v;
  adjustment := null;
  return next;
end;
$$;

revoke execute on function local_to_instant (date, time, text) from public;
grant execute on function local_to_instant (date, time, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Availability and conflicts
-- ---------------------------------------------------------------------------

create or replace function coach_schedule (p_provider uuid)
returns coach_schedule_settings
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s coach_schedule_settings;
  g scheduling_settings;
begin
  select * into s from coach_schedule_settings where provider_id = p_provider;
  if found then
    return s;
  end if;
  select * into g from scheduling_settings where id;
  s.provider_id := p_provider;
  s.durations_minutes := '{30,45,60}';
  s.buffer_before_minutes := 0;
  s.buffer_after_minutes := g.default_buffer_minutes;
  s.min_notice_minutes := g.default_min_notice_minutes;
  s.horizon_days := g.default_horizon_days;
  s.daily_limit := null;
  s.auto_confirm_client_requests := false;
  return s;
end;
$$;

revoke execute on function coach_schedule (uuid) from public, anon;
grant execute on function coach_schedule (uuid) to authenticated, service_role;

-- Is [starts, ends) inside the coach's availability, in the coach's zone?
-- A meeting must sit within one local day.
create or replace function within_availability (p_provider uuid, p_starts timestamptz, p_ends timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_ls timestamp;
  v_le timestamp;
  v_day date;
  v_st time;
  v_et time;
begin
  select timezone into v_tz from providers where id = p_provider;
  if not is_iana_zone (v_tz) then
    return false;
  end if;
  v_ls := p_starts at time zone v_tz;
  v_le := p_ends at time zone v_tz;
  v_day := v_ls::date;
  if v_le::date <> v_day and v_le <> (v_day + 1)::timestamp then
    return false;
  end if;
  v_st := v_ls::time;
  v_et := case when v_le = (v_day + 1)::timestamp then time '24:00' else v_le::time end;

  -- Time off wins over everything.
  if exists (
    select 1 from availability_exceptions x
    where x.provider_id = p_provider and x.kind = 'unavailable'
      and v_day between x.starts_on and x.ends_on
      and (x.start_time is null or (v_st < x.end_time and v_et > x.start_time))
  ) then
    return false;
  end if;

  return exists (
    select 1 from availability_windows w
    where w.provider_id = p_provider and w.weekday = extract(dow from v_day)
      and w.start_time <= v_st and w.end_time >= v_et
  ) or exists (
    select 1 from availability_exceptions x
    where x.provider_id = p_provider and x.kind = 'extra'
      and v_day between x.starts_on and x.ends_on
      and x.start_time <= v_st and x.end_time >= v_et
  );
end;
$$;

revoke execute on function within_availability (uuid, timestamptz, timestamptz) from public, anon;
grant execute on function within_availability (uuid, timestamptz, timestamptz) to authenticated, service_role;

-- Why a time cannot be booked, or null when it can. The same check everywhere:
-- listing slots, proposing, accepting, confirming a tentative meeting.
--   p_client_initiated  the coach has not vouched for this time, so it must
--                       be inside availability and respect notice, horizon and
--                       the daily limit. A coach may offer times outside their
--                       own hours; conflicts are always refused.
create or replace function slot_problem (
  p_provider uuid,
  p_customer uuid,
  p_starts timestamptz,
  p_duration int,
  p_client_initiated boolean,
  p_ignore_appointment uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s coach_schedule_settings := coach_schedule (p_provider);
  v_ends timestamptz := p_starts + make_interval(mins => p_duration);
  v_from timestamptz := p_starts - make_interval(mins => s.buffer_before_minutes);
  v_to timestamptz := v_ends + make_interval(mins => s.buffer_after_minutes);
  v_tz text;
  v_count int;
begin
  if p_starts <= now() then
    return 'in_past';
  end if;
  if p_client_initiated then
    if p_starts < now() + make_interval(mins => s.min_notice_minutes) then
      return 'too_soon';
    end if;
    if p_starts > now() + make_interval(days => s.horizon_days) then
      return 'too_far_ahead';
    end if;
    if not within_availability (p_provider, p_starts, v_ends) then
      return 'outside_availability';
    end if;
    if s.daily_limit is not null then
      select timezone into v_tz from providers where id = p_provider;
      select count(*) into v_count from appointments a
        where a.provider_id = p_provider and a.state in ('held', 'booked')
          and (a.starts_at at time zone v_tz)::date = (p_starts at time zone v_tz)::date
          and a.id is distinct from p_ignore_appointment;
      if v_count >= s.daily_limit then
        return 'daily_limit_reached';
      end if;
    end if;
  end if;
  if exists (
    select 1 from appointments a
    where a.provider_id = p_provider and a.state in ('held', 'booked')
      and a.id is distinct from p_ignore_appointment
      and tstzrange(a.blocked_from, a.blocked_to) && tstzrange(v_from, v_to)
  ) then
    return 'coach_busy';
  end if;
  if p_customer is not null and exists (
    select 1 from appointments a
    where a.customer_id = p_customer and a.state in ('held', 'booked')
      and a.id is distinct from p_ignore_appointment
      and tstzrange(a.blocked_from, a.blocked_to) && tstzrange(v_from, v_to)
  ) then
    return 'client_busy';
  end if;
  return null;
end;
$$;

revoke execute on function slot_problem (uuid, uuid, timestamptz, int, boolean, uuid) from public, anon, authenticated;
grant execute on function slot_problem (uuid, uuid, timestamptz, int, boolean, uuid) to service_role;

-- Bookable start times for a client, over the coach's horizon. Returns times
-- only — nothing about who else is booked. Callable by a signed-in person who
-- is a current client of the coach, or who is buying from a public coach.
create or replace function available_slots (p_provider uuid, p_duration int, p_from date default null, p_days int default null)
returns table (starts_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s coach_schedule_settings := coach_schedule (p_provider);
  v_tz text;
  v_day date;
  v_last date;
  w record;
  v_t timestamp;
  v_inst timestamptz;
  v_uid uuid := auth.uid ();
begin
  if v_uid is null then
    raise exception 'sign_in_required';
  end if;
  if not (provider_is_public (p_provider) or exists (
    select 1 from enrollments e join enrollment_assignments a on a.enrollment_id = e.id and a.effective_to is null
    where e.customer_id = v_uid and a.provider_id = p_provider and e.state in ('active', 'paused')
  ) or is_active_provider (p_provider)) then
    raise exception 'not_found';
  end if;
  if p_duration is null or p_duration < 10 or p_duration > 240 then
    raise exception 'invalid_duration';
  end if;
  select timezone into v_tz from providers where id = p_provider;
  if not is_iana_zone (v_tz) then
    return;
  end if;

  v_day := greatest(coalesce(p_from, (now() at time zone v_tz)::date), (now() at time zone v_tz)::date);
  v_last := least(v_day + coalesce(p_days, s.horizon_days), ((now() + make_interval(days => s.horizon_days)) at time zone v_tz)::date);

  while v_day <= v_last loop
    for w in
      select start_time, end_time from availability_windows
        where provider_id = p_provider and weekday = extract(dow from v_day)
      union all
      select start_time, end_time from availability_exceptions
        where provider_id = p_provider and kind = 'extra' and v_day between starts_on and ends_on
    loop
      v_t := v_day + w.start_time;
      while v_t + make_interval(mins => p_duration) <= v_day + w.end_time loop
        select li.instant into v_inst from local_to_instant (v_day, v_t::time, v_tz) li;
        if slot_problem (p_provider, v_uid, v_inst, p_duration, true) is null then
          starts_at := v_inst;
          return next;
        end if;
        v_t := v_t + interval '15 minutes';
      end loop;
    end loop;
    v_day := v_day + 1;
  end loop;
end;
$$;

revoke execute on function available_slots (uuid, int, date, int) from public, anon;
grant execute on function available_slots (uuid, int, date, int) to authenticated;

-- Future confirmed meetings that no longer fit the coach's availability. Edits
-- to availability never touch an appointment; they surface here instead, with
-- the coach choosing to keep, move or cancel each one.
create or replace function my_schedule_conflicts ()
returns table (appointment_id uuid, starts_at timestamptz, ends_at timestamptz, customer_id uuid, client_name text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.starts_at, a.ends_at, a.customer_id,
         coalesce(nullif(trim(pr.preferred_name), ''), split_part(coalesce(pr.full_name, ''), ' ', 1), 'Client')
  from appointments a
  join providers p on p.id = a.provider_id
  join profiles pr on pr.id = a.customer_id
  where p.profile_id = auth.uid () and is_active_provider (p.id)
    and a.state = 'booked' and a.starts_at > now()
    and not within_availability (a.provider_id, a.starts_at, a.ends_at)
  order by a.starts_at;
$$;

revoke execute on function my_schedule_conflicts () from public, anon;
grant execute on function my_schedule_conflicts () to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Eligibility
-- ---------------------------------------------------------------------------
--
-- Whether a meeting at this time may be CONFIRMED for this relationship.
--   'ok'          confirm it
--   'tentative'   coaching is live, but the time is after the paid period:
--                 it confirms when the renewal is paid (scheduling.v1)
--   anything else a refusal code

create or replace function meeting_eligibility (p_kind text, p_enrollment uuid, p_purchase uuid, p_starts timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e enrollments%rowtype;
  pu purchases%rowtype;
  g scheduling_settings;
begin
  select * into g from scheduling_settings where id;
  if p_kind = 'consultation' then
    select * into pu from purchases where id = p_purchase;
    if not found or pu.service_type <> 'one_off_consultation' then
      return 'not_found';
    end if;
    if pu.state <> 'active' then
      return 'not_paid';
    end if;
    if exists (select 1 from profiles where id = pu.customer_id and suspended_at is not null)
       or exists (select 1 from providers p join profiles c on c.id = p.profile_id
                  where p.id = pu.provider_id and (p.suspended_at is not null or p.status = 'suspended' or c.suspended_at is not null)) then
      return 'suspended';
    end if;
    return 'ok';
  end if;

  select * into e from enrollments where id = p_enrollment;
  if not found then
    return 'not_found';
  end if;
  if not coaching_is_live (e.id) then
    return case when e.state = 'paused' then 'relationship_paused' else 'relationship_not_live' end;
  end if;
  if e.purchase_id is not null then
    select * into pu from purchases where id = e.purchase_id;
    if pu.paid_through_at is not null and p_starts >= pu.paid_through_at and not g.confirm_beyond_paid_through then
      -- A plan that is ending will not renew into that time.
      if pu.state in ('cancelling', 'ended', 'refunded') or not pu.auto_renews and pu.billing_structure <> 'monthly_recurring' then
        return 'after_plan_ends';
      end if;
      return 'tentative';
    end if;
  end if;
  return 'ok';
end;
$$;

revoke execute on function meeting_eligibility (text, uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function meeting_eligibility (text, uuid, uuid, timestamptz) to service_role;

-- Fixed-allowance plans only (calls_included_per_month > 0 in the purchase
-- snapshot). Flexible coaching returns null and is never counted. Takes the
-- entitlement row lock so two acceptances cannot both use the last call.
create or replace function claim_call_allowance (p_enrollment uuid, p_starts timestamptz, p_ignore_appointment uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  pu purchases%rowtype;
  v_allowed int;
  v_minutes int;
  bc billing_cycles%rowtype;
  v_ent uuid;
  v_used int;
begin
  select p.* into pu from purchases p join enrollments e on e.purchase_id = p.id where e.id = p_enrollment;
  if not found then
    return null;
  end if;
  v_allowed := nullif(pu.inclusions_snapshot->>'calls_included_per_month', '')::int;
  if coalesce(v_allowed, 0) <= 0 then
    return null;  -- flexible coaching: no quota
  end if;
  v_minutes := coalesce(nullif(pu.inclusions_snapshot->>'call_duration_minutes', '')::int, 30);

  select * into bc from billing_cycles
    where purchase_id = pu.id and period_start <= p_starts and period_end > p_starts
      and state in ('paid', 'delivered')
    order by sequence desc limit 1;
  if not found then
    raise exception 'allowance_period_unpaid' using hint = 'That date is outside a paid period, so it can''t use one of the plan''s calls yet.';
  end if;

  insert into call_entitlements (purchase_id, billing_cycle_id, enrollment_id, period_start, period_end, calls_allowed, call_duration_minutes)
    values (pu.id, bc.id, p_enrollment, bc.period_start, bc.period_end, v_allowed, v_minutes)
    on conflict (billing_cycle_id) where billing_cycle_id is not null do nothing;
  select id into v_ent from call_entitlements where billing_cycle_id = bc.id for update;

  select count(*) into v_used from appointments
    where entitlement_id = v_ent and state in ('held', 'booked', 'on_hold')
      and id is distinct from p_ignore_appointment;
  if v_used >= v_allowed then
    raise exception 'allowance_used' using hint = 'All the calls included in this period are already booked.';
  end if;
  return v_ent;
end;
$$;

revoke execute on function claim_call_allowance (uuid, timestamptz, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Notices and reminders
-- ---------------------------------------------------------------------------

create or replace function log_appointment_event (p_appointment uuid, p_from text, p_to text, p_role text, p_reason text, p_detail jsonb default '{}')
returns void
language sql
security definer
set search_path = public
as $$
  insert into appointment_events (appointment_id, from_state, to_state, actor_profile_id, actor_role, reason, detail)
  values (p_appointment, p_from, p_to, auth.uid (), p_role, left(p_reason, 200), coalesce(p_detail, '{}'));
$$;

revoke execute on function log_appointment_event (uuid, text, text, text, text, jsonb) from public, anon, authenticated;

-- Pending reminders for an appointment stop being worth sending the moment it
-- changes. The worker also rechecks at send time; this removes them outright.
create or replace function cancel_appointment_jobs (p_appointment uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update outbox set state = 'cancelled', completed_at = now(),
         last_error = coalesce(last_error || ' | ', '') || 'Appointment changed; reminder no longer applies.'
  where topic = 'email.appointment_reminder'
    and state in ('pending', 'blocked')
    and payload->>'appointment_id' = p_appointment::text;
$$;

revoke execute on function cancel_appointment_jobs (uuid) from public, anon, authenticated;

create or replace function queue_appointment_notices (p_appointment uuid, p_topic text, p_extra jsonb default '{}')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a appointments%rowtype;
  g scheduling_settings;
  v_offset int;
  v_who text;
begin
  select * into a from appointments where id = p_appointment;
  select * into g from scheduling_settings where id;
  foreach v_who in array array['customer', 'coach'] loop
    if p_topic is not null then
      perform enqueue_outbox (
        p_topic,
        jsonb_build_object('appointment_id', a.id, 'recipient', v_who, 'starts_at', a.starts_at, 'revision', a.revision) || coalesce(p_extra, '{}'),
        p_topic || ':' || a.id || ':' || a.revision || ':' || v_who || ':' || coalesce(p_extra->>'dedupe', ''),
        now(),
        greatest(a.ends_at, now() + interval '1 day')
      );
    end if;
    if a.state = 'booked' then
      foreach v_offset in array g.reminder_offsets_minutes loop
        if a.starts_at - make_interval(mins => v_offset) > now() then
          perform enqueue_outbox (
            'email.appointment_reminder',
            jsonb_build_object('appointment_id', a.id, 'recipient', v_who, 'starts_at', a.starts_at, 'revision', a.revision),
            'reminder:' || a.id || ':' || a.revision || ':' || v_who || ':' || v_offset,
            a.starts_at - make_interval(mins => v_offset),
            a.starts_at
          );
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

revoke execute on function queue_appointment_notices (uuid, text, jsonb) from public, anon, authenticated;

create or replace function queue_proposal_notice (p_proposal uuid, p_topic text, p_to text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pr appointment_proposals%rowtype;
begin
  select * into pr from appointment_proposals where id = p_proposal;
  perform enqueue_outbox (
    p_topic,
    jsonb_build_object('proposal_id', pr.id, 'recipient', p_to, 'state', pr.state),
    p_topic || ':' || pr.id || ':' || pr.state || ':' || p_to,
    now(),
    greatest(pr.starts_at, now() + interval '1 day')
  );
end;
$$;

revoke execute on function queue_proposal_notice (uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Making an appointment (internal)
-- ---------------------------------------------------------------------------

create or replace function insert_appointment (
  p_kind text, p_enrollment uuid, p_purchase uuid, p_provider uuid, p_customer uuid,
  p_starts timestamptz, p_duration int, p_state text, p_series uuid, p_occurrence_key text,
  p_time_note text, p_entitlement uuid, p_attempt uuid, p_hold_expires timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s coach_schedule_settings := coach_schedule (p_provider);
  v_ends timestamptz := p_starts + make_interval(mins => p_duration);
  v_ptz text;
  v_ctz text;
  v_id uuid;
begin
  select timezone into v_ptz from providers where id = p_provider;
  select timezone into v_ctz from profiles where id = p_customer;
  insert into appointments (
    kind, enrollment_id, purchase_id, provider_id, customer_id, starts_at, ends_at,
    provider_timezone, customer_timezone, state, series_id, occurrence_key, time_note,
    entitlement_id, checkout_attempt_id, hold_expires_at, blocked_from, blocked_to,
    created_by, confirmed_at
  ) values (
    p_kind, p_enrollment, p_purchase, p_provider, p_customer, p_starts, v_ends,
    coalesce(nullif(v_ptz, ''), 'Etc/UTC'), coalesce(nullif(v_ctz, ''), coalesce(nullif(v_ptz, ''), 'Etc/UTC')),
    p_state, p_series, p_occurrence_key, p_time_note,
    p_entitlement, p_attempt, p_hold_expires,
    p_starts - make_interval(mins => s.buffer_before_minutes),
    v_ends + make_interval(mins => s.buffer_after_minutes),
    auth.uid (), case when p_state = 'booked' then now() end
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function insert_appointment (text, uuid, uuid, uuid, uuid, timestamptz, int, text, uuid, text, text, uuid, uuid, timestamptz)
  from public, anon, authenticated;

-- Creates the occurrences of a series between two dates that do not exist yet.
-- Confirmed inside the paid period, tentative after it; a clash with another
-- confirmed meeting puts that one occurrence on hold for the coach to resolve.
create or replace function materialize_series (p_series uuid, p_until date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  sr appointment_series%rowtype;
  v_day date;
  v_inst timestamptz;
  v_note text;
  v_key text;
  v_elig text;
  v_ent uuid;
  v_id uuid;
  v_made int := 0;
  v_first date;
begin
  select * into sr from appointment_series where id = p_series for update;
  if not found or sr.state <> 'active' then
    return 0;
  end if;
  -- First matching weekday on or after the start date.
  v_first := sr.starts_on + ((sr.weekday - extract(dow from sr.starts_on)::int + 7) % 7);
  v_day := v_first;
  while v_day <= least(p_until, coalesce(sr.ends_on, p_until)) loop
    v_key := sr.id || ':' || v_day;
    if not exists (select 1 from appointments where occurrence_key = v_key) then
      select li.instant, li.adjustment into v_inst, v_note from local_to_instant (v_day, sr.local_start, sr.reference_timezone) li;
      if v_inst > now() then
        v_elig := meeting_eligibility ('coaching', sr.enrollment_id, null, v_inst);
        if v_elig in ('ok', 'tentative') then
          begin
            v_ent := case when v_elig = 'ok' then claim_call_allowance (sr.enrollment_id, v_inst) end;
            v_id := insert_appointment ('coaching', sr.enrollment_id, (select purchase_id from enrollments where id = sr.enrollment_id),
              sr.provider_id, sr.customer_id, v_inst, sr.duration_minutes,
              case when v_elig = 'ok' then 'booked' else 'tentative' end,
              sr.id, v_key, v_note, v_ent, null, null);
            perform log_appointment_event (v_id, null, case when v_elig = 'ok' then 'booked' else 'tentative' end, 'system', 'series_occurrence');
            if v_elig = 'ok' then
              perform queue_appointment_notices (v_id, null);
            end if;
            v_made := v_made + 1;
          exception when exclusion_violation or raise_exception then
            -- The time is taken (or the period's calls are used). Keep the
            -- occurrence visible, on hold, for the coach to resolve.
            v_id := insert_appointment ('coaching', sr.enrollment_id, (select purchase_id from enrollments where id = sr.enrollment_id),
              sr.provider_id, sr.customer_id, v_inst, sr.duration_minutes, 'on_hold', sr.id, v_key, v_note, null, null, null);
            update appointments set state_reason = 'conflict' where id = v_id;
            perform log_appointment_event (v_id, null, 'on_hold', 'system', 'series_occurrence_conflict', jsonb_build_object('error', sqlerrm));
            perform queue_appointment_notices (v_id, 'email.appointment_on_hold', jsonb_build_object('reason', 'conflict'));
            v_made := v_made + 1;
          end;
        end if;
      end if;
    end if;
    v_day := v_day + 7 * sr.interval_weeks;
  end loop;
  return v_made;
end;
$$;

revoke execute on function materialize_series (uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Proposing, answering, cancelling
-- ---------------------------------------------------------------------------

create or replace function schedule_role (p_kind text, p_enrollment uuid, p_purchase uuid, out role text, out provider_id uuid, out customer_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
begin
  if p_kind = 'coaching' then
    select a.provider_id, e.customer_id into provider_id, customer_id
      from enrollments e join enrollment_assignments a on a.enrollment_id = e.id and a.effective_to is null
      where e.id = p_enrollment;
  else
    select pu.provider_id, pu.customer_id into provider_id, customer_id from purchases pu where pu.id = p_purchase;
  end if;
  role := case
    when customer_id is not null and customer_id = v_uid then 'customer'
    when provider_id is not null and is_active_provider (provider_id) then 'coach'
  end;
end;
$$;

revoke execute on function schedule_role (text, uuid, uuid) from public, anon, authenticated;

-- A proposal from either person. Holds no time.
--   p: kind, enrollment_id | purchase_id, starts_at, duration_minutes,
--      recurrence, interval_weeks, repeat_until, replaces_appointment_id,
--      series_scope, counter_of, request_key
create or replace function propose_appointment (p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_kind text := coalesce(p->>'kind', 'coaching');
  v_enrollment uuid := nullif(p->>'enrollment_id', '')::uuid;
  v_purchase uuid := nullif(p->>'purchase_id', '')::uuid;
  v_starts timestamptz := (p->>'starts_at')::timestamptz;
  v_duration int := (p->>'duration_minutes')::int;
  v_recurrence text := coalesce(p->>'recurrence', 'none');
  v_replaces uuid := nullif(p->>'replaces_appointment_id', '')::uuid;
  v_counter uuid := nullif(p->>'counter_of', '')::uuid;
  v_key text := p->>'request_key';
  r record;
  s coach_schedule_settings;
  g scheduling_settings;
  v_existing appointment_proposals%rowtype;
  v_old appointments%rowtype;
  v_orig appointment_proposals%rowtype;
  v_problem text;
  v_elig text;
  v_ref_tz text;
  v_id uuid;
  v_consult_minutes int;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;
  if v_key is null or char_length(v_key) not between 8 and 64 then raise exception 'request_key_required'; end if;

  -- A repeated click returns the first answer.
  select * into v_existing from appointment_proposals where proposed_by = v_uid and request_key = v_key;
  if found then
    return jsonb_build_object('proposal_id', v_existing.id, 'state', v_existing.state, 'appointment_id', v_existing.resulting_appointment_id, 'repeated', true);
  end if;

  if v_replaces is not null then
    select * into v_old from appointments where id = v_replaces;
    if not found then raise exception 'not_found'; end if;
    v_kind := v_old.kind; v_enrollment := v_old.enrollment_id; v_purchase := v_old.purchase_id;
    if v_old.state not in ('booked', 'tentative', 'on_hold') or v_old.starts_at <= now() then
      raise exception 'not_reschedulable' using hint = 'Only an upcoming meeting can be moved.';
    end if;
  end if;

  if v_counter is not null then
    select * into v_orig from appointment_proposals where id = v_counter for update;
    if not found then raise exception 'not_found'; end if;
    v_kind := v_orig.kind; v_enrollment := v_orig.enrollment_id; v_purchase := v_orig.purchase_id;
    v_replaces := coalesce(v_replaces, v_orig.replaces_appointment_id);
  end if;

  if v_replaces is not null and v_old.id is null then
    select * into v_old from appointments where id = v_replaces;
  end if;

  select * into r from schedule_role (v_kind, v_enrollment, v_purchase);
  if r.role is null then raise exception 'not_found'; end if;

  if v_counter is not null then
    if v_orig.state <> 'pending' then raise exception 'proposal_closed' using hint = 'That suggestion has already been answered.'; end if;
    if v_orig.proposed_by = v_uid then raise exception 'not_your_turn' using hint = 'Withdraw your own suggestion instead.'; end if;
  end if;

  s := coach_schedule (r.provider_id);
  select * into g from scheduling_settings where id;

  if v_kind = 'consultation' then
    select nullif(pu.inclusions_snapshot->>'call_duration_minutes', '')::int into v_consult_minutes from purchases pu where pu.id = v_purchase;
    v_duration := coalesce(v_consult_minutes, v_duration);
    v_recurrence := 'none';
  elsif v_duration is null or not (v_duration = any (s.durations_minutes)) then
    raise exception 'invalid_duration' using hint = 'Choose one of the meeting lengths your coach offers.';
  end if;
  if v_starts is null then raise exception 'invalid_time'; end if;

  -- Eligibility now (it is checked again when accepted).
  v_elig := meeting_eligibility (v_kind, v_enrollment, v_purchase, v_starts);
  if v_elig not in ('ok', 'tentative') then
    raise exception '%', v_elig using hint = case v_elig
      when 'relationship_paused' then 'Coaching is paused until the payment is sorted, so new meetings can''t be arranged.'
      when 'after_plan_ends' then 'That time is after this plan ends.'
      when 'not_paid' then 'This consultation hasn''t been paid for.'
      else 'Meetings can''t be arranged for this coaching right now.' end;
  end if;

  v_problem := slot_problem (r.provider_id, r.customer_id, v_starts, v_duration, r.role = 'customer', v_replaces);
  if v_problem is not null then
    raise exception '%', v_problem using hint = case v_problem
      when 'in_past' then 'That time has already passed.'
      when 'too_soon' then 'That''s sooner than your coach''s notice period.'
      when 'too_far_ahead' then 'That''s further ahead than your coach takes bookings.'
      when 'outside_availability' then 'That time is outside your coach''s available hours.'
      when 'daily_limit_reached' then 'Your coach is fully booked that day.'
      when 'coach_busy' then 'The coach already has something at that time.'
      when 'client_busy' then 'The client already has something at that time.'
      else 'That time isn''t available.' end;
  end if;

  if v_recurrence = 'weekly' then
    -- The series is anchored where the proposer says, defaulting to the coach's zone.
    v_ref_tz := coalesce(nullif(p->>'reference_timezone', ''), (select timezone from providers where id = r.provider_id));
    if not is_iana_zone (v_ref_tz) then raise exception 'invalid_timezone'; end if;
  end if;

  insert into appointment_proposals (
    kind, enrollment_id, purchase_id, provider_id, customer_id, proposed_by, proposer_role,
    starts_at, duration_minutes, recurrence, interval_weeks, repeat_until, reference_timezone,
    replaces_appointment_id, series_scope, counter_of, expires_at, request_key
  ) values (
    v_kind, v_enrollment, v_purchase, r.provider_id, r.customer_id, v_uid, r.role,
    v_starts, v_duration, v_recurrence, coalesce((p->>'interval_weeks')::int, 1), nullif(p->>'repeat_until', '')::date, v_ref_tz,
    v_replaces, case when v_replaces is not null and v_old.series_id is not null then coalesce(p->>'series_scope', 'this') end,
    v_counter, least(now() + make_interval(hours => g.proposal_ttl_hours), v_starts), v_key
  ) returning id into v_id;

  if v_counter is not null then
    update appointment_proposals set state = 'countered', responded_by = v_uid, responded_at = now(),
      state_reason = 'A different time was suggested.' where id = v_counter;
    perform post_schedule_card (v_enrollment, 'appointment_proposal', v_counter, null, 'Suggestion answered with another time.');
  end if;

  perform post_schedule_card (v_enrollment, 'appointment_proposal', v_id, null,
    case when v_replaces is not null then 'Suggested a new time for a meeting.' else 'Suggested a meeting time.' end);
  perform queue_proposal_notice (v_id, 'email.appointment_proposed', case when r.role = 'customer' then 'coach' else 'customer' end);

  -- The adjustable workflow: a coach may let client requests inside their
  -- availability confirm straight away.
  if r.role = 'customer' and s.auto_confirm_client_requests then
    v_result := accept_proposal_internal (v_id, 'system');
    return v_result || jsonb_build_object('proposal_id', v_id, 'auto_confirmed', true);
  end if;

  return jsonb_build_object('proposal_id', v_id, 'state', 'pending', 'expires_at',
    (select expires_at from appointment_proposals where id = v_id));
end;
$$;

-- Accepting: every rule checked again, under locks, and the insert protected
-- by the exclusion constraints. Called by respond_to_proposal and, for coaches
-- who auto-confirm, by propose_appointment.
create or replace function accept_proposal_internal (p_proposal uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pr appointment_proposals%rowtype;
  v_old appointments%rowtype;
  v_elig text;
  v_problem text;
  v_state text;
  v_ent uuid;
  v_id uuid;
  v_series uuid;
  v_ref_tz text;
  v_local timestamp;
  v_until date;
  v_now_label text;
  v_old_series_ends date;
begin
  select * into pr from appointment_proposals where id = p_proposal for update;
  -- Serialise every acceptance touching this coach.
  perform 1 from providers where id = pr.provider_id for update;

  if pr.replaces_appointment_id is not null then
    select * into v_old from appointments where id = pr.replaces_appointment_id for update;
    select ends_on into v_old_series_ends from appointment_series where id = v_old.series_id;
    if v_old.state not in ('booked', 'tentative', 'on_hold') then
      update appointment_proposals set state = 'conflicted', state_reason = 'The meeting it would replace has changed since.',
        responded_at = now() where id = pr.id;
      return jsonb_build_object('state', 'conflicted', 'reason', 'original_changed');
    end if;
  end if;

  v_elig := meeting_eligibility (pr.kind, pr.enrollment_id, pr.purchase_id, pr.starts_at);
  if v_elig not in ('ok', 'tentative') then
    update appointment_proposals set state = 'conflicted', state_reason = 'Meetings can''t be confirmed for this relationship right now.',
      responded_at = now() where id = pr.id;
    return jsonb_build_object('state', 'conflicted', 'reason', v_elig);
  end if;

  v_problem := slot_problem (pr.provider_id, pr.customer_id, pr.starts_at, pr.duration_minutes,
                             pr.proposer_role = 'customer' and p_role <> 'coach', pr.replaces_appointment_id);
  if v_problem is not null then
    update appointment_proposals set state = 'conflicted', state_reason = 'That time is no longer available.', responded_at = now() where id = pr.id;
    return jsonb_build_object('state', 'conflicted', 'reason', v_problem);
  end if;

  v_state := case when v_elig = 'ok' then 'booked' else 'tentative' end;

  begin
    if pr.replaces_appointment_id is not null then
      -- The original stays until this point; it is replaced in the same
      -- savepoint as the new one is inserted, so a failure keeps it.
      update appointments set state = 'replaced', state_reason = 'rescheduled' where id = v_old.id;
      if pr.series_scope = 'future' and v_old.series_id is not null then
        -- End the old series before this occurrence; later ones are replaced.
        update appointment_series set ends_on = (v_old.starts_at at time zone reference_timezone)::date - 1,
          state = 'ended', ended_at = now() where id = v_old.series_id;
        update appointments set state = 'replaced', state_reason = 'series_changed'
          where series_id = v_old.series_id and starts_at > v_old.starts_at
            and state in ('booked', 'tentative', 'on_hold');
      end if;
    end if;

    if pr.kind = 'coaching' and v_state = 'booked' then
      v_ent := claim_call_allowance (pr.enrollment_id, pr.starts_at, pr.replaces_appointment_id);
    elsif pr.kind = 'consultation' and v_old.id is not null then
      v_ent := v_old.entitlement_id;
    end if;

    if pr.recurrence = 'weekly' or (pr.series_scope = 'future' and v_old.series_id is not null) then
      v_ref_tz := coalesce(pr.reference_timezone, (select reference_timezone from appointment_series where id = v_old.series_id));
      v_local := pr.starts_at at time zone v_ref_tz;
      insert into appointment_series (enrollment_id, provider_id, customer_id, reference_timezone, weekday, local_start,
        duration_minutes, interval_weeks, starts_on, ends_on, previous_series_id, created_by)
      values (pr.enrollment_id, pr.provider_id, pr.customer_id, v_ref_tz, extract(dow from v_local)::smallint, v_local::time,
        pr.duration_minutes, pr.interval_weeks, v_local::date,
        coalesce(pr.repeat_until, v_old_series_ends),
        v_old.series_id, auth.uid ())
      returning id into v_series;
      v_id := insert_appointment ('coaching', pr.enrollment_id, (select purchase_id from enrollments where id = pr.enrollment_id),
        pr.provider_id, pr.customer_id, pr.starts_at, pr.duration_minutes, v_state, v_series, v_series || ':' || v_local::date,
        null, v_ent, null, null);
    else
      v_id := insert_appointment (pr.kind, pr.enrollment_id,
        coalesce(pr.purchase_id, (select purchase_id from enrollments where id = pr.enrollment_id)),
        pr.provider_id, pr.customer_id, pr.starts_at, pr.duration_minutes, v_state,
        case when pr.series_scope = 'this' then v_old.series_id end, null, null, v_ent, null, null);
    end if;

    if pr.replaces_appointment_id is not null then
      update appointments set replaced_by = v_id where id = v_old.id;
    end if;
  exception
    when exclusion_violation then
      update appointment_proposals set state = 'conflicted',
        state_reason = 'Someone else booked that time first. Suggest another time.', responded_at = now() where id = pr.id;
      perform queue_proposal_notice (pr.id, 'email.appointment_proposal_update', pr.proposer_role);
      perform post_schedule_card (pr.enrollment_id, 'appointment_proposal', pr.id, null, 'That time was taken before it could be confirmed.');
      return jsonb_build_object('state', 'conflicted', 'reason', 'slot_taken');
    when raise_exception then
      if sqlerrm in ('allowance_used', 'allowance_period_unpaid') then
        update appointment_proposals set state = 'conflicted',
          state_reason = case sqlerrm
            when 'allowance_used' then 'All the calls included in that period are already booked.'
            else 'That date is outside a paid period, so it can''t use one of the plan''s calls yet.' end,
          responded_at = now() where id = pr.id;
        return jsonb_build_object('state', 'conflicted', 'reason', sqlerrm);
      end if;
      raise;
  end;

  update appointment_proposals set state = 'accepted', responded_by = auth.uid (), responded_at = now(),
    resulting_appointment_id = v_id where id = pr.id;

  perform log_appointment_event (v_id, null, v_state, p_role, 'proposal_accepted', jsonb_build_object('proposal_id', pr.id));
  if v_old.id is not null then
    perform log_appointment_event (v_old.id, v_old.state, 'replaced', p_role, 'rescheduled', jsonb_build_object('replaced_by', v_id));
    perform cancel_appointment_jobs (v_old.id);
    update appointments set revision = revision + 1 where id = v_old.id;
  end if;

  if v_state = 'booked' then
    perform queue_appointment_notices (v_id,
      case when v_old.id is not null then 'email.appointment_changed' else 'email.appointment_confirmed' end,
      case when v_old.id is not null then jsonb_build_object('previous_starts_at', v_old.starts_at) else '{}' end);
  end if;

  if v_series is not null then
    v_until := ((now() + make_interval(days => (coach_schedule (pr.provider_id)).horizon_days)) at time zone v_ref_tz)::date;
    perform materialize_series (v_series, v_until);
  end if;

  v_now_label := case when v_state = 'tentative' then 'Meeting agreed — tentative until the next payment.' else 'Meeting confirmed.' end;
  perform post_schedule_card (pr.enrollment_id, 'appointment_proposal', pr.id, null, 'Suggestion accepted.');
  perform post_schedule_card (pr.enrollment_id, 'appointment_link', null, v_id, v_now_label);

  return jsonb_build_object('state', 'accepted', 'appointment_id', v_id, 'appointment_state', v_state, 'series_id', v_series);
end;
$$;

revoke execute on function accept_proposal_internal (uuid, text) from public, anon, authenticated;
revoke execute on function propose_appointment (jsonb) from public, anon;
grant execute on function propose_appointment (jsonb) to authenticated;

-- Accept, decline or withdraw. Answering twice returns the first answer.
create or replace function respond_to_proposal (p_proposal uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  pr appointment_proposals%rowtype;
  r record;
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;
  if p_action not in ('accept', 'decline', 'withdraw') then raise exception 'invalid_action'; end if;

  select * into pr from appointment_proposals where id = p_proposal for update;
  if not found then raise exception 'not_found'; end if;
  select * into r from schedule_role (pr.kind, pr.enrollment_id, pr.purchase_id);
  if r.role is null or (r.role = 'customer' and pr.customer_id <> v_uid) then raise exception 'not_found'; end if;

  if pr.state <> 'pending' then
    return jsonb_build_object('state', pr.state, 'appointment_id', pr.resulting_appointment_id, 'repeated', true);
  end if;

  if pr.expires_at <= now() then
    update appointment_proposals set state = 'expired', state_reason = 'Nobody answered in time.' where id = pr.id;
    perform queue_proposal_notice (pr.id, 'email.appointment_proposal_update', pr.proposer_role);
    return jsonb_build_object('state', 'expired');
  end if;

  if p_action = 'withdraw' then
    if pr.proposed_by <> v_uid then raise exception 'not_your_turn'; end if;
    update appointment_proposals set state = 'withdrawn', responded_by = v_uid, responded_at = now() where id = pr.id;
    perform post_schedule_card (pr.enrollment_id, 'appointment_proposal', pr.id, null, 'Suggestion withdrawn.');
    return jsonb_build_object('state', 'withdrawn');
  end if;

  if pr.proposed_by = v_uid or r.role = pr.proposer_role then
    raise exception 'not_your_turn' using hint = 'The other person answers this suggestion.';
  end if;

  if p_action = 'decline' then
    update appointment_proposals set state = 'declined', responded_by = v_uid, responded_at = now() where id = pr.id;
    perform queue_proposal_notice (pr.id, 'email.appointment_proposal_update', pr.proposer_role);
    perform post_schedule_card (pr.enrollment_id, 'appointment_proposal', pr.id, null, 'Suggestion declined.');
    return jsonb_build_object('state', 'declined');
  end if;

  return accept_proposal_internal (pr.id, r.role);
end;
$$;

revoke execute on function respond_to_proposal (uuid, text) from public, anon;
grant execute on function respond_to_proposal (uuid, text) to authenticated;

-- Cancel one meeting, or this and all later ones in its series. Past meetings
-- are never changed. Cancelling twice is not an error.
create or replace function cancel_appointment (p_appointment uuid, p_scope text default 'this', p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  a appointments%rowtype;
  v_role text;
  v_ids uuid[];
  v_id uuid;
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;
  select * into a from appointments where id = p_appointment for update;
  if not found then raise exception 'not_found'; end if;
  v_role := case
    when a.customer_id = v_uid then 'customer'
    when is_active_provider (a.provider_id) then 'coach'
    when is_admin () then 'admin'
  end;
  if v_role is null then raise exception 'not_found'; end if;
  if a.state in ('cancelled', 'replaced', 'expired') then
    return jsonb_build_object('state', a.state, 'repeated', true);
  end if;
  if a.starts_at <= now() then
    raise exception 'already_started' using hint = 'A meeting that has started can''t be cancelled. Record what happened instead.';
  end if;

  if p_scope = 'future' and a.series_id is not null then
    update appointment_series set ends_on = (a.starts_at at time zone reference_timezone)::date - 1,
      state = 'ended', ended_at = now() where id = a.series_id;
    select array_agg(id) into v_ids from appointments
      where series_id = a.series_id and starts_at >= a.starts_at and state in ('booked', 'tentative', 'on_hold', 'held');
  else
    v_ids := array[a.id];
  end if;

  foreach v_id in array coalesce(v_ids, '{}') loop
    update appointments set state = 'cancelled', state_reason = left(coalesce(p_reason, 'cancelled_by_' || v_role), 200),
      revision = revision + 1 where id = v_id;
    perform log_appointment_event (v_id, a.state, 'cancelled', v_role, coalesce(p_reason, 'cancelled'));
    perform cancel_appointment_jobs (v_id);
  end loop;
  -- One notice for the change, not one per occurrence.
  perform queue_appointment_notices (a.id, 'email.appointment_cancelled',
    jsonb_build_object('by_coach', v_role = 'coach', 'scope', p_scope, 'count', coalesce(cardinality(v_ids), 1)));
  perform post_schedule_card (a.enrollment_id, 'appointment_link', null, a.id,
    case when coalesce(cardinality(v_ids), 1) > 1 then 'Meetings cancelled.' else 'Meeting cancelled.' end);
  -- Pending suggestions to move it no longer apply.
  update appointment_proposals set state = 'withdrawn', state_reason = 'The meeting was cancelled.'
    where replaces_appointment_id = any (coalesce(v_ids, array[a.id])) and state = 'pending';
  return jsonb_build_object('state', 'cancelled', 'count', coalesce(cardinality(v_ids), 1));
end;
$$;

revoke execute on function cancel_appointment (uuid, text, text) from public, anon;
grant execute on function cancel_appointment (uuid, text, text) to authenticated;

-- What happened. A record only: no penalty, refund, transfer or "delivered".
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
begin
  select * into a from appointments where id = p_appointment;
  if not found then raise exception 'not_found'; end if;
  v_role := case when is_active_provider (a.provider_id) then 'coach' when is_admin () then 'admin' end;
  if v_role is null then raise exception 'not_found'; end if;
  if a.state <> 'booked' or a.starts_at > now() then
    raise exception 'not_yet' using hint = 'An outcome can be recorded once a confirmed meeting has started.';
  end if;
  insert into appointment_outcomes (appointment_id, outcome, note, recorded_by, recorded_role)
    values (a.id, p_outcome, nullif(btrim(coalesce(p_note, '')), ''), auth.uid (), v_role) returning id into v_id;
  perform log_appointment_event (a.id, a.state, a.state, v_role, 'outcome_recorded', jsonb_build_object('outcome', p_outcome));
  return v_id;
end;
$$;

revoke execute on function record_appointment_outcome (uuid, text, text) from public, anon;
grant execute on function record_appointment_outcome (uuid, text, text) to authenticated;

-- An administrator resolving an exception: cancel a meeting on someone's
-- behalf, or reopen a consultation whose held slot lapsed before payment so
-- the client can choose a new time. Refunds stay in the existing refund flow.
create or replace function admin_resolve_consultation (p_purchase uuid, p_action text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pu purchases%rowtype;
begin
  if not is_admin () then raise exception 'admin_only'; end if;
  if p_action not in ('reopen_for_rebooking', 'mark_resolved') then raise exception 'invalid_action'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'reason_required'; end if;
  select * into pu from purchases where id = p_purchase for update;
  if not found or pu.service_type <> 'one_off_consultation' then raise exception 'not_found'; end if;
  if p_action = 'reopen_for_rebooking' then
    if pu.state not in ('ended', 'active') then raise exception 'invalid_state'; end if;
    update purchases set state = 'active', requires_review = false,
      review_reason = left('rebooking reopened: ' || p_note, 200) where id = pu.id;
    perform enqueue_outbox ('email.consultation_rebook', jsonb_build_object('purchase_id', pu.id),
      'consultation_rebook:' || pu.id, now(), now() + interval '14 days');
  else
    update purchases set requires_review = false, review_reason = left('resolved: ' || p_note, 200) where id = pu.id;
  end if;
end;
$$;

revoke execute on function admin_resolve_consultation (uuid, text, text) from public, anon;
grant execute on function admin_resolve_consultation (uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. One-off consultations: the slot is chosen and held at checkout
-- ---------------------------------------------------------------------------

-- Unchanged from 0040 except where marked "Batch 4".
create or replace function create_checkout_records (p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid := (p->>'customer_id')::uuid;
  v_key text := p->>'idempotency_key';
  v_currency text := upper(p->>'currency');
  ver offer_versions%rowtype;
  o offers%rowtype;
  pr providers%rowtype;
  cps current_policy_set%rowtype;
  v_price bigint;
  v_attempt checkout_attempts%rowtype;
  v_reservation uuid;
  v_purchase uuid;
  v_hold int := coalesce((p->>'hold_seconds')::int, 1800);
  v_shown_coach uuid := nullif(p->>'expectations_coach_version_id', '')::uuid;
  v_shown_platform uuid := nullif(p->>'expectations_platform_version_id', '')::uuid;
  v_live_coach uuid;
  v_live_platform uuid;
  -- Batch 4
  v_slot timestamptz := nullif(p->>'slot_starts_at', '')::timestamptz;
  v_problem text;
  v_appointment uuid;
begin
  if not is_privileged_writer () then
    raise exception 'server_only' using hint = 'Checkouts are created by the server.';
  end if;

  select * into v_attempt from checkout_attempts
    where customer_id = v_customer and idempotency_key = v_key;
  if found then
    return jsonb_build_object(
      'reused', true,
      'attempt_id', v_attempt.id,
      'purchase_id', (select id from purchases where checkout_attempt_id = v_attempt.id),
      'reservation_id', v_attempt.reservation_id,
      'state', v_attempt.state,
      'stripe_checkout_session_id', v_attempt.stripe_checkout_session_id,
      'currency', v_attempt.currency,
      'amount_minor', v_attempt.amount_minor
    );
  end if;

  select * into ver from offer_versions where id = (p->>'offer_version_id')::uuid;
  if not found or ver.published_at is null or ver.superseded_at is not null then
    raise exception 'offer_unavailable' using hint = 'This plan is no longer available. Refresh to see the current one.';
  end if;

  select * into o from offers where id = ver.offer_id;
  if o.status <> 'published' then
    raise exception 'offer_unavailable' using hint = 'This plan is not open for new sign-ups.';
  end if;

  select * into pr from providers where id = o.provider_id for update;
  if not provider_is_public (pr.id) then
    raise exception 'coach_unavailable' using hint = 'This coach is not currently taking sign-ups.';
  end if;
  if not pr.accepting_new_clients and ver.service_type = 'recurring_coaching' then
    raise exception 'coach_not_accepting' using hint = 'This coach is not accepting new clients right now.';
  end if;

  if pr.profile_id = v_customer then
    raise exception 'own_offer' using hint = 'You cannot buy your own plan.';
  end if;

  v_live_coach := live_coach_expectations (pr.id);
  v_live_platform := live_platform_expectations ();
  if v_live_coach is null or v_live_platform is null then
    raise exception 'expectations_missing' using hint = 'This coach hasn''t published their welcome and expectations yet, so this plan can''t be bought.';
  end if;
  if v_shown_coach is distinct from v_live_coach or v_shown_platform is distinct from v_live_platform then
    raise exception 'expectations_changed' using hint = 'The welcome and expectations were just updated. Review the new version before you pay.';
  end if;

  -- Batch 4: a consultation states its length and has its time chosen first.
  if ver.service_type = 'one_off_consultation' then
    if ver.call_duration_minutes is null then
      raise exception 'consultation_needs_duration' using hint = 'This session doesn''t say how long it is yet, so it can''t be booked.';
    end if;
    if v_slot is null then
      raise exception 'slot_required' using hint = 'Choose a time for the session first.';
    end if;
    -- Holds that ran out are cleared before counting.
    update appointments set state = 'expired', state_reason = 'hold_lapsed'
      where provider_id = pr.id and state = 'held' and hold_expires_at < now() - interval '5 minutes';
    v_problem := slot_problem (pr.id, v_customer, v_slot, ver.call_duration_minutes, true);
    if v_problem is not null then
      raise exception 'slot_taken' using hint = 'That time has just been taken or is no longer available. Choose another time.';
    end if;
  end if;

  select * into cps from current_policy_set where id;
  if not (ver.billing_structure::text = any (cps.publishable_billing_structures)) then
    raise exception 'billing_structure_not_sellable' using hint = 'This kind of plan cannot be purchased yet.';
  end if;

  select amount_minor into v_price from offer_prices
    where offer_version_id = ver.id and currency = v_currency;
  if v_price is null or v_price <= 0 then
    raise exception 'currency_not_offered' using hint = 'This plan is not sold in that currency.';
  end if;

  if ver.service_type = 'recurring_coaching' and exists (
    select 1 from purchases
    where customer_id = v_customer and provider_id = pr.id
      and service_type = 'recurring_coaching'
      and state in ('active', 'cancelling', 'past_due')
  ) then
    raise exception 'already_subscribed' using hint = 'You already have an ongoing plan with this coach.';
  end if;

  if ver.service_type = 'recurring_coaching' then
    v_reservation := reserve_capacity (pr.id, ver.id, v_customer, v_hold);
    if v_reservation is null then
      raise exception 'coach_full' using hint = 'This coach has no free places right now.';
    end if;
  end if;

  insert into checkout_attempts (
    customer_id, offer_version_id, provider_id, reservation_id,
    currency, amount_minor, idempotency_key, state, expires_at
  ) values (
    v_customer, ver.id, pr.id, v_reservation,
    v_currency, v_price, v_key, 'created', now() + make_interval(secs => v_hold)
  ) returning * into v_attempt;

  insert into purchases (
    customer_id, provider_id, offer_version_id, checkout_attempt_id, state,
    service_type, billing_structure, charge_currency, charge_amount_minor, display_currency,
    term_months, billing_interval, billing_interval_count, auto_renews, inclusions_snapshot,
    commission_policy_id, cancellation_policy_id, payment_failure_policy_id,
    recognition_policy_id, billing_terms_policy_id,
    expectations_coach_version_id, expectations_platform_version_id
  ) values (
    v_customer, pr.id, ver.id, v_attempt.id, 'pending_payment',
    ver.service_type, ver.billing_structure, v_currency, v_price, nullif(upper(p->>'display_currency'), ''),
    ver.term_months, ver.billing_interval, ver.billing_interval_count, ver.auto_renews,
    jsonb_build_object(
      'title', ver.title,
      'description', ver.description,
      'calls_included_per_month', ver.calls_included_per_month,
      'call_duration_minutes', ver.call_duration_minutes,
      'check_in_cadence', ver.check_in_cadence,
      'response_time_hours', ver.response_time_hours,
      'programme_included', ver.programme_included,
      'programme_review_cadence', ver.programme_review_cadence,
      'form_review_included', ver.form_review_included,
      'messaging_channel', ver.messaging_channel,
      'intended_client', ver.intended_client,
      'additional_inclusions', to_jsonb(ver.additional_inclusions),
      'offer_version', ver.version
    ),
    ver.commission_policy_id, ver.cancellation_policy_id, ver.payment_failure_policy_id,
    ver.recognition_policy_id, ver.billing_terms_policy_id,
    v_live_coach, v_live_platform
  ) returning id into v_purchase;

  -- Batch 4: the hold, in the same transaction. Two buyers of the same slot:
  -- the exclusion constraint lets exactly one through.
  if ver.service_type = 'one_off_consultation' then
    begin
      v_appointment := insert_appointment ('consultation', null, v_purchase, pr.id, v_customer, v_slot,
        ver.call_duration_minutes, 'held', null, null, null, null, v_attempt.id, v_attempt.expires_at);
    exception when exclusion_violation then
      raise exception 'slot_taken' using hint = 'That time has just been taken. Choose another time.';
    end;
    perform log_appointment_event (v_appointment, null, 'held', 'system', 'checkout_started');
  end if;

  return jsonb_build_object(
    'reused', false,
    'attempt_id', v_attempt.id,
    'purchase_id', v_purchase,
    'reservation_id', v_reservation,
    'state', 'created',
    'stripe_checkout_session_id', null,
    'currency', v_currency,
    'amount_minor', v_price,
    'expires_at', v_attempt.expires_at,
    'appointment_id', v_appointment
  );
end;
$$;

-- A checkout that ends without payment releases its slot.
create or replace function release_checkout_slot ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if new.state in ('expired', 'abandoned', 'failed') and old.state is distinct from new.state then
    for v_id in select id from appointments where checkout_attempt_id = new.id and state = 'held' loop
      update appointments set state = 'expired', state_reason = 'checkout_' || new.state where id = v_id;
      perform log_appointment_event (v_id, 'held', 'expired', 'system', 'checkout_' || new.state);
      if new.state = 'expired' then
        perform enqueue_outbox ('email.reservation_expired',
          jsonb_build_object('customer_id', new.customer_id, 'starts_at', (select starts_at from appointments where id = v_id)),
          'reservation_expired:' || v_id, now(), now() + interval '2 days');
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists checkout_attempts_release_slot on checkout_attempts;
create trigger checkout_attempts_release_slot after update of state on checkout_attempts
  for each row execute function release_checkout_slot ();

-- Payment confirmed (by the webhook, through record_cycle_payment): the held
-- slot becomes a confirmed session. If the hold had already lapsed, nothing is
-- oversold and the money is not quietly kept: the purchase is flagged for a
-- person to rebook or refund, and the client is told.
create or replace function confirm_consultation_on_payment ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a appointments%rowtype;
  pu purchases%rowtype;
begin
  select * into pu from purchases where id = new.purchase_id;
  if pu.service_type <> 'one_off_consultation' or new.state <> 'paid' then
    return new;
  end if;
  if exists (select 1 from appointments where purchase_id = pu.id and kind = 'consultation' and state = 'booked') then
    return new;  -- already confirmed (a replayed event)
  end if;

  -- record_cycle_payment() inserts the paid cycle BEFORE it marks the purchase
  -- active, so a purchase still pending here is the normal, on-time case.
  select * into a from appointments where purchase_id = pu.id and kind = 'consultation' and state = 'held' for update;
  if found and pu.state in ('pending_payment', 'active') then
    update appointments set state = 'booked', hold_expires_at = null, confirmed_at = now() where id = a.id;
    perform log_appointment_event (a.id, 'held', 'booked', 'system', 'payment_confirmed');
    perform queue_appointment_notices (a.id, 'email.appointment_confirmed');
    return new;
  end if;

  -- Late: the hold lapsed (and the purchase may have been closed) before the
  -- money arrived. Explicit recovery, no automatic refund.
  update purchases set requires_review = true, review_reason = 'consultation_slot_expired' where id = pu.id;
  perform raise_exception_row (jsonb_build_object(
    'kind', 'consultation_slot_expired', 'severity', 'critical',
    'purchase_id', pu.id, 'provider_id', pu.provider_id,
    'currency', pu.charge_currency, 'amount_minor', pu.charge_amount_minor,
    'detail', 'A consultation was paid for after its held time was released. Reopen it for rebooking, or refund it through the refund process.'));
  perform enqueue_outbox ('email.consultation_needs_rebooking', jsonb_build_object('purchase_id', pu.id),
    'consultation_needs_rebooking:' || pu.id, now(), now() + interval '14 days');
  return new;
end;
$$;

drop trigger if exists billing_cycles_confirm_consultation on billing_cycles;
create trigger billing_cycles_confirm_consultation after insert or update of state on billing_cycles
  for each row execute function confirm_consultation_on_payment ();

-- ---------------------------------------------------------------------------
-- 13. Reconciliation — run by the worker every few minutes
-- ---------------------------------------------------------------------------
--
-- Nothing disappears silently. Each step writes history and, where a person
-- needs to know, queues a notice.

create or replace function reconcile_appointments ()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x record;
  v_elig text;
  v_ent uuid;
  v_counts jsonb := '{}';
  n int;
begin
  if not is_privileged_writer () then raise exception 'server_only'; end if;

  -- 1. Unanswered proposals lapse. They never held time.
  n := 0;
  for x in select id, proposer_role, enrollment_id from appointment_proposals where state = 'pending' and expires_at <= now() for update skip locked loop
    update appointment_proposals set state = 'expired', state_reason = 'Nobody answered in time.' where id = x.id;
    perform queue_proposal_notice (x.id, 'email.appointment_proposal_update', x.proposer_role);
    perform post_schedule_card (x.enrollment_id, 'appointment_proposal', x.id, null, 'Suggestion expired.');
    n := n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('proposals_expired', n);

  -- 2. Checkout holds whose attempt vanished without closing.
  update appointments set state = 'expired', state_reason = 'hold_lapsed'
    where state = 'held' and hold_expires_at < now() - interval '10 minutes';
  get diagnostics n = row_count;
  v_counts := v_counts || jsonb_build_object('holds_expired', n);

  -- 3. Confirmed meetings that can no longer go ahead as booked: on hold if
  --    it may come back (payment paused, suspension), cancelled if the
  --    relationship has ended or moved to another coach.
  n := 0;
  for x in
    select a.*, e.state as e_state from appointments a left join enrollments e on e.id = a.enrollment_id
    where a.state in ('booked', 'tentative') and a.starts_at > now()
    for update of a skip locked
  loop
    v_elig := meeting_eligibility (x.kind, x.enrollment_id, x.purchase_id, x.starts_at);
    continue when v_elig in ('ok', 'tentative');
    if (x.kind = 'coaching' and (x.e_state = 'ended' or not exists (
          select 1 from enrollment_assignments ea where ea.enrollment_id = x.enrollment_id and ea.effective_to is null and ea.provider_id = x.provider_id)))
       or v_elig in ('not_found', 'after_plan_ends') then
      update appointments set state = 'cancelled', state_reason = 'relationship_ended', revision = revision + 1 where id = x.id;
      perform log_appointment_event (x.id, x.state, 'cancelled', 'system', 'relationship_ended');
      perform cancel_appointment_jobs (x.id);
      perform queue_appointment_notices (x.id, 'email.appointment_cancelled', jsonb_build_object('reason', 'relationship_ended'));
    else
      update appointments set state = 'on_hold',
        state_reason = case when v_elig = 'relationship_paused' then 'payment_paused'
                            when v_elig = 'not_paid' then 'payment_issue' else 'suspended' end,
        revision = revision + 1 where id = x.id;
      perform log_appointment_event (x.id, x.state, 'on_hold', 'system', v_elig);
      perform cancel_appointment_jobs (x.id);
      perform queue_appointment_notices (x.id, 'email.appointment_on_hold',
        jsonb_build_object('reason', case when v_elig = 'relationship_paused' then 'payment_paused'
                                          when v_elig = 'not_paid' then 'payment_issue' else 'suspended' end));
    end if;
    n := n + 1;
  end loop;
  v_counts := v_counts || jsonb_build_object('held_or_cancelled', n);

  -- 4. On hold or tentative meetings that can now be confirmed (payment
  --    recovered, renewal paid, suspension lifted) — if the time is free.
  n := 0;
  for x in
    select a.* from appointments a
    where a.state in ('on_hold', 'tentative') and a.starts_at > now()
    order by a.starts_at
    for update skip locked
  loop
    v_elig := meeting_eligibility (x.kind, x.enrollment_id, x.purchase_id, x.starts_at);
    continue when v_elig <> 'ok';
    begin
      v_ent := case when x.kind = 'coaching' then claim_call_allowance (x.enrollment_id, x.starts_at, x.id) else x.entitlement_id end;
      update appointments set state = 'booked', state_reason = null, entitlement_id = v_ent,
        confirmed_at = now(), revision = revision + 1 where id = x.id;
      perform log_appointment_event (x.id, x.state, 'booked', 'system', case when x.state = 'tentative' then 'renewal_paid' else 'restored' end);
      perform queue_appointment_notices (x.id, 'email.appointment_confirmed');
      n := n + 1;
    exception when exclusion_violation or raise_exception then
      if x.state = 'tentative' or x.state_reason is distinct from 'conflict' then
        update appointments set state = 'on_hold', state_reason = 'conflict' where id = x.id;
        perform log_appointment_event (x.id, x.state, 'on_hold', 'system', 'conflict', jsonb_build_object('error', sqlerrm));
        perform queue_appointment_notices (x.id, 'email.appointment_on_hold', jsonb_build_object('reason', 'conflict'));
      end if;
    end;
  end loop;
  v_counts := v_counts || jsonb_build_object('confirmed', n);

  -- 5. Tentative or on-hold meetings whose time came without being confirmed.
  for x in select id, state from appointments where state in ('tentative', 'on_hold') and starts_at <= now() for update skip locked loop
    update appointments set state = 'cancelled', state_reason = 'not_confirmed_in_time' where id = x.id;
    perform log_appointment_event (x.id, x.state, 'cancelled', 'system', 'not_confirmed_in_time');
  end loop;

  -- 6. Series: create occurrences up to each coach's horizon.
  n := 0;
  for x in select s.id, s.provider_id, s.reference_timezone from appointment_series s where s.state = 'active' loop
    n := n + materialize_series (x.id, ((now() + make_interval(days => (coach_schedule (x.provider_id)).horizon_days)) at time zone x.reference_timezone)::date);
  end loop;
  v_counts := v_counts || jsonb_build_object('occurrences_created', n);

  return v_counts;
end;
$$;

revoke execute on function reconcile_appointments () from public, anon, authenticated;
grant execute on function reconcile_appointments () to service_role;

-- A coach change moves the relationship to someone else's calendar. Meetings
-- with the previous coach are cancelled with a notice, not carried over.
create or replace function cancel_appointments_on_reassignment ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  x record;
begin
  if new.effective_to is not null and old.effective_to is null then
    for x in select id, state from appointments
      where enrollment_id = new.enrollment_id and provider_id = new.provider_id
        and state in ('booked', 'tentative', 'on_hold') and starts_at > now()
    loop
      update appointments set state = 'cancelled', state_reason = 'coach_changed', revision = revision + 1 where id = x.id;
      perform log_appointment_event (x.id, x.state, 'cancelled', 'system', 'coach_changed');
      perform cancel_appointment_jobs (x.id);
      perform queue_appointment_notices (x.id, 'email.appointment_cancelled', jsonb_build_object('reason', 'coach_changed'));
    end loop;
    update appointment_series set state = 'ended', ended_at = now()
      where enrollment_id = new.enrollment_id and provider_id = new.provider_id and state = 'active';
    update appointment_proposals set state = 'withdrawn', state_reason = 'The coach changed.'
      where enrollment_id = new.enrollment_id and provider_id = new.provider_id and state = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists enrollment_assignments_close_appointments on enrollment_assignments;
create trigger enrollment_assignments_close_appointments after update of effective_to on enrollment_assignments
  for each row execute function cancel_appointments_on_reassignment ();

notify pgrst, 'reload schema';
