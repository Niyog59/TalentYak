-- M11 · Coach-created workout and nutrition programmes.
--
-- What a coach prescribes, versioned. M12 records what the client did against
-- it; this file only defines the prescription and gives M12 stable references.
--
--   plan_templates          a coach's own reusable starting points
--   client_plans            one workout and one nutrition plan per coaching
--                           stint (enrollment × assignment)
--   client_plan_versions    draft → published; a published version never
--                           changes (AAF-PROG-10, AAF-DATA-03)
--   plan_session_moves      "this week, Monday's session moves to Tuesday" —
--                           schedule only, never the prescription
--   client_training_profiles / client_health_profiles
--                           what the client tells their coach for planning;
--                           health notes in their own table (invariant 3)
--
-- The rules that shape this file:
--
--   1. The coach decides what to prescribe and when it changes (AAF-PLAN-05).
--      No cadence, no approval step, no automatic replacement.
--   2. A template is COPIED into a client plan. The copy is independent: later
--      template edits never reach an assigned plan, and a plan never points
--      back to a template for its content.
--   3. Updates apply forward. A published version names the moment it takes
--      effect; the version in force at any moment is the latest published,
--      non-withdrawn version whose effective time has passed. Earlier versions
--      stay readable exactly as they were, and anything M12 records points at
--      the version it was performed against.
--   4. Access reuses the existing relationship rules, unchanged:
--        client          reads every published version of their own plans,
--                        forever (TY-ACCESS-04); never a draft
--        current coach   reads and writes their own plans while coaching is
--                        live (coaches_enrollment_now: a paused, suspended or
--                        ended relationship is read-only or closed)
--        incoming coach  reads an earlier coach's PUBLISHED versions only
--                        within the client's history_scope, and may start
--                        their own plan for this client from a copy
--                        (founder decision, 2026-09-27). Never into a
--                        template library. Private chat is untouched.
--        former coach    nothing
--        admin           nothing — plans are health records (invariant 3)
--   5. Clients are told when a version is published or a planned update is
--      cancelled, through the M08 outbox. Draft saves tell nobody.
--
-- The legacy `programs` / `program_days` / `exercises` tables (0007) are a
-- registered node and are left exactly as they are.

-- ---------------------------------------------------------------------------
-- 1. Content shape — the backstop. The application validates in detail.
-- ---------------------------------------------------------------------------

create or replace function plan_content_ok (p_kind text, c jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(
    jsonb_typeof(c) = 'object'
    and octet_length(c::text) <= 200000
    and case p_kind
      when 'workout' then
        c ->> 'schedule' in ('weekly', 'in_order')
        and jsonb_typeof(c -> 'sessions') = 'array'
        and jsonb_array_length(c -> 'sessions') <= 21
      when 'nutrition' then
        jsonb_typeof(coalesce(c -> 'meals', '[]'::jsonb)) = 'array'
        and jsonb_array_length(coalesce(c -> 'meals', '[]'::jsonb)) <= 12
      else false
    end,
    false);
$$;

-- Enough to hand to a client. Every mode of nutrition is optional; at least
-- one must be used.
create or replace function plan_content_publishable (p_kind text, c jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(
    plan_content_ok (p_kind, c)
    and case p_kind
      when 'workout' then jsonb_array_length(c -> 'sessions') >= 1
      when 'nutrition' then
        length(trim(coalesce(c ->> 'guidance', ''))) > 0
        or (jsonb_typeof(c -> 'targets') = 'object'
            and (c -> 'targets' ->> 'calories' is not null or c -> 'targets' ->> 'proteinG' is not null))
        or jsonb_array_length(coalesce(c -> 'meals', '[]'::jsonb)) > 0
      else false
    end,
    false);
$$;

-- ---------------------------------------------------------------------------
-- 2. Templates — the coach's own library
-- ---------------------------------------------------------------------------

create table if not exists plan_templates (
  id uuid primary key default gen_random_uuid (),
  provider_id uuid not null references providers (id) on delete cascade,
  kind text not null check (kind in ('workout', 'nutrition')),
  title text not null check (char_length(title) between 1 and 120),
  content jsonb not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_templates_content_ok check (plan_content_ok (kind, content))
);

create index if not exists plan_templates_provider_idx on plan_templates (provider_id, kind, updated_at desc);

drop trigger if exists plan_templates_touch on plan_templates;
create trigger plan_templates_touch before update on plan_templates
  for each row execute function touch_updated_at ();

alter table plan_templates enable row level security;
revoke delete, truncate on plan_templates from anon, authenticated;

-- Only the coach who owns it, while their account is in good standing. No
-- client, no other coach, no admin: a template is the coach's own work.
create policy "coach reads own templates" on plan_templates
  for select using (is_active_provider (provider_id));
create policy "coach creates own templates" on plan_templates
  for insert with check (is_active_provider (provider_id));
create policy "coach updates own templates" on plan_templates
  for update using (is_active_provider (provider_id)) with check (is_active_provider (provider_id));
-- No delete: archiving hides a template. Copies already made are unaffected
-- either way, because they are copies.

-- ---------------------------------------------------------------------------
-- 3. Client plans and their versions
-- ---------------------------------------------------------------------------

create table if not exists client_plans (
  id uuid primary key default gen_random_uuid (),
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  -- The coaching stint this plan belongs to. A new coach gets new plans; the
  -- previous coach's stay as they were, credited to them.
  assignment_id uuid not null references enrollment_assignments (id),
  provider_id uuid not null references providers (id),
  kind text not null check (kind in ('workout', 'nutrition')),
  created_at timestamptz not null default now()
);

create unique index if not exists client_plans_one_per_stint on client_plans (assignment_id, kind);
create index if not exists client_plans_enrollment_idx on client_plans (enrollment_id, kind, created_at desc);
create index if not exists client_plans_provider_idx on client_plans (provider_id);

alter table client_plans enable row level security;
revoke insert, update, delete, truncate on client_plans from anon, authenticated;

create table if not exists client_plan_versions (
  id uuid primary key default gen_random_uuid (),
  plan_id uuid not null references client_plans (id) on delete cascade,
  version int not null check (version > 0),
  title text not null check (char_length(title) between 1 and 120),
  content jsonb not null,

  -- Where this version's content was copied from, for the record only. The
  -- content itself is a copy and never follows its source.
  source_template_id uuid references plan_templates (id) on delete set null,
  source_version_id uuid references client_plan_versions (id) on delete set null,

  -- Set at publish. The moment this version starts to apply, chosen by the
  -- coach: now, or later. Never earlier than the publish itself.
  effective_from timestamptz,
  change_summary text check (change_summary is null or char_length(change_summary) <= 500),
  -- Whether the client was told. A minor correction may be published quietly;
  -- a first version and a meaningful change are always announced.
  notified boolean not null default true,

  published_at timestamptz,
  published_by uuid references profiles (id) on delete set null,
  -- A planned update cancelled before it took effect, or replaced by a newer
  -- one scheduled at or before it. Kept, never deleted.
  withdrawn_at timestamptz,
  withdrawn_by uuid references profiles (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint client_plan_versions_published_has_effect check (published_at is null or effective_from is not null),
  constraint client_plan_versions_effect_after_publish check (published_at is null or effective_from >= published_at - interval '1 minute'),
  constraint client_plan_versions_withdrawn_after_publish check (withdrawn_at is null or published_at is not null)
);

create unique index if not exists client_plan_versions_key on client_plan_versions (plan_id, version);
create unique index if not exists client_plan_versions_one_draft on client_plan_versions (plan_id) where published_at is null;
create index if not exists client_plan_versions_in_force_idx
  on client_plan_versions (plan_id, effective_from desc) where published_at is not null and withdrawn_at is null;
create index if not exists client_plan_versions_source_template_idx on client_plan_versions (source_template_id) where source_template_id is not null;
create index if not exists client_plan_versions_source_version_idx on client_plan_versions (source_version_id) where source_version_id is not null;
create index if not exists client_plan_versions_published_by_idx on client_plan_versions (published_by);
create index if not exists client_plan_versions_withdrawn_by_idx on client_plan_versions (withdrawn_by);

drop trigger if exists client_plan_versions_touch on client_plan_versions;
create trigger client_plan_versions_touch before update on client_plan_versions
  for each row execute function touch_updated_at ();

alter table client_plan_versions enable row level security;
revoke insert, update, delete, truncate on client_plan_versions from anon, authenticated;

-- The content check needs the plan's kind, which lives on the parent row.
create or replace function check_plan_version_content ()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_kind text;
begin
  select kind into v_kind from client_plans where id = new.plan_id;
  if not plan_content_ok (v_kind, new.content) then
    raise exception 'plan_content_invalid' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists client_plan_versions_content on client_plan_versions;
create trigger client_plan_versions_content before insert or update of content on client_plan_versions
  for each row execute function check_plan_version_content ();

-- A published version is history. Only a planned update that has not started
-- yet may be withdrawn, once; nothing else about it ever moves.
create or replace function freeze_published_plan_version ()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    -- Only as a consequence of the plan itself being deleted, which happens
    -- only when the whole relationship is. Nobody can delete one version.
    if old.published_at is not null and exists (select 1 from client_plans where id = old.plan_id) then
      raise exception 'plan_version_published' using
        errcode = 'restrict_violation',
        hint = 'A published plan version cannot be deleted.';
    end if;
    return old;
  end if;

  if old.published_at is null then
    return new;  -- still a draft
  end if;

  if (to_jsonb(new) - 'withdrawn_at' - 'withdrawn_by' - 'updated_at')
     is distinct from (to_jsonb(old) - 'withdrawn_at' - 'withdrawn_by' - 'updated_at') then
    raise exception 'plan_version_published' using
      errcode = 'restrict_violation',
      hint = 'A published plan version is immutable. Publish a new version instead.';
  end if;

  if new.withdrawn_at is distinct from old.withdrawn_at then
    if old.withdrawn_at is not null or new.withdrawn_at is null or old.effective_from <= now() then
      raise exception 'plan_version_in_effect' using
        errcode = 'restrict_violation',
        hint = 'Only a planned update that has not started yet can be cancelled.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists client_plan_versions_freeze on client_plan_versions;
create trigger client_plan_versions_freeze before update or delete on client_plan_versions
  for each row execute function freeze_published_plan_version ();

-- ---------------------------------------------------------------------------
-- 4. Who may read and write a plan
-- ---------------------------------------------------------------------------

-- The calling coach owns this plan's stint, the stint is open, and coaching is
-- live. The write gate for everything a coach does to a plan.
create or replace function plan_writable_by_me (p_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from client_plans cp
    join enrollment_assignments a on a.id = cp.assignment_id
    join providers p on p.id = a.provider_id
    where cp.id = p_plan
      and a.effective_to is null
      and p.profile_id = auth.uid ()
      and coaches_enrollment_now (cp.enrollment_id)
  );
$$;

-- May the caller read this plan, and are drafts included?
--   'all'        the current coach, on their own stint's plan (drafts too)
--   'published'  the client; or an incoming coach within history_scope
--   null         nobody else
create or replace function plan_access (p_plan uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from client_plans cp
      join enrollment_assignments a on a.id = cp.assignment_id
      join providers p on p.id = a.provider_id
      where cp.id = p_plan
        and a.effective_to is null
        and p.profile_id = auth.uid ()
        and coach_may_read_record (cp.enrollment_id, now(), false)
    ) then 'all'
    when exists (
      select 1 from client_plans cp
      where cp.id = p_plan
        and (enrollment_belongs_to_me (cp.enrollment_id)
             or coach_may_read_record (cp.enrollment_id, cp.created_at, false))
    ) then 'published'
    else null
  end;
$$;

revoke execute on function plan_writable_by_me (uuid) from public, anon;
revoke execute on function plan_access (uuid) from public, anon;
grant execute on function plan_writable_by_me (uuid) to authenticated, service_role;
grant execute on function plan_access (uuid) to authenticated, service_role;

create policy "participants read plans" on client_plans
  for select using (plan_access (id) is not null);

create policy "participants read plan versions" on client_plan_versions
  for select using (
    case plan_access (plan_id)
      when 'all' then true
      when 'published' then published_at is not null
      else false
    end
  );

-- ---------------------------------------------------------------------------
-- 5. Schedule moves — the prescription stays put
-- ---------------------------------------------------------------------------

create table if not exists plan_session_moves (
  id uuid primary key default gen_random_uuid (),
  plan_id uuid not null references client_plans (id) on delete cascade,
  version_id uuid not null references client_plan_versions (id) on delete cascade,
  session_key uuid not null,
  -- The Monday of the week the move applies to. One week only: the plan's own
  -- day is unchanged for every other week.
  week_start date not null check (extract(isodow from week_start) = 1),
  -- 0 = Monday … 6 = Sunday. Null puts it back on the planned day.
  to_day smallint check (to_day between 0 and 6),
  moved_by uuid references profiles (id) on delete set null,
  moved_by_role text not null check (moved_by_role in ('customer', 'coach')),
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists plan_session_moves_lookup_idx on plan_session_moves (plan_id, week_start, session_key, created_at desc);
create index if not exists plan_session_moves_version_idx on plan_session_moves (version_id);
create index if not exists plan_session_moves_moved_by_idx on plan_session_moves (moved_by);

alter table plan_session_moves enable row level security;
revoke insert, update, delete, truncate on plan_session_moves from anon, authenticated;

create policy "participants read moves" on plan_session_moves
  for select using (plan_access (plan_id) is not null);

-- ---------------------------------------------------------------------------
-- 6. Coach actions
-- ---------------------------------------------------------------------------

-- The calling coach's plan of this kind for this client, created on first use.
create or replace function ensure_my_client_plan (p_enrollment uuid, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment enrollment_assignments;
  v_id uuid;
begin
  if p_kind not in ('workout', 'nutrition') then
    raise exception 'plan_kind_invalid' using errcode = 'check_violation';
  end if;
  if not coaches_enrollment_now (p_enrollment) then
    raise exception 'plan_not_permitted' using errcode = 'insufficient_privilege';
  end if;

  select a.* into v_assignment from enrollment_assignments a
    join providers p on p.id = a.provider_id
    where a.enrollment_id = p_enrollment and a.effective_to is null and p.profile_id = auth.uid ();
  if not found then
    raise exception 'plan_not_permitted' using errcode = 'insufficient_privilege';
  end if;

  insert into client_plans (enrollment_id, assignment_id, provider_id, kind)
    values (p_enrollment, v_assignment.id, v_assignment.provider_id, p_kind)
    on conflict (assignment_id, kind) do nothing
    returning id into v_id;
  if v_id is null then
    select id into v_id from client_plans where assignment_id = v_assignment.id and kind = p_kind;
  end if;
  return v_id;
end;
$$;

create or replace function next_plan_version (p_plan uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(version), 0) + 1 from client_plan_versions where plan_id = p_plan;
$$;

revoke execute on function next_plan_version (uuid) from public, anon, authenticated;

-- Create or replace the single draft. Content arrives validated by the
-- application; the table's checks are the backstop.
create or replace function save_plan_draft (p_plan uuid, p_title text, p_content jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not plan_writable_by_me (p_plan) then
    raise exception 'plan_not_permitted' using errcode = 'insufficient_privilege';
  end if;

  update client_plan_versions set title = p_title, content = p_content
    where plan_id = p_plan and published_at is null
    returning id into v_id;
  if v_id is null then
    insert into client_plan_versions (plan_id, version, title, content)
      values (p_plan, next_plan_version (p_plan), p_title, p_content)
      returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Start a draft as an exact copy of a template (the coach's own) or of a
-- published version this coach may read: one of their own, or an earlier
-- coach's version of THIS client's plan, within the client's history_scope.
-- Copies content; never links to it.
create or replace function start_plan_draft_from (p_plan uuid, p_template uuid, p_version uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan client_plans;
  v_title text;
  v_content jsonb;
  v_id uuid;
begin
  if not plan_writable_by_me (p_plan) then
    raise exception 'plan_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if (p_template is null) = (p_version is null) then
    raise exception 'plan_source_required' using errcode = 'check_violation';
  end if;
  if exists (select 1 from client_plan_versions where plan_id = p_plan and published_at is null) then
    raise exception 'plan_draft_exists' using errcode = 'unique_violation';
  end if;

  select * into v_plan from client_plans where id = p_plan;

  if p_template is not null then
    select t.title, t.content into v_title, v_content
      from plan_templates t
      where t.id = p_template and t.provider_id = v_plan.provider_id
        and t.kind = v_plan.kind and t.archived_at is null;
  else
    select v.title, v.content into v_title, v_content
      from client_plan_versions v
      join client_plans src on src.id = v.plan_id
      where v.id = p_version
        and v.published_at is not null
        and src.kind = v_plan.kind
        and src.enrollment_id = v_plan.enrollment_id
        and plan_access (src.id) is not null;
  end if;

  if v_content is null then
    raise exception 'plan_source_unavailable' using errcode = 'insufficient_privilege';
  end if;

  insert into client_plan_versions (plan_id, version, title, content, source_template_id, source_version_id)
    values (p_plan, next_plan_version (p_plan), v_title, v_content, p_template, p_version)
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function discard_plan_draft (p_plan uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not plan_writable_by_me (p_plan) then
    raise exception 'plan_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  delete from client_plan_versions where plan_id = p_plan and published_at is null;
end;
$$;

create or replace function queue_plan_notice (p_version uuid, p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  select v.id, v.version, v.effective_from, cp.kind, cp.enrollment_id, cp.provider_id, e.customer_id
    into r
    from client_plan_versions v
    join client_plans cp on cp.id = v.plan_id
    join enrollments e on e.id = cp.enrollment_id
    where v.id = p_version;

  -- A summary and a link. Never what the plan says.
  perform enqueue_outbox (
    'email.plan_updated',
    jsonb_build_object(
      'event', p_event,
      'customer_id', r.customer_id,
      'provider_id', r.provider_id,
      'enrollment_id', r.enrollment_id,
      'version_id', r.id,
      'version', r.version,
      'kind', r.kind,
      'effective_from', r.effective_from
    ),
    'plan:' || r.id || ':' || p_event,
    now(),
    now() + interval '14 days'
  );
end;
$$;

revoke execute on function queue_plan_notice (uuid, text) from public, anon, authenticated;
grant execute on function queue_plan_notice (uuid, text) to service_role;

-- Publish the draft. `p_effective_from` null or in the past means now. A
-- meaningful change (p_notify) needs a summary the client will read; the first
-- version is always announced. Any planned update scheduled at or after the
-- new one's start is withdrawn — it would otherwise override a newer decision.
create or replace function publish_plan_draft (
  p_plan uuid,
  p_effective_from timestamptz,
  p_notify boolean,
  p_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan client_plans;
  v_draft client_plan_versions;
  v_effective timestamptz := greatest(coalesce(p_effective_from, now()), now());
  v_first boolean;
  v_notify boolean;
  v_summary text := nullif(trim(coalesce(p_summary, '')), '');
  v_withdrawn int;
begin
  if not plan_writable_by_me (p_plan) then
    raise exception 'plan_not_permitted' using errcode = 'insufficient_privilege';
  end if;

  select * into v_plan from client_plans where id = p_plan;
  select * into v_draft from client_plan_versions where plan_id = p_plan and published_at is null for update;
  if not found then
    raise exception 'plan_no_draft' using errcode = 'no_data_found';
  end if;
  if not plan_content_publishable (v_plan.kind, v_draft.content) then
    raise exception 'plan_not_publishable' using errcode = 'check_violation';
  end if;
  if v_effective > now() + interval '366 days' then
    raise exception 'plan_effective_too_far' using errcode = 'check_violation';
  end if;
  if v_summary is not null and char_length(v_summary) > 500 then
    raise exception 'plan_summary_too_long' using errcode = 'check_violation';
  end if;

  select not exists (select 1 from client_plan_versions where plan_id = p_plan and published_at is not null) into v_first;
  v_notify := v_first or coalesce(p_notify, true);
  if v_notify and not v_first and v_summary is null then
    raise exception 'plan_summary_required' using errcode = 'check_violation';
  end if;

  update client_plan_versions
    set withdrawn_at = now(), withdrawn_by = auth.uid ()
    where plan_id = p_plan and published_at is not null and withdrawn_at is null
      and effective_from > now() and effective_from >= v_effective;
  get diagnostics v_withdrawn = row_count;

  update client_plan_versions
    set published_at = now(), published_by = auth.uid (), effective_from = v_effective,
        change_summary = v_summary, notified = v_notify
    where id = v_draft.id;

  if v_notify then
    perform queue_plan_notice (v_draft.id, 'published');
  end if;

  return jsonb_build_object(
    'version_id', v_draft.id,
    'version', v_draft.version,
    'effective_from', v_effective,
    'notified', v_notify,
    'replaced_scheduled', v_withdrawn
  );
end;
$$;

-- Cancel a planned update before it starts. The client is told if they were
-- told about it in the first place.
create or replace function withdraw_scheduled_plan_version (p_version uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v client_plan_versions;
begin
  select * into v from client_plan_versions where id = p_version for update;
  if not found or not plan_writable_by_me (v.plan_id) then
    raise exception 'plan_not_permitted' using errcode = 'insufficient_privilege';
  end if;
  if v.published_at is null or v.withdrawn_at is not null or v.effective_from <= now() then
    raise exception 'plan_version_in_effect' using errcode = 'restrict_violation';
  end if;

  update client_plan_versions set withdrawn_at = now(), withdrawn_by = auth.uid () where id = p_version;
  if v.notified then
    perform queue_plan_notice (p_version, 'withdrawn');
  end if;
end;
$$;

-- Move one session to another day, for one week. The client may (it is their
-- week, and a pause never locks a client out of their own records —
-- TY-ACCESS-06), and so may the current coach while coaching is live.
create or replace function move_plan_session (
  p_plan uuid,
  p_version uuid,
  p_session_key uuid,
  p_week_start date,
  p_to_day smallint,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan client_plans;
  v_role text;
  v_content jsonb;
  v_id uuid;
begin
  select * into v_plan from client_plans where id = p_plan;
  if not found then
    raise exception 'plan_not_permitted' using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from enrollments e join profiles pr on pr.id = e.customer_id
    where e.id = v_plan.enrollment_id and e.customer_id = auth.uid () and pr.suspended_at is null
  ) then
    v_role := 'customer';
  elsif plan_writable_by_me (p_plan) then
    v_role := 'coach';
  else
    raise exception 'plan_not_permitted' using errcode = 'insufficient_privilege';
  end if;

  select content into v_content from client_plan_versions
    where id = p_version and plan_id = p_plan and published_at is not null and withdrawn_at is null;
  if v_content is null or v_content ->> 'schedule' <> 'weekly' or not exists (
    select 1 from jsonb_array_elements(v_content -> 'sessions') s
    where s ->> 'key' = p_session_key::text and jsonb_typeof(s -> 'day') = 'number'
  ) then
    raise exception 'plan_session_unknown' using errcode = 'no_data_found';
  end if;

  if p_week_start is null or extract(isodow from p_week_start) <> 1
     or p_week_start < current_date - 7 or p_week_start > current_date + 180 then
    raise exception 'plan_week_invalid' using errcode = 'check_violation';
  end if;
  if p_to_day is not null and (p_to_day < 0 or p_to_day > 6) then
    raise exception 'plan_week_invalid' using errcode = 'check_violation';
  end if;

  insert into plan_session_moves (plan_id, version_id, session_key, week_start, to_day, moved_by, moved_by_role, reason)
    values (p_plan, p_version, p_session_key, p_week_start, p_to_day, auth.uid (), v_role,
            nullif(left(trim(coalesce(p_reason, '')), 300), ''))
    returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function ensure_my_client_plan (uuid, text) from public, anon;
revoke execute on function save_plan_draft (uuid, text, jsonb) from public, anon;
revoke execute on function start_plan_draft_from (uuid, uuid, uuid) from public, anon;
revoke execute on function discard_plan_draft (uuid) from public, anon;
revoke execute on function publish_plan_draft (uuid, timestamptz, boolean, text) from public, anon;
revoke execute on function withdraw_scheduled_plan_version (uuid) from public, anon;
revoke execute on function move_plan_session (uuid, uuid, uuid, date, smallint, text) from public, anon;
grant execute on function ensure_my_client_plan (uuid, text) to authenticated;
grant execute on function save_plan_draft (uuid, text, jsonb) to authenticated;
grant execute on function start_plan_draft_from (uuid, uuid, uuid) to authenticated;
grant execute on function discard_plan_draft (uuid) to authenticated;
grant execute on function publish_plan_draft (uuid, timestamptz, boolean, text) to authenticated;
grant execute on function withdraw_scheduled_plan_version (uuid) to authenticated;
grant execute on function move_plan_session (uuid, uuid, uuid, date, smallint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. What the client tells their coach for planning
-- ---------------------------------------------------------------------------
--
-- Plan purchases collect no questionnaire, so the client fills this in and
-- keeps it up to date (founder decision, 2026-09-27). Health notes —
-- limitations and allergies — are their own table, like protected_intake:
-- the client and their CURRENT coach only. Never admin, never a former coach.

create table if not exists client_training_profiles (
  customer_id uuid primary key references profiles (id) on delete cascade,
  experience text check (experience in ('new', 'some', 'experienced')),
  experience_note text check (experience_note is null or char_length(experience_note) <= 500),
  equipment text[] not null default '{}'
    check (equipment <@ array['gym', 'dumbbells', 'barbell', 'kettlebells', 'bands', 'pullup_bar', 'bench', 'cardio_machine', 'none']::text[]),
  equipment_note text check (equipment_note is null or char_length(equipment_note) <= 500),
  session_minutes smallint check (session_minutes between 10 and 240),
  days_per_week smallint check (days_per_week between 1 and 7),
  food_preferences text check (food_preferences is null or char_length(food_preferences) <= 1000),
  local_foods text check (local_foods is null or char_length(local_foods) <= 1000),
  updated_at timestamptz not null default now()
);

create table if not exists client_health_profiles (
  customer_id uuid primary key references profiles (id) on delete cascade,
  limitations text check (limitations is null or char_length(limitations) <= 2000),
  allergies text check (allergies is null or char_length(allergies) <= 1000),
  updated_at timestamptz not null default now()
);

drop trigger if exists client_training_profiles_touch on client_training_profiles;
create trigger client_training_profiles_touch before update on client_training_profiles
  for each row execute function touch_updated_at ();
drop trigger if exists client_health_profiles_touch on client_health_profiles;
create trigger client_health_profiles_touch before update on client_health_profiles
  for each row execute function touch_updated_at ();

alter table client_training_profiles enable row level security;
alter table client_health_profiles enable row level security;
revoke delete, truncate on client_training_profiles from anon, authenticated;
revoke delete, truncate on client_health_profiles from anon, authenticated;

-- A coach currently coaching this person, on any live or paused relationship.
create or replace function coaches_customer_now (p_customer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from enrollments e
    where e.customer_id = p_customer and coach_may_read_record (e.id, now(), false)
  );
$$;

revoke execute on function coaches_customer_now (uuid) from public, anon;
grant execute on function coaches_customer_now (uuid) to authenticated, service_role;

create policy "client reads own training profile" on client_training_profiles
  for select using (customer_id = auth.uid ());
create policy "client creates own training profile" on client_training_profiles
  for insert with check (customer_id = auth.uid ());
create policy "client updates own training profile" on client_training_profiles
  for update using (customer_id = auth.uid ()) with check (customer_id = auth.uid ());
create policy "current coach reads training profile" on client_training_profiles
  for select using (coaches_customer_now (customer_id));

create policy "client reads own health profile" on client_health_profiles
  for select using (customer_id = auth.uid ());
create policy "client creates own health profile" on client_health_profiles
  for insert with check (customer_id = auth.uid ());
create policy "client updates own health profile" on client_health_profiles
  for update using (customer_id = auth.uid ()) with check (customer_id = auth.uid ());
create policy "current coach reads health profile" on client_health_profiles
  for select using (coaches_customer_now (customer_id));

-- ---------------------------------------------------------------------------
-- 8. Stable references for M12 logging
-- ---------------------------------------------------------------------------
--
-- A workout record points at the exact version and session it was performed
-- against, and a set at the exercise — or the alternative the client chose —
-- by its key. Keys survive from version to version while the coach keeps the
-- exercise, so progress compares like with like; an alternative has its own
-- key, so a goblet squat is never averaged into a back squat.

alter table workout_logs add column if not exists plan_version_id uuid references client_plan_versions (id);
alter table workout_logs add column if not exists session_key uuid;
alter table set_logs add column if not exists exercise_key uuid;
alter table set_logs add column if not exists alternative_key uuid;

create index if not exists workout_logs_plan_version_idx on workout_logs (plan_version_id) where plan_version_id is not null;
create index if not exists workout_logs_session_idx on workout_logs (enrollment_id, performed_at, session_key) where session_key is not null;
create index if not exists set_logs_workout_idx on set_logs (workout_log_id);
create index if not exists set_logs_exercise_key_idx on set_logs (exercise_key) where exercise_key is not null;

-- The session a key names in a version, or null.
create or replace function plan_version_session (p_version uuid, p_session_key uuid)
returns jsonb
language sql
stable
as $$
  select s from client_plan_versions v, jsonb_array_elements(v.content -> 'sessions') s
  where v.id = p_version and s ->> 'key' = p_session_key::text
  limit 1;
$$;

-- The exercise (or chosen alternative) a key names in a session, or null.
create or replace function plan_version_exercise (p_version uuid, p_session_key uuid, p_exercise_key uuid, p_alternative_key uuid default null)
returns jsonb
language sql
stable
as $$
  select case when p_alternative_key is null then e
         else (select a from jsonb_array_elements(coalesce(e -> 'alternatives', '[]'::jsonb)) a
               where a ->> 'key' = p_alternative_key::text limit 1) end
  from jsonb_array_elements(coalesce(plan_version_session (p_version, p_session_key) -> 'exercises', '[]'::jsonb)) e
  where e ->> 'key' = p_exercise_key::text
  limit 1;
$$;

-- A record may only point at a published version of a plan on its own
-- relationship, and at a session and exercise that version really contains.
create or replace function check_workout_log_reference ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.plan_version_id is null then
    if new.session_key is not null then
      raise exception 'workout_log_reference_invalid' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if not exists (
    select 1 from client_plan_versions v join client_plans cp on cp.id = v.plan_id
    where v.id = new.plan_version_id and v.published_at is not null
      and cp.kind = 'workout' and cp.enrollment_id = new.enrollment_id
  ) or new.session_key is null or plan_version_session (new.plan_version_id, new.session_key) is null then
    raise exception 'workout_log_reference_invalid' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists workout_logs_plan_reference on workout_logs;
create trigger workout_logs_plan_reference before insert or update of plan_version_id, session_key, enrollment_id on workout_logs
  for each row execute function check_workout_log_reference ();

create or replace function check_set_log_reference ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  w workout_logs;
begin
  if new.exercise_key is null then
    if new.alternative_key is not null then
      raise exception 'set_log_reference_invalid' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  select * into w from workout_logs where id = new.workout_log_id;
  if w.plan_version_id is null
     or plan_version_exercise (w.plan_version_id, w.session_key, new.exercise_key, new.alternative_key) is null then
    raise exception 'set_log_reference_invalid' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists set_logs_plan_reference on set_logs;
create trigger set_logs_plan_reference before insert or update of exercise_key, alternative_key, workout_log_id on set_logs
  for each row execute function check_set_log_reference ();

notify pgrst, 'reload schema';
