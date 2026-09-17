-- Explicit hybrid power model for the TKS customs calculation.
--
-- The customs threshold must use the ICE power (ordinary cars), the 30-minute
-- electric motor rating (series hybrids) or the sum of both (parallel and
-- combined hybrids, including most PHEVs). A marketing "system power" figure
-- must never be used for the calculation, so it is stored separately and is
-- display-only.
--
-- `customs_power_hp` is the single value the calculation and the power
-- threshold read. When the hybrid type or the 30-minute electric rating is
-- unknown the specification must not be used at all: the candidate is dropped
-- from approved resolution and the card stays in `power_pending`.
alter table public.vehicle_power_specs
  add column if not exists hybrid_type text
    check (hybrid_type in ('none', 'series', 'parallel', 'combined', 'phev')),
  add column if not exists power_ice_hp numeric(8, 2),
  add column if not exists power_electric_30min_hp numeric(8, 2),
  add column if not exists customs_power_hp numeric(8, 2),
  add column if not exists system_power_hp numeric(8, 2);

comment on column public.vehicle_power_specs.hybrid_type is
  'Hybrid topology: none, series, parallel, combined or phev. Together with power_electric_30min_hp it determines how customs_power_hp is composed.';
comment on column public.vehicle_power_specs.power_ice_hp is
  'Internal combustion engine power. Used for ordinary cars and as a summand for parallel/combined hybrids.';
comment on column public.vehicle_power_specs.power_electric_30min_hp is
  'Maximum 30-minute electric motor power. Required for series, parallel, combined and phev entries.';
comment on column public.vehicle_power_specs.customs_power_hp is
  'The only value used by the calculation and the power threshold: ICE power, the 30-minute electric rating, or their sum depending on hybrid_type.';
comment on column public.vehicle_power_specs.system_power_hp is
  'Marketing system power, stored for display only and never used in the calculation.';

-- A hybrid entry whose type or 30-minute rating is missing cannot produce a
-- customs value, so it must not be resolvable.
alter table public.vehicle_power_specs
  drop constraint if exists vehicle_power_specs_customs_power_required;
alter table public.vehicle_power_specs
  add constraint vehicle_power_specs_customs_power_required check (
    customs_power_hp is null
    or (
      (hybrid_type is null or hybrid_type = 'none')
      and power_ice_hp is not null
    )
    or (
      hybrid_type = 'series'
      and power_electric_30min_hp is not null
    )
    or (
      hybrid_type in ('parallel', 'combined', 'phev')
      and power_ice_hp is not null
      and power_electric_30min_hp is not null
    )
  );

create index if not exists vehicle_power_specs_hybrid_idx
  on public.vehicle_power_specs(hybrid_type, customs_power_hp);
