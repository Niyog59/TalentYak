-- M04 · Record the intended first administrator.
--
-- The founder named this address on 2026-09-16. It is written here, in a
-- migration, rather than being inferred at runtime — so that "who can become an
-- admin" is a reviewable line in version control rather than a rule like "the
-- first person to sign up" or "anyone with our domain in their email", both of
-- which are doors that whoever arrives first walks through.
--
-- What this does NOT do: create an account, send an invitation, or grant
-- anything. It records an intention. The promotion happens once, when an
-- account with exactly this address exists and a server function calls
-- claim_admin_bootstrap(). After that the row is marked claimed and cannot
-- promote anyone again.
--
-- Changing the address later is a new migration, deliberately. Editing this one
-- after it has been applied would leave the database and the file disagreeing.

insert into admin_bootstrap (id, email)
values (true, 'talentyak@gmail.com')
on conflict (id) do nothing;

-- `on conflict do nothing` rather than an update: if a row already exists, some
-- earlier decision put it there and silently overwriting it would be the very
-- thing this table exists to prevent.
