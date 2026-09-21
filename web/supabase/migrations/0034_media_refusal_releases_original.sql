-- 0034 — A file we refuse outright is not kept.
--
-- 0033 kept the uploaded original after ANY processing failure, so the owner
-- could retry without uploading again. That is right for a failure retrying
-- can fix (a timeout, a storage hiccup). It is wrong for a permanent refusal —
-- an iPhone HEIC photo, a PDF, a clip over the length limit — where no retry is
-- ever offered: holding somebody's photo for 14 days for no purpose is exactly
-- what the body-data rule (invariant 3) is meant to prevent.
--
-- Now a permanent refusal releases the original's path in the same statement
-- that records the failure, and returns it so the processor deletes the bytes.

drop function if exists fail_media_processing (uuid, text, boolean);
create function fail_media_processing (p_id uuid, p_reason text, p_permanent boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_released text;
begin
  if not is_privileged_writer () then
    raise exception 'server_only';
  end if;

  update media_assets m
    set state = 'failed',
        failure_reason = left(p_reason, 500),
        processing_report = coalesce(m.processing_report, '{}'::jsonb) || jsonb_build_object('permanent', p_permanent),
        source_path = case when p_permanent then null else m.source_path end
    where m.id = p_id and m.state in ('processing', 'uploaded', 'reserved')
    returning case when p_permanent then (select s.source_path from media_assets s where s.id = p_id) end
    into v_released;

  return v_released;
end;
$$;

revoke execute on function fail_media_processing (uuid, text, boolean) from public, anon, authenticated;
grant execute on function fail_media_processing (uuid, text, boolean) to service_role;

notify pgrst, 'reload schema';
