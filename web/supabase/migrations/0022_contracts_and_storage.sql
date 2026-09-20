-- M03 · Contracts later modules build on, and private storage.
--
-- Nothing in this file schedules a call, deletes data, or sends a notice to a
-- real person. It defines the shapes so M09 (calendar), M08/M12/M14 (retention)
-- can be built without re-designing the data model, and so the purchase
-- snapshot taken today already knows what a customer is entitled to.

-- ---------------------------------------------------------------------------
-- 1. Call entitlements and appointments — contracts for M09
-- ---------------------------------------------------------------------------
--
-- A purchase is not an appointment, and an appointment is not a workout. An
-- entitlement says "this period of this purchase includes N calls of M
-- minutes"; an appointment is one occurrence booked against it. No scheduler
-- exists. These tables are here so the scheduler has somewhere correct to
-- write, and so selling a plan with calls stays gated until it does.

create table if not exists call_entitlements (
  id uuid primary key default gen_random_uuid (),
  purchase_id uuid not null references purchases (id) on delete cascade,
  billing_cycle_id uuid references billing_cycles (id) on delete cascade,
  enrollment_id uuid references enrollments (id),
  period_start timestamptz not null,
  period_end timestamptz not null,
  calls_allowed int not null check (calls_allowed >= 0),
  call_duration_minutes int not null check (call_duration_minutes > 0),
  created_at timestamptz not null default now(),
  constraint call_entitlements_period check (period_end > period_start)
);

create unique index if not exists call_entitlements_cycle_key
  on call_entitlements (billing_cycle_id) where billing_cycle_id is not null;
create index if not exists call_entitlements_purchase_idx on call_entitlements (purchase_id);

alter table call_entitlements enable row level security;
create policy "customer reads own entitlements" on call_entitlements
  for select using (purchase_belongs_to_me (purchase_id));
create policy "current coach reads entitlements" on call_entitlements
  for select using (coaches_purchase_now (purchase_id));

do $$ begin
  create type appointment_state as enum (
    'held',                -- a slot reserved during booking, expires
    'booked',
    'completed',
    'no_show_customer',
    'no_show_provider',
    'cancelled_by_customer',
    'cancelled_by_provider',
    'technical_failure'
  );
exception when duplicate_object then null; end $$;

create table if not exists appointments (
  id uuid primary key default gen_random_uuid (),
  entitlement_id uuid references call_entitlements (id),
  purchase_id uuid not null references purchases (id),
  enrollment_id uuid references enrollments (id),
  provider_id uuid not null references providers (id),
  customer_id uuid not null references profiles (id),
  -- Instants in UTC, plus the IANA zones both people see them in. A recurring
  -- weekly call is defined in the coach's local time, not as a UTC offset.
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  provider_timezone text not null,
  customer_timezone text not null,
  -- Stable identity for one occurrence of a recurring series, so rebooking an
  -- occurrence does not create a second one.
  occurrence_key text,
  state appointment_state not null default 'held',
  hold_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_order check (ends_at > starts_at),
  constraint appointments_provider_tz check (provider_timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$'),
  constraint appointments_customer_tz check (customer_timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$')
);

create unique index if not exists appointments_occurrence_key on appointments (occurrence_key) where occurrence_key is not null;
create index if not exists appointments_provider_idx on appointments (provider_id, starts_at);
create index if not exists appointments_customer_idx on appointments (customer_id, starts_at);
create index if not exists appointments_purchase_idx on appointments (purchase_id);

-- A coach cannot be double-booked. Held and booked slots both occupy time.
alter table appointments drop constraint if exists appointments_no_double_booking;
alter table appointments add constraint appointments_no_double_booking
  exclude using gist (
    provider_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (state in ('held', 'booked'));

alter table appointments enable row level security;
create policy "customer reads own appointments" on appointments for select using (customer_id = auth.uid ());
create policy "provider reads own appointments" on appointments for select using (is_active_provider (provider_id));

drop trigger if exists appointments_touch on appointments;
create trigger appointments_touch before update on appointments
  for each row execute function touch_updated_at ();

-- ---------------------------------------------------------------------------
-- 2. Consent records
-- ---------------------------------------------------------------------------

create table if not exists consents (
  id uuid primary key default gen_random_uuid (),
  profile_id uuid not null references profiles (id) on delete cascade,
  kind text not null check (kind in ('terms', 'privacy', 'age_18_plus', 'marketing', 'photo_publication', 'call_recording')),
  version text not null,
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  -- A short, non-identifying note of where consent was given.
  context text
);

create index if not exists consents_profile_idx on consents (profile_id, kind, granted_at desc);

alter table consents enable row level security;
create policy "person reads own consents" on consents for select using (profile_id = auth.uid ());
-- Written by the onboarding server action; never by a client directly, so a
-- consent record cannot be backdated or forged.

-- ---------------------------------------------------------------------------
-- 3. Retention and deletion — foundations only, destructive execution OFF
-- ---------------------------------------------------------------------------
--
-- The founder wants advance email notice before scheduled deletion. The
-- earlier retention numbers were proposals, not a signed-off rule, so every
-- policy below is `proposed`, and the one switch that would let anything be
-- deleted is off.

create table if not exists retention_settings (
  id boolean primary key default true,
  -- Nothing reads this as true in this batch. Turning it on is a decision.
  destructive_execution_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint retention_settings_singleton check (id)
);

insert into retention_settings (id, destructive_execution_enabled) values (true, false)
  on conflict (id) do nothing;

alter table retention_settings enable row level security;
create policy "admin reads retention settings" on retention_settings for select using (is_admin ());

create table if not exists retention_policies (
  id text primary key,
  version int not null,
  resource_type text not null,
  eligibility_anchor text not null,
  retain_days int not null check (retain_days > 0),
  notice_days int[] not null default array[30, 7, 1],
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'retired')),
  note text,
  created_at timestamptz not null default now()
);

alter table retention_policies enable row level security;
create policy "admin reads retention policies" on retention_policies for select using (is_admin ());

insert into retention_policies (id, version, resource_type, eligibility_anchor, retain_days, status, note) values
  ('retention.programmes.v1', 1, 'programme_and_progress', 'last_activity', 730, 'proposed',
   'PROPOSAL: plans and progress 24 months after last activity. Not approved.'),
  ('retention.media.v1', 1, 'progress_media', 'relationship_end', 365, 'proposed',
   'PROPOSAL: photos and attachments around 12 months. Anchor not agreed. Not approved.'),
  ('retention.form_clips.v1', 1, 'form_review_video', 'upload', 90, 'proposed',
   'PROPOSAL: form clips 90 days unless selected for longer. Not approved.')
on conflict (id) do nothing;

create table if not exists retention_candidates (
  id uuid primary key default gen_random_uuid (),
  policy_id text not null references retention_policies (id),
  resource_type text not null,
  resource_id uuid not null,
  profile_id uuid references profiles (id) on delete cascade,
  eligible_at timestamptz not null,
  deletion_due_at timestamptz not null,
  state text not null default 'scheduled'
    check (state in ('scheduled', 'notice_failed', 'held', 'export_requested', 'cancelled', 'deleted')),
  hold_reason text,
  -- Test rows. Only these may have notices scheduled while a policy is proposed.
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  constraint retention_candidates_due check (deletion_due_at >= eligible_at)
);

create unique index if not exists retention_candidates_resource_key
  on retention_candidates (policy_id, resource_type, resource_id) where state not in ('cancelled', 'deleted');
create index if not exists retention_candidates_due_idx on retention_candidates (deletion_due_at) where state = 'scheduled';

alter table retention_candidates enable row level security;
create policy "person reads own retention candidates" on retention_candidates for select using (profile_id = auth.uid ());
create policy "admin reads retention candidates" on retention_candidates for select using (is_admin ());

create table if not exists retention_notices (
  id uuid primary key default gen_random_uuid (),
  candidate_id uuid not null references retention_candidates (id) on delete cascade,
  days_before int not null,
  due_at timestamptz not null,
  outbox_id uuid references outbox (id),
  state text not null default 'scheduled' check (state in ('scheduled', 'sent', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (candidate_id, days_before)
);

alter table retention_notices enable row level security;
create policy "admin reads retention notices" on retention_notices for select using (is_admin ());

create table if not exists deletion_requests (
  id uuid primary key default gen_random_uuid (),
  profile_id uuid not null references profiles (id) on delete cascade,
  requested_at timestamptz not null default now(),
  state text not null default 'received' check (state in ('received', 'in_review', 'completed', 'declined')),
  -- Financial records are retained by law and are anonymised, not erased.
  outcome_note text,
  completed_at timestamptz
);

create index if not exists deletion_requests_open_idx on deletion_requests (requested_at) where state in ('received', 'in_review');

alter table deletion_requests enable row level security;
create policy "person reads own deletion requests" on deletion_requests for select using (profile_id = auth.uid ());
create policy "admin reads deletion requests" on deletion_requests for select using (is_admin ());

-- Schedules the advance notices for one candidate. Refuses, under a policy
-- that is only proposed, for anything but a synthetic test row: nobody real
-- receives an email about a deletion rule nobody has approved.
create or replace function schedule_retention_notices (p_candidate_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c retention_candidates%rowtype;
  pol retention_policies%rowtype;
  d int;
  n int := 0;
  v_due timestamptz;
  v_outbox uuid;
begin
  select * into c from retention_candidates where id = p_candidate_id for update;
  if not found then
    raise exception 'candidate_not_found';
  end if;
  select * into pol from retention_policies where id = c.policy_id;

  if pol.status <> 'approved' and not c.is_synthetic then
    raise exception 'policy_not_approved'
      using hint = 'Retention notices cannot be scheduled for real people under a proposed policy.';
  end if;

  foreach d in array pol.notice_days loop
    v_due := c.deletion_due_at - make_interval(days => d);
    if v_due < now() then
      continue;  -- a notice whose moment has passed is not sent late
    end if;

    v_outbox := enqueue_outbox (
      'email.retention_notice',
      jsonb_build_object('candidate_id', c.id, 'days_before', d, 'deletion_due_at', c.deletion_due_at,
                         'resource_type', c.resource_type, 'synthetic', c.is_synthetic),
      'retention_notice:' || c.id || ':' || d,
      v_due,
      c.deletion_due_at
    );

    insert into retention_notices (candidate_id, days_before, due_at, outbox_id)
      values (c.id, d, v_due, v_outbox)
      on conflict (candidate_id, days_before) do nothing;
    if found then n := n + 1; end if;
  end loop;

  return n;
end;
$$;

revoke execute on function schedule_retention_notices (uuid) from public, anon, authenticated;
grant execute on function schedule_retention_notices (uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Private storage for coach photos and credential evidence
-- ---------------------------------------------------------------------------
--
-- Clients never write to storage directly. Every upload goes through a server
-- action that checks the real file type, caps size and pixel count, re-encodes
-- the image and strips all metadata (including GPS), and only then writes.
--
--   coach-photos-pending   private. A sanitised photo awaiting admin review.
--   coach-photos           public. Only a photo an admin approved is copied here.
--   provider-evidence      private. Certificates and documents, admin-viewable
--                          through short-lived signed links only.
--
-- No storage.objects policy is created for any of them, so the anon and
-- authenticated roles can neither read nor write the private buckets. The
-- public bucket is readable by URL, which is its purpose.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('coach-photos-pending', 'coach-photos-pending', false, 2097152, array['image/webp']),
  ('coach-photos', 'coach-photos', true, 2097152, array['image/webp']),
  ('provider-evidence', 'provider-evidence', false, 10485760, array['image/webp', 'application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table provider_public_profiles
  add column if not exists photo_pending_path text,
  add column if not exists photo_pending_at timestamptz,
  add column if not exists photo_review_note text;

-- A coach cannot point their public profile at an arbitrary image path. The
-- public photo is set only by the admin approval action.
create or replace function guard_profile_photo ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_privileged_writer () or in_action ('photo_review') then
    return new;
  end if;
  new.photo_path := old.photo_path;
  new.photo_pending_path := old.photo_pending_path;
  new.photo_pending_at := old.photo_pending_at;
  new.photo_review_note := old.photo_review_note;
  return new;
end;
$$;

drop trigger if exists provider_public_profiles_guard_photo on provider_public_profiles;
create trigger provider_public_profiles_guard_photo before update on provider_public_profiles
  for each row execute function guard_profile_photo ();

notify pgrst, 'reload schema';
