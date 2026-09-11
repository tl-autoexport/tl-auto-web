-- Read-only mirror of the Chesty Prigon catalogue.
-- Rows are never published directly: a reviewed normalizer must promote them
-- into public.cars after validating identity, power and pricing inputs.
create table if not exists public.chestny_catalog_staging (
  id uuid primary key default gen_random_uuid(),
  source_listing_id text not null unique,
  source_url text,
  source_status text,
  manufacturer text,
  model text,
  generation text,
  trim text,
  model_year integer,
  first_registration_date date,
  mileage_km integer,
  price_krw bigint,
  engine_cc integer,
  fuel_type text,
  transmission text,
  drive_type text,
  body_type text,
  location text,
  vin_masked text,
  image_urls jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  source_updated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  imported_at timestamptz not null default now(),
  normalized_at timestamptz,
  promotion_status text not null default 'pending',
  promotion_note text,
  updated_at timestamptz not null default now()
);

create index if not exists chestny_catalog_staging_status_idx
  on public.chestny_catalog_staging(promotion_status, last_seen_at desc);
create index if not exists chestny_catalog_staging_identity_idx
  on public.chestny_catalog_staging(manufacturer, model, model_year);

alter table public.chestny_catalog_staging enable row level security;
revoke all privileges on table public.chestny_catalog_staging from anon, authenticated;

comment on table public.chestny_catalog_staging is
  'Private metadata mirror of Chesty Prigon. Raw JSON and image binaries stay in the source project unless explicitly imported for an audit.';
comment on column public.chestny_catalog_staging.raw_payload is
  'Optional audit payload. The normal importer leaves this as an empty object to avoid duplicating the source catalogue.';
comment on column public.chestny_catalog_staging.image_urls is
  'External image URLs only; image binaries are never copied into TL Auto staging.';
