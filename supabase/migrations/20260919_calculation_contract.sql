-- Completes the calculation contract that the legal power band already relies on.
--
-- `calculation_power_status`, `calculation_power_kw`, `power_basis` and
-- `power_resolution_source` already exist on `cars`, but writers bypassed them:
-- a card could carry `price_rub` and a free-form `vehicle_specs.calculation_status`
-- while `power_basis` stayed empty. This migration adds the missing month
-- provenance, keeps the historic marker as provenance only, and turns the
-- coupling into database invariants.
--
-- The constraints are added NOT VALID so the migration cannot fail on rows that
-- predate the contract; they are validated after the data repair, which is part
-- of the same rollout.
alter table public.cars
  add column if not exists calculation_month smallint
    check (calculation_month between 1 and 12),
  add column if not exists calculation_month_source text
    check (calculation_month_source in ('registration_date', 'source_listing', 'fallback')),
  add column if not exists legacy_calculation_status text;

comment on column public.cars.calculation_month is
  'Month actually used by the RU calculation, kept so the duty band can be reviewed.';
comment on column public.cars.calculation_month_source is
  'registration_date | source_listing | fallback. A fallback month is the labelled June default, never a silent one.';
comment on column public.cars.legacy_calculation_status is
  'Historic free-form calculation marker preserved for provenance. Never read as the current status.';

alter table public.cars drop constraint if exists cars_price_requires_resolved_power;
alter table public.cars add constraint cars_price_requires_resolved_power
  check (price_rub is null or calculation_power_status in ('matched', 'approved')) not valid;

alter table public.cars drop constraint if exists cars_power_kw_requires_basis;
alter table public.cars add constraint cars_power_kw_requires_basis
  check (calculation_power_kw is null or power_basis is not null) not valid;

alter table public.cars drop constraint if exists cars_electric_uses_electric_basis;
alter table public.cars add constraint cars_electric_uses_electric_basis
  check (fuel_type <> 'electric' or power_basis is null or power_basis = 'electric_30min') not valid;

alter table public.cars drop constraint if exists cars_electric_has_no_ice_power;
alter table public.cars add constraint cars_electric_has_no_ice_power
  check (fuel_type <> 'electric' or hybrid_dvs_power_hp is null) not valid;

alter table public.cars drop constraint if exists cars_month_source_requires_month;
alter table public.cars add constraint cars_month_source_requires_month
  check (calculation_month_source is null or calculation_month is not null) not valid;
