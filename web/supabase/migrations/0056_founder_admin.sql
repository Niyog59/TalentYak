-- M17 · Founder administration: feature controls, change history, support
-- operations, reporting, and the completed coach-change workflow.
--
-- Nothing here grants TalentYak new reach into private content. Health
-- records, progress photos and tracking values stay unreadable to
-- administrators (invariant 3, TY-PROG-02, TY-TRACK-07); conversations stay
-- behind the per-case grant (TY-MSG-04). Reports are counts and money totals
-- from the payment and ledger records, never from the browser.

-- ---------------------------------------------------------------------------
-- 1. Which environment this database is
-- ---------------------------------------------------------------------------

-- The database is labelled, not inferred: the deployment's own name says
-- nothing about which database it talks to, and today the production site
-- talks to a project shared with automated tests. A new production project
-- is labelled 'production' by hand when it is created (docs/operations).
create table if not exists platform_environment (
  id boolean primary key default true,
  kind text not null check (kind in ('test', 'production')),
  note text check (note is null or char_length(note) <= 300),
  updated_at timestamptz not null default now(),
  constraint platform_environment_singleton check (id)
);

alter table platform_environment enable row level security;
create policy "admin reads environment" on platform_environment
  for select using (is_admin ());

insert into platform_environment (id, kind, note)
values (true, 'test', 'Hosted project shared with automated tests. Not a launch database.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Change history — append-only
-- ---------------------------------------------------------------------------

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid (),
  actor_id uuid references profiles (id) on delete set null,
  action text not null check (char_length(action) between 3 and 80),
  subject_type text not null check (char_length(subject_type) between 2 and 40),
  subject_id text check (subject_id is null or char_length(subject_id) <= 80),
  reason text check (reason is null or char_length(reason) <= 1000),
  -- Only the fields that changed, and never private content: no message
  -- text, no health values, no payout account numbers.
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx on admin_audit_log (created_at desc);
create index if not exists admin_audit_log_subject_idx on admin_audit_log (subject_type, subject_id, created_at desc);
create index if not exists admin_audit_log_actor_idx on admin_audit_log (actor_id);

alter table admin_audit_log enable row level security;
create policy "admin reads audit log" on admin_audit_log
  for select using (is_admin ());

-- History is never rewritten. The one permitted change is the actor reference
-- becoming null when that account is deleted (the 0016 rule).
create or replace function guard_append_only ()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'append_only' using hint = 'History is kept; it cannot be deleted.';
  end if;
  if (to_jsonb (new) - 'actor_id') is distinct from (to_jsonb (old) - 'actor_id')
     or (new.actor_id is not null and new.actor_id is distinct from old.actor_id) then
    raise exception 'append_only' using hint = 'History is kept; it cannot be edited.';
  end if;
  return new;
end;
$$;

drop trigger if exists admin_audit_log_append_only on admin_audit_log;
create trigger admin_audit_log_append_only before update or delete on admin_audit_log
  for each row execute function guard_append_only ();

create or replace function write_admin_audit (
  p_action text, p_subject_type text, p_subject_id text, p_reason text, p_before jsonb, p_after jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into admin_audit_log (actor_id, action, subject_type, subject_id, reason, before, after)
  values (auth.uid (), p_action, p_subject_type, p_subject_id, left(nullif(btrim(coalesce(p_reason, '')), ''), 1000), p_before, p_after)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function write_admin_audit (text, text, text, text, jsonb, jsonb) from public, anon, authenticated;

-- For founder actions whose workflow function predates this log. The actor is
-- always the caller; an administrator can add to the history, never edit it.
create or replace function admin_record_audit (
  p_action text, p_subject_type text, p_subject_id text, p_reason text, p_before jsonb default null, p_after jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  return write_admin_audit (p_action, p_subject_type, p_subject_id, p_reason, p_before, p_after);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Feature controls
-- ---------------------------------------------------------------------------

-- One row per switchable product capability. Security, authentication,
-- authorisation, payments' live gate and this history are deliberately NOT
-- here: nothing on this list can turn them off.
create table if not exists feature_settings (
  key text primary key check (key in (
    'programmes', 'logging', 'check_ins', 'messaging', 'attachments', 'bookings',
    'calls', 'new_sales', 'public_profiles', 'waitlist', 'coach_changing')),
  mode text not null check (mode in ('on', 'read_only', 'off', 'test_only')),
  allowed_modes text[] not null,
  version int not null default 1 check (version >= 1),
  changed_by uuid references profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text check (reason is null or char_length(reason) <= 1000),
  constraint feature_settings_mode_allowed check (mode = any (allowed_modes))
);

create index if not exists feature_settings_changed_by_idx on feature_settings (changed_by);

alter table feature_settings enable row level security;
create policy "admin reads feature settings" on feature_settings
  for select using (is_admin ());

-- Launch defaults: everything that exists today stays as it is; changing
-- coach is off until the founder turns it on.
insert into feature_settings (key, mode, allowed_modes, reason) values
  ('programmes',      'on',  array['on', 'read_only', 'test_only'],        'Launch default'),
  ('logging',         'on',  array['on', 'read_only', 'test_only'],        'Launch default'),
  ('check_ins',       'on',  array['on', 'read_only', 'test_only'],        'Launch default'),
  ('messaging',       'on',  array['on', 'read_only', 'off', 'test_only'], 'Launch default'),
  ('attachments',     'on',  array['on', 'read_only', 'off', 'test_only'], 'Launch default'),
  ('bookings',        'on',  array['on', 'read_only', 'test_only'],        'Launch default'),
  ('calls',           'on',  array['on', 'off', 'test_only'],              'Launch default'),
  ('new_sales',       'on',  array['on', 'off', 'test_only'],              'Launch default'),
  ('public_profiles', 'on',  array['on', 'off'],                           'Launch default'),
  ('waitlist',        'on',  array['on', 'off'],                           'Launch default'),
  ('coach_changing',  'off', array['on', 'off', 'test_only'],              'Launch default: off until enough coaches and the open money decision is settled')
on conflict (key) do nothing;

create table if not exists feature_setting_changes (
  id uuid primary key default gen_random_uuid (),
  key text not null references feature_settings (key),
  from_mode text not null,
  to_mode text not null,
  reason text not null check (char_length(reason) between 3 and 1000),
  actor_id uuid references profiles (id) on delete set null,
  -- What the founder was shown before confirming: counts only.
  impact jsonb,
  restores_change_id uuid references feature_setting_changes (id),
  created_at timestamptz not null default now()
);

create index if not exists feature_setting_changes_key_idx on feature_setting_changes (key, created_at desc);
create index if not exists feature_setting_changes_actor_idx on feature_setting_changes (actor_id);
create index if not exists feature_setting_changes_restores_idx on feature_setting_changes (restores_change_id);

alter table feature_setting_changes enable row level security;
create policy "admin reads feature changes" on feature_setting_changes
  for select using (is_admin ());

drop trigger if exists feature_setting_changes_append_only on feature_setting_changes;
create trigger feature_setting_changes_append_only before update or delete on feature_setting_changes
  for each row execute function guard_append_only ();

-- The controlled test-account list. "Test accounts only" means these.
create table if not exists feature_test_accounts (
  profile_id uuid primary key references profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  added_by uuid references profiles (id) on delete set null,
  added_at timestamptz not null default now()
);

create index if not exists feature_test_accounts_added_by_idx on feature_test_accounts (added_by);

alter table feature_test_accounts enable row level security;
create policy "admin reads test accounts" on feature_test_accounts
  for select using (is_admin ());

-- Things a switch cannot decide. A mode listed here is refused until the
-- prerequisite is resolved — by a recorded founder decision applied as a
-- migration, never by the switch itself.
create table if not exists feature_prerequisites (
  key text primary key,
  feature_key text not null references feature_settings (key),
  blocks_mode text not null check (blocks_mode in ('on', 'read_only', 'off', 'test_only')),
  description text not null check (char_length(description) <= 1000),
  resolved boolean not null default false,
  resolved_note text,
  resolved_at timestamptz
);

create index if not exists feature_prerequisites_feature_idx on feature_prerequisites (feature_key);

alter table feature_prerequisites enable row level security;
create policy "admin reads prerequisites" on feature_prerequisites
  for select using (is_admin ());

insert into feature_prerequisites (key, feature_key, blocks_mode, description) values
  ('coach_change_money_policy', 'coach_changing', 'on',
   'OPEN-08: what happens to price differences, the part-used paid period, call allowances and any refund or credit when a client changes coach. Needs a founder decision before real clients can use it.')
on conflict (key) do nothing;

create or replace function is_feature_test_account (p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from feature_test_accounts where profile_id = p_profile);
$$;

create or replace function feature_mode (p_key text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  -- A missing row is off: an unknown switch never opens anything.
  select coalesce((select mode from feature_settings where key = p_key), 'off');
$$;

-- May new activity happen for this account (the client of the relationship,
-- or the acting account where there is no relationship)?
create or replace function feature_allows (p_key text, p_subject uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case feature_mode (p_key)
    when 'on' then true
    when 'test_only' then p_subject is not null and is_feature_test_account (p_subject)
    else false
  end;
$$;

create or replace function feature_allows_me (p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select feature_allows (p_key, auth.uid ());
$$;

-- Modes are not secret: pages read them to show the right thing.
create or replace function feature_modes ()
returns table (key text, mode text)
language sql
stable
security definer
set search_path = public
as $$
  select key, mode from feature_settings order by key;
$$;

create or replace function am_feature_test_account ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_feature_test_account (auth.uid ());
$$;

create or replace function feature_refuse (p_key text)
returns void
language plpgsql
as $$
begin
  raise exception 'feature_paused' using hint = case p_key
    when 'messaging' then 'Sending messages is paused by TalentYak for now. What you wrote has not been sent. Your earlier messages are still here.'
    when 'attachments' then 'Adding photos and clips is paused by TalentYak for now. You can still send text.'
    when 'bookings' then 'New session requests are paused by TalentYak for now. Sessions already confirmed go ahead, and you can still answer requests already waiting or cancel.'
    when 'calls' then 'Calls are unavailable right now. Please contact support if this affects a session.'
    when 'programmes' then 'Plan changes are paused by TalentYak for now. Current plans stay available to follow.'
    when 'check_ins' then 'New check-in schedules are paused by TalentYak for now. Check-ins already requested can still be sent and reviewed.'
    when 'new_sales' then 'New purchases are paused right now. Nothing has been charged. You can join the waitlist instead.'
    when 'waitlist' then 'The waitlist is closed right now.'
    when 'coach_changing' then 'Changing coach isn''t available right now. You can contact support about your coaching.'
    else 'This isn''t available right now.'
  end;
end;
$$;

revoke execute on function is_feature_test_account (uuid) from public, anon, authenticated;
revoke execute on function feature_allows (text, uuid) from public, anon, authenticated;
revoke execute on function feature_refuse (text) from public, anon, authenticated;
revoke execute on function feature_mode (text) from public;
grant execute on function feature_mode (text) to anon, authenticated, service_role;
revoke execute on function feature_modes () from public;
grant execute on function feature_modes () to anon, authenticated, service_role;
revoke execute on function feature_allows_me (text) from public, anon;
grant execute on function feature_allows_me (text) to authenticated, service_role;
revoke execute on function am_feature_test_account () from public, anon;
grant execute on function am_feature_test_account () to authenticated, service_role;
grant execute on function is_feature_test_account (uuid) to service_role;
grant execute on function feature_allows (text, uuid) to service_role;

-- The only writer of a feature setting. Refuses unsupported modes, unresolved
-- prerequisites and a stale screen (someone changed it since it was loaded).
create or replace function admin_set_feature_mode (
  p_key text,
  p_mode text,
  p_reason text,
  p_expected_version int,
  p_impact jsonb default null,
  p_restores uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s feature_settings%rowtype;
  v_change uuid;
  v_closed int := 0;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required' using hint = 'Say why — it is kept in the history.';
  end if;

  select * into s from feature_settings where key = p_key for update;
  if not found then
    raise exception 'not_found' using hint = 'That feature isn''t on the register.';
  end if;
  if s.version <> p_expected_version then
    raise exception 'stale_setting' using hint = 'This setting changed since the page was loaded. Reload and check it again.';
  end if;
  if not (p_mode = any (s.allowed_modes)) then
    raise exception 'invalid_mode' using hint = 'That mode isn''t supported for this feature.';
  end if;
  if p_mode = s.mode then
    raise exception 'no_change' using hint = 'It is already set that way.';
  end if;
  if exists (select 1 from feature_prerequisites where feature_key = p_key and blocks_mode = p_mode and not resolved) then
    raise exception 'feature_policy_unresolved'
      using hint = 'This mode needs a founder policy decision first. The switch cannot approve it.';
  end if;

  update feature_settings set
    mode = p_mode, version = version + 1, changed_by = auth.uid (), changed_at = now(), reason = btrim(p_reason)
  where key = p_key;

  insert into feature_setting_changes (key, from_mode, to_mode, reason, actor_id, impact, restores_change_id)
  values (p_key, s.mode, p_mode, btrim(p_reason), auth.uid (), p_impact, p_restores)
  returning id into v_change;

  -- Calls switched off is the one emergency stop that reaches work already
  -- under way: open rooms close through the normal closing job.
  if p_key = 'calls' and p_mode in ('off', 'test_only') then
    v_closed := close_calls_for_appointments (
      array(select a.id from appointments a join call_rooms r on r.appointment_id = a.id
            where r.state in ('pending', 'ready')
              and not (p_mode = 'test_only' and is_feature_test_account (a.customer_id))),
      'calls_switched_off');
  end if;

  perform write_admin_audit ('feature.set_mode', 'feature', p_key, p_reason,
    jsonb_build_object('mode', s.mode, 'version', s.version),
    jsonb_build_object('mode', p_mode, 'version', s.version + 1, 'restores', p_restores, 'rooms_closed', v_closed));

  return jsonb_build_object('change_id', v_change, 'version', s.version + 1, 'rooms_closed', v_closed);
end;
$$;

create or replace function admin_set_test_account (p_profile uuid, p_member boolean, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was boolean;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required' using hint = 'Say why this account is (or is no longer) a test account.';
  end if;
  if not exists (select 1 from profiles where id = p_profile) then
    raise exception 'not_found' using hint = 'That account was not found.';
  end if;
  v_was := is_feature_test_account (p_profile);
  if p_member and not v_was then
    insert into feature_test_accounts (profile_id, reason, added_by) values (p_profile, btrim(p_reason), auth.uid ());
  elsif not p_member and v_was then
    delete from feature_test_accounts where profile_id = p_profile;
  else
    return false;
  end if;
  perform write_admin_audit (case when p_member then 'test_account.add' else 'test_account.remove' end,
    'account', p_profile::text, p_reason, jsonb_build_object('test_account', v_was), jsonb_build_object('test_account', p_member));
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Enforcement below the screens
-- ---------------------------------------------------------------------------
--
-- A switch is checked by the page, again by the action, and finally here, so
-- an old browser tab, a direct API call or a background job cannot start
-- activity that is switched off. Existing records are never touched: these
-- are all BEFORE INSERT (or publish) checks.

create or replace function feature_guard_messages ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid;
begin
  if new.sender_role not in ('customer', 'coach') then
    return new; -- system cards follow the work that created them
  end if;
  select customer_id into v_customer from conversations where id = new.conversation_id;
  if not feature_allows ('messaging', v_customer) then
    perform feature_refuse ('messaging');
  end if;
  if (new.kind = 'attachment' or new.media_asset_id is not null) and not feature_allows ('attachments', v_customer) then
    perform feature_refuse ('attachments');
  end if;
  return new;
end;
$$;

drop trigger if exists messages_feature_guard on messages;
create trigger messages_feature_guard before insert on messages
  for each row execute function feature_guard_messages ();

create or replace function feature_guard_media ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid;
begin
  if new.purpose::text not in ('chat_attachment', 'checkin_attachment') then
    return new; -- progress and food photos are logging, checked by tracking_write_state
  end if;
  select customer_id into v_customer from enrollments where id = new.enrollment_id;
  if not feature_allows ('attachments', coalesce(v_customer, new.owner_profile_id)) then
    perform feature_refuse ('attachments');
  end if;
  return new;
end;
$$;

drop trigger if exists media_assets_feature_guard on media_assets;
create trigger media_assets_feature_guard before insert on media_assets
  for each row execute function feature_guard_media ();

-- New booking requests and suggestions. Confirmed sessions, agreed weekly
-- series and answering or cancelling what already exists are untouched.
create or replace function feature_guard_proposals ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not feature_allows ('bookings', new.customer_id) then
    perform feature_refuse ('bookings');
  end if;
  return new;
end;
$$;

drop trigger if exists appointment_proposals_feature_guard on appointment_proposals;
create trigger appointment_proposals_feature_guard before insert on appointment_proposals
  for each row execute function feature_guard_proposals ();

create or replace function feature_guard_call_passes ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid;
begin
  select customer_id into v_customer from appointments where id = new.appointment_id;
  if not feature_allows ('calls', v_customer) then
    perform feature_refuse ('calls');
  end if;
  return new;
end;
$$;

drop trigger if exists call_join_passes_feature_guard on call_join_passes;
create trigger call_join_passes_feature_guard before insert on call_join_passes
  for each row execute function feature_guard_call_passes ();

-- New check-in requests are simply not made while check-ins are paused (the
-- schedule carries on, with no backlog). New schedules are refused.
create or replace function feature_guard_checkins ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not feature_allows ('check_ins', new.customer_id) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists checkins_feature_guard on checkins;
create trigger checkins_feature_guard before insert on checkins
  for each row execute function feature_guard_checkins ();

create or replace function feature_guard_checkin_schedules ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid;
begin
  select customer_id into v_customer from enrollments where id = new.enrollment_id;
  if not feature_allows ('check_ins', v_customer) then
    perform feature_refuse ('check_ins');
  end if;
  return new;
end;
$$;

drop trigger if exists checkin_schedules_feature_guard on checkin_schedules;
create trigger checkin_schedules_feature_guard before insert on checkin_schedules
  for each row execute function feature_guard_checkin_schedules ();

-- Programmes: no new plans, drafts or publications. Following, reading,
-- moving a session and withdrawing a scheduled update are untouched.
create or replace function feature_guard_plans ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer uuid;
begin
  if tg_table_name = 'client_plans' then
    select customer_id into v_customer from enrollments where id = new.enrollment_id;
  else
    if tg_op = 'UPDATE' and not (old.published_at is null and new.published_at is not null) then
      return new;
    end if;
    select e.customer_id into v_customer
      from client_plans cp join enrollments e on e.id = cp.enrollment_id where cp.id = new.plan_id;
  end if;
  if not feature_allows ('programmes', v_customer) then
    perform feature_refuse ('programmes');
  end if;
  return new;
end;
$$;

drop trigger if exists client_plans_feature_guard on client_plans;
create trigger client_plans_feature_guard before insert on client_plans
  for each row execute function feature_guard_plans ();
drop trigger if exists client_plan_versions_feature_guard on client_plan_versions;
create trigger client_plan_versions_feature_guard before insert or update of published_at on client_plan_versions
  for each row execute function feature_guard_plans ();

create or replace function feature_guard_templates ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach uuid;
begin
  select profile_id into v_coach from providers where id = new.provider_id;
  if not feature_allows ('programmes', v_coach) then
    perform feature_refuse ('programmes');
  end if;
  return new;
end;
$$;

drop trigger if exists plan_templates_feature_guard on plan_templates;
create trigger plan_templates_feature_guard before insert on plan_templates
  for each row execute function feature_guard_templates ();

create or replace function feature_guard_by_customer ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- tg_argv[0] is the feature key.
  if not feature_allows (tg_argv[0], new.customer_id) then
    perform feature_refuse (tg_argv[0]);
  end if;
  return new;
end;
$$;

drop trigger if exists checkout_attempts_feature_guard on checkout_attempts;
create trigger checkout_attempts_feature_guard before insert on checkout_attempts
  for each row execute function feature_guard_by_customer ('new_sales');

drop trigger if exists coach_change_requests_feature_guard on coach_change_requests;
create trigger coach_change_requests_feature_guard before insert on coach_change_requests
  for each row execute function feature_guard_by_customer ('coach_changing');

create or replace function feature_guard_waitlist ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if feature_mode ('waitlist') <> 'on' then
    perform feature_refuse ('waitlist');
  end if;
  return new;
end;
$$;

drop trigger if exists waitlist_entries_feature_guard on waitlist_entries;
create trigger waitlist_entries_feature_guard before insert on waitlist_entries
  for each row execute function feature_guard_waitlist ();

-- Logging: one more answer from the tracking gate every save already asks.
-- The device keeps the entry and saves it when logging is back (TY-TRACK-03).
create or replace function tracking_write_state (p_enrollment uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when e.id is null then 'not_permitted'
    when not feature_allows ('logging', e.customer_id) then 'logging_paused'
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

-- ---------------------------------------------------------------------------
-- 5. Coach change, completed (AAF-OPS-01, AAF-TERM-04, TY-MSG-03, TY-PROG-01)
-- ---------------------------------------------------------------------------

alter table coach_change_requests
  -- What the client agreed the new coach may see from before. The founder
  -- can share less, never more.
  add column if not exists consented_history_scope text
    check (consented_history_scope is null or consented_history_scope in ('none', 'programme_and_logs', 'full')),
  add column if not exists withdrawn_at timestamptz;

create or replace function history_scope_rank (p_scope text)
returns int
language sql
immutable
as $$
  select case p_scope when 'none' then 0 when 'programme_and_logs' then 1 when 'full' then 2 else -1 end;
$$;

-- Can this coach take over this relationship? Approved and selling, in the
-- same service, accepting new clients, not away, and with a free place under
-- both their own limit and TalentYak's ceiling.
create or replace function coach_can_take_over (p_provider uuid, p_enrollment uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from providers np
    join enrollments e on e.id = p_enrollment
    join providers cp on cp.id = e.provider_id
    left join coach_messaging_profiles cm on cm.provider_id = np.id
    where np.id = p_provider
      and np.id <> e.provider_id
      and provider_can_sell (np.id)
      and np.vertical_slug = cp.vertical_slug
      and np.accepting_new_clients
      and (cm.away_until is null or cm.away_until <= now())
      and (least(np.max_active_clients, np.capacity_ceiling) is null
           or provider_commitments (np.id) < least(np.max_active_clients, np.capacity_ceiling))
  );
$$;

revoke execute on function coach_can_take_over (uuid, uuid) from public, anon, authenticated;
grant execute on function coach_can_take_over (uuid, uuid) to service_role;

-- The replacements a client may choose from: public coaches who can take
-- over and sell the same kind of service. Public profile facts only.
create or replace function coach_change_candidates (p_enrollment uuid)
returns table (provider_id uuid, display_name text, slug text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e enrollments%rowtype;
  v_service service_type;
begin
  select * into e from enrollments where id = p_enrollment;
  if not found or e.customer_id <> auth.uid () then
    return;
  end if;
  select service_type into v_service from purchases where id = e.purchase_id;
  return query
    select p.id, p.display_name, p.slug
    from providers p
    where provider_is_public (p.id)
      and coach_can_take_over (p.id, e.id)
      and exists (
        select 1 from offers o join offer_versions v on v.offer_id = o.id
        where o.provider_id = p.id and o.status = 'published'
          and v.published_at is not null and v.superseded_at is null
          and (v_service is null or v.service_type = v_service))
    order by p.display_name;
end;
$$;

drop function if exists request_coach_change (uuid, text, uuid);

create or replace function request_coach_change (
  p_enrollment_id uuid,
  p_reason text,
  p_preferred_provider_id uuid default null,
  p_history_scope text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  e enrollments%rowtype;
  v_id uuid;
begin
  -- The row lock makes two simultaneous requests for one relationship queue
  -- behind each other; the one-open-request index refuses the second.
  select * into e from enrollments where id = p_enrollment_id for update;
  if not found or e.customer_id <> auth.uid () then
    raise exception 'not_found' using hint = 'That coaching relationship was not found.';
  end if;
  if e.state not in ('active', 'paused') then
    raise exception 'relationship_ended' using hint = 'This coaching has ended.';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    raise exception 'reason_required' using hint = 'Tell us a little about why you''d like a change.';
  end if;
  if p_history_scope is not null and history_scope_rank (p_history_scope) < 0 then
    raise exception 'invalid_history_scope' using hint = 'Choose what your new coach may see.';
  end if;
  if p_preferred_provider_id is not null
     and not exists (select 1 from coach_change_candidates (e.id) c where c.provider_id = p_preferred_provider_id) then
    raise exception 'coach_not_eligible' using hint = 'That coach can''t take on a new client right now. Choose another, or let TalentYak suggest one.';
  end if;

  insert into coach_change_requests (enrollment_id, customer_id, current_provider_id, reason, preferred_provider_id, consented_history_scope)
    values (e.id, e.customer_id, e.provider_id, left(trim(p_reason), 2000), p_preferred_provider_id, p_history_scope)
    returning id into v_id;

  perform enqueue_outbox ('email.coach_change_requested',
    jsonb_build_object('request_id', v_id, 'customer_id', e.customer_id), 'coach_change_requested:' || v_id);

  return v_id;
exception
  when unique_violation then
    raise exception 'request_already_open' using hint = 'You already have a coach change request open.';
end;
$$;

-- A client may withdraw their own request while nobody has acted on it.
create or replace function withdraw_coach_change (p_request uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update coach_change_requests set state = 'withdrawn', withdrawn_at = now()
    where id = p_request and customer_id = auth.uid () and state = 'requested';
  return found;
end;
$$;

create or replace function admin_apply_coach_change (
  p_request_id uuid,
  p_new_provider_id uuid,
  p_effective_at timestamptz,
  p_history_scope text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r coach_change_requests%rowtype;
  e enrollments%rowtype;
  np providers%rowtype;
  v_effective timestamptz := coalesce(p_effective_at, now());
  v_cap text;
  v_held int;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required'
      using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if history_scope_rank (p_history_scope) < 0 then
    raise exception 'invalid_history_scope' using hint = 'Choose what the new coach may see.';
  end if;
  if v_effective < now() - interval '1 minute' then
    raise exception 'effective_in_past' using hint = 'A change cannot take effect in the past — that would rewrite who coached whom.';
  end if;

  select * into r from coach_change_requests where id = p_request_id for update;
  if not found or r.state <> 'requested' then
    raise exception 'request_not_open' using hint = 'This request has already been decided or withdrawn.';
  end if;

  -- Never share more than the client agreed to. A request from before the
  -- client was asked can share training and logs at most, never photos.
  v_cap := coalesce(r.consented_history_scope, 'programme_and_logs');
  if history_scope_rank (p_history_scope) > history_scope_rank (v_cap) then
    raise exception 'history_scope_exceeds_consent'
      using hint = 'The client agreed to share less than that. Choose the same or less.';
  end if;

  select * into e from enrollments where id = r.enrollment_id for update;
  if e.state not in ('active', 'paused') then
    raise exception 'relationship_ended' using hint = 'This coaching has ended, so there is nothing to move.';
  end if;
  if e.provider_id = p_new_provider_id then
    raise exception 'same_coach' using hint = 'Choose a different coach.';
  end if;

  -- Locked: two changes (or a checkout) cannot both take this coach's last place.
  select * into np from providers where id = p_new_provider_id for update;
  if not found or not coach_can_take_over (np.id, e.id) then
    raise exception 'coach_not_eligible'
      using hint = 'That coach can''t take this client now: not approved and selling, a different service, not accepting new clients, away, or full.';
  end if;

  update enrollment_assignments set effective_to = v_effective
    where enrollment_id = e.id and effective_to is null;

  insert into enrollment_assignments (enrollment_id, provider_id, previous_provider_id, effective_from,
                                      reason, requested_by, actioned_by, history_scope)
    values (e.id, np.id, e.provider_id, v_effective, left(r.reason, 500), r.customer_id, auth.uid (), p_history_scope);

  update enrollments set provider_id = np.id where id = e.id;

  update earning_states es set state = 'held', hold_reason = 'coach_change:' || r.id
    from ledger_entries le
    join billing_cycles bc on bc.id = le.billing_cycle_id
    where le.id = es.ledger_entry_id
      and le.purchase_id = e.purchase_id
      and le.account = 'coach_payable'
      and le.effect = 'service_earned'
      and es.state = 'pending'
      and bc.period_end > v_effective;
  get diagnostics v_held = row_count;

  if v_held > 0 then
    perform raise_exception_row (jsonb_build_object(
      'kind', 'coach_change_review', 'severity', 'warning',
      'purchase_id', e.purchase_id, 'provider_id', r.current_provider_id,
      'detail', format('Coach changed part-way through a paid period. %s earning(s) held for allocation between the previous and new coach.', v_held)));
  end if;

  update coach_change_requests set
    state = 'applied', new_provider_id = np.id, effective_at = v_effective, history_scope = p_history_scope,
    decision_note = p_note, decided_by = auth.uid (), decided_at = now()
  where id = r.id;

  perform enqueue_outbox ('email.coach_changed',
    jsonb_build_object('request_id', r.id, 'customer_id', r.customer_id,
                       'previous_provider_id', r.current_provider_id, 'new_provider_id', np.id,
                       'effective_at', v_effective),
    'coach_changed:' || r.id);

  perform write_admin_audit ('coach_change.apply', 'coach_change_request', r.id::text, p_note,
    jsonb_build_object('provider_id', r.current_provider_id, 'consented_history_scope', r.consented_history_scope),
    jsonb_build_object('provider_id', np.id, 'history_scope', p_history_scope, 'effective_at', v_effective, 'held_earnings', v_held));

  return jsonb_build_object('request_id', r.id, 'held_earnings', v_held, 'effective_at', v_effective);
end;
$$;

create or replace function admin_decline_coach_change (p_request_id uuid, p_note text)
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
  if nullif(trim(p_note), '') is null then
    raise exception 'reason_required' using hint = 'Tell the customer why.';
  end if;
  update coach_change_requests set state = 'declined', decision_note = p_note, decided_by = auth.uid (), decided_at = now()
    where id = p_request_id and state = 'requested';
  if not found then
    raise exception 'request_not_open' using hint = 'This request has already been decided or withdrawn.';
  end if;
  perform write_admin_audit ('coach_change.decline', 'coach_change_request', p_request_id::text, p_note, null, null);
  return 'declined';
end;
$$;

-- What applying a change would touch, before anyone confirms it. Counts and
-- totals only — never the content of a plan, a check-in or a message.
create or replace function admin_coach_change_preview (p_request uuid, p_new_provider uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r coach_change_requests%rowtype;
  e enrollments%rowtype;
  pu purchases%rowtype;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  select * into r from coach_change_requests where id = p_request;
  if not found then
    raise exception 'not_found' using hint = 'That request was not found.';
  end if;
  select * into e from enrollments where id = r.enrollment_id;
  select * into pu from purchases where id = e.purchase_id;

  return jsonb_build_object(
    'relationship_state', e.state,
    'paid_through_at', pu.paid_through_at,
    'purchase_state', pu.state,
    'charge_amount_minor', pu.charge_amount_minor,
    'charge_currency', pu.charge_currency,
    'calls_included_per_month', pu.inclusions_snapshot -> 'calls_included_per_month',
    'consented_history_scope', r.consented_history_scope,
    'upcoming_sessions', (select count(*) from appointments a
                            where a.enrollment_id = e.id and a.provider_id = e.provider_id
                              and a.state in ('booked', 'tentative', 'on_hold') and a.starts_at > now()),
    'pending_requests', (select count(*) from appointment_proposals p
                           where p.enrollment_id = e.id and p.provider_id = e.provider_id and p.state = 'pending'),
    'weekly_series', (select count(*) from appointment_series s
                        where s.enrollment_id = e.id and s.provider_id = e.provider_id and s.state = 'active'),
    'unfinished_reviews', (select count(*) from checkins c
                             where c.enrollment_id = e.id and c.responsible_provider_id = e.provider_id
                               and c.status in ('submitted', 'reopened')),
    'unfinished_reviews_with_attachments', (select count(*) from checkins c
                             where c.enrollment_id = e.id and c.responsible_provider_id = e.provider_id
                               and c.status in ('submitted', 'reopened') and c.has_attachments),
    'open_checkin_requests', (select count(*) from checkins c
                                where c.enrollment_id = e.id and c.responsible_provider_id = e.provider_id and c.status = 'open'),
    'published_plans', (select count(distinct cp.id) from client_plans cp join client_plan_versions v on v.plan_id = cp.id
                          where cp.enrollment_id = e.id and cp.provider_id = e.provider_id and v.published_at is not null),
    'unfinished_period_earnings', coalesce((
      select jsonb_agg(jsonb_build_object('currency', x.currency, 'amount_minor', x.amount, 'entries', x.n))
      from (select le.currency, sum(le.amount_minor) as amount, count(*) as n
            from ledger_entries le join earning_states es on es.ledger_entry_id = le.id
            join billing_cycles bc on bc.id = le.billing_cycle_id
            where le.purchase_id = e.purchase_id and le.account = 'coach_payable' and le.effect = 'service_earned'
              and es.state = 'pending' and bc.period_end > now()
            group by le.currency) x), '[]'::jsonb),
    'new_coach_eligible', case when p_new_provider is null then null else coach_can_take_over (p_new_provider, e.id) end,
    'preferred_eligible', case when r.preferred_provider_id is null then null else coach_can_take_over (r.preferred_provider_id, e.id) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Support operations: owner, internal notes, history
-- ---------------------------------------------------------------------------

alter table support_cases add column if not exists owner_id uuid references profiles (id) on delete set null;
create index if not exists support_cases_owner_idx on support_cases (owner_id);

create table if not exists support_case_notes (
  id uuid primary key default gen_random_uuid (),
  case_id uuid not null references support_cases (id) on delete cascade,
  author_id uuid references profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists support_case_notes_case_idx on support_case_notes (case_id, created_at);
create index if not exists support_case_notes_author_idx on support_case_notes (author_id);

alter table support_case_notes enable row level security;
-- Internal: administrators only. The reporter never sees these.
create policy "admin reads case notes" on support_case_notes
  for select using (is_admin ());

create table if not exists support_case_events (
  id uuid primary key default gen_random_uuid (),
  case_id uuid not null references support_cases (id) on delete cascade,
  actor_id uuid references profiles (id) on delete set null,
  kind text not null check (kind in ('opened', 'state_changed', 'owner_changed', 'note_added')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists support_case_events_case_idx on support_case_events (case_id, created_at);
create index if not exists support_case_events_actor_idx on support_case_events (actor_id);

alter table support_case_events enable row level security;
create policy "admin reads case events" on support_case_events
  for select using (is_admin ());

create or replace function support_case_history ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into support_case_events (case_id, actor_id, kind, detail)
      values (new.id, auth.uid (), 'opened', jsonb_build_object('category', new.category));
    return new;
  end if;
  if new.state is distinct from old.state then
    insert into support_case_events (case_id, actor_id, kind, detail)
      values (new.id, auth.uid (), 'state_changed', jsonb_build_object('from', old.state, 'to', new.state));
  end if;
  if new.owner_id is distinct from old.owner_id then
    insert into support_case_events (case_id, actor_id, kind, detail)
      values (new.id, auth.uid (), 'owner_changed', jsonb_build_object('from', old.owner_id, 'to', new.owner_id));
  end if;
  return new;
end;
$$;

drop trigger if exists support_cases_history on support_cases;
create trigger support_cases_history after insert or update of state, owner_id on support_cases
  for each row execute function support_case_history ();

create or replace function admin_assign_support_case (p_case uuid, p_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if p_owner is not null and not exists (select 1 from profiles where id = p_owner and role = 'admin' and suspended_at is null) then
    raise exception 'invalid_owner' using hint = 'A case can only be owned by an administrator.';
  end if;
  update support_cases set owner_id = p_owner where id = p_case;
  return found;
end;
$$;

create or replace function admin_add_support_note (p_case uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) < 1 then
    raise exception 'reason_required' using hint = 'Write the note first.';
  end if;
  if not exists (select 1 from support_cases where id = p_case) then
    raise exception 'not_found' using hint = 'That case was not found.';
  end if;
  insert into support_case_notes (case_id, author_id, body) values (p_case, auth.uid (), left(btrim(p_body), 4000))
    returning id into v_id;
  insert into support_case_events (case_id, actor_id, kind, detail) values (p_case, auth.uid (), 'note_added', '{}'::jsonb);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Accounts: suspension through a recorded path, and sign-in counting
-- ---------------------------------------------------------------------------

-- Clients only. A coach is suspended from their coach page, which also closes
-- their profile and sales; an administrator is never suspended from here, so
-- the founder cannot lock themselves out.
create or replace function admin_set_account_suspension (p_profile uuid, p_suspend boolean, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  p profiles%rowtype;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'reason_required' using hint = 'Record why — it is kept in the history.';
  end if;
  select * into p from profiles where id = p_profile for update;
  if not found then
    raise exception 'not_found' using hint = 'That account was not found.';
  end if;
  if p.role = 'admin' then
    raise exception 'use_trusted_process' using hint = 'Administrator accounts are changed only through the documented founder-access process.';
  end if;
  if exists (select 1 from providers where profile_id = p_profile and status <> 'retired') then
    raise exception 'use_coach_workflow' using hint = 'This account is a coach. Suspend or reinstate them from their coach page, which also handles their profile, sales and clients.';
  end if;
  if p_suspend = (p.suspended_at is not null) then
    return false;
  end if;

  update profiles set
    suspended_at = case when p_suspend then now() else null end,
    suspended_reason = case when p_suspend then left(btrim(p_reason), 500) else null end
  where id = p_profile;

  perform write_admin_audit (case when p_suspend then 'account.suspend' else 'account.reinstate' end,
    'account', p_profile::text, p_reason,
    jsonb_build_object('suspended', p.suspended_at is not null),
    jsonb_build_object('suspended', p_suspend));
  return true;
end;
$$;

create table if not exists sign_in_events (
  id uuid primary key default gen_random_uuid (),
  profile_id uuid not null references profiles (id) on delete cascade,
  signed_in_at timestamptz not null default now()
);

create index if not exists sign_in_events_profile_idx on sign_in_events (profile_id, signed_in_at desc);
create index if not exists sign_in_events_time_idx on sign_in_events (signed_in_at);

alter table sign_in_events enable row level security;
-- Deny-all: written by the server after a successful sign-in, read only
-- through the admin report functions.

create or replace function record_sign_in (p_profile uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;
  insert into sign_in_events (profile_id) values (p_profile);
end;
$$;

revoke execute on function record_sign_in (uuid) from public, anon, authenticated;
grant execute on function record_sign_in (uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Reporting — authoritative records only
-- ---------------------------------------------------------------------------

-- Test activity: a reserved test address, an account on the test list, or
-- (for money) a purchase with no live-mode Stripe event behind it.
create or replace function is_test_profile (p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.email ~* '@[^@]*\.(test|invalid|example|localhost)$' or p.email ~* '@example\.(com|org|net)$'
    from profiles p where p.id = p_profile), false)
    or is_feature_test_account (p_profile);
$$;

create or replace function purchase_is_live (p_purchase uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from ledger_entries le join provider_events pe on pe.id = le.source_event_id
    where le.purchase_id = p_purchase and pe.livemode)
    and not exists (select 1 from purchases pu where pu.id = p_purchase and (is_test_profile (pu.customer_id)));
$$;

revoke execute on function is_test_profile (uuid) from public, anon, authenticated;
revoke execute on function purchase_is_live (uuid) from public, anon, authenticated;

create or replace function admin_overview_metrics (p_from timestamptz, p_to timestamptz, p_tz text, p_include_test boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text := coalesce(nullif(p_tz, ''), 'UTC');
  v jsonb;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'invalid_range' using hint = 'Choose a range of up to 400 days.';
  end if;
  perform now() at time zone v_tz; -- rejects an unknown zone

  with
  live_purchases as (
    select pu.id, pu.customer_id, pu.state, pu.cancelled_at, pu.paid_through_at,
           (p_include_test or purchase_is_live (pu.id)) as counted
    from purchases pu
  ),
  cycles as (
    select bc.currency, bc.amount_minor, bc.paid_at
    from billing_cycles bc join live_purchases lp on lp.id = bc.purchase_id
    where lp.counted and bc.paid_at >= p_from and bc.paid_at < p_to
  ),
  refunds_in as (
    select r.currency, r.amount_minor from refunds r join live_purchases lp on lp.id = r.purchase_id
    where lp.counted and r.state = 'succeeded' and r.settled_at >= p_from and r.settled_at < p_to
  ),
  ledger_in as (
    select le.account, le.effect, le.currency, le.amount_minor
    from ledger_entries le left join live_purchases lp on lp.id = le.purchase_id
    where le.occurred_at >= p_from and le.occurred_at < p_to
      and (lp.id is null or lp.counted)
      and (p_include_test or le.provider_id is null
           or not exists (select 1 from providers pr where pr.id = le.provider_id and is_test_profile (pr.profile_id)))
  ),
  owed as (
    select es.currency, es.state, sum(le.amount_minor) as amount
    from earning_states es join ledger_entries le on le.id = es.ledger_entry_id
    left join live_purchases lp on lp.id = le.purchase_id
    join providers pr on pr.id = es.provider_id
    where es.state in ('pending', 'held', 'eligible', 'batched')
      and (lp.id is null or lp.counted)
      and (p_include_test or not is_test_profile (pr.profile_id))
    group by es.currency, es.state
  ),
  payouts_in as (
    select i.currency, i.amount_minor from payout_batch_items i join providers pr on pr.id = i.provider_id
    where i.state = 'paid' and i.paid_at >= p_from and i.paid_at < p_to
      and (p_include_test or not is_test_profile (pr.profile_id))
  ),
  days as (
    select d::date as day
    from generate_series((p_from at time zone v_tz)::date, ((p_to - interval '1 second') at time zone v_tz)::date, interval '1 day') d
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', v_tz, 'include_test', p_include_test),
    'accounts_new', (select count(*) from profiles p where p.created_at >= p_from and p.created_at < p_to
                       and (p_include_test or not is_test_profile (p.id))),
    'sign_ins_distinct', (select count(distinct s.profile_id) from sign_in_events s
                            where s.signed_in_at >= p_from and s.signed_in_at < p_to
                              and (p_include_test or not is_test_profile (s.profile_id))),
    'sign_ins_counted_since', (select min(signed_in_at) from sign_in_events),
    'active_paying_clients_now', (select count(distinct lp.customer_id) from live_purchases lp
                                    where lp.counted and lp.state in ('active', 'cancelling', 'past_due')
                                      and lp.paid_through_at > now()),
    'cancellation_requests', (select count(*) from live_purchases lp
                                where lp.counted and lp.cancelled_at >= p_from and lp.cancelled_at < p_to),
    'coaching_ended', (select count(*) from enrollments en left join live_purchases lp on lp.id = en.purchase_id
                         where en.ended_at >= p_from and en.ended_at < p_to and (lp.id is null or lp.counted)
                           and (p_include_test or not is_test_profile (en.customer_id))),
    'failed_renewals', (select count(*) from provider_events pe
                          where pe.event_type = 'invoice.payment_failed'
                            and coalesce(pe.occurred_at, pe.received_at) >= p_from and coalesce(pe.occurred_at, pe.received_at) < p_to
                            and (p_include_test or pe.livemode)),
    'past_due_now', (select count(*) from live_purchases lp where lp.counted and lp.state = 'past_due'),
    'collected', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount, 'payments', n) order by currency)
                  from (select currency, sum(amount_minor) as amount, count(*) as n from cycles group by currency) x), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount, 'refunds', n) order by currency)
                  from (select currency, sum(amount_minor) as amount, count(*) as n from refunds_in group by currency) x), '[]'::jsonb),
    'commission', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount) order by currency)
                  from (select currency, sum(amount_minor) as amount from ledger_in where account = 'platform_revenue' group by currency) x), '[]'::jsonb),
    'coach_earnings', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount) order by currency)
                  from (select currency, sum(amount_minor) as amount from ledger_in where account = 'coach_payable' and effect <> 'payout' group by currency) x), '[]'::jsonb),
    'platform_subsidies', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount) order by currency)
                  from (select currency, sum(amount_minor) as amount from ledger_in where account = 'platform_subsidy' group by currency) x), '[]'::jsonb),
    'fees', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount) order by currency)
                  from (select currency, sum(amount_minor) as amount from ledger_in where account = 'processing_expense' group by currency) x), '[]'::jsonb),
    'fees_ever_recorded', exists (select 1 from ledger_entries where account = 'processing_expense'),
    'coach_owed_now', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'state', state, 'amount_minor', amount) order by currency, state)
                  from owed), '[]'::jsonb),
    'payouts_recorded', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'amount_minor', amount, 'items', n) order by currency)
                  from (select currency, sum(amount_minor) as amount, count(*) as n from payouts_in group by currency) x), '[]'::jsonb),
    'excluded_test_purchases', (select count(*) from live_purchases lp where not lp.counted),
    'series', (select coalesce(jsonb_agg(jsonb_build_object(
                  'day', d.day,
                  'accounts', (select count(*) from profiles p where (p.created_at at time zone v_tz)::date = d.day
                                 and p.created_at >= p_from and p.created_at < p_to and (p_include_test or not is_test_profile (p.id))),
                  'sign_ins', (select count(distinct s.profile_id) from sign_in_events s where (s.signed_in_at at time zone v_tz)::date = d.day
                                 and s.signed_in_at >= p_from and s.signed_in_at < p_to and (p_include_test or not is_test_profile (s.profile_id))),
                  'collected', coalesce((select jsonb_object_agg(currency, amount) from (
                                 select c.currency, sum(c.amount_minor) as amount from cycles c
                                 where (c.paid_at at time zone v_tz)::date = d.day group by c.currency) y), '{}'::jsonb)
                ) order by d.day), '[]'::jsonb) from days d)
  ) into v;
  return v;
end;
$$;

-- Global search: who and what, never private content.
create or replace function admin_search (p_q text)
returns table (kind text, id uuid, label text, detail text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := left(btrim(coalesce(p_q, '')), 100);
  v_like text;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if char_length(v_q) < 2 then
    return;
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    (select 'account'::text, p.id, coalesce(nullif(p.full_name, ''), p.email), p.email || ' · ' || p.role::text
       from profiles p where p.email ilike v_like or p.full_name ilike v_like or p.id::text = v_q
       order by p.created_at desc limit 15)
    union all
    (select 'coach'::text, pr.id, pr.display_name, pr.status::text || coalesce(' · /' || pr.slug, '')
       from providers pr where pr.display_name ilike v_like or pr.slug ilike v_like or pr.id::text = v_q
       limit 10)
    union all
    (select 'purchase'::text, pu.id, 'Purchase ' || left(pu.id::text, 8), pu.state::text || ' · ' || pu.charge_currency
       from purchases pu where pu.id::text like v_q || '%' and char_length(v_q) >= 6 limit 5)
    union all
    (select 'support_case'::text, sc.id, 'Support case ' || left(sc.id::text, 8), sc.category || ' · ' || sc.state
       from support_cases sc where sc.id::text like v_q || '%' and char_length(v_q) >= 6 limit 5)
    union all
    (select 'coach_change'::text, cr.id, 'Coach change ' || left(cr.id::text, 8), cr.state
       from coach_change_requests cr where cr.id::text like v_q || '%' and char_length(v_q) >= 6 limit 5);
end;
$$;

create or replace function admin_accounts (p_q text, p_role text, p_status text, p_limit int, p_offset int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_q text := left(btrim(coalesce(p_q, '')), 100);
  v_like text := '%' || replace(replace(replace(left(btrim(coalesce(p_q, '')), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v jsonb;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;

  with filtered as (
    select p.id, p.email, p.full_name, p.role::text as role, p.created_at, p.suspended_at, p.timezone,
           p.terms_version, pr.id as provider_id, pr.status::text as provider_status,
           is_test_profile (p.id) as is_test, is_feature_test_account (p.id) as on_test_list,
           (select max(signed_in_at) from sign_in_events s where s.profile_id = p.id) as last_sign_in
    from profiles p left join providers pr on pr.profile_id = p.id
    where (v_q = '' or p.email ilike v_like or p.full_name ilike v_like)
      and (p_role is null or p_role = '' or (p_role = 'coach' and pr.id is not null) or p.role::text = p_role)
      and (p_status is null or p_status = ''
           or (p_status = 'suspended' and p.suspended_at is not null)
           or (p_status = 'active' and p.suspended_at is null)
           or (p_status = 'onboarding' and (p.timezone is null or p.terms_version is null))
           or (p_status = 'test' and is_test_profile (p.id))
           or (p_status = 'real' and not is_test_profile (p.id)))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(to_jsonb (f) order by f.created_at desc)
                      from (select * from filtered order by created_at desc limit v_limit offset v_offset) f), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;

-- One account, as TalentYak may see it: identity, roles, state, relationships
-- and records — never health data, messages or media.
create or replace function admin_account_detail (p_profile uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  select jsonb_build_object(
    'profile', jsonb_build_object('id', p.id, 'email', p.email, 'full_name', p.full_name, 'preferred_name', p.preferred_name,
       'role', p.role, 'timezone', p.timezone, 'created_at', p.created_at, 'suspended_at', p.suspended_at,
       'suspended_reason', p.suspended_reason, 'terms_version', p.terms_version, 'terms_accepted_at', p.terms_accepted_at,
       'privacy_version', p.privacy_version, 'display_currency', p.display_currency),
    'email_confirmed', (select u.email_confirmed_at is not null from auth.users u where u.id = p.id),
    'mfa_factors', (select count(*) from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified'),
    'is_test', is_test_profile (p.id),
    'on_test_list', is_feature_test_account (p.id),
    'last_sign_in', (select max(signed_in_at) from sign_in_events s where s.profile_id = p.id),
    'provider', (select jsonb_build_object('id', pr.id, 'status', pr.status, 'display_name', pr.display_name, 'slug', pr.slug,
                   'published_at', pr.published_at, 'suspended_at', pr.suspended_at, 'accepting_new_clients', pr.accepting_new_clients)
                 from providers pr where pr.profile_id = p.id),
    'relationships', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'state', e.state, 'started_at', e.started_at,
                   'ended_at', e.ended_at, 'purchase_id', e.purchase_id, 'coach', pr.display_name, 'provider_id', pr.id)
                   order by e.started_at desc)
                 from enrollments e join providers pr on pr.id = e.provider_id where e.customer_id = p.id), '[]'::jsonb),
    'clients_as_coach', (select count(*) from enrollments e join providers pr on pr.id = e.provider_id
                         where pr.profile_id = p.id and e.state in ('active', 'paused')),
    'purchases', coalesce((select jsonb_agg(jsonb_build_object('id', pu.id, 'state', pu.state, 'amount_minor', pu.charge_amount_minor,
                   'currency', pu.charge_currency, 'created_at', pu.created_at, 'paid_through_at', pu.paid_through_at)
                   order by pu.created_at desc)
                 from purchases pu where pu.customer_id = p.id), '[]'::jsonb),
    'support_cases', coalesce((select jsonb_agg(jsonb_build_object('id', sc.id, 'category', sc.category, 'state', sc.state,
                   'created_at', sc.created_at) order by sc.created_at desc)
                 from support_cases sc where sc.reporter_profile_id = p.id), '[]'::jsonb),
    'coach_changes', coalesce((select jsonb_agg(jsonb_build_object('id', cr.id, 'state', cr.state, 'created_at', cr.created_at)
                   order by cr.created_at desc)
                 from coach_change_requests cr where cr.customer_id = p.id), '[]'::jsonb),
    'role_changes', coalesce((select jsonb_agg(jsonb_build_object('from', rc.from_role, 'to', rc.to_role, 'at', rc.created_at)
                   order by rc.created_at desc)
                 from role_changes rc where rc.profile_id = p.id), '[]'::jsonb)
  ) into v
  from profiles p where p.id = p_profile;
  return v;
end;
$$;

-- Coaching operations at a glance: counts only. TalentYak does not read
-- plans' contents, tracking values or check-in answers.
create or replace function admin_coaching_operations ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  return jsonb_build_object(
    'relationships', (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb) from (select state, count(*) n from enrollments group by state) x),
    'plans_published_7d', (select count(*) from client_plan_versions where published_at > now() - interval '7 days'),
    'plan_updates_scheduled', (select count(*) from client_plan_versions where published_at is not null and withdrawn_at is null and effective_from > now()),
    'workouts_logged_7d', (select count(*) from workout_logs where created_at > now() - interval '7 days'),
    'checkins_open', (select count(*) from checkins where status = 'open'),
    'checkins_awaiting_review', (select count(*) from checkins where status in ('submitted', 'reopened')),
    'checkins_flagged', (select count(*) from checkins where needs_resolution is not null),
    'conversations_active_7d', (select count(*) from conversations where last_message_at > now() - interval '7 days'),
    'sessions_upcoming', (select count(*) from appointments where state in ('booked', 'tentative') and starts_at > now()),
    'sessions_on_hold', (select count(*) from appointments where state = 'on_hold'),
    'requests_pending', (select count(*) from appointment_proposals where state = 'pending'),
    'calls_open_now', (select count(*) from call_rooms where state in ('pending', 'ready')),
    'calls_interrupted_30d', (select count(*) from appointment_outcomes where outcome = 'technical_failure' and recorded_at > now() - interval '30 days'),
    'media_failed_30d', (select count(*) from media_assets where state::text = 'failed' and updated_at > now() - interval '30 days'),
    'media_processing', (select count(*) from media_assets where state::text in ('uploaded', 'processing'))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'admin_record_audit(text, text, text, text, jsonb, jsonb)',
    'admin_set_feature_mode(text, text, text, int, jsonb, uuid)',
    'admin_set_test_account(uuid, boolean, text)',
    'coach_change_candidates(uuid)',
    'request_coach_change(uuid, text, uuid, text)',
    'withdraw_coach_change(uuid)',
    'admin_apply_coach_change(uuid, uuid, timestamptz, text, text)',
    'admin_decline_coach_change(uuid, text)',
    'admin_coach_change_preview(uuid, uuid)',
    'admin_assign_support_case(uuid, uuid)',
    'admin_add_support_note(uuid, text)',
    'admin_set_account_suspension(uuid, boolean, text)',
    'admin_overview_metrics(timestamptz, timestamptz, text, boolean)',
    'admin_search(text)',
    'admin_accounts(text, text, text, int, int)',
    'admin_account_detail(uuid)',
    'admin_coaching_operations()'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;

end $$;

notify pgrst, 'reload schema';
