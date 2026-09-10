-- TL Auto power-resolution workflow.
--
-- Keeps a full provenance trail for the value used by the calculator while
-- preserving the raw Encar listing data. This migration changes no prices.

alter table public.vehicle_power_evidence
  add column if not exists source_title text,
  add column if not exists source_retrieved_at timestamptz,
  add column if not exists confidence_score numeric(5,2),
  add column if not exists evidence_note text,
  add column if not exists verification_status text not null default 'draft'
    check (verification_status in ('draft', 'approved', 'review_required', 'rejected'));

alter table public.vehicle_power_specs
  add column if not exists engine_power_hp numeric(10,4),
  add column if not exists system_power_hp numeric(10,4),
  add column if not exists power_basis text
    check (power_basis in ('combustion_engine', 'electric_30min', 'parallel_sum')),
  add column if not exists source_priority integer not null default 100;

alter table public.vehicle_power_spec_matches
  add column if not exists drive_type text,
  add column if not exists badge_normalized text;

alter table public.cars
  add column if not exists power_confidence text not null default 'automatic'
    check (power_confidence in ('official', 'high', 'automatic')),
  add column if not exists power_basis text
    check (power_basis in ('combustion_engine', 'electric_30min', 'parallel_sum')),
  add column if not exists power_resolution_source text,
  add column if not exists power_resolution_note text,
  add column if not exists power_resolved_at timestamptz;

create table if not exists public.vehicle_power_resolution_events (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  resolution_version text not null,
  status text not null check (status in ('official', 'high', 'automatic', 'review_required')),
  selected_spec_id uuid references public.vehicle_power_specs(id) on delete set null,
  selected_evidence_id uuid references public.vehicle_power_evidence(id) on delete set null,
  selected_power_kw numeric(10,4),
  power_basis text check (power_basis in ('combustion_engine', 'electric_30min', 'parallel_sum')),
  reason text not null,
  candidates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists vehicle_power_resolution_events_car_idx
  on public.vehicle_power_resolution_events(car_id, created_at desc);
create index if not exists vehicle_power_spec_matches_precise_lookup_idx
  on public.vehicle_power_spec_matches(brand, model, generation, fuel_type, drive_type, priority);

alter table public.vehicle_power_resolution_events enable row level security;
revoke all privileges on table public.vehicle_power_resolution_events from anon, authenticated;

comment on column public.cars.power_confidence is
  'official = approved evidence; high = deterministic exact configuration match; automatic = transparent non-final automatic match.';
comment on column public.cars.power_basis is
  'The legal power basis used for utility/tax calculation, not merely a display power.';
comment on table public.vehicle_power_resolution_events is
  'Immutable explanation of why a calculator power value was selected for a car.';
