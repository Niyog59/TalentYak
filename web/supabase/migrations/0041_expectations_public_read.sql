-- Batch 3 fix: visitors who are not signed in could not read any coach's
-- published expectations.
--
-- Row-level security evaluates every permissive SELECT policy on a table. One
-- of the policies on coach_expectation_versions calls expectations_readable(),
-- and 0040 withheld EXECUTE on it from the anon role — so for an anonymous
-- visitor the whole query failed with "permission denied", including the rows
-- the public policy allows. The expectations must be visible BEFORE purchase,
-- to people who have not signed in yet.
--
-- Granting EXECUTE is safe: for a caller with no session, auth.uid() is null,
-- so the function returns false and reveals nothing.

grant execute on function expectations_readable (uuid) to anon;

notify pgrst, 'reload schema';
