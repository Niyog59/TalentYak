-- 0030 — Private media: progress photos, form-review clips, chat attachments.
--
-- Body and health data is locked (invariant 3). A progress photo is the most
-- sensitive thing a fitness customer gives us: it is their body, it carries GPS
-- in its EXIF, and the people who may see it change over time as coaches are
-- reassigned. This migration gives that material one table, one private bucket,
-- and one authorisation rule.
--
-- IT DOES NOT INVENT AN AUTHORISATION MODEL. `coach_may_read_record()` from
-- 0021 already decides who may see a client's records, and it already treats
-- media more strictly than logs: a coach who took over sees earlier media only
-- if the customer chose the 'full' history scope. That rule is reused verbatim
-- here. A second, parallel rule for media is exactly how two answers to the
-- same question start disagreeing.
--
-- WHAT A SIGNED URL CANNOT DO. Row-level security protects a ROW. A signed URL
-- is a bearer token: once issued, it works for anyone holding it until it
-- expires, regardless of what the database later says. So links are issued only
-- after an authorised read of the row, and they are SHORT — two minutes. When a
-- coach is reassigned, their access to new fetches stops immediately, but a
-- link already in their browser keeps working until it expires. That residual
-- window is real, it is documented in ARCHITECTURE.md, and shortening the
-- lifetime is the only thing that shrinks it.

-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------
--
-- Private, with no storage.objects policy of any kind, so neither `anon` nor
-- `authenticated` can read or write it directly. Every byte in and out goes
-- through a server action. Originals and derived previews share the bucket:
-- a thumbnail of a progress photo is a progress photo.
--
-- The MIME allow-list is enforced again in the application against the file's
-- actual leading bytes. A declared content type is chosen by the uploader and
-- proves nothing; this list is a second gate, not the first.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('private-media', 'private-media', false, 209715200,
   array['image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. The asset record
-- ---------------------------------------------------------------------------

do $$ begin
  create type media_state as enum (
    'reserved',    -- a row exists; nothing has been uploaded against it yet
    'processing',  -- bytes accepted, being validated/re-encoded
    'ready',       -- safe to serve
    'failed',      -- rejected or processing gave up; reason recorded
    'deleted'      -- tombstoned; bytes removed
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type media_purpose as enum ('progress_photo', 'form_review_clip', 'chat_attachment');
exception when duplicate_object then null; end $$;

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid (),

  -- OWNERSHIP. The customer whose body, life and history this is. It stays
  -- theirs across every coach change; a coach is never an owner.
  owner_profile_id uuid not null references profiles (id) on delete cascade,

  -- The relationship it belongs to. This, plus recorded_at, is what
  -- coach_may_read_record() uses to decide whether a coach may see it.
  enrollment_id uuid references enrollments (id) on delete set null,

  -- PURPOSE. What it was given for. A photo uploaded for form review is not
  -- licence to browse it as a progress photo, and the purpose is recorded so
  -- that distinction can be enforced rather than assumed.
  purpose media_purpose not null,

  media_kind text not null check (media_kind in ('image', 'video')),
  -- What we STORED, after re-encoding. Never what the uploader claimed.
  content_type text,
  storage_path text,
  -- A derived thumbnail or poster frame, in the same private bucket. Deriving
  -- it from protected material does not make it less protected.
  preview_path text,

  byte_size bigint check (byte_size is null or byte_size >= 0),
  width int, height int,
  duration_seconds numeric(10, 2),

  state media_state not null default 'reserved',
  -- Why it failed, in words a person can act on. Never a stack trace.
  failure_reason text,
  -- Set when video was accepted without being re-encoded, so the limitation is
  -- visible in the data rather than only in a report.
  compression_skipped boolean not null default false,

  -- The moment the media is ABOUT, which is what coach access keys off — not
  -- when the row happened to be written.
  recorded_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz,
  deleted_at timestamptz
);

create index if not exists media_assets_owner_idx on media_assets (owner_profile_id, recorded_at desc);
create index if not exists media_assets_enrollment_idx on media_assets (enrollment_id, recorded_at desc);
-- The abandoned-upload sweep reads exactly this.
create index if not exists media_assets_incomplete_idx on media_assets (created_at)
  where state in ('reserved', 'processing');

alter table media_assets enable row level security;

drop trigger if exists media_assets_touch on media_assets;
create trigger media_assets_touch before update on media_assets
  for each row execute function touch_updated_at ();

-- OWNER. Reads and deletes their own, always, including after the coaching
-- relationship ends. Customers keep their own history.
create policy "customer manages own media" on media_assets for all
  using (owner_profile_id = auth.uid ())
  with check (owner_profile_id = auth.uid ());

-- CURRENT COACH. Read only, never write, and only what 0021's rule allows.
-- `true` is the p_media argument: media is always judged by the stricter test,
-- so a coach on the 'programme_and_logs' scope sees none of it from before
-- they took over. A FORMER coach matches nothing here, which is the revocation.
create policy "current coach reads permitted media" on media_assets for select
  using (
    enrollment_id is not null
    and state = 'ready'
    and deleted_at is null
    and coach_may_read_record (enrollment_id, recorded_at, true)
  );

-- No admin policy, deliberately, matching 0021: support that genuinely needs
-- to see a customer's body is a decision with a name on it, not a table grant.

-- ---------------------------------------------------------------------------
-- 3. Server-side lifecycle
-- ---------------------------------------------------------------------------

-- Reserves a row before any bytes are accepted, so an upload can never produce
-- a file nobody has a record of. Returns the id the upload is written against.
create or replace function reserve_media (
  p_owner uuid,
  p_enrollment uuid,
  p_purpose media_purpose,
  p_media_kind text,
  p_recorded_at timestamptz default now()
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
    raise exception 'server_only' using hint = 'Media is reserved by the server.';
  end if;

  -- An enrollment, when given, must actually belong to the owner. Otherwise a
  -- caller could file their media under somebody else's coaching relationship
  -- and hand a stranger's coach a reason to read it.
  if p_enrollment is not null
     and not exists (select 1 from enrollments where id = p_enrollment and customer_id = p_owner) then
    raise exception 'enrollment_not_owned';
  end if;

  insert into media_assets (owner_profile_id, enrollment_id, purpose, media_kind, recorded_at, state)
  values (p_owner, p_enrollment, p_purpose, p_media_kind, coalesce(p_recorded_at, now()), 'reserved')
  returning id into v_id;

  return v_id;
end;
$$;

-- Marks an asset ready once the bytes are stored and validated.
create or replace function finalize_media (
  p_id uuid,
  p_storage_path text,
  p_preview_path text,
  p_content_type text,
  p_byte_size bigint,
  p_width int default null,
  p_height int default null,
  p_duration numeric default null,
  p_compression_skipped boolean default false
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
        compression_skipped = p_compression_skipped,
        failure_reason = null,
        finalized_at = now()
    where id = p_id and state in ('reserved', 'processing');

  return found;
end;
$$;

create or replace function fail_media (p_id uuid, p_reason text)
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
    set state = 'failed', failure_reason = left(p_reason, 500)
    where id = p_id and state in ('reserved', 'processing');

  return found;
end;
$$;

-- Abandoned uploads: reserved or processing, and old enough that no live
-- request is still working on them. Returned so the caller can delete the bytes
-- too — a row marked failed while its file lingers in the bucket is a leak.
--
-- This is NOT retention. It removes incomplete uploads that never became
-- anything, which is housekeeping, and is unrelated to the retention policies
-- in 0022 whose destructive execution stays off.
create or replace function sweep_abandoned_media (p_older_than_minutes int default 60)
returns table (id uuid, storage_path text, preview_path text)
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
    set state = 'failed',
        failure_reason = coalesce(failure_reason, 'Upload was never completed.')
    where state in ('reserved', 'processing')
      and created_at < now() - make_interval(mins => greatest(1, p_older_than_minutes))
    returning media_assets.id, media_assets.storage_path, media_assets.preview_path;
end;
$$;

-- A person deleting their own media. Tombstones the row and hands back the
-- paths so the bytes go too. Distinct from retention expiry and from clearing
-- test files: this one is somebody asking.
create or replace function delete_own_media (p_id uuid)
returns table (storage_path text, preview_path text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid () is null then
    raise exception 'sign_in_required';
  end if;

  return query
  update media_assets
    set state = 'deleted', deleted_at = now(), storage_path = null, preview_path = null
    where media_assets.id = p_id
      and media_assets.owner_profile_id = auth.uid ()
      and media_assets.state <> 'deleted'
    returning
      (select m.storage_path from media_assets m where m.id = p_id),
      (select m.preview_path from media_assets m where m.id = p_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'reserve_media(uuid, uuid, media_purpose, text, timestamptz)',
    'finalize_media(uuid, text, text, text, bigint, int, int, numeric, boolean)',
    'fail_media(uuid, text)',
    'sweep_abandoned_media(int)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

revoke execute on function delete_own_media (uuid) from public, anon;
grant execute on function delete_own_media (uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
