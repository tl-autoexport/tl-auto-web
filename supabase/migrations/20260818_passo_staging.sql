-- Passo staging area for the first controlled import.
-- This migration is intentionally separate from public.cars and does not
-- change the Encar catalog or make Passo records visible in production.

create table if not exists public.passo_catalog_staging (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('passo_bike', 'passo_boat')),
  source_id text not null,
  source_url text not null,
  vehicle_type text not null check (vehicle_type in ('motorcycle', 'scooter', 'jetski')),
  source_updated_at timestamptz,
  brand text,
  model text,
  year integer,
  mileage_km integer,
  price_krw bigint,
  seller_region text,
  vehicle_specs jsonb not null default '{}'::jsonb,
  image_urls jsonb not null default '[]'::jsonb,
  import_status text not null default 'validated'
    check (import_status in ('validated', 'needs_review', 'rejected')),
  validation_warnings text[] not null default '{}'::text[],
  parser_version text not null,
  fetched_at timestamptz not null default now(),
  unique (source, source_id)
);

create index if not exists passo_staging_type_updated_idx
  on public.passo_catalog_staging(vehicle_type, source_updated_at desc);

create index if not exists passo_staging_status_idx
  on public.passo_catalog_staging(import_status, fetched_at desc);

comment on table public.passo_catalog_staging is
  'Read-reviewed Passo records before explicit promotion to public.cars.';

comment on column public.passo_catalog_staging.image_urls is
  'External Passo image URLs only; no binary storage in staging.';

comment on column public.passo_catalog_staging.vehicle_specs is
  'Safe category-specific fields only; no seller contacts or raw personal data.';
