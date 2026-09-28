-- M16 · The public launch website.
--
--   coach_public_availability()  per public coach: available / full / away /
--                                not accepting — never a client count
--   public_coach_credentials()   qualifications TalentYak has actually
--                                checked, and only those
--   provider_credentials         a coach can no longer INSERT a claim that
--                                is already marked verified (the update guard
--                                existed; the insert path was open)
--   waitlist_entries             people who want to be told when coaching can
--                                be bought: an email, an optional first name
--                                and an optional coach/plan interest. Nothing
--                                about health. Double opt-in.
--   waitlist_links               withdraw links (hashed), several per entry
--   waitlist_notices             each availability notice a founder sent, for
--                                the record
--   site_event_counts            daily counts of public page events. No
--                                cookies, no identifiers, no emails, no paths
--                                beyond a page kind or a public slug/id
--
-- The rules that shape this file:
--
--   1. Nothing here lets the public read more than before: availability is a
--      state word, credentials only verified ones, and the waitlist and the
--      counters have no policy but the administrator's read.
--   2. The waitlist is written only by the server (service role), after its
--      own rate limit, and a notice reserves nothing — a place is only ever
--      taken through checkout (capacity_reservations).
--   3. Withdrawing deletes the entry. Nothing here deletes anything on a
--      timer.

-- ---------------------------------------------------------------------------
-- 1. Public availability
-- ---------------------------------------------------------------------------

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
           when coalesce(least(p.max_active_clients, p.capacity_ceiling), p.max_active_clients, p.capacity_ceiling) is not null
                and provider_commitments (p.id)
                    + (select count(*) from capacity_reservations r where r.provider_id = p.id and r.state = 'held' and r.expires_at > now())
                    >= coalesce(least(p.max_active_clients, p.capacity_ceiling), p.max_active_clients, p.capacity_ceiling)
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

-- ---------------------------------------------------------------------------
-- 2. Checked qualifications
-- ---------------------------------------------------------------------------

create or replace function public_coach_credentials ()
returns table (provider_id uuid, title text, issuing_body text, issued_year int, verified_detail text, verified_on date)
language sql
stable
security definer
set search_path = public
as $$
  select c.provider_id, c.claimed_title, c.issuing_body, extract(year from c.issued_on)::int, c.verified_detail, c.verified_at::date
  from provider_credentials c
  where provider_is_public (c.provider_id)
    and c.verification_state = 'verified'
    and (c.expires_on is null or c.expires_on >= current_date)
  order by c.provider_id, c.issued_on desc nulls last, c.claimed_title;
$$;

revoke execute on function public_coach_credentials () from public;
grant execute on function public_coach_credentials () to anon, authenticated, service_role;

-- A new claim always starts unchecked, whoever inserts it — unless an
-- administrator (or the privileged server path) records the check itself.
create or replace function guard_credential_insert ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_privileged_writer () or is_admin () then
    return new;
  end if;
  new.verification_state := 'unverified';
  new.verified_detail := null;
  new.verified_by := null;
  new.verified_at := null;
  return new;
end;
$$;

drop trigger if exists provider_credentials_insert_guard on provider_credentials;
create trigger provider_credentials_insert_guard
  before insert on provider_credentials
  for each row execute function guard_credential_insert ();

-- Short, bounded claims; the evidence itself stays out of band or in the
-- private bucket.
alter table provider_credentials drop constraint if exists provider_credentials_lengths;
alter table provider_credentials add constraint provider_credentials_lengths check (
  char_length(claimed_title) between 2 and 160
  and (issuing_body is null or char_length(issuing_body) <= 160)
  and (claimed_reference is null or char_length(claimed_reference) <= 120)
  and (verified_detail is null or char_length(verified_detail) <= 300)
) not valid;

-- ---------------------------------------------------------------------------
-- 3. Waitlist
-- ---------------------------------------------------------------------------

create table if not exists waitlist_entries (
  id uuid primary key default gen_random_uuid (),
  email text not null check (char_length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  first_name text check (first_name is null or char_length(first_name) between 1 and 80),
  -- Optional interest. Kept only while the coach/plan exists.
  provider_id uuid references providers (id) on delete set null,
  offer_id uuid references offers (id) on delete set null,
  state text not null default 'pending' check (state in ('pending', 'confirmed')),
  confirm_token_hash text unique,
  -- What the person was told they were signing up for.
  consent_version text not null,
  confirm_sent_at timestamptz,
  confirmed_at timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists waitlist_entries_email_key on waitlist_entries (lower(email));
create index if not exists waitlist_entries_state_idx on waitlist_entries (state, created_at desc);
create index if not exists waitlist_entries_provider_idx on waitlist_entries (provider_id);
create index if not exists waitlist_entries_offer_idx on waitlist_entries (offer_id);

alter table waitlist_entries enable row level security;
revoke insert, update, delete, truncate on waitlist_entries from anon, authenticated;
create policy "admin reads waitlist" on waitlist_entries for select using (is_admin ());

create table if not exists waitlist_links (
  token_hash text primary key,
  entry_id uuid not null references waitlist_entries (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists waitlist_links_entry_idx on waitlist_links (entry_id);

alter table waitlist_links enable row level security;
revoke all on waitlist_links from anon, authenticated;
-- RLS enabled, zero policies: server functions only.

create table if not exists waitlist_notices (
  id uuid primary key default gen_random_uuid (),
  provider_id uuid references providers (id) on delete set null,
  sent_by uuid references profiles (id) on delete set null,
  recipients int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists waitlist_notices_provider_idx on waitlist_notices (provider_id);
create index if not exists waitlist_notices_sent_by_idx on waitlist_notices (sent_by);

alter table waitlist_notices enable row level security;
revoke insert, update, delete, truncate on waitlist_notices from anon, authenticated;
create policy "admin reads waitlist notices" on waitlist_notices for select using (is_admin ());

-- Register or update interest. Called by the server after its own rate
-- limit, with token hashes it generated. The answer tells the server whether
-- to send a confirmation email; the browser is always told the same thing,
-- so the form never reveals whether an address is already on the list.
create or replace function waitlist_register (
  p_email text,
  p_first_name text,
  p_provider uuid,
  p_offer uuid,
  p_confirm_hash text,
  p_link_hash text,
  p_consent text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w waitlist_entries;
  v_email text := lower(trim(p_email));
  v_provider uuid := p_provider;
  v_offer uuid := p_offer;
  v_send boolean := false;
  v_new boolean := false;
begin
  -- Interest only in something the public can actually see.
  if v_provider is not null and not provider_is_public (v_provider) then
    v_provider := null;
  end if;
  if v_offer is not null and not exists (
    select 1 from offers o where o.id = v_offer and o.status = 'published' and provider_is_public (o.provider_id)
      and (v_provider is null or o.provider_id = v_provider)
  ) then
    v_offer := null;
  end if;
  if v_offer is not null and v_provider is null then
    select provider_id into v_provider from offers where id = v_offer;
  end if;

  select * into w from waitlist_entries where lower(email) = v_email for update;
  if not found then
    insert into waitlist_entries (email, first_name, provider_id, offer_id, consent_version, confirm_token_hash, confirm_sent_at)
      values (v_email, nullif(left(trim(coalesce(p_first_name, '')), 80), ''), v_provider, v_offer, p_consent, p_confirm_hash, now())
      returning * into w;
    v_send := true;
    v_new := true;
  else
    update waitlist_entries
      set first_name = coalesce(nullif(left(trim(coalesce(p_first_name, '')), 80), ''), first_name),
          provider_id = coalesce(v_provider, provider_id),
          offer_id = case when v_provider is not null and v_provider is distinct from provider_id then v_offer else coalesce(v_offer, offer_id) end,
          consent_version = p_consent,
          updated_at = now()
      where id = w.id
      returning * into w;
    -- Still unconfirmed: send a fresh link, at most every 10 minutes.
    if w.state = 'pending' and (w.confirm_sent_at is null or w.confirm_sent_at < now() - interval '10 minutes') then
      update waitlist_entries set confirm_token_hash = p_confirm_hash, confirm_sent_at = now() where id = w.id;
      v_send := true;
    end if;
  end if;

  if v_send then
    insert into waitlist_links (token_hash, entry_id) values (p_link_hash, w.id) on conflict do nothing;
  end if;

  return jsonb_build_object('entry_id', w.id, 'send_confirmation', v_send, 'new', v_new, 'provider_id', w.provider_id);
end;
$$;

create or replace function waitlist_confirm (p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w waitlist_entries;
begin
  select * into w from waitlist_entries where confirm_token_hash = p_hash for update;
  if not found then
    return null;
  end if;
  update waitlist_entries
    set state = 'confirmed', confirmed_at = coalesce(confirmed_at, now()), confirm_token_hash = null, updated_at = now()
    where id = w.id;
  return jsonb_build_object('entry_id', w.id, 'provider_id', w.provider_id);
end;
$$;

-- Withdrawing removes the person from the list entirely.
create or replace function waitlist_withdraw (p_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry uuid;
begin
  select entry_id into v_entry from waitlist_links where token_hash = p_hash;
  if v_entry is null then
    return false;
  end if;
  delete from waitlist_entries where id = v_entry;
  return true;
end;
$$;

revoke execute on function waitlist_register (text, text, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function waitlist_confirm (text) from public, anon, authenticated;
revoke execute on function waitlist_withdraw (text) from public, anon, authenticated;
grant execute on function waitlist_register (text, text, uuid, uuid, text, text, text) to service_role;
grant execute on function waitlist_confirm (text) to service_role;
grant execute on function waitlist_withdraw (text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Public page counters
-- ---------------------------------------------------------------------------

create table if not exists site_event_counts (
  day date not null,
  event text not null check (event in ('page_view', 'coach_profile_view', 'package_selected', 'checkout_started', 'waitlist_registered')),
  -- A page kind ("home"), a public coach slug or a plan version id. Never a
  -- person, an email, a full address or a query string.
  subject text not null default '' check (subject ~ '^[a-z0-9-]{0,64}$'),
  -- False for anything that is not real, public, production activity.
  live boolean not null,
  count bigint not null default 0,
  primary key (day, event, subject, live)
);

alter table site_event_counts enable row level security;
revoke insert, update, delete, truncate on site_event_counts from anon, authenticated;
create policy "admin reads site counts" on site_event_counts for select using (is_admin ());

create or replace function bump_site_event (p_event text, p_subject text, p_live boolean)
returns void
language sql
security definer
set search_path = public
as $$
  insert into site_event_counts (day, event, subject, live, count)
    values ((now() at time zone 'UTC')::date, p_event, lower(coalesce(p_subject, '')), p_live, 1)
  on conflict (day, event, subject, live) do update set count = site_event_counts.count + 1;
$$;

revoke execute on function bump_site_event (text, text, boolean) from public, anon, authenticated;
grant execute on function bump_site_event (text, text, boolean) to service_role;
