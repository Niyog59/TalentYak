-- Communications: notification job queue + recordings metadata.
-- Vertical modules enqueue jobs (e.g. tithi reminders); the shared
-- processor sends them. Every send is auditable here.

create type job_status as enum ('pending', 'sent', 'failed', 'cancelled');

create table notification_jobs (
  id uuid primary key default gen_random_uuid (),
  kind text not null, -- 'booking_confirmation' | 'reminder' | 'recording_delivery' | vertical-defined kinds
  recipient_email text not null,
  subject text not null,
  payload jsonb not null default '{}', -- template variables
  booking_id uuid references bookings (id),
  scheduled_for timestamptz not null default now(),
  status job_status not null default 'pending',
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index notification_jobs_due_idx on notification_jobs (status, scheduled_for);

-- Ceremony / session recordings stored in Cloudflare R2.
create table recordings (
  id uuid primary key default gen_random_uuid (),
  booking_id uuid not null references bookings (id),
  r2_key text not null,
  label text, -- e.g. 'Full ceremony', 'Photos archive'
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

alter table notification_jobs enable row level security;
alter table recordings enable row level security;

create policy "admin manages notification jobs" on notification_jobs
  for all using (is_admin ());

create policy "admin manages recordings" on recordings
  for all using (is_admin ());

create policy "customer reads own recordings" on recordings
  for select using (
    booking_id in (select id from bookings where customer_id = auth.uid ())
  );

-- Scheduling: either enable pg_cron (Supabase dashboard > Extensions)
-- and call the processor endpoint via pg_net, or use Vercel Cron to hit
-- /api/jobs/process every 10 minutes. Vercel Cron is the default:
-- see vercel.json in the app root.
