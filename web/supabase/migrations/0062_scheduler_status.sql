-- M18: is the scheduled worker actually running?
--
-- The worker is called every five minutes by pg_cron through pg_net (0038). A
-- cron run "succeeding" only means the request was queued; whether the site
-- answered is in net._http_response (kept by pg_net for about six hours). This
-- reads both, for the founder panel, so a stopped schedule or an endpoint that
-- answers with an error is visible without database access.
--
-- Read-only. Administrators with a completed second factor only. Returns
-- timestamps and status codes — never a URL, a header or a response body
-- (the bodies hold nothing secret, but nothing here needs them).

create or replace function admin_scheduler_status ()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_job_id bigint;
  v_result jsonb;
begin
  if not is_admin () then
    raise exception 'admin_mfa_required' using hint = 'This needs an administrator who has completed two-factor sign-in.';
  end if;

  select jobid into v_job_id from cron.job where jobname = 'talentyak-job-worker';

  select jsonb_build_object(
    'scheduled', v_job_id is not null,
    'active', coalesce((select active from cron.job where jobid = v_job_id), false),
    'schedule', (select schedule from cron.job where jobid = v_job_id),
    'last_run_at', (select max(start_time) from cron.job_run_details where jobid = v_job_id),
    'last_run_status', (
      select status from cron.job_run_details where jobid = v_job_id order by start_time desc limit 1
    ),
    'runs_failed_24h', (
      select count(*) from cron.job_run_details
      where jobid = v_job_id and status <> 'succeeded' and start_time > now() - interval '24 hours'
    ),
    'last_response_at', (select max(created) from net._http_response),
    'last_response_status', (select status_code from net._http_response order by created desc limit 1),
    'responses_not_ok_6h', (
      select count(*) from net._http_response
      where created > now() - interval '6 hours' and (status_code is null or status_code >= 300)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function admin_scheduler_status () from public, anon;
grant execute on function admin_scheduler_status () to authenticated;
