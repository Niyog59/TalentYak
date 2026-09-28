-- M13 · Client check-ins and coach feedback.
--
--   checkin_templates           a coach's reusable question sets
--   checkin_template_versions   the questions, frozen once written; editing a
--                               template adds a version, so a check-in always
--                               shows the questions it was asked with
--   checkin_schedules           one per coach stint with a client (assignment)
--   checkin_schedule_versions   cadence, due day and time, the client's
--                               timezone (explicit), the coach's own review
--                               time; changes apply forward
--   checkin_breaks              planned breaks: no requests are made for them
--   checkins                    one request per reporting period
--   checkin_drafts              the client's unsent answers (client only)
--   checkin_submissions         every version the client sent, never edited,
--                               each with the progress summary as it stood
--   checkin_feedback            the coach's feedback: drafts, then dated
--                               published versions with "next steps"
--   checkin_step_links          a promised plan change, explicitly linked by
--                               the coach to the M11 version that delivered it
--   checkin_events              what happened, when (no content)
--
-- The rules that shape this file:
--
--   1. Nothing is created backwards. A request is made only for the period
--      running now, only while coaching is live, never inside a planned break
--      or a pause, and never overlapping an earlier request. Pausing, a break
--      or a payment pause therefore never leaves a backlog. Each request keeps
--      the due time and the questions it was created with, so a later change
--      can never make it late retroactively or change what was asked.
--   2. Clients write through functions; coaches write only feedback. Nobody
--      can edit a submission: a correction is a new submission, the original
--      is kept, and a substantive one reopens the review.
--   3. Coaches read by the existing rule (coach_may_read_record, 0021): the
--      current coach, earlier history only within the client's sharing
--      choice, and anything with attachments by the stricter media test.
--      A coach change moves responsibility for an unanswered check-in only
--      when that rule lets the new coach see it; otherwise it is flagged for
--      TalentYak to resolve, and nothing is shown to anyone in the meantime.
--   4. Access follows the approved paid-access policy (payment_failure.v2):
--      while coaching is paused, ended or suspended, no new requests, no
--      client drafts or corrections are saved, and the coach cannot start new
--      work. ONE approved exception (checkin_access.v1, founder, 2026-09-27):
--      the coach responsible for a check-in submitted in paid time may finish
--      that review after the paid time runs out, and the client can read it.
--      It never survives a suspension, a coach change or a refund.
--   5. Summaries only in notices. Answers, attachments and progress never
--      reach the inbox, an email, the outbox payload or a log line.

-- ---------------------------------------------------------------------------
-- 0. Notification category
-- ---------------------------------------------------------------------------

insert into notification_categories (id, label, description, essential, default_email, sort_order) values
  ('checkins', 'Check-ins',
   'When a check-in is due, when your coach replies, and — for coaches — check-ins waiting for your review.', false, true, 75)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  essential = excluded.essential,
  default_email = excluded.default_email,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 1. Templates
-- ---------------------------------------------------------------------------

create table if not exists checkin_templates (
  id uuid primary key default gen_random_uuid (),
  provider_id uuid not null references providers (id),
  title text not null check (char_length(title) between 1 and 80),
  latest_version int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checkin_templates_provider_idx on checkin_templates (provider_id, archived_at);

create table if not exists checkin_template_versions (
  id uuid primary key default gen_random_uuid (),
  template_id uuid not null references checkin_templates (id) on delete cascade,
  version int not null check (version >= 1),
  title text not null check (char_length(title) between 1 and 80),
  questions jsonb not null,
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

-- A question: {key, kind, label, help?, required?, sensitive?, low?, high?}.
-- Kinds: text, long_text, rating (1-5), photo, video. A sensitive question and
-- any attachment can never be required: those are always the client's choice.
create or replace function checkin_questions_valid (p jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p) = 'array'
    and jsonb_array_length(p) between 1 and 20
    and not exists (
      select 1 from jsonb_array_elements(p) q
      where jsonb_typeof(q) <> 'object'
         or coalesce(q ->> 'key', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or coalesce(q ->> 'kind', '') not in ('text', 'long_text', 'rating', 'photo', 'video')
         or char_length(coalesce(q ->> 'label', '')) not between 1 and 200
         or char_length(coalesce(q ->> 'help', '')) > 300
         or char_length(coalesce(q ->> 'low', '')) > 40
         or char_length(coalesce(q ->> 'high', '')) > 40
         or (q -> 'required' = 'true'::jsonb and (q -> 'sensitive' = 'true'::jsonb or q ->> 'kind' in ('photo', 'video')))
    )
    and (select count(distinct q ->> 'key') from jsonb_array_elements(p) q) = jsonb_array_length(p);
$$;

alter table checkin_template_versions drop constraint if exists checkin_template_versions_questions_ok;
alter table checkin_template_versions add constraint checkin_template_versions_questions_ok
  check (checkin_questions_valid (questions));

create index if not exists checkin_template_versions_template_idx on checkin_template_versions (template_id, version desc);

-- ---------------------------------------------------------------------------
-- 2. Schedules and breaks
-- ---------------------------------------------------------------------------

create table if not exists checkin_schedules (
  id uuid primary key default gen_random_uuid (),
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  -- One schedule per coach stint. A coach change ends it.
  assignment_id uuid not null unique references enrollment_assignments (id) on delete cascade,
  provider_id uuid not null references providers (id),
  latest_version int not null default 0,
  paused_at timestamptz,
  pause_note text check (pause_note is null or char_length(pause_note) <= 300),
  resumed_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checkin_schedules_enrollment_idx on checkin_schedules (enrollment_id);
create index if not exists checkin_schedules_provider_idx on checkin_schedules (provider_id);

create table if not exists checkin_schedule_versions (
  id uuid primary key default gen_random_uuid (),
  schedule_id uuid not null references checkin_schedules (id) on delete cascade,
  version int not null check (version >= 1),
  template_id uuid not null references checkin_templates (id),
  interval_weeks smallint not null check (interval_weeks in (1, 2, 4)),
  -- ISO weekday: Monday = 1 ... Sunday = 7.
  due_weekday smallint not null check (due_weekday between 1 and 7),
  due_time time not null,
  -- The CLIENT's timezone, set explicitly by the coach when scheduling.
  timezone text not null check (char_length(timezone) between 1 and 64),
  -- The first due date of this version. Later ones are every interval after.
  anchor_date date not null,
  -- The coach's own review commitment, in their published working days.
  -- Null: no stated time — never a platform guarantee.
  response_days smallint check (response_days is null or response_days between 1 and 14),
  effective_from timestamptz not null default now(),
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique (schedule_id, version)
);

create index if not exists checkin_schedule_versions_schedule_idx on checkin_schedule_versions (schedule_id, version desc);
create index if not exists checkin_schedule_versions_template_idx on checkin_schedule_versions (template_id);

create table if not exists checkin_breaks (
  id uuid primary key default gen_random_uuid (),
  schedule_id uuid not null references checkin_schedules (id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  note text check (note is null or char_length(note) <= 200),
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint checkin_breaks_range check (ends_on >= starts_on and ends_on - starts_on <= 180)
);

create index if not exists checkin_breaks_schedule_idx on checkin_breaks (schedule_id, starts_on);

-- ---------------------------------------------------------------------------
-- 3. Check-ins, drafts, submissions, feedback
-- ---------------------------------------------------------------------------

create table if not exists checkins (
  id uuid primary key default gen_random_uuid (),
  schedule_id uuid not null references checkin_schedules (id) on delete cascade,
  schedule_version_id uuid not null references checkin_schedule_versions (id),
  template_version_id uuid not null references checkin_template_versions (id),
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  customer_id uuid not null references profiles (id) on delete cascade,
  -- Who must review it now. Moves on a coach change only when the new coach
  -- may see it (see rule 3).
  responsible_assignment_id uuid not null references enrollment_assignments (id),
  responsible_provider_id uuid not null references providers (id),
  -- The reporting period, in the client's own calendar, and when it was due.
  -- Both fixed at creation.
  period_start date not null,
  period_end date not null,
  due_at timestamptz not null,
  timezone text not null,
  --   open       awaiting the client (a draft may exist)
  --   submitted  awaiting the coach's review
  --   reviewed   feedback published and the coach marked the review complete
  --   reopened   the client changed something substantive after feedback
  --   missed     the next period began and nothing had been started
  --   cancelled  a pause, a break or a coach change closed it before it was sent
  status text not null default 'open'
    check (status in ('open', 'submitted', 'reviewed', 'reopened', 'missed', 'cancelled')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 60),
  first_submitted_at timestamptz,
  last_submitted_at timestamptz,
  current_revision int not null default 0,
  -- The submission revision the coach's review must cover.
  review_revision int,
  -- Whether that submission was made within paid time (the review exception).
  review_in_paid_time boolean not null default false,
  -- Any submission carried an attachment: judged by the stricter media test.
  has_attachments boolean not null default false,
  -- Set when a coach change could not hand the review on. Metadata only.
  needs_resolution text check (needs_resolution is null or needs_resolution in ('coach_change_scope')),
  completed_at timestamptz,
  completed_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkins_period check (period_end >= period_start),
  unique (schedule_id, period_start)
);

create index if not exists checkins_enrollment_idx on checkins (enrollment_id, period_start desc);
create index if not exists checkins_customer_idx on checkins (customer_id, period_start desc);
create index if not exists checkins_responsible_idx on checkins (responsible_provider_id, status);
create index if not exists checkins_status_due_idx on checkins (status, due_at);
create index if not exists checkins_template_version_idx on checkins (template_version_id);
create index if not exists checkins_schedule_version_idx on checkins (schedule_version_id);
create index if not exists checkins_assignment_idx on checkins (responsible_assignment_id);

create table if not exists checkin_drafts (
  checkin_id uuid primary key references checkins (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 60000),
  -- The submission this draft corrects (0: the first submission).
  base_submission_revision int not null default 0,
  revision int not null default 1,
  last_save_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists checkin_submissions (
  id uuid primary key default gen_random_uuid (),
  checkin_id uuid not null references checkins (id) on delete cascade,
  revision int not null check (revision >= 1),
  answers jsonb not null check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 60000),
  media_ids uuid[] not null default '{}',
  -- False only for a correction that changed nothing the coach relies on.
  substantive boolean not null default true,
  change_note text check (change_note is null or char_length(change_note) <= 300),
  -- The M12 summary of the period as the client's records stood when sent.
  progress_snapshot jsonb check (progress_snapshot is null or octet_length(progress_snapshot::text) <= 60000),
  -- Chosen by the device: sending the same submission twice is one submission.
  submit_id uuid not null unique,
  in_paid_time boolean not null default true,
  submitted_at timestamptz not null default now(),
  unique (checkin_id, revision)
);

create index if not exists checkin_submissions_checkin_idx on checkin_submissions (checkin_id, revision desc);
create index if not exists checkin_submissions_media_idx on checkin_submissions using gin (media_ids);

create table if not exists checkin_feedback (
  id uuid primary key default gen_random_uuid (),
  checkin_id uuid not null references checkins (id) on delete cascade,
  version int not null check (version >= 1),
  provider_id uuid not null references providers (id),
  author_profile_id uuid not null references profiles (id),
  body text not null default '' check (char_length(body) <= 5000),
  -- [{key, text, kind: 'action' | 'plan_change'}]
  next_steps jsonb not null default '[]'::jsonb,
  -- Links for the client: the relevant M11 plan, and the M14 conversation
  -- with this coach for follow-up. Shown only to people who may open them.
  plan_id uuid references client_plans (id),
  conversation_id uuid references conversations (id),
  -- The client's submission this feedback answers.
  refers_to_revision int not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (checkin_id, version),
  constraint checkin_feedback_steps_ok check (
    jsonb_typeof(next_steps) = 'array' and jsonb_array_length(next_steps) <= 8
  )
);

create index if not exists checkin_feedback_checkin_idx on checkin_feedback (checkin_id, version desc);
create index if not exists checkin_feedback_provider_idx on checkin_feedback (provider_id);
create index if not exists checkin_feedback_plan_idx on checkin_feedback (plan_id) where plan_id is not null;
create index if not exists checkin_feedback_conversation_idx on checkin_feedback (conversation_id) where conversation_id is not null;
-- One unpublished draft per coach per check-in.
create unique index if not exists checkin_feedback_one_draft on checkin_feedback (checkin_id, provider_id) where published_at is null;

create table if not exists checkin_step_links (
  feedback_id uuid not null references checkin_feedback (id) on delete cascade,
  step_key uuid not null,
  plan_version_id uuid not null references client_plan_versions (id),
  linked_by uuid references profiles (id),
  linked_at timestamptz not null default now(),
  primary key (feedback_id, step_key)
);

create index if not exists checkin_step_links_version_idx on checkin_step_links (plan_version_id);

create table if not exists checkin_events (
  id uuid primary key default gen_random_uuid (),
  checkin_id uuid not null references checkins (id) on delete cascade,
  kind text not null check (kind in (
    'created', 'draft_saved', 'submitted', 'corrected', 'feedback_published', 'completed', 'reopened',
    'missed', 'cancelled', 'transferred', 'flagged', 'resolved', 'step_linked', 'step_unlinked')),
  actor_profile_id uuid references profiles (id),
  -- Revision numbers and reasons. Never an answer.
  detail jsonb not null default '{}'::jsonb check (octet_length(detail::text) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists checkin_events_checkin_idx on checkin_events (checkin_id, created_at);

-- Frozen rows: a template version, a submission and a published feedback
-- version are never changed. Only the definer functions below write at all;
-- this is the second lock.
-- Deleting is left to the relationship's own lifecycle (account deletion and
-- the separate retention policy), which reaches these rows only by cascade.
create or replace function checkin_refuse_change ()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'checkin_feedback' and old.published_at is null then
    return new;
  end if;
  raise exception 'checkin_record_frozen' using errcode = 'check_violation';
end;
$$;

drop trigger if exists checkin_template_versions_frozen on checkin_template_versions;
create trigger checkin_template_versions_frozen before update on checkin_template_versions
  for each row execute function checkin_refuse_change ();
drop trigger if exists checkin_submissions_frozen on checkin_submissions;
create trigger checkin_submissions_frozen before update on checkin_submissions
  for each row execute function checkin_refuse_change ();
drop trigger if exists checkin_feedback_frozen on checkin_feedback;
create trigger checkin_feedback_frozen before update on checkin_feedback
  for each row execute function checkin_refuse_change ();

-- ---------------------------------------------------------------------------
-- 4. Access helpers
-- ---------------------------------------------------------------------------

-- May this client add or change check-in answers on this relationship now?
-- The same vocabulary as tracking_write_state (0048), for any person.
create or replace function checkin_client_state (p_enrollment uuid, p_uid uuid)
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
  left join enrollments e on e.id = p_enrollment and e.customer_id = p_uid
  left join profiles cu on cu.id = e.customer_id;
$$;

-- Was `p_at` inside the time the client has paid for?
create or replace function checkin_in_paid_time (p_enrollment uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select pu.paid_through_at is null or p_at <= pu.paid_through_at
    from enrollments e
    left join purchases pu on pu.id = e.purchase_id
    where e.id = p_enrollment
  ), false);
$$;

-- THE APPROVED EXCEPTION (checkin_access.v1). The coach responsible for a
-- check-in submitted within paid time may finish its review after that time
-- runs out — while the relationship is paused for a failed renewal, or after
-- a cancelled renewal has ended it. Never across a suspension (either side),
-- a coach change, a refund, or a flag awaiting resolution; only for a review
-- still unfinished.
create or replace function checkin_review_exception (p_checkin uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from checkins c
    join enrollments e on e.id = c.enrollment_id
    join enrollment_assignments a on a.id = c.responsible_assignment_id
    join providers p on p.id = c.responsible_provider_id
    join profiles cp on cp.id = p.profile_id
    join profiles cu on cu.id = e.customer_id
    left join purchases pu on pu.id = e.purchase_id
    where c.id = p_checkin
      and p_uid is not null
      and p.profile_id = p_uid
      and c.status in ('submitted', 'reopened')
      and c.needs_resolution is null
      and c.review_in_paid_time
      and p.suspended_at is null and p.status <> 'suspended'
      and cp.suspended_at is null and cu.suspended_at is null
      and not exists (
        select 1 from enrollment_assignments later
        where later.enrollment_id = e.id and later.id <> a.id and later.effective_from >= a.effective_from
      )
      and (
        (e.state = 'paused' and a.effective_to is null)
        or (e.state = 'ended' and pu.state::text = 'ended')
      )
  );
$$;

create or replace function checkin_coach_may_read (p_checkin uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from checkins c
    where c.id = p_checkin
      and (
        coach_may_read_record (c.enrollment_id, c.created_at, c.has_attachments)
        or checkin_review_exception (c.id, auth.uid ())
      )
  );
$$;

-- May the caller publish feedback on, or complete, this check-in now?
create or replace function checkin_coach_may_review (p_checkin uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from checkins c
    join providers p on p.id = c.responsible_provider_id
    join enrollment_assignments a on a.id = c.responsible_assignment_id
    where c.id = p_checkin
      and p_uid is not null
      and p.profile_id = p_uid
      and c.needs_resolution is null
      and c.status in ('submitted', 'reviewed', 'reopened')
      -- Never blind: the client's sharing choice must still cover it.
      and (c.created_at >= a.effective_from or a.previous_provider_id is null or a.history_scope = 'full'
           or (a.history_scope = 'programme_and_logs' and not c.has_attachments))
      and (
        (coaching_is_live (c.enrollment_id) and a.effective_to is null and a.effective_from <= now())
        or checkin_review_exception (c.id, p_uid)
      )
  );
$$;

-- A check-in attachment the caller may see because it was SENT to them.
-- Drafts' attachments are never shown to a coach.
create or replace function checkin_attachment_readable (p_media uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from checkin_submissions s
    where s.media_ids @> array[p_media]
      and checkin_coach_may_read (s.checkin_id)
  );
$$;

-- The end of the coach's Nth working day after p_from, in their timezone and
-- their published working days, starting after any away period. Null when
-- they have not stated a review time or published any working days: then
-- nothing is promised on their behalf.
create or replace function checkin_expected_by (p_provider uuid, p_from timestamptz, p_days int)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_hours jsonb;
  v_away timestamptz;
  v_days int[];
  v_start timestamptz;
  v_date date;
  v_count int := 0;
  v_end text;
begin
  if p_days is null or p_from is null then
    return null;
  end if;
  select coalesce(nullif(p.timezone, ''), 'UTC'), cm.working_hours, cm.away_until
    into v_tz, v_hours, v_away
    from providers p left join coach_messaging_profiles cm on cm.provider_id = p.id
    where p.id = p_provider;
  select array_agg(distinct (h ->> 'day')::int) into v_days
    from jsonb_array_elements(coalesce(v_hours, '[]'::jsonb)) h
    where (h ->> 'day') ~ '^[0-6]$';
  if v_days is null then
    return null;
  end if;
  begin
    v_start := greatest(p_from, coalesce(v_away, p_from));
    v_date := (v_start at time zone v_tz)::date;
  exception when others then
    v_tz := 'UTC';
    v_date := (greatest(p_from, coalesce(v_away, p_from)) at time zone 'UTC')::date;
  end;
  for i in 1..120 loop
    v_date := v_date + 1;
    if extract(dow from v_date)::int = any (v_days) then
      v_count := v_count + 1;
      if v_count >= p_days then
        select max(h ->> 'end') into v_end
          from jsonb_array_elements(v_hours) h
          where (h ->> 'day') = extract(dow from v_date)::int::text;
        return (v_date + coalesce(v_end, '23:59')::time) at time zone v_tz;
      end if;
    end if;
  end loop;
  return null;
end;
$$;

-- The review time that applies to a check-in: the one its schedule stated,
-- and only while its responsible coach is the coach who stated it.
create or replace function checkin_review_due (p_checkin uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select checkin_expected_by (c.responsible_provider_id, c.last_submitted_at, sv.response_days)
  from checkins c
  join checkin_schedules s on s.id = c.schedule_id
  join checkin_schedule_versions sv on sv.id = c.schedule_version_id
  where c.id = p_checkin and s.provider_id = c.responsible_provider_id and c.status in ('submitted', 'reopened');
$$;

-- ---------------------------------------------------------------------------
-- 5. Row-level security
-- ---------------------------------------------------------------------------

alter table checkin_templates enable row level security;
alter table checkin_template_versions enable row level security;
alter table checkin_schedules enable row level security;
alter table checkin_schedule_versions enable row level security;
alter table checkin_breaks enable row level security;
alter table checkins enable row level security;
alter table checkin_drafts enable row level security;
alter table checkin_submissions enable row level security;
alter table checkin_feedback enable row level security;
alter table checkin_step_links enable row level security;
alter table checkin_events enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['checkin_templates', 'checkin_template_versions', 'checkin_schedules', 'checkin_schedule_versions',
                           'checkin_breaks', 'checkins', 'checkin_drafts', 'checkin_submissions', 'checkin_feedback',
                           'checkin_step_links', 'checkin_events'] loop
    execute format('revoke insert, update, delete, truncate on %I from anon, authenticated', t);
  end loop;
end $$;

create policy "coach reads own check-in templates" on checkin_templates
  for select using (is_active_provider (provider_id));

create policy "coach reads own template versions" on checkin_template_versions
  for select using (exists (select 1 from checkin_templates t where t.id = template_id and is_active_provider (t.provider_id)));
-- The questions a check-in was asked with travel with it: whoever may read
-- the check-in may read them.
create policy "readers of a check-in read its questions" on checkin_template_versions
  for select using (exists (select 1 from checkins c where c.template_version_id = checkin_template_versions.id));

create policy "client reads own check-in schedule" on checkin_schedules
  for select using (enrollment_belongs_to_me (enrollment_id));
create policy "current coach reads own check-in schedule" on checkin_schedules
  for select using (is_active_provider (provider_id) and coach_may_read_record (enrollment_id, now(), false));

create policy "schedule readers read its versions" on checkin_schedule_versions
  for select using (exists (select 1 from checkin_schedules s where s.id = schedule_id));
create policy "schedule readers read its breaks" on checkin_breaks
  for select using (exists (select 1 from checkin_schedules s where s.id = schedule_id));

create policy "client reads own check-ins" on checkins
  for select using (customer_id = auth.uid ());
create policy "coach reads permitted check-ins" on checkins
  for select using (checkin_coach_may_read (id));

create policy "client reads own check-in drafts" on checkin_drafts
  for select using (exists (select 1 from checkins c where c.id = checkin_id and c.customer_id = auth.uid ()));

create policy "client reads own submissions" on checkin_submissions
  for select using (exists (select 1 from checkins c where c.id = checkin_id and c.customer_id = auth.uid ()));
create policy "coach reads permitted submissions" on checkin_submissions
  for select using (checkin_coach_may_read (checkin_id));

create policy "client reads published feedback" on checkin_feedback
  for select using (
    published_at is not null
    and exists (select 1 from checkins c where c.id = checkin_id and c.customer_id = auth.uid ())
  );
-- A coach reads what was published on a check-in they may read, and only
-- their own drafts.
create policy "coach reads permitted feedback" on checkin_feedback
  for select using (
    checkin_coach_may_read (checkin_id)
    and (published_at is not null or is_active_provider (provider_id))
  );

create policy "feedback readers read step links" on checkin_step_links
  for select using (exists (select 1 from checkin_feedback f where f.id = feedback_id and f.published_at is not null));

create policy "check-in readers read its events" on checkin_events
  for select using (exists (select 1 from checkins c where c.id = checkin_id));

-- Media. A check-in attachment reaches a coach only once it was sent: a
-- draft's photo is the client's until they press send.
drop policy if exists "current coach reads permitted media" on media_assets;
create policy "current coach reads permitted media" on media_assets for select
  using (
    enrollment_id is not null
    and purpose <> 'chat_attachment'
    and purpose <> 'checkin_attachment'
    and state = 'ready'
    and deleted_at is null
    and coach_may_read_record (enrollment_id, recorded_at, true)
  );

drop policy if exists "coach reads sent check-in attachments" on media_assets;
create policy "coach reads sent check-in attachments" on media_assets for select
  using (
    purpose = 'checkin_attachment'
    and state = 'ready'
    and deleted_at is null
    and checkin_attachment_readable (id)
  );

-- ---------------------------------------------------------------------------
-- 6. Notices — summaries through the outbox, re-checked before sending
-- ---------------------------------------------------------------------------

create or replace function queue_checkin_notice (p_checkin uuid, p_event text, p_recipient uuid, p_key text, p_extra jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient is null then
    return;
  end if;
  perform enqueue_outbox (
    'email.checkin_notice',
    jsonb_build_object('event', p_event, 'checkin_id', p_checkin, 'recipient_id', p_recipient) || coalesce(p_extra, '{}'::jsonb),
    'checkin:' || p_checkin || ':' || p_key,
    now(),
    now() + interval '7 days'
  );
end;
$$;

-- Is what a queued notice says still true, for that person, right now?
create or replace function checkin_notice_still_true (p_job jsonb)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c checkins;
  v_event text := p_job ->> 'event';
  v_recipient uuid := nullif(p_job ->> 'recipient_id', '')::uuid;
  v_coach uuid;
  f checkin_feedback;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;
  select * into c from checkins where id = nullif(p_job ->> 'checkin_id', '')::uuid;
  if not found then
    return 'the check-in no longer exists';
  end if;
  select p.profile_id into v_coach from providers p where p.id = c.responsible_provider_id;

  if v_event in ('due_soon', 'late') then
    if v_recipient is distinct from c.customer_id then return 'not the client'; end if;
    if c.status <> 'open' then return 'already sent or closed'; end if;
    if not coaching_is_live (c.enrollment_id) then return 'coaching is not live'; end if;
    if exists (select 1 from checkin_schedules s where s.id = c.schedule_id and (s.paused_at is not null or s.ended_at is not null)) then
      return 'check-ins are paused';
    end if;
    return null;
  end if;

  if v_event in ('submitted', 'corrected', 'review_overdue', 'transferred') then
    if v_recipient is distinct from v_coach then return 'no longer the responsible coach'; end if;
    if c.status not in ('submitted', 'reopened') then return 'the review is finished'; end if;
    if c.needs_resolution is not null then return 'awaiting resolution'; end if;
    if (p_job ? 'revision') and (p_job ->> 'revision')::int <> c.review_revision then return 'superseded by a later version'; end if;
    if not checkin_coach_may_review (c.id, v_coach) then return 'the coach may not review this now'; end if;
    return null;
  end if;

  if v_event = 'feedback' then
    if v_recipient is distinct from c.customer_id then return 'not the client'; end if;
    select * into f from checkin_feedback where id = nullif(p_job ->> 'feedback_id', '')::uuid;
    if not found or f.published_at is null or f.checkin_id <> c.id then return 'feedback not published'; end if;
    if exists (select 1 from checkin_feedback g where g.checkin_id = c.id and g.published_at > f.published_at) then
      return 'superseded by later feedback';
    end if;
    return null;
  end if;

  if v_event = 'closed' then
    if v_recipient is distinct from c.customer_id then return 'not the client'; end if;
    return null;
  end if;

  return 'unknown notice';
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Making requests — only for the period running now
-- ---------------------------------------------------------------------------

create or replace function materialize_checkins_for (p_enrollment uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s checkin_schedules;
  v checkin_schedule_versions;
  v_template_version uuid;
  v_today date;
  v_step int;
  v_due date;
  v_due_at timestamptz;
  v_start date;
  v_last_end date;
  v_floor date;
  v_break_end date;
  v_id uuid;
  v_made int := 0;
begin
  for s in
    select * from checkin_schedules
    where ended_at is null and paused_at is null
      and (p_enrollment is null or enrollment_id = p_enrollment)
    for update
  loop
    -- Only while coaching is live, with this schedule's coach.
    if not coaching_is_live (s.enrollment_id)
       or not exists (select 1 from enrollment_assignments a where a.id = s.assignment_id and a.effective_to is null) then
      continue;
    end if;

    select * into v from checkin_schedule_versions
      where schedule_id = s.id and effective_from <= now()
      order by version desc limit 1;
    if not found then
      continue;
    end if;

    select tv.id into v_template_version from checkin_template_versions tv
      where tv.template_id = v.template_id order by tv.version desc limit 1;
    if v_template_version is null then
      continue;
    end if;

    begin
      v_today := (now() at time zone v.timezone)::date;
    exception when others then
      continue;
    end;
    v_step := 7 * v.interval_weeks;
    -- The first due date of the cadence on or after today.
    v_due := v.anchor_date + (ceil((v_today - v.anchor_date)::numeric / v_step)::int * v_step);
    select max(period_end) into v_last_end from checkins where schedule_id = s.id;
    -- Nothing reaches back before the schedule began or before it resumed.
    v_floor := greatest(
      (s.created_at at time zone v.timezone)::date,
      coalesce((s.resumed_at at time zone v.timezone)::date, '-infinity'::date),
      coalesce(v_last_end + 1, '-infinity'::date)
    );

    for i in 1..4 loop
      v_due_at := (v_due + v.due_time) at time zone v.timezone;
      if v_due_at > now() then
        -- A due date inside a planned break asks nothing.
        if not exists (
          select 1 from checkin_breaks b
          where b.schedule_id = s.id and b.cancelled_at is null and v_due between b.starts_on and b.ends_on
        ) then
          -- A period that follows a break starts after it.
          select max(b.ends_on) into v_break_end from checkin_breaks b
            where b.schedule_id = s.id and b.cancelled_at is null
              and b.ends_on >= v_due - v_step + 1 and b.ends_on < v_due;
          v_start := greatest(v_due - v_step + 1, v_floor, coalesce(v_break_end + 1, '-infinity'::date));
          if v_start <= v_due then
            if v_start > v_today then
              exit; -- this period has not begun yet
            end if;

            -- The request before it, never started, is closed: no backlog.
            with gone as (
              update checkins c set status = 'missed', status_reason = 'next_period_began', updated_at = now()
                where c.schedule_id = s.id and c.status = 'open' and c.due_at < now()
                  and not exists (select 1 from checkin_drafts d where d.checkin_id = c.id)
                returning c.id
            )
            insert into checkin_events (checkin_id, kind, detail)
              select id, 'missed', '{}'::jsonb from gone;

            insert into checkins (schedule_id, schedule_version_id, template_version_id, enrollment_id, customer_id,
                                  responsible_assignment_id, responsible_provider_id, period_start, period_end, due_at, timezone)
              select s.id, v.id, v_template_version, s.enrollment_id, e.customer_id, s.assignment_id, s.provider_id,
                     v_start, v_due, v_due_at, v.timezone
              from enrollments e where e.id = s.enrollment_id
            on conflict (schedule_id, period_start) do nothing
            returning id into v_id;
            if v_id is not null then
              insert into checkin_events (checkin_id, kind, detail)
                values (v_id, 'created', jsonb_build_object('schedule_version', v.version));
              v_made := v_made + 1;
            end if;
            exit;
          end if;
        end if;
      end if;
      v_due := v_due + v_step;
    end loop;
  end loop;
  return v_made;
end;
$$;

-- The worker's call: every schedule.
create or replace function materialize_checkins ()
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;
  return materialize_checkins_for (null);
end;
$$;

-- A page's call: the caller's own relationship, or one they coach now.
create or replace function refresh_checkins (p_enrollment uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (enrollment_belongs_to_me (p_enrollment) or coach_may_read_record (p_enrollment, now(), false)) then
    return 0;
  end if;
  return materialize_checkins_for (p_enrollment);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Coach: templates and schedules
-- ---------------------------------------------------------------------------

create or replace function my_provider_for_checkins ()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from providers p join profiles pr on pr.id = p.profile_id
  where p.profile_id = auth.uid () and p.suspended_at is null and p.status <> 'suspended' and pr.suspended_at is null
  limit 1;
$$;

-- Creates a template, or adds a version when the questions changed. Earlier
-- versions stay exactly as they were, with every check-in that used them.
create or replace function save_checkin_template (p_template uuid, p_title text, p_questions jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid := my_provider_for_checkins ();
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  t checkin_templates;
  v_latest jsonb;
begin
  if v_provider is null then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if v_title is null or char_length(v_title) > 80 or not checkin_questions_valid (p_questions) then
    raise exception 'checkin_template_invalid' using errcode = 'check_violation';
  end if;

  if p_template is null then
    insert into checkin_templates (provider_id, title, latest_version) values (v_provider, v_title, 1) returning * into t;
    insert into checkin_template_versions (template_id, version, title, questions) values (t.id, 1, v_title, p_questions);
    return t.id;
  end if;

  select * into t from checkin_templates where id = p_template and provider_id = v_provider for update;
  if not found then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  select questions into v_latest from checkin_template_versions where template_id = t.id and version = t.latest_version;
  if v_latest is distinct from p_questions or t.title <> v_title then
    insert into checkin_template_versions (template_id, version, title, questions)
      values (t.id, t.latest_version + 1, v_title, p_questions);
    update checkin_templates set title = v_title, latest_version = latest_version + 1, updated_at = now() where id = t.id;
  end if;
  return t.id;
end;
$$;

create or replace function archive_checkin_template (p_template uuid, p_archive boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update checkin_templates
    set archived_at = case when p_archive then coalesce(archived_at, now()) end, updated_at = now()
    where id = p_template and provider_id = my_provider_for_checkins ();
  if not found then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- The coach's schedule for a client they coach now. A change is a new
-- version from now on: the request already open keeps its questions and due
-- time, and the next one never overlaps it.
create or replace function set_checkin_schedule (
  p_enrollment uuid,
  p_template uuid,
  p_interval_weeks int,
  p_due_weekday int,
  p_due_time time,
  p_timezone text,
  p_response_days int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a enrollment_assignments;
  s checkin_schedules;
  v_today date;
  v_anchor date;
begin
  if not coaches_enrollment_now (p_enrollment) then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  select a2.* into a from enrollment_assignments a2 join providers p on p.id = a2.provider_id
    where a2.enrollment_id = p_enrollment and a2.effective_to is null and p.profile_id = auth.uid ();
  if not exists (
    select 1 from checkin_templates t where t.id = p_template and t.provider_id = a.provider_id and t.archived_at is null
  ) then
    raise exception 'checkin_schedule_invalid' using errcode = 'check_violation';
  end if;
  if p_interval_weeks not in (1, 2, 4) or p_due_weekday not between 1 and 7 or p_due_time is null
     or (p_response_days is not null and p_response_days not between 1 and 14) then
    raise exception 'checkin_schedule_invalid' using errcode = 'check_violation';
  end if;
  begin
    v_today := (now() at time zone p_timezone)::date;
  exception when others then
    raise exception 'checkin_timezone_invalid' using errcode = 'check_violation';
  end;
  if p_timezone !~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$' then
    raise exception 'checkin_timezone_invalid' using errcode = 'check_violation';
  end if;

  -- The first due date of the new cadence: the next chosen weekday.
  v_anchor := v_today + ((p_due_weekday - extract(isodow from v_today)::int + 7) % 7);

  insert into checkin_schedules (enrollment_id, assignment_id, provider_id)
    values (p_enrollment, a.id, a.provider_id)
  on conflict (assignment_id) do update set updated_at = now()
  returning * into s;

  insert into checkin_schedule_versions (schedule_id, version, template_id, interval_weeks, due_weekday, due_time,
                                         timezone, anchor_date, response_days, created_by)
    values (s.id, s.latest_version + 1, p_template, p_interval_weeks, p_due_weekday, p_due_time,
            p_timezone, v_anchor, p_response_days, auth.uid ());
  update checkin_schedules set latest_version = latest_version + 1, updated_at = now() where id = s.id;

  perform materialize_checkins_for (p_enrollment);
  return s.id;
end;
$$;

-- Pausing asks nothing new, and withdraws a request the client has not
-- started. A started one stays theirs to send.
create or replace function pause_checkin_schedule (p_enrollment uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s checkin_schedules;
begin
  if not coaches_enrollment_now (p_enrollment) then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  select cs.* into s from checkin_schedules cs join enrollment_assignments a on a.id = cs.assignment_id
    where cs.enrollment_id = p_enrollment and a.effective_to is null and cs.ended_at is null for update;
  if not found then
    raise exception 'checkin_schedule_missing' using errcode = 'no_data_found';
  end if;
  update checkin_schedules set paused_at = coalesce(paused_at, now()),
         pause_note = nullif(left(trim(coalesce(p_note, '')), 300), ''), updated_at = now()
    where id = s.id;
  with gone as (
    update checkins c set status = 'cancelled', status_reason = 'schedule_paused', updated_at = now()
      where c.schedule_id = s.id and c.status = 'open'
        and not exists (select 1 from checkin_drafts d where d.checkin_id = c.id)
      returning c.id
  )
  insert into checkin_events (checkin_id, kind, actor_profile_id, detail)
    select id, 'cancelled', auth.uid (), '{"reason":"schedule_paused"}'::jsonb from gone;
end;
$$;

-- Resuming starts from the period running now. Nothing for the paused weeks.
create or replace function resume_checkin_schedule (p_enrollment uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coaches_enrollment_now (p_enrollment) then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  update checkin_schedules cs set paused_at = null, pause_note = null, resumed_at = now(), updated_at = now()
    from enrollment_assignments a
    where a.id = cs.assignment_id and cs.enrollment_id = p_enrollment and a.effective_to is null
      and cs.ended_at is null and cs.paused_at is not null;
  perform materialize_checkins_for (p_enrollment);
end;
$$;

-- A planned break, from the coach or the client. Requests due inside it are
-- not made; an unstarted one already open for it is withdrawn.
create or replace function add_checkin_break (p_enrollment uuid, p_from date, p_to date, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s checkin_schedules;
  v_tz text;
  v_id uuid;
begin
  if not (coaches_enrollment_now (p_enrollment)
          or (enrollment_belongs_to_me (p_enrollment) and checkin_client_state (p_enrollment, auth.uid ()) = 'live')) then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  select cs.* into s from checkin_schedules cs join enrollment_assignments a on a.id = cs.assignment_id
    where cs.enrollment_id = p_enrollment and a.effective_to is null and cs.ended_at is null;
  if not found then
    raise exception 'checkin_schedule_missing' using errcode = 'no_data_found';
  end if;
  select timezone into v_tz from checkin_schedule_versions where schedule_id = s.id order by version desc limit 1;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 180
     or p_to < (now() at time zone coalesce(v_tz, 'UTC'))::date then
    raise exception 'checkin_break_invalid' using errcode = 'check_violation';
  end if;
  insert into checkin_breaks (schedule_id, starts_on, ends_on, note, created_by)
    values (s.id, p_from, p_to, nullif(left(trim(coalesce(p_note, '')), 200), ''), auth.uid ())
    returning id into v_id;
  with gone as (
    update checkins c set status = 'cancelled', status_reason = 'planned_break', updated_at = now()
      where c.schedule_id = s.id and c.status = 'open' and c.period_end between p_from and p_to
        and not exists (select 1 from checkin_drafts d where d.checkin_id = c.id)
      returning c.id
  )
  insert into checkin_events (checkin_id, kind, actor_profile_id, detail)
    select id, 'cancelled', auth.uid (), '{"reason":"planned_break"}'::jsonb from gone;
  return v_id;
end;
$$;

create or replace function cancel_checkin_break (p_break uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment uuid;
begin
  select s.enrollment_id into v_enrollment from checkin_breaks b join checkin_schedules s on s.id = b.schedule_id where b.id = p_break;
  if v_enrollment is null or not (coaches_enrollment_now (v_enrollment)
          or (enrollment_belongs_to_me (v_enrollment) and checkin_client_state (v_enrollment, auth.uid ()) = 'live')) then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  update checkin_breaks set cancelled_at = now() where id = p_break and cancelled_at is null;
  perform materialize_checkins_for (v_enrollment);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Client: drafts and submissions
-- ---------------------------------------------------------------------------

-- Saves the client's unsent answers. Safe to repeat: the same save arriving
-- twice is recognised; a save based on an older draft is refused with the
-- current revision, so two devices never silently overwrite each other.
create or replace function save_checkin_draft (p_checkin uuid, p_answers jsonb, p_base_revision int, p_save_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c checkins;
  d checkin_drafts;
  v_state text;
  v_revision int;
begin
  select * into c from checkins where id = p_checkin for update;
  if not found or c.customer_id is distinct from auth.uid () then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if c.status in ('missed', 'cancelled') then
    raise exception 'checkin_closed' using errcode = 'check_violation';
  end if;
  v_state := checkin_client_state (c.enrollment_id, auth.uid ());
  if v_state <> 'live' then
    raise exception 'checkin_%', v_state using errcode = 'insufficient_privilege',
      hint = 'Answers wait on the device until coaching is live again.';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' or octet_length(p_answers::text) > 60000 then
    raise exception 'checkin_answers_invalid' using errcode = 'check_violation';
  end if;

  select * into d from checkin_drafts where checkin_id = c.id for update;
  if found then
    if p_save_id is not null and d.last_save_id = p_save_id then
      return jsonb_build_object('ok', true, 'revision', d.revision, 'replayed', true);
    end if;
    if d.revision <> coalesce(p_base_revision, -1) then
      return jsonb_build_object('ok', false, 'conflict', true, 'revision', d.revision, 'answers', d.answers);
    end if;
    update checkin_drafts set answers = p_answers, revision = revision + 1, last_save_id = p_save_id,
           base_submission_revision = c.current_revision, updated_at = now()
      where checkin_id = c.id returning revision into v_revision;
  else
    if coalesce(p_base_revision, 0) <> 0 then
      -- Saved before and since sent or discarded elsewhere.
      return jsonb_build_object('ok', false, 'conflict', true, 'revision', 0, 'missing', true,
                                'submitted_revision', c.current_revision);
    end if;
    insert into checkin_drafts (checkin_id, answers, base_submission_revision, revision, last_save_id)
      values (c.id, p_answers, c.current_revision, 1, p_save_id);
    v_revision := 1;
  end if;
  return jsonb_build_object('ok', true, 'revision', v_revision);
end;
$$;

-- Throwing away unsent answers is always the client's to do.
create or replace function discard_checkin_draft (p_checkin uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from checkin_drafts d using checkins c
    where d.checkin_id = p_checkin and c.id = d.checkin_id and c.customer_id = auth.uid ();
end;
$$;

-- Sending, or sending a correction. Called by our server on the client's
-- behalf (their identity comes from their session, checked there), because
-- the progress summary is assembled by the server from the client's own
-- records and must not be something a device can write.
--
-- Returns {ok, revision, status} — or {ok:false, conflict} when the check-in
-- moved on since the device last saw it. The same submit_id twice is one
-- submission.
create or replace function submit_checkin (
  p_actor uuid,
  p_checkin uuid,
  p_answers jsonb,
  p_media uuid[],
  p_submit_id uuid,
  p_base_revision int,
  p_substantive boolean,
  p_change_note text,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c checkins;
  prior checkin_submissions;
  v_state text;
  v_revision int;
  v_media uuid[] := coalesce(p_media, '{}');
  v_substantive boolean;
  v_published boolean;
  v_status text;
  v_paid boolean;
  v_coach uuid;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  select * into prior from checkin_submissions where submit_id = p_submit_id;
  if found then
    select * into c from checkins where id = prior.checkin_id;
    if prior.checkin_id <> p_checkin or c.customer_id is distinct from p_actor then
      raise exception 'checkin_answers_invalid' using errcode = 'check_violation';
    end if;
    return jsonb_build_object('ok', true, 'revision', prior.revision, 'status', c.status, 'replayed', true);
  end if;

  select * into c from checkins where id = p_checkin for update;
  if not found or c.customer_id is distinct from p_actor then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if c.status in ('missed', 'cancelled') then
    raise exception 'checkin_closed' using errcode = 'check_violation';
  end if;
  v_state := checkin_client_state (c.enrollment_id, p_actor);
  if v_state <> 'live' then
    raise exception 'checkin_%', v_state using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_base_revision, -1) <> c.current_revision then
    return jsonb_build_object('ok', false, 'conflict', true, 'revision', c.current_revision, 'status', c.status);
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' or octet_length(p_answers::text) > 60000
     or cardinality(v_media) > 6
     or (p_snapshot is not null and (jsonb_typeof(p_snapshot) <> 'object' or octet_length(p_snapshot::text) > 60000)) then
    raise exception 'checkin_answers_invalid' using errcode = 'check_violation';
  end if;
  -- Every attachment is the client's own check-in attachment on this
  -- relationship, and still there.
  if exists (
    select 1 from unnest(v_media) m
    where not exists (
      select 1 from media_assets a
      where a.id = m and a.owner_profile_id = p_actor and a.enrollment_id = c.enrollment_id
        and a.purpose = 'checkin_attachment' and a.state not in ('deleted', 'failed') and a.deleted_at is null
    )
  ) then
    raise exception 'checkin_attachment_invalid' using errcode = 'check_violation';
  end if;

  v_revision := c.current_revision + 1;
  -- The first submission is always substantive; a correction is judged by
  -- the server that called this.
  v_substantive := v_revision = 1 or coalesce(p_substantive, true);
  v_paid := checkin_in_paid_time (c.enrollment_id, now());

  insert into checkin_submissions (checkin_id, revision, answers, media_ids, substantive, change_note,
                                   progress_snapshot, submit_id, in_paid_time)
    values (c.id, v_revision, p_answers, v_media, v_substantive,
            nullif(left(trim(coalesce(p_change_note, '')), 300), ''), p_snapshot, p_submit_id, v_paid);

  select exists (select 1 from checkin_feedback f where f.checkin_id = c.id and f.published_at is not null) into v_published;

  v_status := case
    when c.status = 'open' then 'submitted'
    when not v_substantive then c.status
    when c.status = 'reviewed' or v_published then 'reopened'
    else c.status
  end;

  update checkins set
      current_revision = v_revision,
      first_submitted_at = coalesce(first_submitted_at, now()),
      last_submitted_at = now(),
      has_attachments = has_attachments or cardinality(v_media) > 0,
      status = v_status,
      review_revision = case when v_substantive then v_revision else review_revision end,
      review_in_paid_time = case when v_substantive then v_paid else review_in_paid_time end,
      completed_at = case when v_status = 'reopened' then null else completed_at end,
      completed_by = case when v_status = 'reopened' then null else completed_by end,
      updated_at = now()
    where id = c.id;

  delete from checkin_drafts where checkin_id = c.id;

  insert into checkin_events (checkin_id, kind, actor_profile_id, detail)
    values (c.id, case when v_revision = 1 then 'submitted' else 'corrected' end, p_actor,
            jsonb_build_object('revision', v_revision, 'substantive', v_substantive, 'late', now() > c.due_at));
  if v_status = 'reopened' and c.status <> 'reopened' then
    insert into checkin_events (checkin_id, kind, actor_profile_id, detail)
      values (c.id, 'reopened', p_actor, jsonb_build_object('revision', v_revision));
  end if;

  if c.needs_resolution is null and v_substantive then
    select p.profile_id into v_coach from providers p where p.id = c.responsible_provider_id;
    perform queue_checkin_notice (c.id, case when v_revision = 1 then 'submitted' else 'corrected' end, v_coach,
                                  (case when v_revision = 1 then 'submitted' else 'corrected:' || v_revision end),
                                  jsonb_build_object('revision', v_revision));
  end if;

  return jsonb_build_object('ok', true, 'revision', v_revision, 'status', v_status, 'substantive', v_substantive);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Coach: feedback and completion
-- ---------------------------------------------------------------------------

create or replace function checkin_steps_valid (p jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p) = 'array'
    and jsonb_array_length(p) <= 8
    and not exists (
      select 1 from jsonb_array_elements(p) s
      where jsonb_typeof(s) <> 'object'
         or coalesce(s ->> 'key', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or char_length(coalesce(s ->> 'text', '')) not between 1 and 200
         or coalesce(s ->> 'kind', '') not in ('action', 'plan_change')
    );
$$;

-- Saves the coach's draft (one per coach per check-in). Nothing is shown to
-- the client until it is published.
create or replace function save_checkin_feedback (
  p_checkin uuid,
  p_body text,
  p_next_steps jsonb,
  p_plan uuid,
  p_link_conversation boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c checkins;
  v_provider uuid;
  v_id uuid;
  v_conversation uuid;
  v_body text := coalesce(p_body, '');
  v_steps jsonb := coalesce(p_next_steps, '[]'::jsonb);
begin
  select * into c from checkins where id = p_checkin for update;
  if not found or not checkin_coach_may_review (c.id, auth.uid ()) then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_body) > 5000 or not checkin_steps_valid (v_steps) then
    raise exception 'checkin_feedback_invalid' using errcode = 'check_violation';
  end if;
  if p_plan is not null and not exists (select 1 from client_plans cp where cp.id = p_plan and cp.enrollment_id = c.enrollment_id) then
    raise exception 'checkin_feedback_invalid' using errcode = 'check_violation';
  end if;
  v_provider := c.responsible_provider_id;
  if p_link_conversation then
    select id into v_conversation from conversations where assignment_id = c.responsible_assignment_id;
  end if;

  update checkin_feedback
    set body = v_body, next_steps = v_steps, plan_id = p_plan, conversation_id = v_conversation,
        refers_to_revision = c.current_revision, updated_at = now()
    where checkin_id = c.id and provider_id = v_provider and published_at is null
    returning id into v_id;
  if v_id is null then
    insert into checkin_feedback (checkin_id, version, provider_id, author_profile_id, body, next_steps, plan_id,
                                  conversation_id, refers_to_revision)
      values (c.id, coalesce((select max(version) from checkin_feedback where checkin_id = c.id), 0) + 1,
              v_provider, auth.uid (), v_body, v_steps, p_plan, v_conversation, c.current_revision)
      returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function discard_checkin_feedback (p_feedback uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from checkin_feedback f using providers p
    where f.id = p_feedback and f.published_at is null and p.id = f.provider_id and p.profile_id = auth.uid ();
end;
$$;

-- Publishing: the client can read it and is told. It does NOT complete the
-- review — that is a separate, explicit step.
create or replace function publish_checkin_feedback (p_feedback uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f checkin_feedback;
  c checkins;
begin
  select * into f from checkin_feedback where id = p_feedback for update;
  if not found or f.published_at is not null then
    raise exception 'checkin_feedback_invalid' using errcode = 'check_violation';
  end if;
  select * into c from checkins where id = f.checkin_id for update;
  if f.provider_id <> c.responsible_provider_id or not checkin_coach_may_review (c.id, auth.uid ()) then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if btrim(f.body) = '' and jsonb_array_length(f.next_steps) = 0 then
    raise exception 'checkin_feedback_empty' using errcode = 'check_violation';
  end if;
  update checkin_feedback set published_at = now(), refers_to_revision = c.current_revision where id = f.id;
  insert into checkin_events (checkin_id, kind, actor_profile_id, detail)
    values (c.id, 'feedback_published', auth.uid (), jsonb_build_object('revision', c.current_revision));
  perform queue_checkin_notice (c.id, 'feedback', c.customer_id, 'feedback:' || f.id, jsonb_build_object('feedback_id', f.id));
end;
$$;

-- Completing needs published feedback covering the latest substantive
-- change. Opening a check-in never completes it.
create or replace function complete_checkin_review (p_checkin uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c checkins;
begin
  select * into c from checkins where id = p_checkin for update;
  if not found or not checkin_coach_may_review (c.id, auth.uid ()) then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if c.status not in ('submitted', 'reopened') then
    raise exception 'checkin_not_awaiting_review' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from checkin_feedback f
    where f.checkin_id = c.id and f.published_at is not null and f.refers_to_revision >= coalesce(c.review_revision, 1)
  ) then
    raise exception 'checkin_feedback_required' using errcode = 'check_violation';
  end if;
  update checkins set status = 'reviewed', completed_at = now(), completed_by = auth.uid (), updated_at = now()
    where id = c.id;
  insert into checkin_events (checkin_id, kind, actor_profile_id, detail)
    values (c.id, 'completed', auth.uid (), jsonb_build_object('revision', c.review_revision));
end;
$$;

-- A promised plan change is shown as delivered only when the coach links it
-- to a version that was actually published, after the check-in was sent.
create or replace function link_checkin_step (p_feedback uuid, p_step uuid, p_version uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f checkin_feedback;
  c checkins;
begin
  select * into f from checkin_feedback where id = p_feedback;
  if not found or f.published_at is null then
    raise exception 'checkin_feedback_invalid' using errcode = 'check_violation';
  end if;
  select * into c from checkins where id = f.checkin_id;
  if not checkin_coach_may_review (c.id, auth.uid ()) then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from jsonb_array_elements(f.next_steps) s where s ->> 'key' = p_step::text and s ->> 'kind' = 'plan_change') then
    raise exception 'checkin_feedback_invalid' using errcode = 'check_violation';
  end if;
  if p_version is null then
    delete from checkin_step_links where feedback_id = f.id and step_key = p_step;
    insert into checkin_events (checkin_id, kind, actor_profile_id, detail)
      values (c.id, 'step_unlinked', auth.uid (), '{}'::jsonb);
    return;
  end if;
  if not exists (
    select 1 from client_plan_versions v join client_plans cp on cp.id = v.plan_id
    where v.id = p_version and cp.enrollment_id = c.enrollment_id
      and v.published_at is not null and v.withdrawn_at is null
      and v.published_at >= c.first_submitted_at
  ) then
    raise exception 'checkin_step_version_invalid' using errcode = 'check_violation';
  end if;
  insert into checkin_step_links (feedback_id, step_key, plan_version_id, linked_by)
    values (f.id, p_step, p_version, auth.uid ())
  on conflict (feedback_id, step_key) do update set plan_version_id = excluded.plan_version_id,
    linked_by = excluded.linked_by, linked_at = now();
  insert into checkin_events (checkin_id, kind, actor_profile_id, detail)
    values (c.id, 'step_linked', auth.uid (), '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Coach changes
-- ---------------------------------------------------------------------------

-- An unanswered check-in moves to the new coach only when the client's
-- sharing choice lets that coach see it (with attachments: the 'full'
-- choice). Otherwise it is flagged, and nobody sees it until resolved.
create or replace function checkin_hand_over (p_assignment uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a enrollment_assignments;
  c checkins;
  v_coach uuid;
begin
  select * into a from enrollment_assignments where id = p_assignment;
  if not found then
    return;
  end if;
  select profile_id into v_coach from providers where id = a.provider_id;

  for c in
    select * from checkins
    where enrollment_id = a.enrollment_id and responsible_assignment_id <> a.id
      and status in ('open', 'submitted', 'reopened')
    for update
  loop
    if c.status = 'open' then
      -- Not sent: closed. Any draft stays for the client to read.
      update checkins set status = 'cancelled', status_reason = 'coach_changed', updated_at = now() where id = c.id;
      insert into checkin_events (checkin_id, kind, detail) values (c.id, 'cancelled', '{"reason":"coach_changed"}'::jsonb);
    elsif a.history_scope = 'full' or (a.history_scope = 'programme_and_logs' and not c.has_attachments) then
      update checkins set responsible_assignment_id = a.id, responsible_provider_id = a.provider_id,
             needs_resolution = null, updated_at = now()
        where id = c.id;
      insert into checkin_events (checkin_id, kind, detail) values (c.id, 'transferred', '{}'::jsonb);
      perform queue_checkin_notice (c.id, 'transferred', v_coach, 'transferred:' || a.id,
                                    jsonb_build_object('revision', c.review_revision));
    elsif c.needs_resolution is null then
      update checkins set needs_resolution = 'coach_change_scope', updated_at = now() where id = c.id;
      insert into checkin_events (checkin_id, kind, detail) values (c.id, 'flagged', '{"reason":"coach_change_scope"}'::jsonb);
    end if;
  end loop;

  -- A narrower sharing choice made later: a review already handed over that
  -- the coach may no longer see is flagged, never reviewed blind.
  with narrowed as (
    update checkins c set needs_resolution = 'coach_change_scope', updated_at = now()
      where c.responsible_assignment_id = a.id and c.status in ('submitted', 'reopened') and c.needs_resolution is null
        and a.previous_provider_id is not null and c.created_at < a.effective_from
        and not (a.history_scope = 'full' or (a.history_scope = 'programme_and_logs' and not c.has_attachments))
      returning c.id
  )
  insert into checkin_events (checkin_id, kind, detail)
    select id, 'flagged', '{"reason":"coach_change_scope"}'::jsonb from narrowed;

  update checkin_schedules set ended_at = coalesce(ended_at, now()), updated_at = now()
    where enrollment_id = a.enrollment_id and assignment_id <> a.id and ended_at is null;
end;
$$;

create or replace function checkin_on_assignment ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.history_scope is distinct from old.history_scope then
    if new.effective_to is null then
      perform checkin_hand_over (new.id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enrollment_assignments_checkins on enrollment_assignments;
create trigger enrollment_assignments_checkins after insert or update of history_scope on enrollment_assignments
  for each row execute function checkin_on_assignment ();

-- TalentYak resolving a flag: close it (the client is told and can send a new
-- one to their new coach), or look again after the client changed what they
-- share. Admin only; nothing here reads an answer.
create or replace function resolve_checkin_flag (p_checkin uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c checkins;
  v_assignment uuid;
begin
  if not is_admin () then
    raise exception 'checkin_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  select * into c from checkins where id = p_checkin for update;
  if not found or c.needs_resolution is null then
    return 'nothing_to_resolve';
  end if;
  if p_action = 'recheck' then
    select id into v_assignment from enrollment_assignments where enrollment_id = c.enrollment_id and effective_to is null;
    if v_assignment is not null then
      update checkins set needs_resolution = null where id = c.id;
      perform checkin_hand_over (v_assignment);
      select * into c from checkins where id = p_checkin;
    end if;
    return case when c.needs_resolution is null and c.responsible_assignment_id = v_assignment then 'transferred' else 'still_flagged' end;
  elsif p_action = 'close' then
    update checkins set status = 'cancelled', status_reason = 'closed_after_coach_change', needs_resolution = null, updated_at = now()
      where id = c.id;
    insert into checkin_events (checkin_id, kind, actor_profile_id, detail)
      values (c.id, 'resolved', auth.uid (), '{"action":"close"}'::jsonb);
    perform queue_checkin_notice (c.id, 'closed', c.customer_id, 'closed', '{}'::jsonb);
    return 'closed';
  end if;
  raise exception 'checkin_resolution_invalid' using errcode = 'check_violation';
end;
$$;

-- What TalentYak sees: that something needs a person, never what was said.
create or replace function admin_checkin_attention ()
returns table (
  checkin_id uuid,
  reason text,
  client_name text,
  coach_name text,
  period_start date,
  period_end date,
  submitted_at timestamptz,
  away_until timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         case when c.needs_resolution is not null then c.needs_resolution else 'coach_away' end,
         coalesce(nullif(trim(cu.preferred_name), ''), split_part(coalesce(cu.full_name, ''), ' ', 1), 'Client'),
         p.display_name,
         c.period_start, c.period_end, c.last_submitted_at,
         case when cm.away_until > now() then cm.away_until end
  from checkins c
  join profiles cu on cu.id = c.customer_id
  join providers p on p.id = c.responsible_provider_id
  left join coach_messaging_profiles cm on cm.provider_id = p.id
  where is_admin ()
    and c.status in ('submitted', 'reopened')
    and (c.needs_resolution is not null or cm.away_until > now())
  order by c.last_submitted_at;
$$;

-- ---------------------------------------------------------------------------
-- 12. Reading for screens and the worker
-- ---------------------------------------------------------------------------

-- The coach's queue: everything they may read, with who is responsible and
-- when the coach said they would reply.
create or replace function coach_checkin_queue ()
returns table (
  checkin_id uuid,
  enrollment_id uuid,
  client_name text,
  period_start date,
  period_end date,
  due_at timestamptz,
  status text,
  first_submitted_at timestamptz,
  last_submitted_at timestamptz,
  current_revision int,
  review_revision int,
  feedback_published boolean,
  review_due timestamptz,
  responsible_name text,
  mine boolean,
  may_review boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.enrollment_id,
         coalesce(nullif(trim(cu.preferred_name), ''), split_part(coalesce(cu.full_name, ''), ' ', 1), 'Client'),
         c.period_start, c.period_end, c.due_at, c.status, c.first_submitted_at, c.last_submitted_at,
         c.current_revision, c.review_revision,
         exists (select 1 from checkin_feedback f where f.checkin_id = c.id and f.published_at is not null
                   and f.refers_to_revision >= coalesce(c.review_revision, 1)),
         checkin_review_due (c.id),
         p.display_name,
         p.profile_id = auth.uid (),
         checkin_coach_may_review (c.id, auth.uid ())
  from checkins c
  join profiles cu on cu.id = c.customer_id
  join providers p on p.id = c.responsible_provider_id
  where c.status in ('submitted', 'reviewed', 'reopened')
    and checkin_coach_may_read (c.id)
  order by c.last_submitted_at desc
  limit 500;
$$;

-- What the client (or coach) is told about when a review will come: the
-- coach's own words and working days, and any away period. Null for anyone
-- who may not read the check-in.
create or replace function checkin_review_expectation (p_checkin uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c checkins;
  r record;
begin
  select * into c from checkins where id = p_checkin;
  if not found or not (c.customer_id = auth.uid () or checkin_coach_may_read (c.id)) then
    return null;
  end if;
  select p.display_name, p.timezone, cm.working_hours, cm.response_expectation, cm.away_until, cm.away_note,
         sv.response_days, s.provider_id = c.responsible_provider_id as same_coach
    into r
    from providers p
    left join coach_messaging_profiles cm on cm.provider_id = p.id
    join checkin_schedule_versions sv on sv.id = c.schedule_version_id
    join checkin_schedules s on s.id = c.schedule_id
    where p.id = c.responsible_provider_id;
  return jsonb_build_object(
    'coach_name', r.display_name,
    'coach_timezone', r.timezone,
    'working_hours', coalesce(r.working_hours, '[]'::jsonb),
    'response_expectation', r.response_expectation,
    'response_days', case when r.same_coach then r.response_days end,
    'review_due', checkin_review_due (c.id),
    'away_until', case when r.away_until > now() then r.away_until end,
    'away_note', case when r.away_until > now() then r.away_note end,
    'may_finish_after_paid_time', checkin_review_exception (c.id, (select profile_id from providers where id = c.responsible_provider_id))
  );
end;
$$;

-- The worker's reminders. Timings come from the caller (the policy register,
-- checkin_reminders.v1); dedupe keys make every notice once-only, and the
-- sender rechecks it before it goes out.
create or replace function queue_checkin_reminders (
  p_due_soon_hours int,
  p_late_after_hours int,
  p_late_window_hours int,
  p_review_default_hours int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_n int := 0;
  v_due timestamptz;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  for r in
    select c.id, c.customer_id, c.due_at from checkins c
    join checkin_schedules s on s.id = c.schedule_id
    join profiles cu on cu.id = c.customer_id
    where c.status = 'open' and s.paused_at is null and s.ended_at is null and cu.suspended_at is null
      and now() between c.due_at - make_interval(hours => p_due_soon_hours) and c.due_at
      and coaching_is_live (c.enrollment_id)
  loop
    perform queue_checkin_notice (r.id, 'due_soon', r.customer_id, 'due_soon', jsonb_build_object('due_at', r.due_at));
    v_n := v_n + 1;
  end loop;

  for r in
    select c.id, c.customer_id, c.due_at from checkins c
    join checkin_schedules s on s.id = c.schedule_id
    join profiles cu on cu.id = c.customer_id
    where c.status = 'open' and s.paused_at is null and s.ended_at is null and cu.suspended_at is null
      and now() between c.due_at + make_interval(hours => p_late_after_hours) and c.due_at + make_interval(hours => p_late_window_hours)
      and coaching_is_live (c.enrollment_id)
  loop
    perform queue_checkin_notice (r.id, 'late', r.customer_id, 'late', jsonb_build_object('due_at', r.due_at));
    v_n := v_n + 1;
  end loop;

  for r in
    select c.id, c.review_revision, c.last_submitted_at, p.profile_id as coach from checkins c
    join providers p on p.id = c.responsible_provider_id
    where c.status in ('submitted', 'reopened') and c.needs_resolution is null
      and c.last_submitted_at > now() - interval '30 days'
  loop
    v_due := coalesce(checkin_review_due (r.id), r.last_submitted_at + make_interval(hours => p_review_default_hours));
    if now() > v_due and checkin_coach_may_review (r.id, r.coach) then
      perform queue_checkin_notice (r.id, 'review_overdue', r.coach, 'review_overdue:' || r.review_revision,
                                    jsonb_build_object('revision', r.review_revision));
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Grants
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  -- Signed-in people; each function checks who is calling.
  foreach fn in array array[
    'refresh_checkins(uuid)',
    'save_checkin_template(uuid, text, jsonb)',
    'archive_checkin_template(uuid, boolean)',
    'set_checkin_schedule(uuid, uuid, int, int, time, text, int)',
    'pause_checkin_schedule(uuid, text)',
    'resume_checkin_schedule(uuid)',
    'add_checkin_break(uuid, date, date, text)',
    'cancel_checkin_break(uuid)',
    'save_checkin_draft(uuid, jsonb, int, uuid)',
    'discard_checkin_draft(uuid)',
    'save_checkin_feedback(uuid, text, jsonb, uuid, boolean)',
    'discard_checkin_feedback(uuid)',
    'publish_checkin_feedback(uuid)',
    'complete_checkin_review(uuid)',
    'link_checkin_step(uuid, uuid, uuid)',
    'resolve_checkin_flag(uuid, text)',
    'admin_checkin_attention()',
    'coach_checkin_queue()',
    'checkin_review_expectation(uuid)',
    -- Used inside row-level security policies, so the reader needs them.
    'checkin_coach_may_read(uuid)',
    'checkin_attachment_readable(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;

  -- Our server only.
  foreach fn in array array[
    'materialize_checkins()',
    'submit_checkin(uuid, uuid, jsonb, uuid[], uuid, int, boolean, text, jsonb)',
    'checkin_notice_still_true(jsonb)',
    'queue_checkin_reminders(int, int, int, int)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  -- Internal: called only by the functions above.
  foreach fn in array array[
    'materialize_checkins_for(uuid)',
    'queue_checkin_notice(uuid, text, uuid, text, jsonb)',
    'checkin_hand_over(uuid)',
    'checkin_client_state(uuid, uuid)',
    'checkin_in_paid_time(uuid, timestamptz)',
    'checkin_review_exception(uuid, uuid)',
    'checkin_coach_may_review(uuid, uuid)',
    'checkin_expected_by(uuid, timestamptz, int)',
    'checkin_review_due(uuid)',
    'my_provider_for_checkins()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

notify pgrst, 'reload schema';
