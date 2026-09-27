-- Batch 3 · Coaching Welcome & Expectations.
--
-- A mutual-expectations document, in three parts:
--
--   TalentYak essentials       platform-controlled; coaches cannot change it
--   Your coaching arrangement  the coach's own words, plus the facts of the
--                              plan that was actually bought
--   Your part as a client      adaptable expectations, with the coach's
--                              reciprocal commitments
--
-- It is NOT a contract, a waiver, or a replacement for the platform terms, and
-- nothing here can change what somebody bought. The rules that shape this file:
--
--   1. Published versions are immutable, exactly like offer versions. Drafting
--      a new version never rewrites what an existing client saw.
--   2. What was shown before payment is what the purchase records. Checkout
--      names the versions it displayed, and the database refuses if either is
--      no longer live, so a publish cannot slip in between reading and paying.
--   3. Acknowledging is a record that somebody read something. It has no path
--      to price, billing, refunds, service or access — the acknowledgement
--      table references nothing commercial, and no function here writes to a
--      purchase, a cycle, a subscription or an enrollment's state.
--   4. An unread document withholds nothing. No access function reads it.
--   5. Existing customers are not given a history they did not have. Nothing
--      is backfilled; they are presented the current version when a coach
--      publishes, labelled as presented after they joined.

-- ---------------------------------------------------------------------------
-- 1. TalentYak essentials — platform-controlled versions
-- ---------------------------------------------------------------------------

-- Every element is a path on this site: starts with one slash, lowercase
-- letters, digits, hyphens and slashes only. No scheme, no host, no "//".
create or replace function internal_paths_only (p text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(l ~ '^/[a-z0-9-]+(/[a-z0-9-]+)*$'), true) from unnest(p) l;
$$;

create table if not exists platform_expectation_versions (
  id uuid primary key default gen_random_uuid (),
  version int not null check (version > 0),

  conduct text not null default '',
  privacy text not null default '',
  -- The support ROUTE, in words. Never an invented address: the one real
  -- address is configured separately and shown by the application.
  support text not null default '',
  -- Internal paths only, chosen from a fixed list by the application. An
  -- external link cannot be stored here, so it cannot be rendered.
  policy_links text[] not null default '{}',

  material boolean not null default true,
  change_summary text,

  created_by uuid references profiles (id) on delete set null,
  published_at timestamptz,
  published_by uuid references profiles (id) on delete set null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint platform_expectations_conduct_len check (char_length(conduct) <= 4000),
  constraint platform_expectations_privacy_len check (char_length(privacy) <= 4000),
  constraint platform_expectations_support_len check (char_length(support) <= 2000),
  constraint platform_expectations_summary_len check (change_summary is null or char_length(change_summary) <= 500),
  constraint platform_expectations_links_count check (cardinality(policy_links) <= 10),
  constraint platform_expectations_links_internal check (internal_paths_only (policy_links)),
  constraint platform_expectations_superseded_after_publish check (superseded_at is null or published_at is not null)
);

create unique index if not exists platform_expectation_versions_version_key
  on platform_expectation_versions (version);
create unique index if not exists platform_expectation_versions_live
  on platform_expectation_versions ((true)) where published_at is not null and superseded_at is null;
create unique index if not exists platform_expectation_versions_one_draft
  on platform_expectation_versions ((true)) where published_at is null;
create index if not exists platform_expectation_versions_created_by_idx
  on platform_expectation_versions (created_by);
create index if not exists platform_expectation_versions_published_by_idx
  on platform_expectation_versions (published_by);

drop trigger if exists platform_expectation_versions_touch on platform_expectation_versions;
create trigger platform_expectation_versions_touch before update on platform_expectation_versions
  for each row execute function touch_updated_at ();

alter table platform_expectation_versions enable row level security;
revoke insert, update, delete, truncate on platform_expectation_versions from anon, authenticated;

-- Published essentials are public: they are shown before anyone signs in.
create policy "anyone reads published platform expectations" on platform_expectation_versions
  for select using (published_at is not null);
create policy "admin reads platform expectation drafts" on platform_expectation_versions
  for select using (is_admin ());

-- ---------------------------------------------------------------------------
-- 2. The coach's arrangement — coach-controlled versions
-- ---------------------------------------------------------------------------

create table if not exists coach_expectation_versions (
  id uuid primary key default gen_random_uuid (),
  provider_id uuid not null references providers (id) on delete cascade,
  version int not null check (version > 0),

  -- "Your coaching arrangement", in the coach's own words. Plain text, rendered
  -- as text: never HTML, never a link, never an embed.
  provides text not null default '',
  meeting_approach text not null default '',
  typical_duration text not null default '',
  appointments text not null default '',
  messaging_availability text not null default '',
  response_expectation text not null default '',
  changes text not null default '',

  -- "Your part as a client", and what the coach commits to in return.
  client_part text[] not null default '{}',
  coach_part text[] not null default '{}',

  material boolean not null default true,
  change_summary text,

  published_at timestamptz,
  published_by uuid references profiles (id) on delete set null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint coach_expectations_provides_len check (char_length(provides) <= 1500),
  constraint coach_expectations_meeting_len check (char_length(meeting_approach) <= 1500),
  constraint coach_expectations_duration_len check (char_length(typical_duration) <= 300),
  constraint coach_expectations_appointments_len check (char_length(appointments) <= 1500),
  constraint coach_expectations_messaging_len check (char_length(messaging_availability) <= 1000),
  constraint coach_expectations_response_len check (char_length(response_expectation) <= 500),
  constraint coach_expectations_changes_len check (char_length(changes) <= 1500),
  constraint coach_expectations_client_count check (cardinality(client_part) <= 12),
  constraint coach_expectations_coach_count check (cardinality(coach_part) <= 12),
  constraint coach_expectations_client_item_len check (char_length(array_to_string(client_part, '')) <= 12 * 300),
  constraint coach_expectations_coach_item_len check (char_length(array_to_string(coach_part, '')) <= 12 * 300),
  constraint coach_expectations_summary_len check (change_summary is null or char_length(change_summary) <= 500),
  constraint coach_expectations_superseded_after_publish check (superseded_at is null or published_at is not null)
);

create unique index if not exists coach_expectation_versions_key
  on coach_expectation_versions (provider_id, version);
create index if not exists coach_expectation_versions_provider_idx
  on coach_expectation_versions (provider_id, version desc);
create unique index if not exists coach_expectation_versions_live
  on coach_expectation_versions (provider_id) where published_at is not null and superseded_at is null;
create unique index if not exists coach_expectation_versions_one_draft
  on coach_expectation_versions (provider_id) where published_at is null;
create index if not exists coach_expectation_versions_published_by_idx
  on coach_expectation_versions (published_by);

drop trigger if exists coach_expectation_versions_touch on coach_expectation_versions;
create trigger coach_expectation_versions_touch before update on coach_expectation_versions
  for each row execute function touch_updated_at ();

-- ---------------------------------------------------------------------------
-- 3. Immutability, for both version tables
-- ---------------------------------------------------------------------------

create or replace function freeze_published_expectations ()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then
      raise exception 'expectations_published' using
        errcode = 'restrict_violation',
        hint = 'A published expectations version cannot be deleted.';
    end if;
    return old;
  end if;

  if old.published_at is null then
    return new;  -- still a draft
  end if;

  -- Published: only superseded_at (once) and updated_at may move.
  if (to_jsonb(new) - 'superseded_at' - 'updated_at') is distinct from (to_jsonb(old) - 'superseded_at' - 'updated_at')
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at) then
    raise exception 'expectations_published' using
      errcode = 'restrict_violation',
      hint = 'A published expectations version is immutable. Publish a new version instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists platform_expectation_versions_freeze on platform_expectation_versions;
create trigger platform_expectation_versions_freeze
  before update or delete on platform_expectation_versions
  for each row execute function freeze_published_expectations ();

drop trigger if exists coach_expectation_versions_freeze on coach_expectation_versions;
create trigger coach_expectation_versions_freeze
  before update or delete on coach_expectation_versions
  for each row execute function freeze_published_expectations ();

-- ---------------------------------------------------------------------------
-- 4. What each relationship was shown, and who acknowledged it
-- ---------------------------------------------------------------------------

create table if not exists enrollment_expectations (
  id uuid primary key default gen_random_uuid (),
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  -- The coach whose words these are, at the time.
  provider_id uuid not null references providers (id),
  coach_version_id uuid not null references coach_expectation_versions (id),
  platform_version_id uuid not null references platform_expectation_versions (id),
  -- Set only for a presentation made AT purchase, from the purchase snapshot.
  purchase_id uuid references purchases (id),
  offer_version_id uuid references offer_versions (id),
  --   purchase      shown before payment and recorded with the purchase
  --   revision      a newer version published during the relationship
  --   reassignment  the incoming coach's version after a coach change
  --   legacy        first shown to someone who joined before this existed
  source text not null check (source in ('purchase', 'revision', 'reassignment', 'legacy')),
  acknowledgement_requested boolean not null default true,
  previous_id uuid references enrollment_expectations (id),
  presented_at timestamptz not null default now(),
  constraint enrollment_expectations_purchase_source check (
    (source = 'purchase') = (purchase_id is not null)
  )
);

create unique index if not exists enrollment_expectations_versions_key
  on enrollment_expectations (enrollment_id, coach_version_id, platform_version_id);
create index if not exists enrollment_expectations_enrollment_idx
  on enrollment_expectations (enrollment_id, presented_at desc);
create index if not exists enrollment_expectations_provider_idx on enrollment_expectations (provider_id);
create index if not exists enrollment_expectations_coach_version_idx on enrollment_expectations (coach_version_id);
create index if not exists enrollment_expectations_platform_version_idx on enrollment_expectations (platform_version_id);
create index if not exists enrollment_expectations_purchase_idx on enrollment_expectations (purchase_id) where purchase_id is not null;
create index if not exists enrollment_expectations_offer_version_idx on enrollment_expectations (offer_version_id) where offer_version_id is not null;
create index if not exists enrollment_expectations_previous_idx on enrollment_expectations (previous_id) where previous_id is not null;

alter table enrollment_expectations enable row level security;
revoke insert, update, delete, truncate on enrollment_expectations from anon, authenticated;

-- Readable by the client, and by the coach currently assigned. A former coach
-- does not follow the client after a change; another client never sees it.
create or replace function expectations_readable (e_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from enrollments e
    join profiles pr on pr.id = e.customer_id
    where e.id = e_id and e.customer_id = auth.uid () and pr.suspended_at is null
  )
  or coach_may_read_record (e_id, now(), false);
$$;

revoke execute on function expectations_readable (uuid) from public, anon;
grant execute on function expectations_readable (uuid) to authenticated, service_role;

create policy "participants read presented expectations" on enrollment_expectations
  for select using (expectations_readable (enrollment_id));
create policy "admin reads presented expectations" on enrollment_expectations
  for select using (is_admin ());

create table if not exists expectation_acknowledgements (
  id uuid primary key default gen_random_uuid (),
  presentation_id uuid not null unique references enrollment_expectations (id) on delete cascade,
  actor_profile_id uuid references profiles (id) on delete set null,
  -- Copied so the record stands on its own: who read which words, when.
  coach_version_id uuid not null references coach_expectation_versions (id),
  platform_version_id uuid not null references platform_expectation_versions (id),
  -- The server's clock, never the browser's.
  acknowledged_at timestamptz not null default now()
);

create index if not exists expectation_acknowledgements_actor_idx on expectation_acknowledgements (actor_profile_id);
create index if not exists expectation_acknowledgements_coach_version_idx on expectation_acknowledgements (coach_version_id);
create index if not exists expectation_acknowledgements_platform_version_idx on expectation_acknowledgements (platform_version_id);

alter table expectation_acknowledgements enable row level security;
revoke insert, update, delete, truncate on expectation_acknowledgements from anon, authenticated;

create policy "participants read acknowledgements" on expectation_acknowledgements
  for select using (
    exists (select 1 from enrollment_expectations x where x.id = expectation_acknowledgements.presentation_id and expectations_readable (x.enrollment_id))
  );
create policy "admin reads acknowledgements" on expectation_acknowledgements
  for select using (is_admin ());

-- Append-only. A correction is never an edit of what somebody acknowledged.
create or replace function prevent_acknowledgement_change ()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'acknowledgement_immutable' using errcode = 'restrict_violation';
  end if;
  -- Deletion only as a consequence of the relationship itself being deleted.
  if exists (select 1 from enrollment_expectations where id = old.presentation_id) then
    raise exception 'acknowledgement_immutable' using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists expectation_acknowledgements_append_only on expectation_acknowledgements;
create trigger expectation_acknowledgements_append_only
  before update or delete on expectation_acknowledgements
  for each row execute function prevent_acknowledgement_change ();

-- ---------------------------------------------------------------------------
-- 5. Coach versions: who reads what
-- ---------------------------------------------------------------------------

alter table coach_expectation_versions enable row level security;
revoke insert, update, delete, truncate on coach_expectation_versions from anon, authenticated;

-- The live version of a public coach is shown before purchase.
create policy "public reads live coach expectations" on coach_expectation_versions
  for select using (published_at is not null and superseded_at is null and provider_is_public (provider_id));
create policy "coach reads own expectations" on coach_expectation_versions
  for select using (is_active_provider (provider_id));
-- A client keeps reading exactly what they were shown, even once superseded or
-- after the coach who wrote it has left.
create policy "client reads presented coach expectations" on coach_expectation_versions
  for select using (
    exists (
      select 1 from enrollment_expectations x
      where x.coach_version_id = coach_expectation_versions.id and expectations_readable (x.enrollment_id)
    )
  );
create policy "admin reads coach expectations" on coach_expectation_versions
  for select using (is_admin ());

-- Superseded platform versions are already public (published_at is not null).

-- ---------------------------------------------------------------------------
-- 6. Messages can carry a link to a presented version
-- ---------------------------------------------------------------------------

alter table messages
  add column if not exists expectations_presentation_id uuid references enrollment_expectations (id) on delete set null;
create index if not exists messages_expectations_idx
  on messages (expectations_presentation_id) where expectations_presentation_id is not null;

alter table messages drop constraint if exists messages_kind_check;
alter table messages add constraint messages_kind_check
  check (kind in ('text', 'attachment', 'system', 'expectations_link'));
alter table messages drop constraint if exists messages_expectations_link_target;
alter table messages add constraint messages_expectations_link_target
  check ((kind = 'expectations_link') = (expectations_presentation_id is not null));

-- ---------------------------------------------------------------------------
-- 7. Presenting a version to a relationship
-- ---------------------------------------------------------------------------
--
-- One path for every source. Records the presentation, posts a link into the
-- open conversation, and — except at purchase, where the person has just read
-- it — queues a notice through M08. The notice names nobody's words: the
-- coach's name and a link, never the content.
--
-- Internal. Not callable through the API at all (EXECUTE is revoked from every
-- API role): it is reached only from the security-definer publish and trigger
-- functions below, which make their own authorisation decision first. A
-- signed-in coach publishing is not a privileged writer, so a runtime
-- is_privileged_writer() check here would refuse the legitimate path.

create or replace function present_expectations (
  p_enrollment uuid,
  p_provider uuid,
  p_coach_version uuid,
  p_platform_version uuid,
  p_source text,
  p_ack_requested boolean,
  p_purchase uuid default null,
  p_offer_version uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev uuid;
  v_id uuid;
  v_conv conversations;
  v_seq bigint;
  v_customer uuid;
  v_label text;
begin
  select id into v_prev from enrollment_expectations
    where enrollment_id = p_enrollment
    order by presented_at desc, id desc limit 1;

  insert into enrollment_expectations (
    enrollment_id, provider_id, coach_version_id, platform_version_id,
    purchase_id, offer_version_id, source, acknowledgement_requested, previous_id
  ) values (
    p_enrollment, p_provider, p_coach_version, p_platform_version,
    p_purchase, p_offer_version, p_source, p_ack_requested, v_prev
  )
  on conflict (enrollment_id, coach_version_id, platform_version_id) do nothing
  returning id into v_id;

  if v_id is null then
    return null;  -- this relationship has already been shown these exact versions
  end if;

  -- The link goes into the conversation for the assignment that is open now.
  select c.* into v_conv from conversations c
    join enrollment_assignments a on a.id = c.assignment_id
    where c.enrollment_id = p_enrollment and a.effective_to is null
    for update of c;

  if found then
    v_label := case p_source
      when 'purchase' then 'Your Coaching Welcome & Expectations is ready to read.'
      when 'reassignment' then 'Your new coach''s Welcome & Expectations is ready to read.'
      when 'legacy' then 'A Coaching Welcome & Expectations document is now available.'
      else 'Your Coaching Welcome & Expectations has been updated.'
    end;

    update conversations set last_seq = last_seq + 1, last_message_at = now()
      where id = v_conv.id returning last_seq into v_seq;
    insert into messages (conversation_id, seq, sender_profile_id, sender_role, kind, body,
                          client_message_id, expectations_presentation_id)
      values (v_conv.id, v_seq, null, 'system', 'expectations_link', v_label, gen_random_uuid (), v_id);
    insert into conversation_signals (conversation_id, kind) values (v_conv.id, 'message');
  end if;

  if p_source <> 'purchase' and p_ack_requested then
    select customer_id into v_customer from enrollments where id = p_enrollment;
    perform enqueue_outbox (
      'email.expectations_updated',
      jsonb_build_object(
        'customer_id', v_customer,
        'provider_id', p_provider,
        'enrollment_id', p_enrollment,
        'presentation_id', v_id
      ),
      'expectations:' || p_enrollment || ':' || v_id,
      now(),
      now() + interval '14 days'
    );
  end if;

  return v_id;
end;
$$;

revoke execute on function present_expectations (uuid, uuid, uuid, uuid, text, boolean, uuid, uuid) from public, anon, authenticated;
grant execute on function present_expectations (uuid, uuid, uuid, uuid, text, boolean, uuid, uuid) to service_role;

-- The live versions, or null.
create or replace function live_platform_expectations ()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from platform_expectation_versions
  where published_at is not null and superseded_at is null;
$$;

create or replace function live_coach_expectations (p_provider uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from coach_expectation_versions
  where provider_id = p_provider and published_at is not null and superseded_at is null;
$$;

revoke execute on function live_platform_expectations () from public, anon, authenticated;
revoke execute on function live_coach_expectations (uuid) from public, anon, authenticated;
grant execute on function live_platform_expectations () to service_role;
grant execute on function live_coach_expectations (uuid) to service_role;

-- Present a newly published version to every live relationship it applies to.
-- `p_provider` null means the platform essentials changed, which applies to all.
create or replace function present_to_current_clients (p_provider uuid, p_material boolean)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_platform uuid := live_platform_expectations ();
  v_coach uuid;
  v_had boolean;
  v_count int := 0;
begin
  if v_platform is null then
    return 0;
  end if;

  for r in
    select e.id as enrollment_id, a.provider_id
    from enrollments e
    join enrollment_assignments a on a.enrollment_id = e.id and a.effective_to is null
    where e.state in ('active', 'paused')
      and (p_provider is null or a.provider_id = p_provider)
  loop
    v_coach := live_coach_expectations (r.provider_id);
    continue when v_coach is null;

    select exists (select 1 from enrollment_expectations where enrollment_id = r.enrollment_id) into v_had;

    if present_expectations (
      r.enrollment_id, r.provider_id, v_coach, v_platform,
      case when v_had then 'revision' else 'legacy' end,
      -- Someone who has never been shown a document is always asked to read it.
      p_material or not v_had
    ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function present_to_current_clients (uuid, boolean) from public, anon, authenticated;
grant execute on function present_to_current_clients (uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Coach: save a draft, publish it
-- ---------------------------------------------------------------------------

create or replace function my_expectations_provider ()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from providers p
  join profiles pr on pr.id = p.profile_id
  where p.profile_id = auth.uid ()
    and p.suspended_at is null and p.status <> 'suspended' and pr.suspended_at is null
    and p.active
  limit 1;
$$;

revoke execute on function my_expectations_provider () from public, anon;
grant execute on function my_expectations_provider () to authenticated;

-- Creates or replaces the coach's single draft. Text arrives already trimmed
-- and capped by the application; the table's checks are the backstop.
create or replace function save_my_expectations_draft (p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid := my_expectations_provider ();
  v_id uuid;
  v_client text[];
  v_coach text[];
begin
  if v_provider is null then
    raise exception 'not_a_coach' using hint = 'Only an active coach can edit their expectations.';
  end if;

  v_client := coalesce(array(select jsonb_array_elements_text(coalesce(p->'client_part', '[]'::jsonb))), '{}');
  v_coach := coalesce(array(select jsonb_array_elements_text(coalesce(p->'coach_part', '[]'::jsonb))), '{}');
  if exists (select 1 from unnest(v_client || v_coach) t where char_length(t) > 300) then
    raise exception 'item_too_long' using hint = 'Keep each point under 300 characters.';
  end if;

  select id into v_id from coach_expectation_versions
    where provider_id = v_provider and published_at is null
    for update;

  if v_id is null then
    -- Serialise version numbering per coach.
    perform 1 from providers where id = v_provider for update;
    insert into coach_expectation_versions (provider_id, version)
      values (v_provider, coalesce((select max(version) from coach_expectation_versions where provider_id = v_provider), 0) + 1)
      returning id into v_id;
  end if;

  update coach_expectation_versions set
    provides = coalesce(p->>'provides', ''),
    meeting_approach = coalesce(p->>'meeting_approach', ''),
    typical_duration = coalesce(p->>'typical_duration', ''),
    appointments = coalesce(p->>'appointments', ''),
    messaging_availability = coalesce(p->>'messaging_availability', ''),
    response_expectation = coalesce(p->>'response_expectation', ''),
    changes = coalesce(p->>'changes', ''),
    client_part = v_client,
    coach_part = v_coach
  where id = v_id;

  return v_id;
end;
$$;

revoke execute on function save_my_expectations_draft (jsonb) from public, anon;
grant execute on function save_my_expectations_draft (jsonb) to authenticated;

create or replace function discard_my_expectations_draft ()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid := my_expectations_provider ();
begin
  if v_provider is null then
    raise exception 'not_a_coach';
  end if;
  delete from coach_expectation_versions where provider_id = v_provider and published_at is null;
  return found;
end;
$$;

revoke execute on function discard_my_expectations_draft () from public, anon;
grant execute on function discard_my_expectations_draft () to authenticated;

create or replace function publish_my_expectations (p_draft uuid, p_material boolean, p_summary text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider uuid := my_expectations_provider ();
  d coach_expectation_versions%rowtype;
  v_had_live boolean;
  v_presented int;
  v_summary text := nullif(btrim(coalesce(p_summary, '')), '');
begin
  if v_provider is null then
    raise exception 'not_a_coach';
  end if;

  -- Same lock the draft path takes: one publish at a time per coach.
  perform 1 from providers where id = v_provider for update;

  select * into d from coach_expectation_versions
    where id = p_draft and provider_id = v_provider and published_at is null
    for update;
  if not found then
    raise exception 'draft_not_found' using hint = 'That draft has already been published or discarded. Refresh the page.';
  end if;

  if btrim(d.provides) = '' or btrim(d.meeting_approach) = '' or btrim(d.appointments) = ''
     or btrim(d.messaging_availability) = '' or btrim(d.response_expectation) = '' or btrim(d.changes) = ''
     or cardinality(d.client_part) = 0 or cardinality(d.coach_part) = 0 then
    raise exception 'expectations_incomplete' using hint = 'Fill in every required part before publishing.';
  end if;
  if v_summary is not null and char_length(v_summary) > 500 then
    raise exception 'summary_too_long';
  end if;

  v_had_live := live_coach_expectations (v_provider) is not null;

  update coach_expectation_versions set superseded_at = now()
    where provider_id = v_provider and published_at is not null and superseded_at is null;

  update coach_expectation_versions set
    published_at = now(),
    published_by = auth.uid (),
    material = coalesce(p_material, true) or not v_had_live,
    change_summary = v_summary
  where id = d.id;

  v_presented := present_to_current_clients (v_provider, coalesce(p_material, true) or not v_had_live);

  return jsonb_build_object('version_id', d.id, 'version', d.version, 'presented', v_presented);
end;
$$;

revoke execute on function publish_my_expectations (uuid, boolean, text) from public, anon;
grant execute on function publish_my_expectations (uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Admin: TalentYak essentials
-- ---------------------------------------------------------------------------

create or replace function admin_save_platform_expectations_draft (p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_links text[];
begin
  if not is_admin () then
    raise exception 'admin_only';
  end if;

  v_links := coalesce(array(select jsonb_array_elements_text(coalesce(p->'policy_links', '[]'::jsonb))), '{}');

  select id into v_id from platform_expectation_versions where published_at is null for update;
  if v_id is null then
    lock table platform_expectation_versions in share row exclusive mode;
    insert into platform_expectation_versions (version, created_by)
      values (coalesce((select max(version) from platform_expectation_versions), 0) + 1, auth.uid ())
      returning id into v_id;
  end if;

  update platform_expectation_versions set
    conduct = coalesce(p->>'conduct', ''),
    privacy = coalesce(p->>'privacy', ''),
    support = coalesce(p->>'support', ''),
    policy_links = v_links
  where id = v_id;

  return v_id;
end;
$$;

revoke execute on function admin_save_platform_expectations_draft (jsonb) from public, anon;
grant execute on function admin_save_platform_expectations_draft (jsonb) to authenticated;

create or replace function admin_publish_platform_expectations (p_draft uuid, p_material boolean, p_summary text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d platform_expectation_versions%rowtype;
  v_had_live boolean;
  v_presented int;
begin
  if not is_admin () then
    raise exception 'admin_only';
  end if;

  lock table platform_expectation_versions in share row exclusive mode;

  select * into d from platform_expectation_versions where id = p_draft and published_at is null for update;
  if not found then
    raise exception 'draft_not_found';
  end if;
  if btrim(d.conduct) = '' or btrim(d.privacy) = '' or btrim(d.support) = '' then
    raise exception 'expectations_incomplete' using hint = 'Conduct, privacy and support are all required.';
  end if;

  v_had_live := live_platform_expectations () is not null;

  update platform_expectation_versions set superseded_at = now()
    where published_at is not null and superseded_at is null;
  update platform_expectation_versions set
    published_at = now(),
    published_by = auth.uid (),
    material = coalesce(p_material, true),
    change_summary = nullif(btrim(coalesce(p_summary, '')), '')
  where id = d.id;

  -- The first ever publication has nobody to re-present to: relationships that
  -- started before it are presented when their coach publishes.
  v_presented := case when v_had_live then present_to_current_clients (null, coalesce(p_material, true)) else 0 end;

  return jsonb_build_object('version_id', d.id, 'version', d.version, 'presented', v_presented);
end;
$$;

revoke execute on function admin_publish_platform_expectations (uuid, boolean, text) from public, anon;
grant execute on function admin_publish_platform_expectations (uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Client: acknowledge
-- ---------------------------------------------------------------------------
--
-- Records that the client read a presented version. Touches nothing else. It
-- is idempotent: a second click returns the first record, with its original
-- time.

create or replace function acknowledge_expectations (p_presentation uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  x enrollment_expectations%rowtype;
  v_ack expectation_acknowledgements%rowtype;
begin
  if auth.uid () is null then
    raise exception 'sign_in_required';
  end if;

  select ee.* into x from enrollment_expectations ee
    join enrollments e on e.id = ee.enrollment_id
    join profiles pr on pr.id = e.customer_id
    where ee.id = p_presentation and e.customer_id = auth.uid () and pr.suspended_at is null;
  if not found then
    raise exception 'not_found';
  end if;

  insert into expectation_acknowledgements (presentation_id, actor_profile_id, coach_version_id, platform_version_id)
    values (x.id, auth.uid (), x.coach_version_id, x.platform_version_id)
    on conflict (presentation_id) do nothing
    returning * into v_ack;

  if v_ack.id is null then
    select * into v_ack from expectation_acknowledgements where presentation_id = x.id;
  end if;

  return jsonb_build_object('id', v_ack.id, 'acknowledged_at', v_ack.acknowledged_at);
end;
$$;

revoke execute on function acknowledge_expectations (uuid) from public, anon;
grant execute on function acknowledge_expectations (uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. The purchase records what was shown
-- ---------------------------------------------------------------------------

alter table purchases
  add column if not exists expectations_coach_version_id uuid references coach_expectation_versions (id),
  add column if not exists expectations_platform_version_id uuid references platform_expectation_versions (id);

create index if not exists purchases_expectations_coach_idx
  on purchases (expectations_coach_version_id) where expectations_coach_version_id is not null;
create index if not exists purchases_expectations_platform_idx
  on purchases (expectations_platform_version_id) where expectations_platform_version_id is not null;

comment on column purchases.expectations_coach_version_id is
  'The coach expectations version displayed at checkout. Null for purchases made before Batch 3 — never backfilled, because nobody was shown one.';

create or replace function freeze_purchase_snapshot ()
returns trigger
language plpgsql
as $$
begin
  if old.state = 'pending_payment' then
    return new;
  end if;

  if new.charge_amount_minor is distinct from old.charge_amount_minor
     or new.charge_currency is distinct from old.charge_currency
     or new.offer_version_id is distinct from old.offer_version_id
     or new.service_type is distinct from old.service_type
     or new.billing_structure is distinct from old.billing_structure
     or new.term_months is distinct from old.term_months
     or new.commission_policy_id is distinct from old.commission_policy_id
     or new.inclusions_snapshot is distinct from old.inclusions_snapshot
     or new.customer_id is distinct from old.customer_id
     or new.expectations_coach_version_id is distinct from old.expectations_coach_version_id
     or new.expectations_platform_version_id is distinct from old.expectations_platform_version_id
  then
    raise exception
      'Purchase % is active; its agreed terms are immutable. Record a correction instead.',
      old.id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

-- Unchanged from 0019 except where marked: the displayed expectations versions
-- must still be live, and are recorded on the purchase.
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
  -- Batch 3
  v_shown_coach uuid := nullif(p->>'expectations_coach_version_id', '')::uuid;
  v_shown_platform uuid := nullif(p->>'expectations_platform_version_id', '')::uuid;
  v_live_coach uuid;
  v_live_platform uuid;
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

  -- Batch 3: the provider row lock serialises this check against the coach's
  -- own publish, which takes the same lock.
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

  -- Batch 3: what was on screen must be what is live, or nothing is sold.
  v_live_coach := live_coach_expectations (pr.id);
  v_live_platform := live_platform_expectations ();
  if v_live_coach is null or v_live_platform is null then
    raise exception 'expectations_missing' using hint = 'This coach hasn''t published their welcome and expectations yet, so this plan can''t be bought.';
  end if;
  if v_shown_coach is distinct from v_live_coach or v_shown_platform is distinct from v_live_platform then
    raise exception 'expectations_changed' using hint = 'The welcome and expectations were just updated. Review the new version before you pay.';
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

  return jsonb_build_object(
    'reused', false,
    'attempt_id', v_attempt.id,
    'purchase_id', v_purchase,
    'reservation_id', v_reservation,
    'state', 'created',
    'stripe_checkout_session_id', null,
    'currency', v_currency,
    'amount_minor', v_price,
    'expires_at', v_attempt.expires_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. When a relationship opens, or changes coach
-- ---------------------------------------------------------------------------
--
-- Fires after the conversation trigger (triggers on one event run in name
-- order, and "welcome" sorts after "conversation"), so the link lands in the
-- conversation that has just been created.

create or replace function present_expectations_on_assignment ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pu purchases%rowtype;
  v_coach uuid;
  v_platform uuid;
begin
  if new.previous_provider_id is null then
    -- The first assignment: present exactly what the purchase recorded. A
    -- purchase from before Batch 3 recorded nothing, and nothing is invented.
    select p.* into pu from purchases p
      join enrollments e on e.purchase_id = p.id
      where e.id = new.enrollment_id;
    if pu.expectations_coach_version_id is not null and pu.expectations_platform_version_id is not null then
      perform present_expectations (
        new.enrollment_id, new.provider_id, pu.expectations_coach_version_id, pu.expectations_platform_version_id,
        'purchase', true, pu.id, pu.offer_version_id
      );
    end if;
  else
    -- A coach change: the incoming coach's live version, if they have one.
    v_coach := live_coach_expectations (new.provider_id);
    v_platform := live_platform_expectations ();
    if v_coach is not null and v_platform is not null then
      perform present_expectations (new.enrollment_id, new.provider_id, v_coach, v_platform, 'reassignment', true);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enrollment_assignments_welcome on enrollment_assignments;
create trigger enrollment_assignments_welcome after insert on enrollment_assignments
  for each row execute function present_expectations_on_assignment ();

notify pgrst, 'reload schema';
