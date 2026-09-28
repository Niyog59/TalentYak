-- M15 · Client and coach dashboards.
--
-- The dashboards are summaries of records that already exist — plans, logs,
-- check-ins, bookings, messages, earnings. Almost everything they show is
-- read through the existing functions and row-level security. This file adds
-- only what could not be read that way:
--
--   dashboard_marks           a person's own "snoozed", "handled" and
--                             "dismissed" marks on dashboard items. Private to
--                             them; never changes the item it points at
--   set_dashboard_mark        writes one, with the rules below
--   clear_dashboard_mark      removes one
--   coach_message_attention   per conversation the coach may read: unread
--                             (not yet opened) and unanswered (the client
--                             wrote last) kept apart, with no message text
--   coach_client_activity     per current client: dates and counts of what
--                             was recorded, never the values
--   my_call_allowance         calls left in the current paid period, only for
--                             a package that includes a fixed number
--
-- The rules that shape this file:
--
--   1. A mark is a reminder about a reminder. Snoozing hides an item from the
--      owner's own queue for a while; it never moves a deadline, never marks
--      a review, request or plan done, and the dashboard shows an item that is
--      due or overdue whatever its mark says. Completion always comes from
--      the underlying feature.
--   2. "Handled" exists only for a client message that needs no reply, and it
--      covers the messages that were there when it was set: the server
--      records how far it reaches, so a new message from the client brings
--      the conversation back.
--   3. Opening the dashboard reads nothing as "seen". Nothing here writes a
--      read marker, so a client never sees a read receipt for a preview.
--   4. Summaries carry dates and counts, never message text or health values.

-- ---------------------------------------------------------------------------
-- 1. Marks
-- ---------------------------------------------------------------------------

create table if not exists dashboard_marks (
  profile_id uuid not null references profiles (id) on delete cascade,
  area text not null check (area in ('client', 'coach')),
  -- What the mark is on: a kind and the id of the record.
  item_key text not null check (item_key ~ '^(msg|checkin|proposal|plan|planver|exp|appt):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  action text not null check (action in ('snoozed', 'handled', 'dismissed')),
  snoozed_until timestamptz,
  -- For "handled" on a conversation: the client's latest message it covers.
  through_seq bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, area, item_key),
  constraint dashboard_marks_snooze check ((action = 'snoozed') = (snoozed_until is not null)),
  constraint dashboard_marks_handled check ((action = 'handled') = (through_seq is not null)),
  constraint dashboard_marks_handled_is_message check (action <> 'handled' or item_key like 'msg:%')
);

create index if not exists dashboard_marks_snoozed_idx on dashboard_marks (snoozed_until) where snoozed_until is not null;

alter table dashboard_marks enable row level security;
revoke insert, update, delete, truncate on dashboard_marks from anon, authenticated;

create policy "owner reads own dashboard marks" on dashboard_marks
  for select using (profile_id = auth.uid ());

-- Snoozing is for a short while: a week at most, and never in the past.
create or replace function set_dashboard_mark (p_area text, p_item text, p_action text, p_until timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_through bigint;
  v_conv uuid;
  a record;
begin
  if v_uid is null then
    raise exception 'sign_in_required';
  end if;
  if exists (select 1 from profiles where id = v_uid and suspended_at is not null) then
    raise exception 'suspended';
  end if;
  if p_area not in ('client', 'coach') or p_action not in ('snoozed', 'handled', 'dismissed')
     or p_item !~ '^(msg|checkin|proposal|plan|planver|exp|appt):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'mark_invalid';
  end if;
  if p_area = 'coach' and not exists (select 1 from providers where profile_id = v_uid and status <> 'retired') then
    raise exception 'mark_not_permitted';
  end if;

  if p_action = 'snoozed' then
    if p_area <> 'coach' or p_until is null or p_until <= now() or p_until > now() + interval '7 days' then
      raise exception 'mark_invalid';
    end if;
  elsif p_action = 'dismissed' then
    -- Notices on the client's own dashboard: a plan update or an expectations
    -- update. Dismissing never acknowledges or accepts anything.
    if p_area <> 'client' or p_item !~ '^(planver|exp):' then
      raise exception 'mark_invalid';
    end if;
  else
    -- Handled: a coach's conversation, up to the client's latest message.
    if p_area <> 'coach' or p_item !~ '^msg:' then
      raise exception 'mark_invalid';
    end if;
    v_conv := substr(p_item, 5)::uuid;
    select * into a from conversation_access (v_conv, v_uid);
    if not found or a.role is distinct from 'coach' or not a.can_read then
      raise exception 'mark_not_permitted';
    end if;
    select max(seq) into v_through from messages where conversation_id = v_conv and sender_role = 'customer';
    if v_through is null then
      raise exception 'mark_invalid';
    end if;
  end if;

  insert into dashboard_marks (profile_id, area, item_key, action, snoozed_until, through_seq)
    values (v_uid, p_area, p_item, p_action, case when p_action = 'snoozed' then p_until end, v_through)
  on conflict (profile_id, area, item_key) do update
    set action = excluded.action, snoozed_until = excluded.snoozed_until, through_seq = excluded.through_seq, updated_at = now();

  return jsonb_build_object('ok', true, 'through_seq', v_through);
end;
$$;

create or replace function clear_dashboard_mark (p_area text, p_item text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from dashboard_marks where profile_id = auth.uid () and area = p_area and item_key = p_item;
$$;

revoke execute on function set_dashboard_mark (text, text, text, timestamptz) from public, anon;
grant execute on function set_dashboard_mark (text, text, text, timestamptz) to authenticated;
revoke execute on function clear_dashboard_mark (text, text) from public, anon;
grant execute on function clear_dashboard_mark (text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A coach's conversations: unread and unanswered, kept apart
-- ---------------------------------------------------------------------------

create index if not exists messages_conversation_role_idx on messages (conversation_id, sender_role, seq desc);

-- Unread: messages from the client after the coach's own read marker (only
-- opening the conversation moves it). Unanswered: the client's latest
-- message is later than the coach's latest. No message text is returned.
create or replace function coach_message_attention ()
returns table (
  conversation_id uuid,
  enrollment_id uuid,
  client_name text,
  state text,
  can_send boolean,
  unread_count bigint,
  last_client_seq bigint,
  last_client_at timestamptz,
  last_coach_at timestamptz,
  waiting_since timestamptz,
  awaiting_reply boolean,
  handled_through_seq bigint,
  assigned_from timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    cv.id,
    cv.enrollment_id,
    coalesce(nullif(trim(cu.preferred_name), ''), split_part(coalesce(cu.full_name, ''), ' ', 1), 'Client'),
    a.state,
    a.can_send,
    (select count(*) from messages m
      where m.conversation_id = cv.id
        and m.seq > coalesce((select r.last_read_seq from conversation_reads r
                              where r.conversation_id = cv.id and r.profile_id = auth.uid ()), 0)
        and m.sender_role = 'customer'),
    lc.seq,
    lc.created_at,
    lo.created_at,
    (select min(m.created_at) from messages m
      where m.conversation_id = cv.id and m.sender_role = 'customer' and m.seq > coalesce(lo.seq, 0)),
    coalesce(lc.seq, 0) > coalesce(lo.seq, 0),
    dm.through_seq,
    ea.effective_from
  from conversations cv
  join providers p on p.id = cv.provider_id
  cross join lateral conversation_access (cv.id, auth.uid ()) a
  join profiles cu on cu.id = cv.customer_id
  join enrollment_assignments ea on ea.id = cv.assignment_id
  left join lateral (
    select m.seq, m.created_at from messages m
    where m.conversation_id = cv.id and m.sender_role = 'customer' order by m.seq desc limit 1
  ) lc on true
  left join lateral (
    select m.seq, m.created_at from messages m
    where m.conversation_id = cv.id and m.sender_role = 'coach' order by m.seq desc limit 1
  ) lo on true
  left join dashboard_marks dm
    on dm.profile_id = auth.uid () and dm.area = 'coach' and dm.item_key = 'msg:' || cv.id::text and dm.action = 'handled'
  where p.profile_id = auth.uid ()
    and a.role = 'coach'
    and a.can_read
  order by lc.created_at desc nulls last;
$$;

revoke execute on function coach_message_attention () from public, anon;
grant execute on function coach_message_attention () to authenticated;

-- ---------------------------------------------------------------------------
-- 3. What each current client recorded, as dates and counts
-- ---------------------------------------------------------------------------

-- Security INVOKER: every count below is read through the coach's own
-- row-level security, so a coach whose view of earlier history is limited by
-- the client's sharing choice sees exactly that much, and nothing more.
-- `records_visible` says whether the coach may read this client's records at
-- all right now, so "nothing recorded" is never confused with "not shown".
create or replace function coach_client_activity (p_since timestamptz)
returns table (
  enrollment_id uuid,
  records_visible boolean,
  last_workout_on date,
  workouts_since bigint,
  last_body_on date,
  body_since bigint,
  last_food_on date,
  food_since bigint,
  last_checkin_at timestamptz,
  checkins_since bigint,
  last_client_message_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.enrollment_id,
    coaches_enrollment_now (c.enrollment_id),
    (select max(w.performed_at) from workout_logs w where w.enrollment_id = c.enrollment_id),
    (select count(*) from workout_logs w where w.enrollment_id = c.enrollment_id and w.created_at >= p_since),
    greatest(
      (select max(b.logged_on) from bodyweight_logs b where b.enrollment_id = c.enrollment_id),
      (select max(m.logged_on) from measurements m where m.enrollment_id = c.enrollment_id)),
    (select count(*) from bodyweight_logs b where b.enrollment_id = c.enrollment_id and b.created_at >= p_since)
      + (select count(*) from measurements m where m.enrollment_id = c.enrollment_id and m.created_at >= p_since),
    (select max(f.eaten_on) from food_entries f where f.enrollment_id = c.enrollment_id),
    (select count(distinct f.eaten_on) from food_entries f where f.enrollment_id = c.enrollment_id and f.created_at >= p_since),
    (select max(s.submitted_at) from checkin_submissions s join checkins k on k.id = s.checkin_id where k.enrollment_id = c.enrollment_id),
    (select count(*) from checkin_submissions s join checkins k on k.id = s.checkin_id
      where k.enrollment_id = c.enrollment_id and s.submitted_at >= p_since),
    (select max(m.created_at) from messages m join conversations cv on cv.id = m.conversation_id
      where cv.enrollment_id = c.enrollment_id and m.sender_role = 'customer')
  from my_clients () c;
$$;

revoke execute on function coach_client_activity (timestamptz) from public, anon;
grant execute on function coach_client_activity (timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Calls left in the current paid period
-- ---------------------------------------------------------------------------

-- Null unless the purchase includes a fixed number of calls a month. Counts
-- the same appointments claim_call_allowance counts, so the dashboard and a
-- booking can never disagree about what is left.
create or replace function my_call_allowance (p_enrollment uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  pu purchases%rowtype;
  v_allowed int;
  bc billing_cycles%rowtype;
  v_used int := 0;
begin
  if not (enrollment_belongs_to_me (p_enrollment) or coaches_enrollment_now (p_enrollment)) then
    return null;
  end if;
  select p.* into pu from purchases p join enrollments e on e.purchase_id = p.id where e.id = p_enrollment;
  if not found then
    return null;
  end if;
  v_allowed := nullif(pu.inclusions_snapshot->>'calls_included_per_month', '')::int;
  if coalesce(v_allowed, 0) <= 0 then
    return null;
  end if;
  select * into bc from billing_cycles
    where purchase_id = pu.id and period_start <= now() and period_end > now() and state in ('paid', 'delivered')
    order by sequence desc limit 1;
  if not found then
    return jsonb_build_object('allowed', v_allowed, 'used', null, 'period_start', null, 'period_end', null);
  end if;
  select count(*) into v_used from appointments ap
    join call_entitlements ce on ce.id = ap.entitlement_id
    where ce.billing_cycle_id = bc.id and ap.state in ('held', 'booked', 'on_hold');
  return jsonb_build_object('allowed', v_allowed, 'used', v_used, 'period_start', bc.period_start, 'period_end', bc.period_end);
end;
$$;

revoke execute on function my_call_allowance (uuid) from public, anon;
grant execute on function my_call_allowance (uuid) to authenticated;
