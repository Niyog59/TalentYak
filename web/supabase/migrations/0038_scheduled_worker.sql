-- The job worker, called every five minutes by the database's own scheduler.
--
-- Vercel's free plan runs a cron job at most once a day (see the M08 status
-- file). Supabase Cron (pg_cron) with pg_net is available on the current
-- Supabase plan at no extra cost, and calls the SAME protected endpoint
-- (/api/jobs/process) with the SAME bearer secret. The daily Vercel cron
-- stays as a second, independent trigger; every sweep and job is idempotent,
-- so two schedulers cannot double-send (outbox leases, dedupe keys).
--
-- THE SECRET IS NOT IN THIS FILE. It lives in Supabase Vault under the name
-- `worker_cron_secret`, with the endpoint URL under `worker_url`, written by
-- scripts/configure-worker-cron.mjs from the server environment. Until both
-- exist, the scheduled call does nothing and says so in the cron log.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function invoke_job_worker ()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'worker_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'worker_cron_secret';
  if v_url is null or v_secret is null then
    raise notice 'worker schedule not configured: vault secrets missing';
    return null;
  end if;

  -- pg_net sends asynchronously; the response (status, not body secrets) is
  -- kept briefly in net._http_response for checking.
  return net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

revoke execute on function invoke_job_worker () from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('talentyak-job-worker')
    where exists (select 1 from cron.job where jobname = 'talentyak-job-worker');
  perform cron.schedule('talentyak-job-worker', '*/5 * * * *', 'select public.invoke_job_worker ()');
end $$;
