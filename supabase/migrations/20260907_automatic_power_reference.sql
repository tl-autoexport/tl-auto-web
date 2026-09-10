-- Provisional TL Auto reference for preliminary catalog calculations.
-- It is explicitly separate from approved TKS specifications.

create table if not exists public.vehicle_power_automatic_reference (
  id uuid primary key default gen_random_uuid(),
  configuration_key text not null unique,
  brand text,
  model text,
  fuel_type text,
  engine_cc integer,
  drive_type text,
  badge text,
  badge_detail text,
  year_from integer,
  year_to integer,
  power_hp numeric(10,4),
  power_kw numeric(10,4),
  source text not null,
  status text not null default 'automatic' check (status in ('automatic', 'confirmed', 'retired')),
  note text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists vehicle_power_automatic_reference_lookup_idx
  on public.vehicle_power_automatic_reference(brand, model, fuel_type, engine_cc);

drop trigger if exists vehicle_power_automatic_reference_set_updated_at on public.vehicle_power_automatic_reference;
create trigger vehicle_power_automatic_reference_set_updated_at
before update on public.vehicle_power_automatic_reference
for each row execute procedure public.set_updated_at();

alter table public.vehicle_power_automatic_reference enable row level security;
revoke all privileges on table public.vehicle_power_automatic_reference from anon, authenticated;

comment on table public.vehicle_power_automatic_reference is
  'Provisional automatic values for preliminary estimates. Never treated as approved TKS evidence.';
