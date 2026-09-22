-- M14 — Private messaging between a client and their coach.
--
-- SHAPE
--   One conversation per coach ASSIGNMENT, not per client. A reassignment opens
--   an empty conversation with the new coach; the old one stays readable by the
--   client, and by nobody else. A new coach never inherits a previous coach's
--   private thread (founder decision, 2026-09-21), whatever history_scope says —
--   that scope governs the training record and media, not someone else's words.
--
-- ACCESS
--   Every read and write is decided by conversation_access(), which reuses the
--   relationship state the billing side already maintains (enrollments.state,
--   kept by end_lapsed_enrollments from the purchase). There is no second
--   billing authority here. Messages have no write policy at all: sending goes
--   through send_message(), which checks access, limits and attachments.
--
-- REALTIME
--   Browsers subscribe to conversation_signals, a table that carries NO message
--   text. Row-level security is evaluated for every change delivered, so a
--   suspended or reassigned person stops receiving signals at once. A signal is
--   only ever a prompt to fetch; the fetch goes through the same access rules.
--
-- POLICY
--   messaging_settings mirrors `messaging.v1` in src/lib/policy/registry.ts (a
--   test asserts they agree). Every value is a sandbox default, not approved.

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------

create table if not exists messaging_settings (
  id boolean primary key default true check (id),
  policy_id text not null,
  policy_status text not null check (policy_status in ('sandbox_default', 'confirmed')),
  -- A renewal failed and the paid-for time has run out (enrollment 'paused').
  send_while_paused boolean not null,
  -- The relationship ended or the coach changed: may the client still read?
  client_reads_after_end boolean not null,
  -- Messaging a coach before buying. Discussed, not approved: off.
  pre_purchase_inquiries boolean not null,
  max_body_chars int not null check (max_body_chars between 1 and 4000),
  sends_per_minute int not null check (sends_per_minute > 0),
  sends_per_day int not null check (sends_per_day > 0),
  unread_email_delay_minutes int not null check (unread_email_delay_minutes between 1 and 1440),
  support_access_hours int not null check (support_access_hours between 1 and 168),
  support_cases_per_day int not null check (support_cases_per_day > 0),
  updated_at timestamptz not null default now()
);

insert into messaging_settings (
  id, policy_id, policy_status, send_while_paused, client_reads_after_end, pre_purchase_inquiries,
  max_body_chars, sends_per_minute, sends_per_day, unread_email_delay_minutes, support_access_hours,
  support_cases_per_day
) values (true, 'messaging.v1', 'sandbox_default', false, true, false, 4000, 20, 500, 15, 72, 5)
on conflict (id) do nothing;

alter table messaging_settings enable row level security;
-- Policy values are shown to people ("you can read this conversation but not
-- reply"); they are not secret. Changing them is a migration.
create policy "anyone signed in reads messaging settings" on messaging_settings
  for select to authenticated using (true);
revoke insert, update, delete, truncate on messaging_settings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Conversations
-- ---------------------------------------------------------------------------

create table if not exists conversations (
  id uuid primary key default gen_random_uuid (),
  assignment_id uuid not null unique references enrollment_assignments (id) on delete cascade,
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  customer_id uuid not null references profiles (id) on delete cascade,
  provider_id uuid not null references providers (id),
  -- The sequence counter. Incremented under the row lock by send_message, so
  -- messages have a total, stable order that pagination can rely on.
  last_seq bigint not null default 0,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists conversations_customer_idx on conversations (customer_id, last_message_at desc);
create index if not exists conversations_provider_idx on conversations (provider_id, last_message_at desc);
create index if not exists conversations_enrollment_idx on conversations (enrollment_id);

alter table conversations enable row level security;
revoke insert, update, delete, truncate on conversations from anon, authenticated;

-- A conversation exists for every assignment, created with it.
create or replace function create_assignment_conversation ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into conversations (assignment_id, enrollment_id, customer_id, provider_id)
  select new.id, new.enrollment_id, e.customer_id, new.provider_id
  from enrollments e where e.id = new.enrollment_id
  on conflict (assignment_id) do nothing;
  return new;
end;
$$;

drop trigger if exists enrollment_assignments_conversation on enrollment_assignments;
create trigger enrollment_assignments_conversation after insert on enrollment_assignments
  for each row execute function create_assignment_conversation ();

insert into conversations (assignment_id, enrollment_id, customer_id, provider_id)
select a.id, a.enrollment_id, e.customer_id, a.provider_id
from enrollment_assignments a join enrollments e on e.id = a.enrollment_id
on conflict (assignment_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The access decision — one function, used by every policy and action
-- ---------------------------------------------------------------------------
--
-- For person p_uid on conversation p_id:
--   role      'customer' | 'coach' | null (not a participant: nothing at all)
--   can_read  / can_send
--   state     active | paused | pending | ended | reassigned | suspended
--   reason    words for the screen when sending is not possible
--
-- A coach reads only while their assignment is open, they are not suspended,
-- and the relationship is active or paused — the same test as
-- coach_may_read_record(). The client reads their own history unless
-- client_reads_after_end is switched off, and never while suspended.

-- Is an assignment interval open right now?
create or replace function a_open (p_from timestamptz, p_to timestamptz)
returns boolean
language sql
stable
as $$
  select p_from <= now() and (p_to is null or p_to > now());
$$;

create or replace function conversation_access (p_id uuid, p_uid uuid)
returns table (role text, can_read boolean, can_send boolean, state text, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  s messaging_settings;
  v_open boolean;
  v_coach_ok boolean;
  v_customer_ok boolean;
  v_live boolean;
begin
  select c.customer_id, e.state as e_state, a.effective_from, a.effective_to,
         p.profile_id as coach_profile, p.status as p_status, p.suspended_at as p_suspended,
         cp.suspended_at as coach_suspended, cu.suspended_at as customer_suspended
    into r
    from conversations c
    join enrollments e on e.id = c.enrollment_id
    join enrollment_assignments a on a.id = c.assignment_id
    join providers p on p.id = c.provider_id
    join profiles cp on cp.id = p.profile_id
    join profiles cu on cu.id = c.customer_id
    where c.id = p_id;

  if not found or p_uid is null then
    return;
  end if;

  select * into s from messaging_settings where id;

  v_open := a_open (r.effective_from, r.effective_to);
  v_coach_ok := r.p_suspended is null and r.p_status <> 'suspended' and r.coach_suspended is null;
  v_customer_ok := r.customer_suspended is null;
  v_live := v_open and r.e_state in ('active', 'paused');

  if p_uid = r.customer_id then
    role := 'customer';
    if not v_customer_ok then
      can_read := false; can_send := false; state := 'suspended';
      reason := 'Your account is paused. Contact support.';
    else
      can_read := v_live or s.client_reads_after_end;
      if r.e_state = 'ended' then
        state := 'ended'; can_send := false;
        reason := 'This coaching has ended. You can still read your messages.';
      elsif not v_open then
        state := 'reassigned'; can_send := false;
        reason := 'You have a different coach now. This conversation is kept for you to read.';
      elsif not v_coach_ok then
        state := 'suspended'; can_send := false;
        reason := 'Your coach is not available at the moment. Contact support if you need help.';
      elsif r.e_state = 'pending' then
        state := 'pending'; can_send := false;
        reason := 'Messaging opens once your coaching starts.';
      elsif r.e_state = 'paused' then
        state := 'paused'; can_send := s.send_while_paused;
        reason := case when s.send_while_paused then null
                       else 'Your paid time has run out. Update your payment to message your coach again.' end;
      else
        state := 'active'; can_send := true; reason := null;
      end if;
    end if;
    return next;
    return;
  end if;

  if p_uid = r.coach_profile then
    role := 'coach';
    if not v_coach_ok then
      can_read := false; can_send := false; state := 'suspended';
      reason := 'Your coaching account is paused. Contact support.';
    elsif not v_live then
      can_read := false; can_send := false;
      state := case when r.e_state = 'ended' then 'ended' else 'reassigned' end;
      reason := 'You are no longer this client''s coach.';
    elsif not v_customer_ok then
      can_read := true; can_send := false; state := 'suspended';
      reason := 'This client''s account is paused.';
    elsif r.e_state = 'paused' then
      can_read := true; can_send := s.send_while_paused; state := 'paused';
      reason := case when s.send_while_paused then null
                     else 'This client''s paid time has run out. Messaging resumes when they pay.' end;
    else
      can_read := true; can_send := true; state := 'active'; reason := null;
    end if;
    return next;
    return;
  end if;
end;
$$;

create or replace function conversation_can_read (p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select can_read from conversation_access (p_id, auth.uid ())), false);
$$;

revoke execute on function conversation_access (uuid, uuid) from public, anon, authenticated;
grant execute on function conversation_access (uuid, uuid) to service_role;
revoke execute on function conversation_can_read (uuid) from public, anon;
grant execute on function conversation_can_read (uuid) to authenticated, service_role;

create policy "participants read their conversations" on conversations
  for select using (conversation_can_read (id));

-- ---------------------------------------------------------------------------
-- 4. Messages
-- ---------------------------------------------------------------------------

create table if not exists messages (
  id uuid primary key default gen_random_uuid (),
  conversation_id uuid not null references conversations (id) on delete cascade,
  seq bigint not null,
  sender_profile_id uuid references profiles (id) on delete set null,
  sender_role text not null check (sender_role in ('customer', 'coach', 'system')),
  -- Structured kinds (appointment proposals, expectations links) are added by
  -- the batches that own them (3 and 4). Until then the database refuses them,
  -- so nothing can render a button that does nothing.
  kind text not null check (kind in ('text', 'attachment', 'system')),
  -- Plain text only. Rendered as text, never as HTML.
  body text check (body is null or char_length(body) between 1 and 4000),
  media_asset_id uuid unique references media_assets (id) on delete set null,
  -- Generated by the sender's device. Retrying after a dropped connection
  -- returns the original message instead of creating a second one.
  client_message_id uuid not null,
  created_at timestamptz not null default now(),
  unique (conversation_id, seq),
  unique (sender_profile_id, client_message_id),
  check (kind <> 'text' or body is not null)
);

create index if not exists messages_sender_recent_idx on messages (sender_profile_id, created_at desc);

alter table messages enable row level security;
revoke insert, update, delete, truncate on messages from anon, authenticated;

create policy "participants read messages" on messages
  for select using (conversation_can_read (conversation_id));

-- ---------------------------------------------------------------------------
-- 5. Read markers
-- ---------------------------------------------------------------------------
--
-- A person's high-water mark: every message up to last_read_seq has been seen
-- by them in the open conversation. The browser moves it only when messages
-- are actually on screen in a visible tab, and only across a contiguous run it
-- has seen; the database only lets it move forwards.

create table if not exists conversation_reads (
  conversation_id uuid not null references conversations (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  last_read_seq bigint not null default 0,
  read_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);

create index if not exists conversation_reads_profile_idx on conversation_reads (profile_id);

alter table conversation_reads enable row level security;
revoke insert, update, delete, truncate on conversation_reads from anon, authenticated;

-- Both participants see both markers: that is what a read receipt is.
create policy "participants read read markers" on conversation_reads
  for select using (conversation_can_read (conversation_id));

-- ---------------------------------------------------------------------------
-- 6. Realtime signals — no content
-- ---------------------------------------------------------------------------

create table if not exists conversation_signals (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references conversations (id) on delete cascade,
  kind text not null check (kind in ('message', 'read')),
  created_at timestamptz not null default now()
);

create index if not exists conversation_signals_conversation_idx on conversation_signals (conversation_id);
create index if not exists conversation_signals_created_idx on conversation_signals (created_at);

alter table conversation_signals enable row level security;
revoke insert, update, delete, truncate on conversation_signals from anon, authenticated;

create policy "participants receive signals" on conversation_signals
  for select using (conversation_can_read (conversation_id));

do $$ begin
  alter publication supabase_realtime add table conversation_signals;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 7. Coach availability — the coach's own words, not a platform promise
-- ---------------------------------------------------------------------------

create table if not exists coach_messaging_profiles (
  provider_id uuid primary key references providers (id) on delete cascade,
  -- [{ "day": 0-6 (Sunday = 0), "start": "HH:MM", "end": "HH:MM" }] in the
  -- coach's own timezone (providers.timezone).
  working_hours jsonb not null default '[]'
    check (jsonb_typeof(working_hours) = 'array' and jsonb_array_length(working_hours) <= 21),
  response_expectation text check (response_expectation is null or char_length(response_expectation) <= 200),
  away_until timestamptz,
  away_note text check (away_note is null or char_length(away_note) <= 200),
  updated_at timestamptz not null default now()
);

alter table coach_messaging_profiles enable row level security;

create policy "coach reads own messaging profile" on coach_messaging_profiles
  for select using (is_active_provider (provider_id));
create policy "coach creates own messaging profile" on coach_messaging_profiles
  for insert with check (is_active_provider (provider_id));
create policy "coach updates own messaging profile" on coach_messaging_profiles
  for update using (is_active_provider (provider_id)) with check (is_active_provider (provider_id));
revoke delete, truncate on coach_messaging_profiles from anon, authenticated;

drop trigger if exists coach_messaging_profiles_touch on coach_messaging_profiles;
create trigger coach_messaging_profiles_touch before update on coach_messaging_profiles
  for each row execute function touch_updated_at ();

-- ---------------------------------------------------------------------------
-- 8. Sending
-- ---------------------------------------------------------------------------

create or replace function send_message (
  p_conversation uuid,
  p_client_id uuid,
  p_body text,
  p_media uuid default null
)
returns table (id uuid, seq bigint, created_at timestamptz, duplicate boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_access record;
  v_conv conversations;
  v_settings messaging_settings;
  v_body text;
  v_existing messages;
  v_seq bigint;
  v_msg messages;
  v_recipient uuid;
  v_recipient_read bigint;
  v_from_name text;
  v_count int;
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;
  if p_client_id is null then raise exception 'client_id_required'; end if;

  -- The lock serialises sends in this conversation: the sequence stays gapless
  -- and a duplicate check cannot race its twin.
  select * into v_conv from conversations c where c.id = p_conversation for update;
  if not found then raise exception 'not_found'; end if;

  select * into v_existing from messages m
    where m.sender_profile_id = v_uid and m.client_message_id = p_client_id;
  if found then
    if v_existing.conversation_id <> p_conversation then raise exception 'client_id_reused'; end if;
    id := v_existing.id; seq := v_existing.seq; created_at := v_existing.created_at; duplicate := true;
    return next;
    return;
  end if;

  select * into v_access from conversation_access (p_conversation, v_uid);
  if v_access.role is null then raise exception 'not_found'; end if;
  if not v_access.can_send then raise exception 'conversation_closed'; end if;

  select * into v_settings from messaging_settings where messaging_settings.id;

  v_body := nullif(btrim(coalesce(p_body, '')), '');
  if v_body is not null and char_length(v_body) > v_settings.max_body_chars then
    raise exception 'too_long';
  end if;
  if v_body is null and p_media is null then raise exception 'empty'; end if;

  select count(*) into v_count from messages m
    where m.sender_profile_id = v_uid and m.created_at > now() - interval '1 minute';
  if v_count >= v_settings.sends_per_minute then raise exception 'rate_limited'; end if;
  select count(*) into v_count from messages m
    where m.sender_profile_id = v_uid and m.created_at > now() - interval '1 day';
  if v_count >= v_settings.sends_per_day then raise exception 'rate_limited'; end if;

  -- An attachment is only sendable once it has been processed. A failed or
  -- unfinished upload can never appear as a sent message.
  if p_media is not null then
    perform 1 from media_assets ma
      where ma.id = p_media
        and ma.owner_profile_id = v_uid
        and ma.purpose = 'chat_attachment'
        and ma.enrollment_id = v_conv.enrollment_id
        and ma.state = 'ready'
        and ma.deleted_at is null
      for update;
    if not found then raise exception 'attachment_not_ready'; end if;
    if exists (select 1 from messages m where m.media_asset_id = p_media) then
      raise exception 'attachment_used';
    end if;
  end if;

  update conversations c set last_seq = c.last_seq + 1, last_message_at = now()
    where c.id = p_conversation
    returning c.last_seq into v_seq;

  insert into messages (conversation_id, seq, sender_profile_id, sender_role, kind, body, media_asset_id, client_message_id)
  values (p_conversation, v_seq, v_uid, v_access.role,
          case when p_media is null then 'text' else 'attachment' end,
          v_body, p_media, p_client_id)
  returning * into v_msg;

  insert into conversation_signals (conversation_id, kind) values (p_conversation, 'message');

  -- One unread-message email per unread run: the dedupe key is the
  -- recipient's read position, so further messages before they read collapse
  -- into the same job, and reading starts a fresh run. The worker rechecks at
  -- send time that the messages are still unread and still theirs to read.
  if v_access.role = 'customer' then
    select p.profile_id, coalesce(nullif(trim(pr.preferred_name), ''), split_part(coalesce(pr.full_name, ''), ' ', 1), 'Your client')
      into v_recipient, v_from_name
      from providers p, profiles pr
      where p.id = v_conv.provider_id and pr.id = v_uid;
  else
    select v_conv.customer_id, coalesce(nullif(trim(p.display_name), ''), 'Your coach')
      into v_recipient, v_from_name
      from providers p where p.id = v_conv.provider_id;
  end if;

  select coalesce((select r.last_read_seq from conversation_reads r
                   where r.conversation_id = p_conversation and r.profile_id = v_recipient), 0)
    into v_recipient_read;

  perform enqueue_outbox (
    'email.unread_messages',
    jsonb_build_object(
      'profile_id', v_recipient,
      'conversation_id', p_conversation,
      'since_seq', v_recipient_read,
      'from_name', v_from_name,
      'recipient_role', case when v_access.role = 'customer' then 'coach' else 'customer' end
    ),
    'unread:' || v_recipient || ':' || p_conversation || ':' || v_recipient_read,
    now() + make_interval(mins => v_settings.unread_email_delay_minutes),
    now() + interval '7 days'
  );

  id := v_msg.id; seq := v_msg.seq; created_at := v_msg.created_at; duplicate := false;
  return next;
end;
$$;

revoke execute on function send_message (uuid, uuid, text, uuid) from public, anon;
grant execute on function send_message (uuid, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Reading
-- ---------------------------------------------------------------------------

create or replace function mark_conversation_read (p_conversation uuid, p_seq bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_last bigint;
  v_now bigint;
  v_before bigint;
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;
  if not coalesce((select can_read from conversation_access (p_conversation, v_uid)), false) then
    raise exception 'not_found';
  end if;

  select last_seq into v_last from conversations where id = p_conversation;
  v_now := least(greatest(coalesce(p_seq, 0), 0), v_last);

  select last_read_seq into v_before from conversation_reads
    where conversation_id = p_conversation and profile_id = v_uid;

  insert into conversation_reads (conversation_id, profile_id, last_read_seq, read_at)
  values (p_conversation, v_uid, v_now, now())
  on conflict (conversation_id, profile_id) do update
    set last_read_seq = greatest(conversation_reads.last_read_seq, excluded.last_read_seq),
        read_at = case when excluded.last_read_seq > conversation_reads.last_read_seq then now()
                       else conversation_reads.read_at end
  returning last_read_seq into v_now;

  if v_before is null or v_now > v_before then
    insert into conversation_signals (conversation_id, kind) values (p_conversation, 'read');
  end if;
  return v_now;
end;
$$;

revoke execute on function mark_conversation_read (uuid, bigint) from public, anon;
grant execute on function mark_conversation_read (uuid, bigint) to authenticated;

-- Everything a conversation screen needs to know about its own state. Only
-- for a participant; null otherwise.
create or replace function conversation_status (p_conversation uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  a record;
  c record;
  v_mine bigint;
  v_theirs bigint;
  v_other uuid;
begin
  select * into a from conversation_access (p_conversation, v_uid);
  if a.role is null or not a.can_read then return null; end if;

  select cv.id, cv.last_seq, cv.customer_id, cv.enrollment_id, cv.created_at,
         pa.effective_from, pa.effective_to, e.state as e_state, e.ended_at,
         pu.paid_through_at, pu.state::text as purchase_state,
         p.id as provider_id, p.profile_id as coach_profile, p.display_name, p.timezone as coach_tz,
         coalesce(nullif(trim(cu.preferred_name), ''), split_part(coalesce(cu.full_name, ''), ' ', 1), 'Client') as client_name,
         cm.working_hours, cm.response_expectation, cm.away_until, cm.away_note
    into c
    from conversations cv
    join enrollment_assignments pa on pa.id = cv.assignment_id
    join enrollments e on e.id = cv.enrollment_id
    left join purchases pu on pu.id = e.purchase_id
    join providers p on p.id = cv.provider_id
    join profiles cu on cu.id = cv.customer_id
    left join coach_messaging_profiles cm on cm.provider_id = p.id
    where cv.id = p_conversation;

  v_other := case when a.role = 'customer' then c.coach_profile else c.customer_id end;
  select last_read_seq into v_mine from conversation_reads where conversation_id = p_conversation and profile_id = v_uid;
  select last_read_seq into v_theirs from conversation_reads where conversation_id = p_conversation and profile_id = v_other;

  return jsonb_build_object(
    'id', c.id,
    'role', a.role,
    'state', a.state,
    'can_send', a.can_send,
    'reason', a.reason,
    'last_seq', c.last_seq,
    'my_last_read_seq', coalesce(v_mine, 0),
    'their_last_read_seq', coalesce(v_theirs, 0),
    'client_name', c.client_name,
    'coach_name', c.display_name,
    'coach_timezone', c.coach_tz,
    'working_hours', coalesce(c.working_hours, '[]'::jsonb),
    'response_expectation', c.response_expectation,
    'away_until', case when c.away_until > now() then c.away_until end,
    'away_note', case when c.away_until > now() then c.away_note end,
    'assigned_from', c.effective_from,
    'assigned_to', c.effective_to,
    'ended_at', c.ended_at,
    'paid_through', c.paid_through_at,
    'purchase_state', c.purchase_state
  );
end;
$$;

revoke execute on function conversation_status (uuid) from public, anon;
grant execute on function conversation_status (uuid) to authenticated;

-- The conversations a person can read, newest activity first, with unread
-- counts. Serves both the client's list and the coach's inbox: a coach sees
-- only clients currently assigned to them, because only those are readable.
create or replace function my_conversations ()
returns table (
  conversation_id uuid,
  role text,
  state text,
  can_send boolean,
  other_name text,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_mine boolean,
  unread_count bigint,
  assigned_from timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cv.id,
    a.role,
    a.state,
    a.can_send,
    case when a.role = 'customer' then p.display_name
         else coalesce(nullif(trim(cu.preferred_name), ''), split_part(coalesce(cu.full_name, ''), ' ', 1), 'Client') end,
    cv.last_message_at,
    case when lm.kind = 'attachment' and lm.body is null then '[attachment]' else left(lm.body, 120) end,
    lm.sender_profile_id = auth.uid (),
    (select count(*) from messages m
      where m.conversation_id = cv.id
        and m.seq > coalesce((select r.last_read_seq from conversation_reads r
                              where r.conversation_id = cv.id and r.profile_id = auth.uid ()), 0)
        and m.sender_profile_id is distinct from auth.uid ()),
    ea.effective_from
  from conversations cv
  cross join lateral conversation_access (cv.id, auth.uid ()) a
  join providers p on p.id = cv.provider_id
  join profiles cu on cu.id = cv.customer_id
  join enrollment_assignments ea on ea.id = cv.assignment_id
  left join lateral (
    select m.kind, m.body, m.sender_profile_id from messages m
    where m.conversation_id = cv.id order by m.seq desc limit 1
  ) lm on true
  where (cv.customer_id = auth.uid () or p.profile_id = auth.uid ())
    and a.can_read
  order by cv.last_message_at desc nulls last, ea.effective_from desc;
$$;

revoke execute on function my_conversations () from public, anon;
grant execute on function my_conversations () to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Attachments
-- ---------------------------------------------------------------------------

-- May the calling person see this chat attachment? Only through a message in a
-- conversation they can currently read.
create or replace function chat_attachment_readable (p_asset uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from messages m
    where m.media_asset_id = p_asset and conversation_can_read (m.conversation_id)
  );
$$;

revoke execute on function chat_attachment_readable (uuid) from public, anon;
grant execute on function chat_attachment_readable (uuid) to authenticated, service_role;

-- Chat attachments are judged by the conversation, not by coach_may_read_record:
-- otherwise an incoming coach with 'full' history could see what a client sent
-- the previous coach privately.
drop policy if exists "current coach reads permitted media" on media_assets;
create policy "current coach reads permitted media" on media_assets for select
  using (
    enrollment_id is not null
    and purpose <> 'chat_attachment'
    and state = 'ready'
    and deleted_at is null
    and coach_may_read_record (enrollment_id, recorded_at, true)
  );

drop policy if exists "participants read chat attachments" on media_assets;
create policy "participants read chat attachments" on media_assets for select
  using (
    purpose = 'chat_attachment'
    and state = 'ready'
    and deleted_at is null
    and chat_attachment_readable (id)
  );

-- A coach may upload a chat attachment into a relationship they currently
-- coach; a client, into their own. Every other purpose stays client-only.
create or replace function reserve_media_upload (
  p_owner uuid,
  p_enrollment uuid,
  p_purpose media_purpose,
  p_media_kind text,
  p_declared_bytes bigint
)
returns table (id uuid, source_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_path text;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  if p_purpose = 'chat_attachment' and p_enrollment is null then
    raise exception 'enrollment_not_owned';
  end if;

  if p_enrollment is not null
     and not exists (select 1 from enrollments e where e.id = p_enrollment and e.customer_id = p_owner)
     and not (
       p_purpose = 'chat_attachment'
       and exists (
         select 1
         from enrollment_assignments a
         join enrollments e on e.id = a.enrollment_id
         join providers p on p.id = a.provider_id
         join profiles pr on pr.id = p.profile_id
         where a.enrollment_id = p_enrollment
           and a_open (a.effective_from, a.effective_to)
           and e.state in ('active', 'paused')
           and p.profile_id = p_owner
           and p.suspended_at is null and p.status <> 'suspended' and pr.suspended_at is null
       )
     ) then
    raise exception 'enrollment_not_owned';
  end if;

  v_id := gen_random_uuid ();
  v_path := p_owner || '/' || v_id || '/source';

  insert into media_assets (id, owner_profile_id, enrollment_id, purpose, media_kind, state, source_path, source_bytes)
  values (v_id, p_owner, p_enrollment, p_purpose, p_media_kind, 'reserved', v_path, p_declared_bytes);

  id := v_id; source_path := v_path;
  return next;
end;
$$;

revoke execute on function reserve_media_upload (uuid, uuid, media_purpose, text, bigint) from public, anon, authenticated;
grant execute on function reserve_media_upload (uuid, uuid, media_purpose, text, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 11. Unread-message recheck (worker)
-- ---------------------------------------------------------------------------

-- How many messages from the other person are still unread by p_profile, past
-- both the point the email was queued at and wherever they have read to since.
-- Zero if they can no longer read the conversation at all.
create or replace function unread_message_count (p_profile uuid, p_conversation uuid, p_since_seq bigint)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_read bigint;
begin
  if not is_privileged_writer () then raise exception 'server_only'; end if;
  if not coalesce((select can_read from conversation_access (p_conversation, p_profile)), false) then
    return 0;
  end if;
  select last_read_seq into v_read from conversation_reads
    where conversation_id = p_conversation and profile_id = p_profile;
  return (
    select count(*) from messages m
    where m.conversation_id = p_conversation
      and m.seq > greatest(coalesce(p_since_seq, 0), coalesce(v_read, 0))
      and m.sender_profile_id is distinct from p_profile
  );
end;
$$;

revoke execute on function unread_message_count (uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function unread_message_count (uuid, uuid, bigint) to service_role;

-- Signals are prompts, not records. A day is far longer than any reconnect.
create or replace function prune_conversation_signals ()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not is_privileged_writer () then raise exception 'server_only'; end if;
  delete from conversation_signals where created_at < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function prune_conversation_signals () from public, anon, authenticated;
grant execute on function prune_conversation_signals () to service_role;

-- ---------------------------------------------------------------------------
-- 12. Support cases and case-scoped message access
-- ---------------------------------------------------------------------------

create table if not exists support_cases (
  id uuid primary key default gen_random_uuid (),
  reporter_profile_id uuid not null references profiles (id) on delete cascade,
  reporter_role text not null check (reporter_role in ('customer', 'coach')),
  conversation_id uuid references conversations (id) on delete set null,
  category text not null check (category in ('conduct', 'safety', 'billing', 'technical', 'coach_change', 'other')),
  description text not null check (char_length(description) between 10 and 2000),
  state text not null default 'open' check (state in ('open', 'in_progress', 'resolved')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  resolved_by uuid references profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_cases_reporter_idx on support_cases (reporter_profile_id, created_at desc);
create index if not exists support_cases_state_idx on support_cases (state, created_at desc);
create index if not exists support_cases_conversation_idx on support_cases (conversation_id);

alter table support_cases enable row level security;
revoke insert, update, delete, truncate on support_cases from anon, authenticated;

create policy "reporter reads own cases" on support_cases
  for select using (reporter_profile_id = auth.uid ());
create policy "admin reads cases" on support_cases
  for select using (is_admin ());

drop trigger if exists support_cases_touch on support_cases;
create trigger support_cases_touch before update on support_cases
  for each row execute function touch_updated_at ();

-- A grant for ONE admin to read ONE case's conversation, for a limited time,
-- with a reason. There is no other way for anyone at TalentYak to read messages.
create table if not exists support_message_access (
  id uuid primary key default gen_random_uuid (),
  case_id uuid not null references support_cases (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  granted_to uuid not null references profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 10 and 500),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists support_message_access_case_idx on support_message_access (case_id);
create index if not exists support_message_access_admin_idx on support_message_access (granted_to, expires_at);
create index if not exists support_message_access_conversation_idx on support_message_access (conversation_id);

-- Append-only record of every grant, view and revocation.
create table if not exists support_access_log (
  id bigint generated always as identity primary key,
  access_id uuid references support_message_access (id) on delete set null,
  case_id uuid references support_cases (id) on delete set null,
  admin_profile_id uuid references profiles (id) on delete set null,
  conversation_id uuid,
  action text not null check (action in ('granted', 'viewed', 'revoked')),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists support_access_log_case_idx on support_access_log (case_id, created_at desc);
create index if not exists support_access_log_access_idx on support_access_log (access_id);
create index if not exists support_access_log_admin_idx on support_access_log (admin_profile_id);

alter table support_message_access enable row level security;
alter table support_access_log enable row level security;
revoke insert, update, delete, truncate on support_message_access from anon, authenticated;
revoke insert, update, delete, truncate on support_access_log from anon, authenticated;

create policy "admin reads message access grants" on support_message_access
  for select using (is_admin ());
create policy "admin reads support access log" on support_access_log
  for select using (is_admin ());

create or replace function open_support_case (
  p_category text,
  p_description text,
  p_conversation uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_role text;
  v_id uuid;
  v_limit int;
begin
  if v_uid is null then raise exception 'sign_in_required'; end if;
  if exists (select 1 from profiles where id = v_uid and suspended_at is not null) then
    -- A suspended person can still reach support by email; the in-app case
    -- form is for active accounts.
    raise exception 'suspended';
  end if;

  select support_cases_per_day into v_limit from messaging_settings where id;
  if (select count(*) from support_cases where reporter_profile_id = v_uid and created_at > now() - interval '1 day') >= v_limit then
    raise exception 'rate_limited';
  end if;

  if p_conversation is not null then
    -- Only a conversation the reporter can read — including an ended one for a
    -- client — can be attached to their case.
    select role into v_role from conversation_access (p_conversation, v_uid) where can_read;
    if v_role is null then raise exception 'not_found'; end if;
  else
    v_role := case when exists (select 1 from providers where profile_id = v_uid) then 'coach' else 'customer' end;
  end if;

  insert into support_cases (reporter_profile_id, reporter_role, conversation_id, category, description)
  values (v_uid, v_role, p_conversation, p_category, btrim(p_description))
  returning id into v_id;

  -- Fanned out to current admins by the worker. The description is not in it.
  perform enqueue_outbox (
    'email.support_case_opened',
    jsonb_build_object('case_id', v_id, 'reporter_role', v_role, 'category', p_category),
    'support_case:' || v_id
  );

  return v_id;
end;
$$;

revoke execute on function open_support_case (text, text, uuid) from public, anon;
grant execute on function open_support_case (text, text, uuid) to authenticated;

create or replace function admin_update_support_case (p_case uuid, p_state text, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin () then raise exception 'admin_only'; end if;
  if p_state not in ('open', 'in_progress', 'resolved') then raise exception 'bad_state'; end if;
  if p_state = 'resolved' and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'note_required';
  end if;

  update support_cases set
    state = p_state,
    resolution_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), resolution_note),
    resolved_by = case when p_state = 'resolved' then auth.uid () else null end,
    resolved_at = case when p_state = 'resolved' then now() else null end
  where id = p_case;
  if not found then return false; end if;

  -- Resolving a case ends any message access granted for it.
  if p_state = 'resolved' then
    insert into support_access_log (access_id, case_id, admin_profile_id, conversation_id, action, detail)
    select g.id, g.case_id, auth.uid (), g.conversation_id, 'revoked', 'case resolved'
    from support_message_access g
    where g.case_id = p_case and g.revoked_at is null and g.expires_at > now();
    update support_message_access set revoked_at = now()
      where case_id = p_case and revoked_at is null and expires_at > now();
  end if;

  return true;
end;
$$;

create or replace function admin_grant_case_message_access (p_case uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case support_cases;
  v_hours int;
  v_id uuid;
begin
  if not is_admin () then raise exception 'admin_only'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'reason_required'; end if;

  select * into v_case from support_cases where id = p_case;
  if not found then raise exception 'not_found'; end if;
  if v_case.conversation_id is null then raise exception 'no_conversation'; end if;
  if v_case.state = 'resolved' then raise exception 'case_resolved'; end if;

  select support_access_hours into v_hours from messaging_settings where id;

  insert into support_message_access (case_id, conversation_id, granted_to, reason, expires_at)
  values (p_case, v_case.conversation_id, auth.uid (), btrim(p_reason), now() + make_interval(hours => v_hours))
  returning id into v_id;

  insert into support_access_log (access_id, case_id, admin_profile_id, conversation_id, action, detail)
  values (v_id, p_case, auth.uid (), v_case.conversation_id, 'granted', left(btrim(p_reason), 500));

  return v_id;
end;
$$;

create or replace function admin_revoke_case_message_access (p_access uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  g support_message_access;
begin
  if not is_admin () then raise exception 'admin_only'; end if;
  update support_message_access set revoked_at = now()
    where id = p_access and revoked_at is null
    returning * into g;
  if not found then return false; end if;
  insert into support_access_log (access_id, case_id, admin_profile_id, conversation_id, action)
  values (g.id, g.case_id, auth.uid (), g.conversation_id, 'revoked');
  return true;
end;
$$;

-- Reads a case's conversation under a live grant held by the calling admin.
-- Every call is logged. Attachments are named, never served.
create or replace function admin_case_messages (p_case uuid, p_before_seq bigint default null, p_limit int default 50)
returns table (seq bigint, sender_role text, kind text, body text, has_attachment boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  g support_message_access;
begin
  if not is_admin () then raise exception 'admin_only'; end if;

  select * into g from support_message_access a
    where a.case_id = p_case and a.granted_to = auth.uid () and a.revoked_at is null and a.expires_at > now()
    order by a.expires_at desc limit 1;
  if not found then raise exception 'no_access'; end if;

  insert into support_access_log (access_id, case_id, admin_profile_id, conversation_id, action, detail)
  values (g.id, p_case, auth.uid (), g.conversation_id, 'viewed',
          case when p_before_seq is null then 'latest' else 'before ' || p_before_seq end);

  return query
    select m.seq, m.sender_role, m.kind, m.body, m.media_asset_id is not null, m.created_at
    from messages m
    where m.conversation_id = g.conversation_id
      and (p_before_seq is null or m.seq < p_before_seq)
    order by m.seq desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- The admin case list, with names, for the resolution screen.
create or replace function admin_support_cases (p_state text default null)
returns table (
  id uuid, category text, state text, reporter_role text, reporter_name text,
  other_name text, has_conversation boolean, description text, resolution_note text,
  created_at timestamptz, resolved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin () then raise exception 'admin_only'; end if;
  return query
    select s.id, s.category, s.state, s.reporter_role,
           coalesce(nullif(trim(rp.full_name), ''), 'Unnamed'),
           case when s.conversation_id is null then null
                when s.reporter_role = 'customer' then pv.display_name
                else coalesce(nullif(trim(cu.full_name), ''), 'Client') end,
           s.conversation_id is not null,
           s.description, s.resolution_note, s.created_at, s.resolved_at
    from support_cases s
    join profiles rp on rp.id = s.reporter_profile_id
    left join conversations cv on cv.id = s.conversation_id
    left join providers pv on pv.id = cv.provider_id
    left join profiles cu on cu.id = cv.customer_id
    where p_state is null or s.state = p_state
    order by (s.state = 'resolved'), s.created_at desc
    limit 200;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'admin_update_support_case(uuid, text, text)',
    'admin_grant_case_message_access(uuid, text)',
    'admin_revoke_case_message_access(uuid)',
    'admin_case_messages(uuid, bigint, int)',
    'admin_support_cases(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

notify pgrst, 'reload schema';
