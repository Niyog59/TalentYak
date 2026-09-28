-- M16 fix · 0054's coach_public_availability() added checkout holds on top of
-- provider_commitments(), which already counts them (0019). A coach with one
-- place left and one checkout in progress would have read "full" a place too
-- early. Same rule as the checkout's own capacity check now: commitments
-- (active and paused clients, plus live holds) against the lower of the
-- coach's limit and TalentYak's ceiling.

create or replace function coach_public_availability ()
returns table (provider_id uuid, state text, away_until date)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         case
           when not p.accepting_new_clients then 'not_accepting'
           when least(p.max_active_clients, p.capacity_ceiling) is not null
                and provider_commitments (p.id) >= least(p.max_active_clients, p.capacity_ceiling)
             then 'full'
           when cm.away_until is not null and cm.away_until > now() then 'away'
           else 'available'
         end,
         case when cm.away_until > now() then (cm.away_until at time zone coalesce(p.timezone, 'UTC'))::date end
  from providers p
  left join coach_messaging_profiles cm on cm.provider_id = p.id
  where provider_is_public (p.id);
$$;

revoke execute on function coach_public_availability () from public;
grant execute on function coach_public_availability () to anon, authenticated, service_role;
