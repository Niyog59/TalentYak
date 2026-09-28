-- M12 · A food photo is its own media purpose.
--
-- A photo of a meal is not a progress photo, and the purpose is recorded so
-- the two are never browsed as one another (see 0030). Added in its own
-- migration: Postgres will not let a new enum value be used in the
-- transaction that created it.

alter type media_purpose add value if not exists 'food_photo';

notify pgrst, 'reload schema';
