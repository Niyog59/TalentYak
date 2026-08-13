-- Service catalog: verticals and services are the plug-in surface.
-- Adding a vertical to the platform = inserting rows here (+ its own
-- fulfillment tables in a separate migration). Core never special-cases
-- a vertical slug.

create type catalog_status as enum ('active', 'coming_soon', 'hidden');
create type billing_type as enum ('one_time', 'subscription');

create table verticals (
  slug text primary key,
  name text not null,
  name_ne text, -- Devanagari display name
  tagline text not null default '',
  description text not null default '',
  status catalog_status not null default 'coming_soon',
  sort int not null default 100
);

create table services (
  id text primary key, -- stable slug, e.g. 'shraddha-basic'
  vertical_slug text not null references verticals (slug),
  name text not null,
  summary text not null default '',
  description text not null default '',
  price_cents int not null,
  currency text not null default 'usd',
  billing_type billing_type not null default 'one_time',
  billing_interval text check (billing_interval in ('month', 'quarter')),
  price_note text,
  stripe_price_id text, -- set once created in Stripe
  capacity_limit int, -- optional cap (e.g. Sohra Shraddha seasonal)
  status catalog_status not null default 'coming_soon',
  sort int not null default 100,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Versioned intake form definitions, rendered by the generic form renderer.
create table intake_schemas (
  id uuid primary key default gen_random_uuid (),
  service_id text not null references services (id),
  version int not null default 1,
  schema jsonb not null, -- { fields: IntakeField[] }
  created_at timestamptz not null default now(),
  unique (service_id, version)
);

alter table verticals enable row level security;
alter table services enable row level security;
alter table intake_schemas enable row level security;

-- Catalog is public to read (site renders from it), admin-only to write.
create policy "public reads verticals" on verticals
  for select using (status <> 'hidden' or is_admin ());

create policy "admin writes verticals" on verticals
  for all using (is_admin ());

create policy "public reads services" on services
  for select using (status <> 'hidden' or is_admin ());

create policy "admin writes services" on services
  for all using (is_admin ());

create policy "public reads intake schemas" on intake_schemas
  for select using (true);

create policy "admin writes intake schemas" on intake_schemas
  for all using (is_admin ());
