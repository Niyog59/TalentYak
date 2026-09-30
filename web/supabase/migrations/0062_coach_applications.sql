-- 0062 — Coach applications (M18).
--
-- A person with a TalentYak account applies to coach. The founder reviews the
-- application, and an approved applicant signs the coach agreement, which turns
-- the same account into a coach in `onboarding`. From there the existing coach
-- onboarding and the founder's final approval (0017) take over.
--
--   coach_applications               one application per attempt, owned by an account
--   coach_application_certificates   qualifications claimed, with an optional private file
--   coach_application_checklist      the founder's reviewer checklist (founder-only)
--   coach_application_notes          private founder notes (founder-only, append-only)
--   coach_application_events         decision history (founder-only, append-only)
--
-- RULES THIS FILE ENFORCES
--
--   1. Nobody writes these tables directly. Applicants act through functions
--      that check auth.uid(); founders through functions that check is_admin()
--      (a completed second factor); the server through service-only functions.
--   2. An applicant reads only their own application, and their certificates
--      only through a function that leaves out the founder's notes. Founders
--      read submitted applications; drafts stay private to the applicant.
--   3. Checking a qualification is separate from approving an application.
--      An uploaded file never marks anything as checked.
--   4. Approval does not make anyone a coach. Signing the agreement creates a
--      coach in `onboarding` — unpublished, no clients, nothing visible — and
--      the founder's existing final approval activates them.
--   5. Decision emails are queued in the same transaction as the decision,
--      keyed on the decision itself, so a repeated click or a retried job
--      can't send a second copy. Private notes and reasons are never emailed.
--   6. The "Accept coach applications" switch stops new applications here in
--      the database as well as on the page. Existing applicants keep status,
--      editing and withdrawal; founders keep review.
--   7. Files live in the existing private `provider-evidence` bucket, written
--      only by the server after checking the real file type.

-- ---------------------------------------------------------------------------
-- 1. The founder switch
-- ---------------------------------------------------------------------------

alter table feature_settings drop constraint if exists feature_settings_key_check;
alter table feature_settings add constraint feature_settings_key_check check (key in (
  'programmes', 'logging', 'check_ins', 'messaging', 'attachments', 'bookings',
  'calls', 'new_sales', 'public_profiles', 'waitlist', 'coach_changing', 'coach_applications'));

-- On at deploy: the founder asked for it on to test (2026-09-29). It can be
-- switched off from Feature controls at any time.
insert into feature_settings (key, mode, allowed_modes, reason) values
  ('coach_applications', 'on', array['on', 'off'], 'Founder: on for testing (M18)')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

create table if not exists coach_applications (
  id uuid primary key default gen_random_uuid (),
  -- Deleting the account deletes the application with it.
  profile_id uuid not null references profiles (id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'new', 'reviewing', 'interview', 'approved', 'waitlisted', 'declined', 'withdrawn')),
  full_name text not null check (char_length(full_name) between 2 and 120),
  country text not null check (char_length(country) between 2 and 60),
  timezone text not null check (char_length(timezone) between 3 and 64),
  languages text[] not null check (cardinality(languages) between 1 and 10),
  specialties text[] not null check (cardinality(specialties) between 1 and 12),
  experience_years text not null check (experience_years in ('lt1', '1-2', '3-5', '6-10', '10+')),
  experience text not null check (char_length(experience) between 20 and 2000),
  online_experience text check (online_experience is null or char_length(online_experience) <= 1500),
  instagram text check (instagram is null or char_length(instagram) <= 200),
  website text check (website is null or char_length(website) <= 300),
  profile_url text check (profile_url is null or char_length(profile_url) <= 300),
  availability text not null check (char_length(availability) between 5 and 500),
  new_client_capacity int check (new_client_capacity is null or new_client_capacity between 0 and 100),
  consistency_answer text not null check (char_length(consistency_answer) between 30 and 2000),
  privacy_version text not null check (char_length(privacy_version) between 3 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_reason text check (withdrawn_reason is null or withdrawn_reason in ('applicant', 'declined_agreement')),
  agreement_version text,
  agreement_signed_at timestamptz,
  agreement_signed_name text check (agreement_signed_name is null or char_length(agreement_signed_name) between 2 and 120),
  provider_id uuid references providers (id) on delete set null,
  acceptance_sends int not null default 0 check (acceptance_sends >= 0)
);

-- One open application per account. Declined and withdrawn ones don't count.
create unique index if not exists coach_applications_one_open
  on coach_applications (profile_id) where status not in ('declined', 'withdrawn');
create index if not exists coach_applications_profile_idx on coach_applications (profile_id);
create index if not exists coach_applications_status_idx on coach_applications (status, submitted_at desc);
create index if not exists coach_applications_submitted_idx on coach_applications (submitted_at desc);
create index if not exists coach_applications_country_idx on coach_applications (country);
create index if not exists coach_applications_provider_idx on coach_applications (provider_id);
create index if not exists coach_applications_specialties_idx on coach_applications using gin (specialties);
create index if not exists coach_applications_languages_idx on coach_applications using gin (languages);

alter table coach_applications enable row level security;
revoke insert, update, delete, truncate on coach_applications from anon, authenticated;
drop policy if exists "applicant reads own application" on coach_applications;
create policy "applicant reads own application" on coach_applications
  for select using (profile_id = auth.uid ());
drop policy if exists "admin reads submitted applications" on coach_applications;
create policy "admin reads submitted applications" on coach_applications
  for select using (is_admin () and status <> 'draft');

create table if not exists coach_application_certificates (
  id uuid primary key default gen_random_uuid (),
  application_id uuid not null references coach_applications (id) on delete cascade,
  qualification text not null check (char_length(qualification) between 2 and 160),
  issuing_body text not null check (char_length(issuing_body) between 2 and 160),
  expires_on date,
  -- Path in the PRIVATE provider-evidence bucket. Written only by the server.
  file_path text check (file_path is null or file_path ~ '^coach-applications/[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9_-]+\.(webp|pdf)$'),
  file_kind text check (file_kind is null or file_kind in ('image', 'pdf')),
  file_bytes int check (file_bytes is null or file_bytes > 0),
  file_added_at timestamptz,
  -- What TalentYak confirmed, set only by a founder. Independent of the
  -- application's status.
  verification_state text not null default 'unverified'
    check (verification_state in ('unverified', 'verified', 'could_not_verify')),
  verified_detail text check (verified_detail is null or char_length(verified_detail) <= 300),
  verified_by uuid references profiles (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint coach_application_certificates_file check ((file_path is null) = (file_kind is null))
);

create index if not exists coach_application_certificates_app_idx on coach_application_certificates (application_id, created_at);
create index if not exists coach_application_certificates_verified_by_idx on coach_application_certificates (verified_by);

alter table coach_application_certificates enable row level security;
revoke insert, update, delete, truncate on coach_application_certificates from anon, authenticated;
drop policy if exists "admin reads submitted certificates" on coach_application_certificates;
create policy "admin reads submitted certificates" on coach_application_certificates
  for select using (is_admin () and exists (
    select 1 from coach_applications a where a.id = application_id and a.status <> 'draft'));

create table if not exists coach_application_checklist (
  application_id uuid primary key references coach_applications (id) on delete cascade,
  qualification_checked boolean not null default false,
  communication boolean not null default false,
  beginner_scenario boolean not null default false,
  healthcare_referral boolean not null default false,
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists coach_application_checklist_updated_by_idx on coach_application_checklist (updated_by);

alter table coach_application_checklist enable row level security;
revoke insert, update, delete, truncate on coach_application_checklist from anon, authenticated;
drop policy if exists "admin reads application checklist" on coach_application_checklist;
create policy "admin reads application checklist" on coach_application_checklist
  for select using (is_admin ());

create table if not exists coach_application_notes (
  id uuid primary key default gen_random_uuid (),
  application_id uuid not null references coach_applications (id) on delete cascade,
  author_id uuid references profiles (id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists coach_application_notes_app_idx on coach_application_notes (application_id, created_at desc);
create index if not exists coach_application_notes_author_idx on coach_application_notes (author_id);

alter table coach_application_notes enable row level security;
revoke insert, update, delete, truncate on coach_application_notes from anon, authenticated;
drop policy if exists "admin reads application notes" on coach_application_notes;
create policy "admin reads application notes" on coach_application_notes
  for select using (is_admin ());

create table if not exists coach_application_events (
  id uuid primary key default gen_random_uuid (),
  application_id uuid not null references coach_applications (id) on delete cascade,
  kind text not null check (kind in (
    'created', 'submitted', 'updated', 'status_changed', 'withdrawn', 'agreement_signed',
    'agreement_declined', 'certificate_added', 'certificate_removed', 'certificate_file_added',
    'certificate_checked', 'checklist_updated', 'acceptance_resent', 'note_added')),
  from_status text,
  to_status text,
  actor_id uuid references profiles (id) on delete set null,
  actor_kind text not null check (actor_kind in ('applicant', 'founder')),
  -- The founder's private reason. Never shown or emailed to the applicant.
  reason text check (reason is null or char_length(reason) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists coach_application_events_app_idx on coach_application_events (application_id, created_at desc);
create index if not exists coach_application_events_actor_idx on coach_application_events (actor_id);

alter table coach_application_events enable row level security;
revoke insert, update, delete, truncate on coach_application_events from anon, authenticated;
drop policy if exists "admin reads application history" on coach_application_events;
create policy "admin reads application history" on coach_application_events
  for select using (is_admin ());

-- The switch, enforced underneath the page and the action.
create or replace function feature_guard_coach_applications ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if feature_mode ('coach_applications') <> 'on' then
    raise exception 'feature_paused' using hint = 'Coach applications are closed right now, so nothing was saved.';
  end if;
  return new;
end;
$$;

drop trigger if exists coach_applications_feature_guard on coach_applications;
create trigger coach_applications_feature_guard before insert on coach_applications
  for each row execute function feature_guard_coach_applications ();

-- ---------------------------------------------------------------------------
-- 3. Retention — a PROPOSAL, configurable, not active
-- ---------------------------------------------------------------------------
--
-- No retention period for applications has been decided. This records a
-- proposed one so it can be seen and changed in one place; while it is
-- `proposed`, nothing deletes a real application automatically (0022/0031).
-- Applicants can withdraw and delete their own data at any time.

insert into retention_policies (id, version, resource_type, eligibility_anchor, retain_days, status, note) values
  ('retention.coach_applications.v1', 1, 'coach_application', 'final_decision', 365, 'proposed',
   'PROPOSAL: closed coach applications (declined, withdrawn, or approved but never signed) 12 months after the final decision. Not approved. Coaches who signed keep their details under their coach account.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Shared checks
-- ---------------------------------------------------------------------------

-- The signed-in person may act as an applicant: a confirmed email address and
-- an account that isn't suspended.
create or replace function coach_applicant_check ()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid () is null then
    raise exception 'not_signed_in' using hint = 'Sign in to continue.';
  end if;
  if not exists (select 1 from auth.users u where u.id = auth.uid () and u.email_confirmed_at is not null) then
    raise exception 'email_unconfirmed' using hint = 'Confirm your email address first, using the link we sent you.';
  end if;
  if exists (select 1 from profiles where id = auth.uid () and suspended_at is not null) then
    raise exception 'account_suspended' using hint = 'This account is suspended. Contact support.';
  end if;
end;
$$;

create or replace function coach_application_editable (p_status text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_status in ('draft', 'new', 'reviewing', 'interview', 'waitlisted');
$$;

-- Text an applicant typed: trimmed, and empty means absent.
create or replace function coach_application_text (p jsonb, p_key text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(btrim(coalesce(p ->> p_key, '')), '');
$$;

create or replace function coach_application_list (p jsonb, p_key text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array(
    select distinct btrim(v) from jsonb_array_elements_text(coalesce(p -> p_key, '[]'::jsonb)) as v
    where btrim(v) <> '' and char_length(btrim(v)) <= 60
  ), '{}');
$$;

-- ---------------------------------------------------------------------------
-- 5. Applicant functions (the applicant's own session)
-- ---------------------------------------------------------------------------

-- Create a draft, or correct an application that is still under review.
create or replace function coach_application_save (p_application uuid, p_fields jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a coach_applications%rowtype;
  v_id uuid;
  v_name text := coach_application_text (p_fields, 'full_name');
  v_country text := coach_application_text (p_fields, 'country');
  v_tz text := coach_application_text (p_fields, 'timezone');
  v_langs text[] := coach_application_list (p_fields, 'languages');
  v_specs text[] := coach_application_list (p_fields, 'specialties');
  v_years text := coach_application_text (p_fields, 'experience_years');
  v_exp text := coach_application_text (p_fields, 'experience');
  v_online text := coach_application_text (p_fields, 'online_experience');
  v_ig text := coach_application_text (p_fields, 'instagram');
  v_web text := coach_application_text (p_fields, 'website');
  v_prof text := coach_application_text (p_fields, 'profile_url');
  v_avail text := coach_application_text (p_fields, 'availability');
  v_cap_text text := coach_application_text (p_fields, 'new_client_capacity');
  v_cap int;
  v_answer text := coach_application_text (p_fields, 'consistency_answer');
  v_privacy text := coach_application_text (p_fields, 'privacy_version');
begin
  perform coach_applicant_check ();

  if v_name is null or char_length(v_name) not between 2 and 120
    or v_country is null or char_length(v_country) not between 2 and 60
    or not is_iana_zone (v_tz)
    or cardinality(v_langs) not between 1 and 10
    or cardinality(v_specs) not between 1 and 12
    or v_years is null or v_years not in ('lt1', '1-2', '3-5', '6-10', '10+')
    or v_exp is null or char_length(v_exp) not between 20 and 2000
    or (v_online is not null and char_length(v_online) > 1500)
    or (v_ig is not null and (char_length(v_ig) > 200 or v_ig !~ '^(@?[A-Za-z0-9._]{1,30}|https://(www\.)?instagram\.com/[A-Za-z0-9._/?=-]+)$'))
    or (v_web is not null and (char_length(v_web) > 300 or v_web !~ '^https?://[^\s<>"]+\.[^\s<>"]+$'))
    or (v_prof is not null and (char_length(v_prof) > 300 or v_prof !~ '^https?://[^\s<>"]+\.[^\s<>"]+$'))
    or v_avail is null or char_length(v_avail) not between 5 and 500
    or (v_cap_text is not null and v_cap_text !~ '^[0-9]{1,3}$')
    or v_answer is null or char_length(v_answer) not between 30 and 2000
    or v_privacy is null
  then
    raise exception 'invalid_application' using hint = 'Some answers are missing or too long. Check the highlighted fields.';
  end if;
  v_cap := v_cap_text::int;
  if v_cap is not null and v_cap > 100 then
    raise exception 'invalid_application' using hint = 'Enter a number of new clients between 0 and 100.';
  end if;

  if p_application is null then
    if exists (select 1 from providers where profile_id = auth.uid ()) then
      raise exception 'already_a_coach' using hint = 'This account is already a TalentYak coach.';
    end if;
    if exists (select 1 from coach_applications where profile_id = auth.uid () and status not in ('declined', 'withdrawn')) then
      raise exception 'application_exists' using hint = 'You already have an application. Open it to make changes.';
    end if;
    insert into coach_applications (
      profile_id, full_name, country, timezone, languages, specialties, experience_years, experience,
      online_experience, instagram, website, profile_url, availability, new_client_capacity,
      consistency_answer, privacy_version)
    values (
      auth.uid (), v_name, v_country, v_tz, v_langs, v_specs, v_years, v_exp,
      v_online, v_ig, v_web, v_prof, v_avail, v_cap, v_answer, v_privacy)
    returning id into v_id;
    insert into coach_application_events (application_id, kind, to_status, actor_id, actor_kind)
      values (v_id, 'created', 'draft', auth.uid (), 'applicant');
    return v_id;
  end if;

  select * into a from coach_applications where id = p_application and profile_id = auth.uid () for update;
  if not found then
    raise exception 'not_found' using hint = 'That application wasn''t found.';
  end if;
  if not coach_application_editable (a.status) then
    raise exception 'application_locked' using hint = 'This application can''t be changed any more.';
  end if;

  update coach_applications set
    full_name = v_name, country = v_country, timezone = v_tz, languages = v_langs, specialties = v_specs,
    experience_years = v_years, experience = v_exp, online_experience = v_online, instagram = v_ig,
    website = v_web, profile_url = v_prof, availability = v_avail, new_client_capacity = v_cap,
    consistency_answer = v_answer, privacy_version = v_privacy, updated_at = now()
  where id = a.id;
  if a.status <> 'draft' then
    insert into coach_application_events (application_id, kind, from_status, to_status, actor_id, actor_kind)
      values (a.id, 'updated', a.status, a.status, auth.uid (), 'applicant');
  end if;
  return a.id;
end;
$$;

create or replace function coach_application_submit (p_application uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  a coach_applications%rowtype;
begin
  perform coach_applicant_check ();
  select * into a from coach_applications where id = p_application and profile_id = auth.uid () for update;
  if not found then
    raise exception 'not_found' using hint = 'That application wasn''t found.';
  end if;
  -- Submitting twice is harmless: the second press changes nothing and sends nothing.
  if a.status <> 'draft' then
    return a.status;
  end if;
  if feature_mode ('coach_applications') <> 'on' then
    raise exception 'feature_paused' using hint = 'Coach applications are closed right now, so this wasn''t sent. Your draft is saved.';
  end if;

  update coach_applications set status = 'new', submitted_at = now(), updated_at = now() where id = a.id;
  insert into coach_application_events (application_id, kind, from_status, to_status, actor_id, actor_kind)
    values (a.id, 'submitted', 'draft', 'new', auth.uid (), 'applicant');

  perform enqueue_outbox ('email.coach_application_received', jsonb_build_object('application_id', a.id),
    'coach_application_received:' || a.id);
  perform enqueue_outbox ('email.coach_application_submitted', jsonb_build_object('application_id', a.id),
    'coach_application_submitted:' || a.id);
  return 'new';
end;
$$;

-- Returns the file paths the server must remove from storage.
create or replace function coach_application_withdraw (p_application uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  a coach_applications%rowtype;
  v_paths text[];
begin
  if auth.uid () is null then
    raise exception 'not_signed_in' using hint = 'Sign in to continue.';
  end if;
  select * into a from coach_applications where id = p_application and profile_id = auth.uid () for update;
  if not found then
    raise exception 'not_found' using hint = 'That application wasn''t found.';
  end if;
  if a.status in ('withdrawn', 'declined', 'draft') then
    raise exception 'application_locked' using hint = 'This application isn''t active, so there''s nothing to withdraw.';
  end if;
  if a.agreement_signed_at is not null then
    raise exception 'application_locked' using hint = 'You''ve already signed the coach agreement. Contact support to stop coaching.';
  end if;

  select coalesce(array_agg(file_path), '{}') into v_paths
    from coach_application_certificates where application_id = a.id and file_path is not null;
  update coach_application_certificates set file_path = null, file_kind = null, file_bytes = null, file_added_at = null
    where application_id = a.id;
  update coach_applications set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = 'applicant', updated_at = now()
    where id = a.id;
  insert into coach_application_events (application_id, kind, from_status, to_status, actor_id, actor_kind)
    values (a.id, 'withdrawn', a.status, 'withdrawn', auth.uid (), 'applicant');
  return v_paths;
end;
$$;

-- "Delete my data": removes the application and everything attached to it.
-- The founder's change history keeps only that an application was deleted.
create or replace function coach_application_erase (p_application uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  a coach_applications%rowtype;
  v_paths text[];
begin
  if auth.uid () is null then
    raise exception 'not_signed_in' using hint = 'Sign in to continue.';
  end if;
  select * into a from coach_applications where id = p_application and profile_id = auth.uid () for update;
  if not found then
    raise exception 'not_found' using hint = 'That application wasn''t found.';
  end if;
  if a.agreement_signed_at is not null then
    raise exception 'application_locked' using hint = 'You''ve signed the coach agreement, so your details are part of your coach account. Contact support.';
  end if;

  select coalesce(array_agg(file_path), '{}') into v_paths
    from coach_application_certificates where application_id = a.id and file_path is not null;
  delete from coach_applications where id = a.id;
  if a.status <> 'draft' then
    perform write_admin_audit ('coach_application.erased_by_applicant', 'coach_application', a.id::text, null,
      jsonb_build_object('status', a.status), null);
  end if;
  return v_paths;
end;
$$;

create or replace function coach_application_add_certificate (
  p_application uuid, p_qualification text, p_issuing_body text, p_expires_on date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a coach_applications%rowtype;
  v_id uuid;
  v_q text := btrim(coalesce(p_qualification, ''));
  v_b text := btrim(coalesce(p_issuing_body, ''));
begin
  perform coach_applicant_check ();
  select * into a from coach_applications where id = p_application and profile_id = auth.uid () for update;
  if not found then
    raise exception 'not_found' using hint = 'That application wasn''t found.';
  end if;
  if not coach_application_editable (a.status) then
    raise exception 'application_locked' using hint = 'This application can''t be changed any more.';
  end if;
  if char_length(v_q) not between 2 and 160 or char_length(v_b) not between 2 and 160 then
    raise exception 'invalid_application' using hint = 'Enter the qualification and the organisation that issued it.';
  end if;
  if p_expires_on is not null and (p_expires_on < date '2000-01-01' or p_expires_on > date '2100-01-01') then
    raise exception 'invalid_application' using hint = 'Enter a real expiry date, or leave it empty.';
  end if;
  if (select count(*) from coach_application_certificates where application_id = a.id) >= 5 then
    raise exception 'too_many_certificates' using hint = 'You can add up to 5 qualifications.';
  end if;

  insert into coach_application_certificates (application_id, qualification, issuing_body, expires_on)
    values (a.id, v_q, v_b, p_expires_on) returning id into v_id;
  if a.status <> 'draft' then
    insert into coach_application_events (application_id, kind, actor_id, actor_kind)
      values (a.id, 'certificate_added', auth.uid (), 'applicant');
  end if;
  return v_id;
end;
$$;

-- Returns the removed file's path, if any, for the server to delete.
create or replace function coach_application_remove_certificate (p_certificate uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c coach_application_certificates%rowtype;
  a coach_applications%rowtype;
begin
  if auth.uid () is null then
    raise exception 'not_signed_in' using hint = 'Sign in to continue.';
  end if;
  select * into c from coach_application_certificates where id = p_certificate for update;
  select * into a from coach_applications where id = c.application_id and profile_id = auth.uid ();
  if c.id is null or a.id is null then
    raise exception 'not_found' using hint = 'That qualification wasn''t found.';
  end if;
  if not coach_application_editable (a.status) then
    raise exception 'application_locked' using hint = 'This application can''t be changed any more.';
  end if;
  delete from coach_application_certificates where id = c.id;
  if a.status <> 'draft' then
    insert into coach_application_events (application_id, kind, actor_id, actor_kind)
      values (a.id, 'certificate_removed', auth.uid (), 'applicant');
  end if;
  return c.file_path;
end;
$$;

-- The applicant's view of their qualifications: no founder notes.
create or replace function my_coach_application_certificates (p_application uuid)
returns table (id uuid, qualification text, issuing_body text, expires_on date, file_kind text, checked boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.qualification, c.issuing_body, c.expires_on, c.file_kind, c.verification_state = 'verified', c.created_at
  from coach_application_certificates c
  join coach_applications a on a.id = c.application_id
  where a.id = p_application and a.profile_id = auth.uid ()
  order by c.created_at;
$$;

create or replace function decline_coach_agreement (p_application uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  a coach_applications%rowtype;
  v_paths text[];
begin
  if auth.uid () is null then
    raise exception 'not_signed_in' using hint = 'Sign in to continue.';
  end if;
  select * into a from coach_applications where id = p_application and profile_id = auth.uid () for update;
  if not found then
    raise exception 'not_found' using hint = 'That application wasn''t found.';
  end if;
  if a.status <> 'approved' or a.agreement_signed_at is not null then
    raise exception 'application_locked' using hint = 'There''s no agreement waiting for you.';
  end if;

  select coalesce(array_agg(file_path), '{}') into v_paths
    from coach_application_certificates where application_id = a.id and file_path is not null;
  update coach_application_certificates set file_path = null, file_kind = null, file_bytes = null, file_added_at = null
    where application_id = a.id;
  update coach_applications set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = 'declined_agreement', updated_at = now()
    where id = a.id;
  insert into coach_application_events (application_id, kind, from_status, to_status, actor_id, actor_kind)
    values (a.id, 'agreement_declined', 'approved', 'withdrawn', auth.uid (), 'applicant');
  return v_paths;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Server-only functions (service role, after the server checked the session)
-- ---------------------------------------------------------------------------

-- Records a file the server has already checked, cleaned and stored. Returns
-- the path of any file it replaces, for the server to delete.
create or replace function coach_application_attach_file (
  p_user uuid, p_certificate uuid, p_path text, p_kind text, p_bytes int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c coach_application_certificates%rowtype;
  a coach_applications%rowtype;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;
  select * into c from coach_application_certificates where id = p_certificate for update;
  select * into a from coach_applications where id = c.application_id and profile_id = p_user;
  if c.id is null or a.id is null then
    raise exception 'not_found' using hint = 'That qualification wasn''t found.';
  end if;
  if not coach_application_editable (a.status) then
    raise exception 'application_locked' using hint = 'This application can''t be changed any more.';
  end if;
  if p_path is null or p_path not like ('coach-applications/' || a.id || '/' || c.id || '/%') then
    raise exception 'invalid_reference';
  end if;

  update coach_application_certificates
    set file_path = p_path, file_kind = p_kind, file_bytes = p_bytes, file_added_at = now()
    where id = c.id;
  if a.status <> 'draft' then
    insert into coach_application_events (application_id, kind, actor_id, actor_kind)
      values (a.id, 'certificate_file_added', p_user, 'applicant');
  end if;
  return c.file_path;
end;
$$;

-- Signing the agreement. Creates the coach in `onboarding` on the SAME account:
-- an existing role (for example an administrator) is kept, nothing else on the
-- account changes, and nothing is published. Qualifications carry over with
-- exactly the checked state the founder recorded.
create or replace function sign_coach_agreement (
  p_user uuid, p_application uuid, p_version text, p_signed_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a coach_applications%rowtype;
  pr profiles%rowtype;
  v_provider uuid;
  v_base text;
  v_slug text;
  n int := 0;
  v_name text := btrim(coalesce(p_signed_name, ''));
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;
  select * into a from coach_applications where id = p_application and profile_id = p_user for update;
  if not found then
    raise exception 'not_found' using hint = 'That application wasn''t found.';
  end if;
  if a.agreement_signed_at is not null then
    return a.provider_id;  -- signing twice is harmless
  end if;
  if a.status <> 'approved' then
    raise exception 'application_locked' using hint = 'There''s no agreement waiting for you.';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'signature_required' using hint = 'Type your full name to sign.';
  end if;
  if p_version is null or char_length(p_version) not between 3 and 60 then
    raise exception 'invalid_reference';
  end if;

  select * into pr from profiles where id = p_user for update;
  if pr.suspended_at is not null then
    raise exception 'account_suspended' using hint = 'This account is suspended. Contact support.';
  end if;
  if exists (select 1 from providers where profile_id = p_user) then
    raise exception 'already_a_coach' using hint = 'This account is already a TalentYak coach.';
  end if;

  v_base := regexp_replace(lower(a.full_name), '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  if v_base = '' then v_base := 'coach'; end if;
  v_base := left(v_base, 40);
  v_slug := v_base;
  while exists (select 1 from providers where slug = v_slug) loop
    n := n + 1;
    v_slug := v_base || '-' || n;
  end loop;

  insert into providers (profile_id, display_name, vertical_slug, status, slug, accepting_new_clients, active, timezone)
    values (p_user, a.full_name, 'fitness', 'onboarding', v_slug, false, true, a.timezone)
    returning id into v_provider;

  insert into provider_public_profiles (provider_id, display_name, specialties, languages)
    values (v_provider, a.full_name, a.specialties, a.languages);

  -- Only a customer account changes role. An administrator stays one; the
  -- coach record is what makes them a coach.
  update profiles set role = 'provider' where id = p_user and role = 'customer';

  insert into provider_credentials (provider_id, kind, claimed_title, issuing_body, expires_on, evidence_path,
                                    verification_state, verified_detail, verified_by, verified_at)
  select v_provider, 'certificate', c.qualification, c.issuing_body, c.expires_on, c.file_path,
         case c.verification_state when 'verified' then 'verified' when 'could_not_verify' then 'rejected' else 'unverified' end,
         c.verified_detail, c.verified_by, c.verified_at
  from coach_application_certificates c where c.application_id = a.id;

  insert into provider_status_events (provider_id, from_status, to_status, action, actor)
    values (v_provider, null, 'onboarding', 'application_agreement_signed', p_user);

  update coach_applications set
    agreement_version = p_version, agreement_signed_at = now(), agreement_signed_name = v_name,
    provider_id = v_provider, updated_at = now()
  where id = a.id;
  insert into coach_application_events (application_id, kind, from_status, to_status, actor_id, actor_kind)
    values (a.id, 'agreement_signed', 'approved', 'approved', p_user, 'applicant');

  return v_provider;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Founder functions (admin with a completed second factor)
-- ---------------------------------------------------------------------------

create or replace function coach_application_next_statuses (p_status text, p_signed boolean)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_status
    when 'new' then array['reviewing', 'interview', 'approved', 'waitlisted', 'declined']
    when 'reviewing' then array['interview', 'approved', 'waitlisted', 'declined']
    when 'interview' then array['reviewing', 'approved', 'waitlisted', 'declined']
    when 'waitlisted' then array['reviewing', 'interview', 'approved', 'declined']
    when 'declined' then array['reviewing']
    when 'approved' then case when p_signed then array[]::text[] else array['reviewing', 'waitlisted', 'declined'] end
    else array[]::text[]
  end;
$$;

create or replace function admin_set_coach_application_status (p_application uuid, p_to text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a coach_applications%rowtype;
  v_event uuid;
  v_emailed boolean := false;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  select * into a from coach_applications where id = p_application and status <> 'draft' for update;
  if not found then
    raise exception 'not_found' using hint = 'That application wasn''t found.';
  end if;
  if p_to = a.status then
    raise exception 'no_change' using hint = 'It is already set that way. Nothing was changed and no email was sent.';
  end if;
  if not (p_to = any (coach_application_next_statuses (a.status, a.agreement_signed_at is not null))) then
    raise exception 'invalid_transition' using hint = 'That change isn''t possible from the application''s current status.';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'invalid_application' using hint = 'Keep the reason under 1,000 characters.';
  end if;

  update coach_applications set
    status = p_to,
    decided_at = case when p_to in ('approved', 'waitlisted', 'declined') then now() else decided_at end,
    acceptance_sends = case when p_to = 'approved' then acceptance_sends + 1 else acceptance_sends end,
    updated_at = now()
  where id = a.id;
  insert into coach_application_events (application_id, kind, from_status, to_status, actor_id, actor_kind, reason)
    values (a.id, 'status_changed', a.status, p_to, auth.uid (), 'founder', nullif(btrim(coalesce(p_reason, '')), ''))
    returning id into v_event;

  -- One email per decision, keyed on the decision itself.
  if p_to in ('approved', 'waitlisted', 'declined') then
    perform enqueue_outbox ('email.coach_application_decision',
      jsonb_build_object('application_id', a.id, 'status', p_to, 'event_id', v_event),
      'coach_application_decision:' || v_event);
    v_emailed := true;
  end if;

  perform write_admin_audit ('coach_application.status', 'coach_application', a.id::text, p_reason,
    jsonb_build_object('status', a.status), jsonb_build_object('status', p_to));
  return jsonb_build_object('status', p_to, 'emailed', v_emailed);
end;
$$;

create or replace function admin_resend_coach_acceptance (p_application uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  a coach_applications%rowtype;
  v_event uuid;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  select * into a from coach_applications where id = p_application for update;
  if not found or a.status <> 'approved' or a.agreement_signed_at is not null then
    raise exception 'invalid_state' using hint = 'Only an approved applicant who hasn''t signed yet can be sent the invitation again.';
  end if;
  if a.acceptance_sends >= 5 then
    raise exception 'invalid_state' using hint = 'The invitation has been sent 5 times. Contact the applicant another way.';
  end if;
  update coach_applications set acceptance_sends = acceptance_sends + 1, updated_at = now() where id = a.id;
  insert into coach_application_events (application_id, kind, from_status, to_status, actor_id, actor_kind)
    values (a.id, 'acceptance_resent', 'approved', 'approved', auth.uid (), 'founder')
    returning id into v_event;
  perform enqueue_outbox ('email.coach_application_decision',
    jsonb_build_object('application_id', a.id, 'status', 'approved', 'event_id', v_event),
    'coach_application_decision:' || v_event);
  perform write_admin_audit ('coach_application.acceptance_resent', 'coach_application', a.id::text, null, null,
    jsonb_build_object('sends', a.acceptance_sends + 1));
  return a.acceptance_sends + 1;
end;
$$;

create or replace function admin_check_coach_certificate (p_certificate uuid, p_state text, p_detail text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c coach_application_certificates%rowtype;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if p_state not in ('unverified', 'verified', 'could_not_verify') then
    raise exception 'invalid_state';
  end if;
  if p_state = 'verified' and char_length(btrim(coalesce(p_detail, ''))) < 3 then
    raise exception 'reason_required' using hint = 'Say what you checked, for example "Confirmed with the issuer''s register".';
  end if;
  if p_detail is not null and char_length(p_detail) > 300 then
    raise exception 'invalid_application' using hint = 'Keep the note under 300 characters.';
  end if;
  select c2.* into c from coach_application_certificates c2
    join coach_applications a on a.id = c2.application_id
    where c2.id = p_certificate and a.status <> 'draft' for update of c2;
  if not found then
    raise exception 'not_found' using hint = 'That qualification wasn''t found.';
  end if;
  update coach_application_certificates set
    verification_state = p_state,
    verified_detail = case when p_state = 'unverified' then null else nullif(btrim(coalesce(p_detail, '')), '') end,
    verified_by = case when p_state = 'unverified' then null else auth.uid () end,
    verified_at = case when p_state = 'unverified' then null else now() end
  where id = c.id;
  insert into coach_application_events (application_id, kind, actor_id, actor_kind, reason)
    values (c.application_id, 'certificate_checked', auth.uid (), 'founder', p_state || ': ' || c.qualification);
  perform write_admin_audit ('coach_application.certificate_checked', 'coach_application', c.application_id::text, p_detail,
    jsonb_build_object('state', c.verification_state), jsonb_build_object('state', p_state));
end;
$$;

create or replace function admin_set_coach_application_checklist (
  p_application uuid, p_qualification boolean, p_communication boolean, p_scenario boolean, p_referral boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if not exists (select 1 from coach_applications where id = p_application and status <> 'draft') then
    raise exception 'not_found' using hint = 'That application wasn''t found.';
  end if;
  insert into coach_application_checklist (application_id, qualification_checked, communication, beginner_scenario, healthcare_referral, updated_by, updated_at)
    values (p_application, p_qualification, p_communication, p_scenario, p_referral, auth.uid (), now())
  on conflict (application_id) do update set
    qualification_checked = excluded.qualification_checked, communication = excluded.communication,
    beginner_scenario = excluded.beginner_scenario, healthcare_referral = excluded.healthcare_referral,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into coach_application_events (application_id, kind, actor_id, actor_kind)
    values (p_application, 'checklist_updated', auth.uid (), 'founder');
end;
$$;

create or replace function admin_add_coach_application_note (p_application uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This action needs an administrator who has completed two-factor sign-in.';
  end if;
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'invalid_application' using hint = 'Write a note of up to 4,000 characters.';
  end if;
  if not exists (select 1 from coach_applications where id = p_application and status <> 'draft') then
    raise exception 'not_found' using hint = 'That application wasn''t found.';
  end if;
  insert into coach_application_notes (application_id, author_id, body) values (p_application, auth.uid (), v_body)
    returning id into v_id;
  insert into coach_application_events (application_id, kind, actor_id, actor_kind)
    values (p_application, 'note_added', auth.uid (), 'founder');
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Who may call what
-- ---------------------------------------------------------------------------

revoke execute on function feature_guard_coach_applications () from public, anon, authenticated;
revoke execute on function coach_applicant_check () from public, anon, authenticated;

revoke execute on function coach_application_save (uuid, jsonb) from public, anon;
grant execute on function coach_application_save (uuid, jsonb) to authenticated;
revoke execute on function coach_application_submit (uuid) from public, anon;
grant execute on function coach_application_submit (uuid) to authenticated;
revoke execute on function coach_application_withdraw (uuid) from public, anon;
grant execute on function coach_application_withdraw (uuid) to authenticated;
revoke execute on function coach_application_erase (uuid) from public, anon;
grant execute on function coach_application_erase (uuid) to authenticated;
revoke execute on function coach_application_add_certificate (uuid, text, text, date) from public, anon;
grant execute on function coach_application_add_certificate (uuid, text, text, date) to authenticated;
revoke execute on function coach_application_remove_certificate (uuid) from public, anon;
grant execute on function coach_application_remove_certificate (uuid) to authenticated;
revoke execute on function my_coach_application_certificates (uuid) from public, anon;
grant execute on function my_coach_application_certificates (uuid) to authenticated;
revoke execute on function decline_coach_agreement (uuid) from public, anon;
grant execute on function decline_coach_agreement (uuid) to authenticated;

revoke execute on function coach_application_attach_file (uuid, uuid, text, text, int) from public, anon, authenticated;
grant execute on function coach_application_attach_file (uuid, uuid, text, text, int) to service_role;
revoke execute on function sign_coach_agreement (uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function sign_coach_agreement (uuid, uuid, text, text) to service_role;

revoke execute on function admin_set_coach_application_status (uuid, text, text) from public, anon;
grant execute on function admin_set_coach_application_status (uuid, text, text) to authenticated;
revoke execute on function admin_resend_coach_acceptance (uuid) from public, anon;
grant execute on function admin_resend_coach_acceptance (uuid) to authenticated;
revoke execute on function admin_check_coach_certificate (uuid, text, text) from public, anon;
grant execute on function admin_check_coach_certificate (uuid, text, text) to authenticated;
revoke execute on function admin_set_coach_application_checklist (uuid, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function admin_set_coach_application_checklist (uuid, boolean, boolean, boolean, boolean) to authenticated;
revoke execute on function admin_add_coach_application_note (uuid, text) from public, anon;
grant execute on function admin_add_coach_application_note (uuid, text) to authenticated;
