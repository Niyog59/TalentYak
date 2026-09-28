-- M13 · A check-in attachment is its own media purpose.
--
-- A photo or a form-check clip sent with a check-in is not a progress photo
-- and not a chat attachment: it was given to the coach reviewing that
-- check-in. Recording the purpose keeps it from being browsed as either (see
-- 0030). Added in its own migration: Postgres will not let a new enum value be
-- used in the transaction that created it.

alter type media_purpose add value if not exists 'checkin_attachment';

notify pgrst, 'reload schema';
