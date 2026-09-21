-- 0032 — One new media state, in a file of its own.
--
-- Postgres refuses to use an enum value inside the same transaction that added
-- it, and each migration runs as one transaction. 0033 uses 'uploaded' in an
-- index and in its functions, so the value has to be committed first.
--
-- 'uploaded' means: the file is in the private holding area and has NOT yet
-- been checked, cleaned or compressed. Nothing in that state is served.

alter type media_state add value if not exists 'uploaded' after 'reserved';
