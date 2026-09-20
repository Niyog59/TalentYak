-- SECURITY FIX · is_privileged_writer() was true for every caller.
--
-- Found 2026-09-16 by the access-matrix suite on its first run against the real
-- database. A signed-in customer ran
--
--     update profiles set role = 'admin' where id = auth.uid();
--
-- and became an administrator. The trigger written in 0008 to prevent exactly
-- that let it through.
--
-- ROOT CAUSE
--
-- 0008 defined:
--
--     select jwt_role () = 'service_role'
--         or current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin');
--
-- Every caller of this function is itself SECURITY DEFINER. **Inside a security
-- definer function, `current_user` is the function's OWNER, not the person who
-- called it.** The owner is `postgres`, because that is who ran the migration.
-- So the second clause was true for every request from every user, and every
-- guard built on it waved everyone through.
--
-- Measured directly, as the same signed-in customer in the same request:
--
--                          security invoker     security definer
--     current_user         authenticated        postgres          <- lies
--     session_user         authenticator        authenticator     <- truthful
--     jwt_role()           authenticated        authenticated     <- truthful
--     is_privileged_writer false                true              <- the bug
--
-- `session_user` is the role the connection was opened as and cannot be changed
-- by a function boundary. `jwt_role()` reads a per-request setting PostgREST
-- writes before the query runs. Both stay honest where `current_user` does not.
--
-- EXPOSURE
--
-- The project was empty when this was found: zero real accounts, nothing
-- deployed, no public URL. Only the suite's own synthetic users, all deleted.
-- No real person was ever able to reach this.
--
-- AFFECTED — all six callers, all closed by this one change:
--
--   guard_profile_privileged_columns   customer -> admin                 CONFIRMED
--   guard_provider_publication         coach raises own client limit     CONFIRMED
--   guard_credential_verification      coach self-verifies a credential  masked: RLS denied the UPDATE first
--   claim_admin_bootstrap              callable by anyone via RPC        email check still limited it
--   reserve_capacity                   hold places for any customer      not yet tested
--   release_capacity                   release anyone's hold             not yet tested

create or replace function is_privileged_writer ()
returns boolean
language sql
stable
as $$
  select
    -- Our own server code, arriving through the API with the service role.
    jwt_role () = 'service_role'
    -- A direct database session with NO JWT at all: a migration, or an operator
    -- in the SQL editor. Requiring the JWT to be absent is what makes this
    -- branch unreachable from the API — PostgREST always sets one, even for an
    -- anonymous visitor — so no request shape can qualify through it.
    or (jwt_role () = '' and session_user in ('postgres', 'supabase_admin'));
$$;

comment on function is_privileged_writer () is
  'True only for the service role via the API, or a JWT-less direct superuser session. Uses session_user, never current_user: inside a SECURITY DEFINER caller, current_user is the owner and would make this true for everyone. See 0015.';

-- ---------------------------------------------------------------------------
-- Defence in depth: nobody outside the server may call these at all.
-- ---------------------------------------------------------------------------
--
-- Functions in the public schema are executable by PUBLIC unless revoked, which
-- means any signed-in user could call these through the API as an RPC. With
-- is_privileged_writer() fixed they would refuse — but a refusal that depends
-- on one function being correct is exactly the arrangement that just failed.
-- Revoking EXECUTE means the call never reaches the check.

revoke execute on function claim_admin_bootstrap (uuid) from public, anon, authenticated;
revoke execute on function reserve_capacity (uuid, uuid, uuid, int) from public, anon, authenticated;
revoke execute on function release_capacity (uuid) from public, anon, authenticated;

grant execute on function claim_admin_bootstrap (uuid) to service_role;
grant execute on function reserve_capacity (uuid, uuid, uuid, int) to service_role;
grant execute on function release_capacity (uuid) to service_role;

-- Refresh the API's schema cache so the revocation takes effect immediately
-- rather than on the next cache expiry.
notify pgrst, 'reload schema';
