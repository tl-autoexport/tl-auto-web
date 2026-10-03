-- Display names are separate from source fields used by technical/power matching.
create table if not exists public.catalog_vehicle_names (
  car_id uuid primary key references public.cars(id) on delete cascade,
  rules_version text not null,
  run_id uuid not null,
  brand text not null,
  model text not null,
  generation_label text,
  generation_full_name text,
  modification_label text,
  trim_label text,
  version_line text,
  compact_version text,
  evidence jsonb not null,
  normalized_at timestamptz not null default now()
);
comment on table public.catalog_vehicle_names is
  'Persisted canonical display names. Raw cars/staging/snapshot names remain intact. Evidence contains scoped source names, codes and unresolved statuses; does not approve power or equipment.';
alter table public.catalog_vehicle_names enable row level security;
drop policy if exists "Public can read catalog vehicle names" on public.catalog_vehicle_names;
revoke all on public.catalog_vehicle_names from anon, authenticated;
-- The catalogue API reads with the server role; evidence is not exposed directly.
grant all on public.catalog_vehicle_names to service_role;
