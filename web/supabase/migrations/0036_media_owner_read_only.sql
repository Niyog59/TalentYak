-- Media records are written by the server only.
--
-- 0030 gave the owner a FOR ALL policy on their own media_assets rows. Nothing
-- in the application writes those rows with a person's session — reservation,
-- upload completion, processing and deletion all run through server functions
-- — but the policy still let any signed-in person insert or edit a row in
-- their own name, including `storage_path` and `state`.
--
-- That mattered because the viewing route signs whatever path a readable row
-- names. A coach reassigned away from a client has already seen that client's
-- storage paths (they appear in the links the browser followed), and could
-- have created a `ready` row of their own pointing at one, keeping access the
-- reassignment was meant to end.
--
-- The owner keeps READ. Deletion stays available through delete_own_media(),
-- which is security definer and checks ownership itself.

drop policy if exists "customer manages own media" on media_assets;

drop policy if exists "owner reads own media" on media_assets;
create policy "owner reads own media" on media_assets for select
  using (owner_profile_id = auth.uid ());

-- Defence in depth: without a write policy, row-level security already refuses
-- these, but the table privilege should not be there to begin with.
revoke insert, update, delete, truncate on media_assets from anon, authenticated;

notify pgrst, 'reload schema';
