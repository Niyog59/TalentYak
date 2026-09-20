-- 0029 — The notification inbox, and what a person may switch off.
--
-- Until now the only way TalentYak could tell somebody anything was email, and
-- the only record that it had done so was `notification_deliveries`, which is
-- admin-only and keyed to a send rather than to a person. A customer had no
-- place to see what had happened on their account, and no way to say "stop
-- emailing me about that".
--
-- Two things are separated here, deliberately:
--
--   THE INBOX is a record for the person. Everything lands here, including
--   essential notices. It is never suppressed by a preference — switching off
--   an email does not mean you stop being told, it means you stop being
--   emailed.
--
--   EMAIL is a delivery choice. Some categories can be switched off; some
--   cannot, because they are how an account is operated safely.
--
-- WHAT IS NOT STORED HERE. Titles and bodies are SUMMARIES written by the
-- server. No message text, no health or body data, no grief data, no ceremony
-- detail ever reaches this table — it is readable by the person, is quoted into
-- email subjects, and appears on lock screens. Invariants 2 and 3 apply in
-- full: the notification says a message arrived, never what it said.

-- ---------------------------------------------------------------------------
-- 1. Categories, and which of them a person may switch off
-- ---------------------------------------------------------------------------
--
-- `essential` is not a marketing distinction. An essential category is one
-- where not telling the person would leave them unable to operate their own
-- account safely — a failed payment, a security change, a coach reassignment,
-- a deletion notice. Those cannot be switched off, and the preferences screen
-- says so rather than showing a toggle that silently does nothing.
--
-- Everything else defaults to ON but is the person's to turn off.

create table if not exists notification_categories (
  id text primary key,
  label text not null,
  description text not null,
  essential boolean not null,
  -- Only consulted for optional categories.
  default_email boolean not null default true,
  sort_order int not null default 100
);

alter table notification_categories enable row level security;
-- Labels only, no personal data. A signed-in person needs them to render the
-- preferences screen.
create policy "signed-in people read categories" on notification_categories
  for select to authenticated using (true);

insert into notification_categories (id, label, description, essential, default_email, sort_order) values
  ('account_security', 'Account and security',
   'Sign-in changes, password resets and two-factor updates.', true, true, 10),
  ('billing', 'Payments and billing',
   'Receipts, failed payments, refunds and changes to your plan.', true, true, 20),
  ('coaching', 'Your coaching',
   'Your coach assignment, coach changes, and your plan starting or ending.', true, true, 30),
  ('appointments', 'Session changes',
   'Confirmations, reschedules and cancellations for booked sessions.', true, true, 40),
  ('data_and_privacy', 'Your data',
   'Advance notice before anything of yours is scheduled for deletion, and export requests.', true, true, 50),
  ('appointment_reminders', 'Session reminders',
   'A reminder before a session you have booked.', false, true, 60),
  ('messages', 'Messages',
   'An email when you have unread messages from your coach.', false, true, 70),
  ('expectations', 'Plan and expectations updates',
   'When your coach updates what you have agreed to work on.', false, true, 80),
  ('product_updates', 'News from TalentYak',
   'Occasional updates about the service. Never sold or shared.', false, false, 90)
on conflict (id) do update set
  label = excluded.label,
  description = excluded.description,
  essential = excluded.essential,
  default_email = excluded.default_email,
  sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 2. Preferences — a row exists only where a person differs from the default
-- ---------------------------------------------------------------------------

create table if not exists notification_preferences (
  profile_id uuid not null references profiles (id) on delete cascade,
  category_id text not null references notification_categories (id),
  email_enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, category_id)
);

create index if not exists notification_preferences_profile_idx on notification_preferences (profile_id);

alter table notification_preferences enable row level security;
create policy "person reads own preferences" on notification_preferences
  for select using (profile_id = auth.uid ());
-- No insert/update policy: changes go through set_notification_preference(),
-- which refuses to switch off an essential category. A direct write could not
-- enforce that.

drop trigger if exists notification_preferences_touch on notification_preferences;
create trigger notification_preferences_touch before update on notification_preferences
  for each row execute function touch_updated_at ();

-- ---------------------------------------------------------------------------
-- 3. The inbox
-- ---------------------------------------------------------------------------

create table if not exists notifications (
  id uuid primary key default gen_random_uuid (),
  profile_id uuid not null references profiles (id) on delete cascade,
  category_id text not null references notification_categories (id),
  -- A summary, written by the server. Never user-supplied text, never content.
  title text not null check (length(title) between 1 and 160),
  body text check (body is null or length(body) <= 600),
  -- Where the person goes to act on it. Same-site path only, never a full URL:
  -- a stored absolute URL is an open-redirect waiting to be rendered as a link.
  path text check (path is null or path ~ '^/[A-Za-z0-9/_.%?=&#-]*$'),
  -- The outbox job that also emailed this, when one did. Null when the
  -- notification is in-app only, e.g. because the person switched email off.
  outbox_id uuid references outbox (id) on delete set null,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- The inbox is always read newest-first for one person.
create index if not exists notifications_profile_idx on notifications (profile_id, created_at desc);
-- The unread badge counts this.
create index if not exists notifications_unread_idx on notifications (profile_id) where read_at is null;
-- One notification per event per person, however many times a producer fires.
create unique index if not exists notifications_dedupe_key on notifications (profile_id, dedupe_key)
  where dedupe_key is not null;

alter table notifications enable row level security;
create policy "person reads own notifications" on notifications
  for select using (profile_id = auth.uid ());
-- Marking read goes through mark_notification_read(); no update policy exists,
-- so a person cannot rewrite the title of their own audit trail.

-- ---------------------------------------------------------------------------
-- 4. Functions
-- ---------------------------------------------------------------------------

-- May this person be EMAILED about this category? Essential categories are
-- always true. The inbox is unaffected by this answer.
create or replace function notification_email_allowed (p_profile_id uuid, p_category text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cat notification_categories%rowtype;
  v_pref boolean;
begin
  if not is_privileged_writer () then
    raise exception 'server_only' using hint = 'Delivery preferences are checked by the server.';
  end if;

  select * into cat from notification_categories where id = p_category;
  if not found then
    -- An unknown category is a programming error. Fail loud rather than
    -- silently emailing under a category nobody defined.
    raise exception 'unknown_notification_category: %', p_category;
  end if;

  if cat.essential then
    return true;
  end if;

  select email_enabled into v_pref
    from notification_preferences
    where profile_id = p_profile_id and category_id = p_category;

  return coalesce(v_pref, cat.default_email);
end;
$$;

-- Writes one notification to a person's inbox. Server-only: a person cannot
-- write to their own inbox, and neither can a coach write to a client's.
create or replace function create_notification (
  p_profile_id uuid,
  p_category text,
  p_title text,
  p_body text default null,
  p_path text default null,
  p_dedupe_key text default null,
  p_outbox_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not is_privileged_writer () then
    raise exception 'server_only' using hint = 'Only server functions write to an inbox.';
  end if;

  if not exists (select 1 from notification_categories where id = p_category) then
    raise exception 'unknown_notification_category: %', p_category;
  end if;

  insert into notifications (profile_id, category_id, title, body, path, dedupe_key, outbox_id)
  values (p_profile_id, p_category, p_title, p_body, p_path, p_dedupe_key, p_outbox_id)
  on conflict (profile_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  if v_id is null and p_dedupe_key is not null then
    select id into v_id from notifications
      where profile_id = p_profile_id and dedupe_key = p_dedupe_key;
  end if;

  return v_id;
end;
$$;

create or replace function mark_notification_read (p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid () is null then
    raise exception 'sign_in_required';
  end if;

  update notifications
    set read_at = coalesce(read_at, now())
    where id = p_id and profile_id = auth.uid ();

  return found;
end;
$$;

create or replace function mark_all_notifications_read ()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid () is null then
    raise exception 'sign_in_required';
  end if;

  update notifications set read_at = now()
    where profile_id = auth.uid () and read_at is null;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- A person changing their own preference. Refuses on an essential category
-- rather than accepting the change and ignoring it.
create or replace function set_notification_preference (p_category text, p_email_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cat notification_categories%rowtype;
begin
  if auth.uid () is null then
    raise exception 'sign_in_required';
  end if;

  select * into cat from notification_categories where id = p_category;
  if not found then
    raise exception 'unknown_notification_category' using hint = 'That setting does not exist.';
  end if;

  if cat.essential and not p_email_enabled then
    raise exception 'essential_category'
      using hint = 'This is how your account is kept safe and paid for. It cannot be switched off.';
  end if;

  insert into notification_preferences (profile_id, category_id, email_enabled)
  values (auth.uid (), p_category, p_email_enabled)
  on conflict (profile_id, category_id) do update set email_enabled = excluded.email_enabled;

  return p_email_enabled;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'notification_email_allowed(uuid, text)',
    'create_notification(uuid, text, text, text, text, text, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  foreach fn in array array[
    'mark_notification_read(uuid)',
    'mark_all_notifications_read()',
    'set_notification_preference(text, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

grant select on notification_categories to authenticated;

notify pgrst, 'reload schema';
