-- Prelude · Remove a stray `profiles` table so 0001 can create the real one.
--
-- The Supabase project carried a `profiles` table that did NOT come from this
-- repository. Inspected 2026-09-16, it had four columns — id, full_name, role,
-- created_at — no row-level security, and no trigger linking it to auth.users.
-- It looks like a leftover from a starter template.
--
-- `0001_core.sql` creates the real `profiles`: email, phone, role, plus the
-- handle_new_user() trigger and the access policies everything else depends on.
-- It cannot run while a table of that name already exists.
--
-- **This migration is deliberately incapable of destroying data.** It counts
-- the rows first and raises an exception if it finds any, so running it against
-- a project that turned out to have real profiles fails loudly instead of
-- quietly deleting people. Dropping an empty table is recoverable; dropping a
-- populated one is not, and the check costs nothing.
--
-- Numbered 0000 so it runs before 0001. It is a no-op on any database that does
-- not have the stray table, including a fresh production project later.

do $$
declare
  row_count bigint;
  has_email boolean;
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'profiles'
  ) then
    raise notice '[0000] No existing profiles table. Nothing to do.';
    return;
  end if;

  -- If it already has an `email` column it is probably OUR table, from a
  -- previous run of 0001. Leave it completely alone.
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'email'
  ) into has_email;

  if has_email then
    raise notice '[0000] profiles already has an email column — this looks like the real table. Leaving it untouched.';
    return;
  end if;

  execute 'select count(*) from public.profiles' into row_count;

  if row_count > 0 then
    raise exception
      '[0000] Refusing to drop public.profiles: it contains % row(s). This migration only removes an EMPTY stray table. Inspect the data and decide deliberately.',
      row_count
      using errcode = 'restrict_violation';
  end if;

  raise notice '[0000] Dropping empty stray profiles table so 0001 can create the real one.';
  execute 'drop table public.profiles cascade';
end;
$$;
