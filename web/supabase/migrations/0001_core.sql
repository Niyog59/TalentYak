-- Ghartira core schema: identity and providers.
-- RLS is enabled on every table from day one.

create type user_role as enum ('customer', 'provider', 'admin');

-- Profile row mirrors auth.users; created by trigger on signup.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  role user_role not null default 'customer',
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "read own profile" on profiles
  for select using (auth.uid () = id);

create policy "update own profile" on profiles
  for update using (auth.uid () = id);

-- Admins can read all profiles (checked via their own row's role).
create or replace function is_admin ()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles where id = auth.uid () and role = 'admin'
  );
$$;

create policy "admin reads all profiles" on profiles
  for select using (is_admin ());

create policy "admin updates all profiles" on profiles
  for update using (is_admin ());

-- Auto-create profile on signup.
create or replace function handle_new_user ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user ();

-- Providers: Nepal-side professionals. A provider may exist without a
-- login (agency phase — founder operates on their behalf).
create table providers (
  id uuid primary key default gen_random_uuid (),
  profile_id uuid references profiles (id) on delete set null,
  display_name text not null,
  vertical_slug text not null,
  country text not null default 'NP',
  payout_channel text not null default 'payoneer',
  payout_reference text, -- Payoneer ID / bank account label
  founding boolean not null default false, -- founding coaches get 65%
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

alter table providers enable row level security;

create policy "admin manages providers" on providers
  for all using (is_admin ());

create policy "provider reads own record" on providers
  for select using (profile_id = auth.uid ());
