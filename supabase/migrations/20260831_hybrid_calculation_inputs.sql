alter table public.cars
  add column if not exists hybrid_dvs_power_hp numeric,
  add column if not exists hybrid_electric_power_kw numeric,
  add column if not exists hybrid_dvs_above_electric_30min boolean,
  add column if not exists hybrid_sequential boolean;

comment on column public.cars.hybrid_dvs_power_hp is 'Hybrid internal-combustion engine power in hp, as required by TKS.';
comment on column public.cars.hybrid_electric_power_kw is 'Hybrid electric motor power in kW, as required by TKS.';
comment on column public.cars.hybrid_dvs_above_electric_30min is 'TKS mdvs_gt_m30ed flag.';
comment on column public.cars.hybrid_sequential is 'TKS sequential hybrid flag.';
