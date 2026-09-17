-- Support pure electric vehicles in the customs power model.
--
-- The previous revision of the constraint required an ICE power for
-- `hybrid_type = 'none'`, which makes a battery-electric specification
-- impossible to store (it has no internal combustion engine). For a BEV the
-- customs value is the 30-minute rating of the traction motor, exactly as for a
-- series hybrid. `hybrid_type = 'electric'` expresses that case, and the 30-minute
-- rating becomes the required component instead of the ICE power.
alter table public.vehicle_power_specs
  drop constraint if exists vehicle_power_specs_hybrid_type_check;
alter table public.vehicle_power_specs
  add constraint vehicle_power_specs_hybrid_type_check
  check (hybrid_type in ('none', 'electric', 'series', 'parallel', 'combined', 'phev'));

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
      hybrid_type in ('electric', 'series')
      and power_electric_30min_hp is not null
    )
    or (
      hybrid_type in ('parallel', 'combined', 'phev')
      and power_ice_hp is not null
      and power_electric_30min_hp is not null
    )
  );

comment on column public.vehicle_power_specs.hybrid_type is
  'Powertrain topology: none (ice), electric, series, parallel, combined or phev. Determines how customs_power_hp is composed.';
