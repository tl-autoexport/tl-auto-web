-- Captured TKS controls are evidence for tariff rules, not vehicle facts.
-- They remain private and do not change published prices by themselves.
create table if not exists public.tks_calculation_controls (
  id uuid primary key default gen_random_uuid(),
  source_row_id uuid not null unique references public.vehicle_power_source_rows(id) on delete cascade,
  control_kind text not null default 'util_fee' check (control_kind in ('util_fee', 'customs_duty', 'customs_fee')),
  vehicle_category text not null check (vehicle_category in ('M1', 'N1', 'other')),
  propulsion_type text not null check (propulsion_type in ('ice', 'electric', 'hybrid_parallel', 'hybrid_sequential')),
  importer_type text not null check (importer_type in ('individual', 'legal_entity')),
  age_code text not null,
  age_band text not null check (age_band in ('under_3', 'from_3_to_5', 'from_5_to_7', 'over_7')),
  cost_amount numeric(16,2),
  currency_code text,
  engine_cc integer,
  power_kw numeric(10,4),
  hybrid_dvs_power_kw numeric(10,4),
  hybrid_electric_power_kw_30min numeric(10,4),
  observed_util_coefficient numeric(12,4),
  observed_util_rub bigint,
  observed_customs_fee_rub bigint,
  observed_duty_rub numeric(16,2),
  response_snapshot jsonb not null default '{}'::jsonb,
  review_status text not null default 'captured' check (review_status in ('captured', 'reviewed', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (power_kw is null or power_kw > 0),
  check (observed_util_coefficient is null or observed_util_coefficient >= 0),
  check (observed_util_rub is null or observed_util_rub >= 0)
);

create index if not exists tks_calculation_controls_lookup_idx
  on public.tks_calculation_controls(propulsion_type, age_band, power_kw, review_status);

alter table public.tks_calculation_controls
  add column if not exists power_hp numeric(10,4),
  add column if not exists observed_customs_fee_rub bigint,
  add column if not exists observed_duty_rub numeric(16,2);

comment on table public.tks_calculation_controls is
  'Normalized TKS HAR checks used to verify tariff-rule implementation.';

alter table public.tks_calculation_controls enable row level security;
revoke all privileges on table public.tks_calculation_controls from anon, authenticated;
