alter table public.tks_calculation_controls
  add column if not exists power_hp numeric(10,4),
  add column if not exists observed_customs_fee_rub bigint,
  add column if not exists observed_duty_rub numeric(16,2);

alter table public.tks_calculation_controls
  add constraint tks_calculation_controls_power_hp_check
  check (power_hp is null or power_hp > 0)
  not valid;
