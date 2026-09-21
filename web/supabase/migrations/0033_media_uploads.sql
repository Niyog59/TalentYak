-- 0032 — Direct uploads to a private holding area, and processing afterwards.
--
-- WHY THIS EXISTS. 0030 accepted uploads through our own server, which on the
-- hosting we use cannot receive a request body above 4.5 MB. Most phone photos
-- and nearly every clip are bigger than that. So files now go from the browser
-- straight to storage — into a holding bucket nobody can read — and the server
-- processes them from there.
--
-- THE HOLDING BUCKET (`media-uploads`) is never served. It has no storage
-- policy, so browsers cannot list or read it; the only way in is a single-use
-- upload token the server issues for one exact path, and that token cannot
-- overwrite a file once it exists. The 50 MB limit is the storage plan's own
-- per-file ceiling, measured, not chosen.
--
-- THE LIFECYCLE, and what each state promises:
--
--   reserved    a token was issued; no complete file yet
--   uploaded    the file is in the holding area, NOT yet checked or cleaned
--   processing  a processor holds it (with a lease, so a crash is recovered)
--   ready       the cleaned copy is stored and verified; the original is gone
--   failed      rejected or processing failed; the reason says which, and a
--               retry is possible while the original is still held
--   deleted     tombstone
--
-- Only `ready` is ever visible to a coach (0030's policy), and only `ready`
-- carries metadata_stripped = true. Nothing unprocessed is ever described as
-- optimised or clean — the column that says so is set in exactly one place.

-- The 'uploaded' state is added by 0032, in its own transaction: Postgres will
-- not let a new enum value be used in the transaction that created it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  -- Any declared type is accepted here, deliberately: the declared type is the
  -- uploader's claim and proves nothing. The processor reads the bytes and
  -- refuses what it cannot make safe, with a reason the person can act on.
  ('media-uploads', 'media-uploads', false, 52428800, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table media_assets
  add column if not exists source_path text,
  add column if not exists source_bytes bigint,
  add column if not exists metadata_stripped boolean not null default false,
  add column if not exists processing_attempts int not null default 0,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processed_at timestamptz,
  -- Measured before/after figures, written by the processor. Never estimated.
  add column if not exists processing_report jsonb;

create index if not exists media_assets_queue_idx on media_assets (created_at)
  where state in ('uploaded', 'processing');

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Reserves a row and the one path its upload token will be valid for.
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

  if p_enrollment is not null
     and not exists (select 1 from enrollments e where e.id = p_enrollment and e.customer_id = p_owner) then
    raise exception 'enrollment_not_owned';
  end if;

  v_id := gen_random_uuid ();
  -- No file name, no date, no sequence: a path is not a secret, but it should
  -- not describe what is in it either.
  v_path := p_owner || '/' || v_id || '/source';

  insert into media_assets (id, owner_profile_id, enrollment_id, purpose, media_kind, state, source_path, source_bytes)
  values (v_id, p_owner, p_enrollment, p_purpose, p_media_kind, 'reserved', v_path, p_declared_bytes);

  id := v_id; source_path := v_path;
  return next;
end;
$$;

-- The browser says it has finished. The server has already confirmed the file
-- exists and measured it; this records that, and only for the owner.
create or replace function mark_media_uploaded (p_id uuid, p_owner uuid, p_bytes bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  update media_assets
    set state = 'uploaded', source_bytes = p_bytes, failure_reason = null
    where id = p_id and owner_profile_id = p_owner and state = 'reserved';

  return found;
end;
$$;

-- Claims one asset for processing. Atomic: two processors started at once
-- cannot both take it. A claim older than the lease is presumed crashed and
-- may be taken again, so a dead function never strands a file.
create or replace function claim_media_processing (p_id uuid, p_lease_seconds int default 600)
returns setof media_assets
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  return query
  update media_assets
    set state = 'processing',
        processing_attempts = processing_attempts + 1,
        processing_started_at = now()
    where id = p_id
      and source_path is not null
      and (
        state = 'uploaded'
        or (state = 'processing' and processing_started_at < now() - make_interval(secs => p_lease_seconds))
      )
    returning *;
end;
$$;

-- The only place an asset becomes ready, and the only place metadata_stripped
-- becomes true. Called after the cleaned copy is stored AND re-read and checked.
create or replace function complete_media_processing (
  p_id uuid,
  p_storage_path text,
  p_preview_path text,
  p_content_type text,
  p_byte_size bigint,
  p_width int,
  p_height int,
  p_duration numeric,
  p_report jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  update media_assets
    set state = 'ready',
        storage_path = p_storage_path,
        preview_path = p_preview_path,
        content_type = p_content_type,
        byte_size = p_byte_size,
        width = p_width,
        height = p_height,
        duration_seconds = p_duration,
        metadata_stripped = true,
        compression_skipped = false,
        processing_report = p_report,
        processed_at = now(),
        finalized_at = now(),
        failure_reason = null
    where id = p_id and state = 'processing';

  return found;
end;
$$;

-- The original is released only after completion was recorded. Clearing the
-- path is what lets the processor delete the bytes without a second writer
-- ever pointing at them again.
create or replace function release_media_source (p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  update media_assets m
    set source_path = null
    where m.id = p_id and m.state = 'ready'
    returning (select source_path from media_assets where id = p_id) into v_path;

  return v_path;
end;
$$;

-- A processing failure. The original is KEPT, so the person can retry without
-- uploading again; the reason is recorded in words they can act on.
create or replace function fail_media_processing (p_id uuid, p_reason text, p_permanent boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  update media_assets
    set state = 'failed',
        failure_reason = left(p_reason, 500),
        processing_report = coalesce(processing_report, '{}'::jsonb) || jsonb_build_object('permanent', p_permanent)
    where id = p_id and state in ('processing', 'uploaded', 'reserved');

  return found;
end;
$$;

-- The owner asking for another go. Only while the original is still held, only
-- for a failure that was not a permanent refusal (a HEIC file will not become
-- a JPEG by being retried), and only a bounded number of times.
create or replace function request_media_retry (p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid () is null then
    raise exception 'sign_in_required';
  end if;

  update media_assets
    set state = 'uploaded', failure_reason = null
    where id = p_id
      and owner_profile_id = auth.uid ()
      and state = 'failed'
      and source_path is not null
      and processing_attempts < 5
      and coalesce((processing_report ->> 'permanent')::boolean, false) = false;

  return found;
end;
$$;

-- Deleting now returns the held original too, so no copy is left behind.
drop function if exists delete_own_media (uuid);
create function delete_own_media (p_id uuid)
returns table (storage_path text, preview_path text, source_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r media_assets%rowtype;
begin
  if auth.uid () is null then
    raise exception 'sign_in_required';
  end if;

  select * into r from media_assets m
    where m.id = p_id and m.owner_profile_id = auth.uid () and m.state <> 'deleted'
    for update;
  if not found then
    return;
  end if;

  update media_assets m
    set state = 'deleted', deleted_at = now(), storage_path = null, preview_path = null, source_path = null
    where m.id = p_id;

  storage_path := r.storage_path; preview_path := r.preview_path; source_path := r.source_path;
  return next;
end;
$$;

-- Housekeeping for uploads that never finished. NOT retention: it only touches
-- things that never became a usable file, and the retention policies in 0022
-- stay proposed with their destructive execution off.
--
--   · a token issued more than a day ago with no finished upload — the upload
--     token itself is only valid for that long — is failed, and any partial
--     bytes are released for deletion
--   · a processing claim past its lease is put back in the queue, not failed:
--     the function running it died, the file did nothing wrong
--   · a failed upload's held original is released after 14 days, so a
--     never-retried failure does not keep a copy of somebody's body forever
drop function if exists sweep_abandoned_media (int);
create function sweep_abandoned_media (p_older_than_minutes int default 1440)
returns table (id uuid, source_path text, outcome text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  return query
  with abandoned as (
    update media_assets m
      set state = 'failed',
          failure_reason = coalesce(m.failure_reason, 'The upload was never completed.'),
          source_path = null
      where m.state = 'reserved'
        and m.created_at < now() - make_interval(mins => greatest(1, p_older_than_minutes))
      returning m.id, (select s.source_path from media_assets s where s.id = m.id) as source_path
  ),
  stale as (
    update media_assets m
      set state = 'uploaded'
      where m.state = 'processing'
        and m.processing_started_at < now() - interval '15 minutes'
      returning m.id, null::text as source_path
  ),
  expired_failures as (
    update media_assets m
      set source_path = null
      where m.state = 'failed'
        and m.source_path is not null
        and m.updated_at < now() - interval '14 days'
      returning m.id, (select s.source_path from media_assets s where s.id = m.id) as source_path
  )
  select a.id, a.source_path, 'abandoned'::text from abandoned a
  union all select s.id, s.source_path, 'requeued'::text from stale s
  union all select e.id, e.source_path, 'failed_original_released'::text from expired_failures e;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'reserve_media_upload(uuid, uuid, media_purpose, text, bigint)',
    'mark_media_uploaded(uuid, uuid, bigint)',
    'claim_media_processing(uuid, int)',
    'complete_media_processing(uuid, text, text, text, bigint, int, int, numeric, jsonb)',
    'release_media_source(uuid)',
    'fail_media_processing(uuid, text, boolean)',
    'sweep_abandoned_media(int)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

revoke execute on function request_media_retry (uuid) from public, anon;
grant execute on function request_media_retry (uuid) to authenticated, service_role;
revoke execute on function delete_own_media (uuid) from public, anon;
grant execute on function delete_own_media (uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
