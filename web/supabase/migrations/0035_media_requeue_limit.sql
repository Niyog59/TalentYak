-- 0035 — A file that keeps killing its processor is not retried forever.
--
-- 0033's sweep puts a processing claim whose lease ran out back in the queue,
-- on the reasonable assumption that the function running it died for reasons
-- unrelated to the file. But if the FILE is the reason — too heavy to finish
-- inside the platform's time limit — requeueing it forever would burn a
-- function run every sweep and never tell the owner anything.
--
-- Now a claim that has already been attempted three times is failed instead,
-- with a reason the owner can act on. The original is kept, so they may still
-- retry by hand (request_media_retry allows up to five attempts in total).

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
        and m.processing_attempts < 3
      returning m.id, null::text as source_path
  ),
  exhausted as (
    update media_assets m
      set state = 'failed',
          failure_reason = 'This clip could not be processed in time, three times over. Try a shorter clip.'
      where m.state = 'processing'
        and m.processing_started_at < now() - interval '15 minutes'
        and m.processing_attempts >= 3
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
  union all select x.id, x.source_path, 'gave_up'::text from exhausted x
  union all select e.id, e.source_path, 'failed_original_released'::text from expired_failures e;
end;
$$;

revoke execute on function sweep_abandoned_media (int) from public, anon, authenticated;
grant execute on function sweep_abandoned_media (int) to service_role;

notify pgrst, 'reload schema';
