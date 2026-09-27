-- Keep parallel-hybrid electric motor power separate from the EV/series-hybrid
-- 30-minute rating. Existing 30-minute evidence remains in its original field.

alter table public.vehicle_power_source_batches
  drop constraint if exists vehicle_power_source_batches_source_kind_check;
alter table public.vehicle_power_source_batches
  add constraint vehicle_power_source_batches_source_kind_check check (
    source_kind in ('customer_workbook', 'tks_har', 'sbkts', 'otts', 'epts',
      'manufacturer_document', 'vin_decoder', 'manual', 'danawa')
  );

alter table public.vehicle_power_evidence
  drop constraint if exists vehicle_power_evidence_source_kind_check;
alter table public.vehicle_power_evidence
  add constraint vehicle_power_evidence_source_kind_check check (
    source_kind in ('sbkts', 'otts', 'epts', 'manufacturer_document', 'vin_decoder',
      'tks_har', 'customer_workbook', 'manual', 'danawa')
  );

alter table public.vehicle_power_evidence
  add column if not exists hybrid_electric_motor_power_kw numeric(10,4);

alter table public.vehicle_power_specs
  add column if not exists hybrid_electric_motor_power_kw numeric(10,4),
  add column if not exists power_electric_motor_hp numeric(8,2);

alter table public.tks_calculation_controls
  add column if not exists hybrid_electric_motor_power_kw numeric(10,4);

alter table public.vehicle_power_evidence
  drop constraint if exists vehicle_power_evidence_check1;
alter table public.vehicle_power_evidence
  add constraint vehicle_power_evidence_power_components_check check (
    (propulsion_type = 'ice' and dvs_power_kw is not null)
    or (propulsion_type in ('electric', 'hybrid_sequential') and electric_power_kw_30min is not null)
    or (propulsion_type = 'hybrid_parallel' and dvs_power_kw is not null
      and (hybrid_electric_motor_power_kw is not null or electric_power_kw_30min is not null))
  );

alter table public.vehicle_power_specs
  drop constraint if exists vehicle_power_specs_check2;
alter table public.vehicle_power_specs
  add constraint vehicle_power_specs_power_components_check check (
    (propulsion_type = 'ice' and dvs_power_kw is not null and calculation_power_kw = dvs_power_kw)
    or (propulsion_type in ('electric', 'hybrid_sequential')
      and electric_power_kw_30min is not null and calculation_power_kw = electric_power_kw_30min)
    or (propulsion_type = 'hybrid_parallel' and dvs_power_kw is not null
      and (hybrid_electric_motor_power_kw is not null or electric_power_kw_30min is not null)
      and calculation_power_kw = dvs_power_kw + coalesce(hybrid_electric_motor_power_kw, electric_power_kw_30min))
  );

alter table public.vehicle_power_specs
  drop constraint if exists vehicle_power_specs_customs_power_required;
alter table public.vehicle_power_specs
  add constraint vehicle_power_specs_customs_power_required check (
    customs_power_hp is null
    or ((hybrid_type is null or hybrid_type = 'none') and power_ice_hp is not null)
    or (hybrid_type in ('electric', 'series') and power_electric_30min_hp is not null)
    or (hybrid_type in ('parallel', 'combined', 'phev') and power_ice_hp is not null
      and (power_electric_motor_hp is not null or power_electric_30min_hp is not null))
  );

comment on column public.vehicle_power_evidence.hybrid_electric_motor_power_kw is
  'Parallel-hybrid electric motor power component; distinct from a regulatory 30-minute EV/series-hybrid rating.';
comment on column public.vehicle_power_specs.hybrid_electric_motor_power_kw is
  'Parallel-hybrid electric motor power used with dvs_power_kw in parallel_sum; distinct from electric_power_kw_30min.';
comment on column public.vehicle_power_specs.power_electric_motor_hp is
  'Parallel-hybrid electric motor power in PS; distinct from power_electric_30min_hp.';
comment on column public.tks_calculation_controls.hybrid_electric_motor_power_kw is
  'Electric motor component submitted in the TKS parallel-hybrid calculation; distinct from a 30-minute rating.';
